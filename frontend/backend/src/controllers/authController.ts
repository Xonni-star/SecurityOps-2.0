import { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import crypto from 'crypto';
import { z } from 'zod';
import { query } from '../config/database';
import { env } from '../config/env';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  requestedTenantId: z.string().uuid().optional()
});

/**
 * Wandelt Zeitangaben wie '8h', '1h', '30m' in Millisekunden um
 */
function parseDurationToMs(durationStr: string): number {
  const match = durationStr.match(/^(\d+)([smhd])$/);
  if (!match) return 8 * 60 * 60 * 1000; // Fallback: 8 Stunden
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 8 * 60 * 60 * 1000;
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, requestedTenantId } = loginSchema.parse(req.body);

    // 1. Benutzer abfragen
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

    // Sperrprüfung
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
      // ATOMARE Aktualisierung in PostgreSQL verhindert Race Conditions bei parallelen Anfragen:
      await query(
        `UPDATE users 
         SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE NULL END
         WHERE id = $1`,
        [user.id]
      );

      res.status(401).json({ success: false, message: 'Ungültige Anmeldedaten.' });
      return;
    }

    // Reset der Fehlversuche bei Erfolg
    await query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
      [user.id]
    );

    // 3. EINDEUTIGE MANDANTENAUSWAHL (Keine willkürliche Auswahl via LIMIT 1)
    const userTenantsResult = await query(
      `SELECT t.id as tenant_id, t.name as tenant_name, r.id as role_id, r.name as role_name
       FROM user_roles ur
       JOIN tenants t ON ur.tenant_id = t.id
       JOIN roles r ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND t.is_active = true`,
      [user.id]
    );

    const memberships = userTenantsResult.rows;

    if (memberships.length === 0) {
      res.status(403).json({
        success: false,
        message: 'Keine aktiven Mandantenzuordnungen für diesen Benutzer vorhanden.'
      });
      return;
    }

    let selectedMembership = null;

    if (requestedTenantId) {
      selectedMembership = memberships.find((m) => m.tenant_id === requestedTenantId);
      if (!selectedMembership) {
        res.status(403).json({
          success: false,
          message: 'Zugriff verweigert: Sie gehören dem angeforderten Mandanten nicht an.'
        });
        return;
      }
    } else {
      if (memberships.length === 1) {
        selectedMembership = memberships[0];
      } else {
        // MEHRDEUTIGE MANDANTENZUORDNUNG: Der Benutzer MUSS explizit wählen!
        res.status(400).json({
          success: false,
          code: 'AMBIGUOUS_TENANT_SELECTION',
          message: 'Mehrdeutige Mandantenzuordnung: Bitte übermitteln Sie "requestedTenantId" mit der gewünschten Mandanten-ID.',
          availableTenants: memberships.map((m) => ({
            id: m.tenant_id,
            name: m.tenant_name,
            role: m.role_name
          }))
        });
        return;
      }
    }

    const { tenant_id, tenant_name, role_id, role_name } = selectedMembership;

    // 4. Granulare Berechtigungen aus der Datenbank laden
    const permResult = await query(
      `SELECT p.code 
       FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.id
       WHERE rp.role_id = $1`,
      [role_id]
    );

    const permissions: string[] = permResult.rows.map((row) => row.code);

    // 5. Exakter Abgleich von JWT- und Sitzungs-Ablaufzeit
    const sessionDurationMs = parseDurationToMs(env.JWT_EXPIRES_IN);
    const expiresAt = new Date(Date.now() + sessionDurationMs);

    // Opaque, high-entropy session identifier; only its SHA-256 hash is persisted.
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(sessionId).digest('hex');

    await query(
      `INSERT INTO user_sessions (user_id, tenant_id, token_hash, device_name, ip_address, expires_at, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, false)`,
      [user.id, tenant_id, tokenHash, req.headers['user-agent'] || 'Unbekannt', req.ip, expiresAt]
    );

    const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/v1', maxAge: sessionDurationMs };
    res.cookie('secops_session', sessionId, cookieOptions);
    res.cookie('secops_csrf', csrfToken, { ...cookieOptions, httpOnly: false });
    res.setHeader('X-CSRF-Token', csrfToken);
    res.json({
      success: true,
      message: 'Authentifizierung erfolgreich',
      data: {
        csrfToken,
        expiresAt: expiresAt.toISOString(),
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
    if (req.user?.sessionHash) await query('UPDATE user_sessions SET revoked = true WHERE token_hash = $1', [req.user.sessionHash]);
    res.clearCookie('secops_session', { path: '/api/v1', httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict' });
    res.clearCookie('secops_csrf', { path: '/api/v1', secure: env.NODE_ENV === 'production', sameSite: 'strict' });
    res.json({
      success: true,
      message: 'Erfolgreich abgemeldet. Sitzung wurde in der Datenbank widerrufen.'
    });
  } catch (error) {
    next(error);
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=', 2)).filter(v => v.length === 2));
  if (cookies.secops_csrf) res.setHeader('X-CSRF-Token', cookies.secops_csrf);
  const { sessionHash: _sessionHash, ...publicUser } = req.user!;
  res.json({
    success: true,
    data: publicUser
  });
}
