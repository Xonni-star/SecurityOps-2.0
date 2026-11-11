import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

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

// In-Memory Token-Widerrufsliste (im Cluster: Redis oder PostgreSQL user_sessions)
const revokedTokens = new Set<string>();

export function revokeToken(token: string): void {
  revokedTokens.add(token);
}

export function authenticateJwt(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Nicht autorisiert: Fehlender oder ungültiger Authorization Bearer Token'
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (revokedTokens.has(token)) {
    res.status(401).json({
      success: false,
      message: 'Sitzung wurde widerrufen (Token Blacklist).'
    });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;

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
    // Systemadministrator besitzt vollen Zugriff
    if (role === 'Systemadministrator' || permissions.includes(permissionCode) || permissions.includes('*')) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      message: `Zugriff verweigert: Fehlende Berechtigung '${permissionCode}'`
    });
  };
}
