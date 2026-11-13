import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '../config/database';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  permissions: string[];
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
    const sessionRes = await query(
      `SELECT s.user_id, s.tenant_id, s.expires_at, u.email, u.is_active, r.name AS role_name, p.code
       FROM user_sessions s JOIN users u ON u.id=s.user_id
       JOIN tenants t ON t.id=s.tenant_id AND t.is_active=true
       JOIN user_roles ur ON ur.user_id=s.user_id AND ur.tenant_id=s.tenant_id
       JOIN roles r ON r.id=ur.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id
       LEFT JOIN permissions p ON p.id=rp.permission_id
       WHERE s.token_hash=$1 AND s.revoked=false AND s.expires_at>CURRENT_TIMESTAMP`, [tokenHash]);
    if (!sessionRes.rows.length || !sessionRes.rows[0].is_active) { res.status(401).json({ success:false, message:'Sitzung ungültig oder abgelaufen.' }); return; }
    const row=sessionRes.rows[0];
    req.user={ userId:row.user_id, email:row.email, tenantId:row.tenant_id, role:row.role_name, permissions:sessionRes.rows.map((x:any)=>x.code).filter(Boolean), sessionHash:tokenHash };
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

    const { permissions } = req.user;

    if (permissions.includes(permissionCode)) {
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
