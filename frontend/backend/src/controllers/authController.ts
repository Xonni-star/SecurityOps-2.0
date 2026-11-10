import { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/database';
import { env } from '../config/env';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const userResult = await query(
      'SELECT id, email, password_hash, first_name, last_name, is_active FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      res.status(401).json({ success: false, message: 'Ungültige Zugangsdaten' });
      return;
    }

    const user = userResult.rows[0];
    if (!user.is_active) {
      res.status(403).json({ success: false, message: 'Benutzerkonto ist deaktiviert' });
      return;
    }

    // Passwortprüfung mit Argon2id
    const validPassword = await argon2.verify(user.password_hash, password);
    if (!validPassword) {
      res.status(401).json({ success: false, message: 'Ungültige Zugangsdaten' });
      return;
    }

    // Standard-Mandant für den Benutzer ermitteln
    const tenantUserResult = await query(
      `SELECT t.id, t.name, ur.role_id, r.name as role_name 
       FROM user_roles ur
       JOIN tenants t ON ur.tenant_id = t.id
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1 LIMIT 1`,
      [user.id]
    );

    const tenantId = tenantUserResult.rows[0]?.id || '11111111-1111-1111-1111-111111111111';
    const tenantName = tenantUserResult.rows[0]?.name || 'Securitas & Wache Frankfurt GmbH';
    const roleName = tenantUserResult.rows[0]?.role_name || 'Einsatzleitung';

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        tenantId,
        role: roleName,
        permissions: ['*']
      },
      env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      message: 'Erfolgreich angemeldet',
      data: {
        accessToken: token,
        tokenType: 'Bearer',
        user: {
          id: user.id,
          email: user.email,
          fullName: `${user.first_name} ${user.last_name}`,
          role: roleName,
          tenantId,
          tenantName
        }
      }
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
