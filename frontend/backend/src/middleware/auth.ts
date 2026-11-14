import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { withSessionLookupTransaction } from '../config/database';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  tenantId: string;
  role: string;
  permissions: string[];
  sitePermissions?: Array<{ code: string; siteId: string }>;
  isSuperAdmin?: boolean;
  sessionHash: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticateJwt(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=', 2)).filter(v => v.length === 2));
  const sessionId = cookies['secops_session'];
  // The session format is exactly 32 random bytes encoded base64url. This also
  // invalidates legacy JWTs still present in old session rows.
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) { res.status(401).json({ success: false, message: 'Nicht authentifiziert.' }); return; }
  try {
    const tokenHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    const sessionRes = await withSessionLookupTransaction(tokenHash, db => db.query(
      `WITH auth_grants AS (
         SELECT ur.user_id, ur.tenant_id, r.name AS role_name, p.code AS permission_code,
                NULL::uuid AS site_id
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id
         UNION ALL
         SELECT tur.user_id, tur.tenant_id, tr.name AS role_name, p.code AS permission_code,
                COALESCE(tur.site_id, trp.site_id) AS site_id
           FROM tenant_user_roles tur
           JOIN tenant_roles tr ON tr.id = tur.role_id AND tr.tenant_id = tur.tenant_id
           JOIN tenant_role_permissions trp ON trp.role_id = tr.id AND trp.tenant_id = tr.tenant_id
           JOIN permissions p ON p.id = trp.permission_id
          WHERE trp.data_scope <> 'OWN'
            AND ((trp.data_scope = 'TENANT' AND trp.site_id IS NULL)
              OR (trp.data_scope = 'SITE' AND trp.site_id IS NOT NULL))
            AND (tur.site_id IS NULL OR trp.site_id IS NULL OR tur.site_id = trp.site_id)
       )
       SELECT s.user_id, s.tenant_id, u.email, tm.first_name, tm.last_name, u.is_active, u.is_locked,
              u.is_superadmin, tm.is_active AS membership_active, tm.is_locked AS membership_locked,
              COALESCE(string_agg(DISTINCT ag.role_name, ', '), '') AS role_names,
              ag.permission_code, ag.site_id
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         JOIN tenants t ON t.id = s.tenant_id AND t.is_active = true
         JOIN tenant_memberships tm ON tm.user_id = s.user_id AND tm.tenant_id = s.tenant_id
         LEFT JOIN auth_grants ag ON ag.user_id = s.user_id AND ag.tenant_id = s.tenant_id
        WHERE s.token_hash = $1 AND s.revoked = false AND s.expires_at > CURRENT_TIMESTAMP
        GROUP BY s.user_id, s.tenant_id, u.email, tm.first_name, tm.last_name, u.is_active, u.is_locked, u.is_superadmin,
                  tm.is_active, tm.is_locked, ag.permission_code, ag.site_id`,
      [tokenHash]
    ));
    if (!sessionRes?.rows.length || !sessionRes.rows[0].is_active || sessionRes.rows[0].is_locked ||
        !sessionRes.rows[0].membership_active || sessionRes.rows[0].membership_locked) {
      res.status(401).json({ success:false, message:'Sitzung ungültig oder abgelaufen.' }); return;
    }
    const row=sessionRes.rows[0];
    const permissions = [...new Set(sessionRes.rows.filter((x:any) => x.permission_code && !x.site_id).map((x:any) => x.permission_code))];
    const sitePermissions = [...new Map(sessionRes.rows
      .filter((x:any) => x.permission_code && x.site_id)
      .map((x:any) => [`${x.permission_code}:${x.site_id}`, { code: x.permission_code, siteId: x.site_id }])).values()];
    req.user={
      userId:row.user_id,
      email:row.email,
      fullName:`${row.first_name} ${row.last_name}`,
      tenantId:row.tenant_id,
      role:row.role_names,
      permissions,
      sitePermissions,
      isSuperAdmin: row.is_superadmin,
      sessionHash:tokenHash
    };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * RBAC Berechtigungsprüfung:
 * WICHTIG (Schritt 3): Keine pauschale Sonderbehandlung 'role === Systemadministrator'.
 * Alle Benutzer, einschließlich Administratoren, benötigen die ausdrückliche Berechtigung
 * aus der Datenbank für die jeweilige Ressource/Aktion.
 */
export function requirePermission(permissionCode: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Nicht authentifiziert' });
      return;
    }

    const { permissions, sitePermissions = [] } = req.user;

    const listPathSupportsSiteFilter = req.method === 'GET' &&
      ['/api/v1/admin/users', '/api/v1/employees'].includes(req.path);
    const siteScopedCreatePaths = new Set([
      '/api/v1/shifts', '/api/v1/keys', '/api/v1/handovers',
      '/api/v1/alarms', '/api/v1/patrol/exceptions', '/api/v1/patrol/rounds',
      '/api/v1/logbook'
    ]);
    const siteScopedCreate = req.method === 'POST' && siteScopedCreatePaths.has(req.path) &&
      typeof req.body?.siteId === 'string';
    const requestedSiteId = req.params.siteId ??
      (listPathSupportsSiteFilter && typeof req.query.siteId === 'string' ? req.query.siteId : undefined) ??
      (siteScopedCreate ? req.body.siteId as string : undefined);
    if (permissions.includes(permissionCode) ||
        (requestedSiteId && sitePermissions.some(grant => grant.code === permissionCode && grant.siteId === requestedSiteId))) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      message: `Zugriff verweigert: Fehlende Berechtigung '${permissionCode}'`
    });
  };
}

export function requireAnyPermission(...permissionCodes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Nicht authentifiziert' });
      return;
    }

    const granted = permissionCodes.find(permissionCode => req.user!.permissions.includes(permissionCode));
    if (granted) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      message: `Zugriff verweigert: Erforderlich ist eine der Berechtigungen ${permissionCodes.map(code => `'${code}'`).join(', ')}`
    });
  };
}
