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
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    
    // WICHTIG: Die tenantId wird niemals ungeprüft aus dem Browser übernommen!
    // Sie entstammt direkt dem kryptografisch verifizierten JWT.
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
