import { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/database';
import { env } from '../config/env';
import { revokeToken } from '../middleware/auth';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  requestedTenantId: z.string().uuid().optional()
});

// Brute-Force Schutz: Fehlversuchs-Tracker
const loginAttempts: Record<string, { count: number; lockedUntil: number | null }> = {};

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, requestedTenantId } = loginSchema.parse(req.body);

    const now = Date.now();
    const attempt = loginAttempts[email] || { count: 0, lockedUntil: null };

    if (attempt.lockedUntil && attempt.lockedUntil > now) {
      res.status(429).json({
        success: false,
        message: 'Zu viele Fehlversuche. Das Konto ist vorübergehend gesperrt (15 Minuten Brute-Force-Schutz).'
      });
      return;
    }

    // 1. Benutzer aus PostgreSQL abfragen
    const userResult = await query(
      'SELECT id, email, password_hash, first_name, last_name, is_active FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      attempt.count += 1;
      if (attempt.count >= 5) {
        attempt.lockedUntil = now + 15 * 60 * 1000;
      }
      loginAttempts[email] = attempt;
      res.status(401).json({ success: false, message: 'Ungültige Anmeldedaten.' });
      return;
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      res.status(403).json({ success: false, message: 'Benutzerkonto ist deaktiviert.' });
      return;
    }

    // 2. Passwortprüfung mit Argon2id
    const validPassword = await argon2.verify(user.password_hash, password);
    if (!validPassword) {
      attempt.count += 1;
      if (attempt.count >= 5) {
        attempt.lockedUntil = now + 15 * 60 * 1000;
      }
      loginAttempts[email] = attempt;
      res.status(401).json({ success: false, message: 'Ungültige Anmeldedaten.' });
      return;
    }

    // Reset bei erfolgreicher Anmeldung
    delete loginAttempts[email];

    // 3. Mandantenzugehörigkeit und Rollen serverseitig aus der Datenbank laden
    let tenantQuery = `
      SELECT t.id as tenant_id, t.name as tenant_name, r.id as role_id, r.name as role_name
      FROM user_roles ur
      JOIN tenants t ON ur.tenant_id = t.id
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1 AND t.is_active = true
    `;
    const queryParams: any[] = [user.id];

    if (requestedTenantId) {
      tenantQuery += ' AND t.id = $2';
      queryParams.push(requestedTenantId);
    }

    tenantQuery += ' LIMIT 1';

    const tenantResult = await query(tenantQuery, queryParams);

    if (tenantResult.rows.length === 0) {
      res.status(403).json({
        success: false,
        message: 'Keine gültige Mandantenzuordnung für diesen Benutzer gefunden.'
      });
      return;
    }

    const { tenant_id, tenant_name, role_id, role_name } = tenantResult.rows[0];

    // 4. Granulare Berechtigungen für die zugewiesene Rolle laden (KEIN pauschales '*')
    const permResult = await query(
      `SELECT p.code 
       FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.id
       WHERE rp.role_id = $1`,
      [role_id]
    );

    const permissions: string[] = permResult.rows.map((row) => row.code);

    // 5. JWT signieren mit Mindestangaben: User-ID, Tenant-ID, Rolle, Berechtigungen und Expiration
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        tenantId: tenant_id,
        role: role_name,
        permissions
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: 'Authentifizierung erfolgreich',
      data: {
        accessToken: token,
        tokenType: 'Bearer',
        user: {
          id: user.id,
          email: user.email,
          fullName: `${user.first_name} ${user.last_name}`,
          role: role_name,
          tenantId: tenant_id,
          tenantName: tenant_name,
          permissions
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    revokeToken(token);
  }

  res.json({
    success: true,
    message: 'Erfolgreich abgemeldet. Token wurde widerrufen.'
  });
}

export async function getMe(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: req.user
  });
}
