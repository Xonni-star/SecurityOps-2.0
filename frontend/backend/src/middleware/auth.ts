import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';
import { query } from '../config/database';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticateJwt(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Nicht autorisiert: Fehlender oder ungültiger Authorization Bearer Token'
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;

    // Token-Hash zur Überprüfung in user_sessions (datenbankgestützter Widerruf)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const sessionRes = await query(
      `SELECT id, revoked, expires_at 
       FROM user_sessions 
       WHERE token_hash = $1 AND user_id = $2 AND tenant_id = $3`,
      [tokenHash, payload.sub, payload.tenantId]
    );

    if (sessionRes.rows.length === 0 || sessionRes.rows[0].revoked) {
      res.status(401).json({
        success: false,
        message: 'Sitzung ist ungültig oder wurde widerrufen.'
      });
      return;
    }

    if (new Date(sessionRes.rows[0].expires_at) < new Date()) {
      res.status(401).json({
        success: false,
        message: 'Sitzung ist abgelaufen.'
      });
      return;
    }

    // SICHERHEITSPRINZIP:
    // Der Mandantenkontext (tenantId) wird niemals aus einem vom Browser übermittelten
    // X-Tenant-ID Header übernommen, sondern stammt ausnahmslos aus dem signierten JWT.
    req.user = {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
      permissions: payload.permissions || []
    };

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Sitzung ungültig oder abgelaufen.'
    });
  }
}

export function requirePermission(permissionCode: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Nicht authentifiziert' });
      return;
    }

    const { role, permissions } = req.user;

    // Nur der Systemadministrator oder Träger der expliziten Berechtigung haben Zugriff
    if (role === 'Systemadministrator' || permissions.includes(permissionCode)) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      message: `Zugriff verweigert: Fehlende Berechtigung '${permissionCode}'`
    });
  };
}
