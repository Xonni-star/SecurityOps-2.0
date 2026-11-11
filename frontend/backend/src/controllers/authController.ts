import { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { query } from '../config/database';
import { env } from '../config/env';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  requestedTenantId: z.string().uuid().optional()
});

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, requestedTenantId } = loginSchema.parse(req.body);

    // 1. Benutzer aus PostgreSQL abfragen
    const userResult = await query(
      `SELECT id, email, password_hash, first_name, last_name, is_active, failed_login_attempts, locked_until 
       FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      res.status(401).json({ success: false, message: 'Ungültige Anmeldedaten.' });
      return;
    }

    const user = userResult.rows[0];

    // Brute-Force Sperrprüfung in der Datenbank
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      res.status(429).json({
        success: false,
        message: 'Konto ist vorübergehend gesperrt. Bitte versuchen Sie es in wenigen Minuten erneut.'
      });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ success: false, message: 'Benutzerkonto ist deaktiviert.' });
      return;
    }

    // 2. Passwortprüfung mit Argon2id
    const validPassword = await argon2.verify(user.password_hash, password);
    if (!validPassword) {
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      const shouldLock = newAttempts >= 5;
      const lockedUntil = shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [newAttempts, lockedUntil, user.id]
      );

      res.status(401).json({ success: false, message: 'Ungültige Anmeldedaten.' });
      return;
    }

    // Reset der Fehlversuche bei Erfolg
    await query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
      [user.id]
    );

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

    // 4. Granulare Berechtigungen aus der Datenbank laden
    const permResult = await query(
      `SELECT p.code 
       FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.id
       WHERE rp.role_id = $1`,
      [role_id]
    );

    const permissions: string[] = permResult.rows.map((row) => row.code);

    // 5. JWT signieren
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

    // 6. Sitzung in user_sessions persistieren
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 Stunden

    await query(
      `INSERT INTO user_sessions (user_id, tenant_id, token_hash, device_name, ip_address, expires_at, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, false)`,
      [user.id, tenant_id, tokenHash, req.headers['user-agent'] || 'Unbekannt', req.ip, expiresAt]
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

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Sitzung in der Datenbank auf widerrufen setzen
      await query('UPDATE user_sessions SET revoked = true WHERE token_hash = $1', [tokenHash]);
    }

    res.json({
      success: true,
      message: 'Erfolgreich abgemeldet. Sitzung wurde in der Datenbank widerrufen.'
    });
  } catch (error) {
    next(error);
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    data: req.user
  });
}
