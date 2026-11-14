import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { withSessionLookupTransaction } from '../config/database';
import { runWithAuthorizationContext, setActivePermissionCode } from './requestAuthorizationContext';
import { OWN_SCOPED_PERMISSION_CODES, SITE_SCOPED_PERMISSION_CODES } from '../security/authorizationScopes';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  tenantId: string;
  role: string;
  permissions: string[];
  sitePermissions?: Array<{ code: string; siteId: string }>;
  ownPermissions?: string[];
  permissionGrants?: Array<{ code: string; dataScope: 'TENANT' | 'SITE' | 'OWN'; siteId?: string }>;
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
                NULL::uuid AS site_id, 'TENANT'::text AS data_scope
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           JOIN role_permissions rp ON rp.role_id = r.id
           JOIN permissions p ON p.id = rp.permission_id
         UNION ALL
         SELECT tur.user_id, tur.tenant_id, tr.name AS role_name, p.code AS permission_code,
                COALESCE(tur.site_id, trp.site_id) AS site_id,
                CASE WHEN tur.site_id IS NOT NULL AND trp.data_scope <> 'OWN'
                     THEN 'SITE' ELSE trp.data_scope END AS data_scope
           FROM tenant_user_roles tur
           JOIN tenant_roles tr ON tr.id = tur.role_id AND tr.tenant_id = tur.tenant_id
           JOIN tenant_role_permissions trp ON trp.role_id = tr.id AND trp.tenant_id = tr.tenant_id
           JOIN permissions p ON p.id = trp.permission_id
          WHERE ((trp.data_scope = 'TENANT' AND trp.site_id IS NULL)
              OR (trp.data_scope = 'SITE' AND trp.site_id IS NOT NULL)
              OR (trp.data_scope = 'OWN' AND trp.site_id IS NULL))
            AND (tur.site_id IS NULL OR trp.site_id IS NULL OR tur.site_id = trp.site_id)
       )
       SELECT s.user_id, s.tenant_id, u.email, tm.first_name, tm.last_name, u.is_active, u.is_locked,
              u.is_superadmin, tm.is_active AS membership_active, tm.is_locked AS membership_locked,
              COALESCE(string_agg(DISTINCT ag.role_name, ', '), '') AS role_names,
              ag.permission_code, ag.site_id, ag.data_scope
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         JOIN tenants t ON t.id = s.tenant_id AND t.is_active = true
         JOIN tenant_memberships tm ON tm.user_id = s.user_id AND tm.tenant_id = s.tenant_id
         LEFT JOIN auth_grants ag ON ag.user_id = s.user_id AND ag.tenant_id = s.tenant_id
        WHERE s.token_hash = $1 AND s.revoked = false AND s.expires_at > CURRENT_TIMESTAMP
        GROUP BY s.user_id, s.tenant_id, u.email, tm.first_name, tm.last_name, u.is_active, u.is_locked, u.is_superadmin,
                  tm.is_active, tm.is_locked, ag.permission_code, ag.site_id, ag.data_scope`,
      [tokenHash]
    ));
    if (!sessionRes?.rows.length || !sessionRes.rows[0].is_active || sessionRes.rows[0].is_locked ||
        !sessionRes.rows[0].membership_active || sessionRes.rows[0].membership_locked) {
      res.status(401).json({ success:false, message:'Sitzung ungültig oder abgelaufen.' }); return;
    }
    const row=sessionRes.rows[0];
    const permissionGrants = [...new Map(sessionRes.rows
      .filter((x: any) => x.permission_code)
      .map((x: any) => {
        const grant = {
          code: x.permission_code as string,
          dataScope: x.data_scope as 'TENANT' | 'SITE' | 'OWN',
          ...(x.site_id ? { siteId: x.site_id as string } : {})
        };
        return [`${grant.code}:${grant.dataScope}:${grant.siteId ?? ''}`, grant];
      })).values()];
    const permissions = [...new Set(permissionGrants
      .filter(grant => grant.dataScope === 'TENANT' && !grant.siteId)
      .map(grant => grant.code))];
    const sitePermissions = permissionGrants
      .filter(grant => grant.dataScope === 'SITE' && grant.siteId)
      .map(grant => ({ code: grant.code, siteId: grant.siteId! }));
    const ownPermissions = [...new Set(permissionGrants
      .filter(grant => grant.dataScope === 'OWN')
      .map(grant => grant.code))];
    req.user={
      userId:row.user_id,
      email:row.email,
      fullName:`${row.first_name} ${row.last_name}`,
      tenantId:row.tenant_id,
      role:row.role_names,
      permissions,
      sitePermissions,
      ownPermissions,
      permissionGrants,
      isSuperAdmin: row.is_superadmin,
      sessionHash:tokenHash
    };
    runWithAuthorizationContext(row.user_id, next);
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

    const user = req.user;
    const hasTenantGrant = user.permissions.includes(permissionCode);
    const siteListGrant = permissionCode === 'users:read' &&
      req.method === 'GET' && req.path === '/api/v1/admin/users' &&
      typeof req.query.siteId === 'string' &&
      user.sitePermissions?.some(grant => grant.code === permissionCode && grant.siteId === req.query.siteId);
    const hasSiteGrant = siteListGrant || (SITE_SCOPED_PERMISSION_CODES.has(permissionCode) &&
      user.sitePermissions?.some(grant => grant.code === permissionCode));
    const hasOwnGrant = OWN_SCOPED_PERMISSION_CODES.has(permissionCode) &&
      user.ownPermissions?.includes(permissionCode);
    if (hasTenantGrant || hasSiteGrant || hasOwnGrant) {
      setActivePermissionCode(permissionCode);
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

    const granted = permissionCodes.find(permissionCode =>
      req.user!.permissions.includes(permissionCode) ||
      (SITE_SCOPED_PERMISSION_CODES.has(permissionCode) &&
        req.user!.sitePermissions?.some(grant => grant.code === permissionCode)) ||
      (permissionCode === 'users:read' && req.method === 'GET' &&
        req.path === '/api/v1/admin/users' && typeof req.query.siteId === 'string' &&
        req.user!.sitePermissions?.some(grant =>
          grant.code === permissionCode && grant.siteId === req.query.siteId
        )) ||
      (OWN_SCOPED_PERMISSION_CODES.has(permissionCode) &&
        req.user!.ownPermissions?.includes(permissionCode))
    );
    if (granted) {
      setActivePermissionCode(granted);
      next();
      return;
    }

    res.status(403).json({
      success: false,
      message: `Zugriff verweigert: Erforderlich ist eine der Berechtigungen ${permissionCodes.map(code => `'${code}'`).join(', ')}`
    });
  };
}
