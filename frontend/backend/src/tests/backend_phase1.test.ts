import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool, withTenantTransaction, withSystemTransaction } from '../config/database';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 3 Vollständige Sicherheitsprüfung & RLS Tests', () => {
  let testTenantA: string;
  let testTenantB: string;
  let testUserAId: string;
  let testUserMultiTenantId: string;
  let testRoleEinsatzId: string;
  let testRoleAdminId: string;
  let testValidTokenA: string;
  let testRevokedTokenA: string;
  let testExpiredTokenA: string;

  beforeAll(async () => {
    // 1. Eigene Testmandanten anlegen (keine Abhängigkeit von Seed-Daten)
    const tARes = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('Test Mandant A (Frankfurt)', $1, 'DE-TEST-A', 'BWR-TEST-A')
      RETURNING id;
    `, [`test-a-${Date.now()}`]);
    testTenantA = tARes.rows[0].id;

    const tBRes = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('Test Mandant B (Bavaria)', $1, 'DE-TEST-B', 'BWR-TEST-B')
      RETURNING id;
    `, [`test-b-${Date.now()}`]);
    testTenantB = tBRes.rows[0].id;

    // 2. Rollen und granulare Berechtigungen anlegen
    const roleAdminRes = await pool.query(`
      INSERT INTO roles (name, description) VALUES ($1, 'Systemadministrator ohne Bypass') RETURNING id;
    `, [`Admin_${Date.now()}`]);
    testRoleAdminId = roleAdminRes.rows[0].id;

    const roleEinsatzRes = await pool.query(`
      INSERT INTO roles (name, description) VALUES ($1, 'Einsatzleitung mit customers:read') RETURNING id;
    `, [`Einsatz_${Date.now()}`]);
    testRoleEinsatzId = roleEinsatzRes.rows[0].id;

    // Nur der Einsatzleiter erhält 'customers:read'
    const permRes = await pool.query("SELECT id FROM permissions WHERE code = 'customers:read' LIMIT 1");
    if (permRes.rows.length > 0) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;',
        [testRoleEinsatzId, permRes.rows[0].id]
      );
    }

    // 3. Testbenutzer A mit echtem Argon2id Hash anlegen
    const passHash = await argon2.hash('TestSecurePassword2025!', { type: argon2.argon2id });
    const userRes = await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, $2, 'Test', 'UserA') RETURNING id;
    `, [`test.user.${Date.now()}@secops.local`, passHash]);
    testUserAId = userRes.rows[0].id;

    await pool.query(`
      INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3);
    `, [testUserAId, testRoleEinsatzId, testTenantA]);

    // 4. Testbenutzer mit MEHREREN Mandanten anlegen (zur Prüfung mehrdeutiger Mandantenauswahl)
    const multiUserRes = await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, $2, 'Multi', 'TenantUser') RETURNING id;
    `, [`multi.user.${Date.now()}@secops.local`, passHash]);
    testUserMultiTenantId = multiUserRes.rows[0].id;

    // Weist Benutzer A beiden Mandanten (A und B) zu:
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES 
        ($1, $2, $3),
        ($1, $2, $4);
    `, [testUserMultiTenantId, testRoleEinsatzId, testTenantA, testTenantB]);

    // 5. Testkunden für Mandant A und Mandant B anlegen
    await withTenantTransaction(testTenantA, async (tx) => {
      await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'KUN-TA-1', 'Mandant A Firma', 'Hr. A', 'a@firma.de', '+49 111', 'Straße A', '2025-01-01', '2026-01-01');
      `, [testTenantA]);
    });

    await withTenantTransaction(testTenantB, async (tx) => {
      await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'KUN-TB-1', 'Mandant B Firma', 'Hr. B', 'b@firma.de', '+49 222', 'Straße B', '2025-01-01', '2026-01-01');
      `, [testTenantB]);
    });

    // 6. Gültigen, widerrufenen und abgelaufenen Token anlegen
    testValidTokenA = jwt.sign(
      { sub: testUserAId, email: 'test.user@secops.local', tenantId: testTenantA, role: 'Einsatzleitung', permissions: ['customers:read'] },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const validHash = crypto.createHash('sha256').update(testValidTokenA).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantA, validHash]);

    testRevokedTokenA = jwt.sign(
      { sub: testUserAId, email: 'test.user@secops.local', tenantId: testTenantA, role: 'Einsatzleitung', permissions: ['customers:read'] },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const revokedHash = crypto.createHash('sha256').update(testRevokedTokenA).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', true);
    `, [testUserAId, testTenantA, revokedHash]);

    testExpiredTokenA = jwt.sign(
      { sub: testUserAId, email: 'test.user@secops.local', tenantId: testTenantA, role: 'Einsatzleitung', permissions: ['customers:read'] },
      env.JWT_SECRET,
      { expiresIn: '-10m' }
    );
    const expiredHash = crypto.createHash('sha256').update(testExpiredTokenA).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() - interval '10 minutes', false);
    `, [testUserAId, testTenantA, expiredHash]);
  });

  afterAll(async () => {
    // Zuverlässige Bereinigung der Testdaten
    if (testTenantA) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantA]);
    if (testTenantB) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantB]);
    if (testUserAId) await pool.query('DELETE FROM users WHERE id = $1', [testUserAId]);
    if (testUserMultiTenantId) await pool.query('DELETE FROM users WHERE id = $1', [testUserMultiTenantId]);
    await pool.end();
  });

  // Test 1: Least-Privilege DB-Rolle
  test('1. Least-Privilege: secops_app_user besitzt weder SUPERUSER noch BYPASSRLS', async () => {
    const res = await pool.query(`
      SELECT rolname, rolsuper, rolbypassrls 
      FROM pg_roles 
      WHERE rolname = 'secops_app_user'
    `);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].rolsuper).toBe(false);
    expect(res.rows[0].rolbypassrls).toBe(false);
  });

  // Test 2: RLS Leseisolation
  test('2. Mandant A kann NIEMALS Daten von Mandant B lesen', async () => {
    const dataForA = await withTenantTransaction(testTenantA, async (client) => {
      const res = await client.query('SELECT id, company_name, tenant_id FROM clients');
      return res.rows;
    });

    expect(dataForA.length).toBeGreaterThan(0);
    expect(dataForA.every((c) => c.tenant_id === testTenantA)).toBe(true);
    expect(dataForA.some((c) => c.tenant_id === testTenantB)).toBe(false);
  });

  // Test 3: RLS Schreibisolation
  test('3. Mandant A kann keine Daten für Mandant B schreiben', async () => {
    await expect(
      withTenantTransaction(testTenantA, async (client) => {
        return client.query(
          `INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
           VALUES ($1, 'KUN-HACK', 'Illegal Client', 'Spion', 's@dark.net', '00', 'Weg', '2025-01-01', '2026-01-01')`,
          [testTenantB]
        );
      })
    ).rejects.toThrow();
  });

  // Test 4: RLS ohne Kontext
  test('4. Ohne gesetzten Mandantenkontext sind 0 Datensätze sichtbar', async () => {
    const res = await withSystemTransaction(async (client) => {
      return client.query('SELECT * FROM clients');
    });
    expect(res.rows.length).toBe(0);
  });

  // Test 5: Composite Foreign Key Schutz
  test('5. Composite Foreign Key verhindert mandantenübergreifende Beziehungen', async () => {
    const clientB = await withTenantTransaction(testTenantB, async (c) => {
      return (await c.query('SELECT id FROM clients LIMIT 1')).rows[0].id;
    });

    await expect(
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query(
          `INSERT INTO sites (tenant_id, client_id, site_code, name, address)
           VALUES ($1, $2, 'OBJ-CROSS-99', 'Cross Site', 'Weg 1')`,
          [testTenantA, clientB]
        );
      })
    ).rejects.toThrow();
  });

  // Test 6: Parallele Login-Fehlversuche / Race Condition Schutz
  test('6. Atomares Update der Fehlversuche verhindert Race Conditions', async () => {
    // 3 parallele Fehlversuche ausführen
    await Promise.all([
      pool.query(`
        UPDATE users 
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE NULL END
        WHERE id = $1`, [testUserAId]),
      pool.query(`
        UPDATE users 
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE NULL END
        WHERE id = $1`, [testUserAId]),
      pool.query(`
        UPDATE users 
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE NULL END
        WHERE id = $1`, [testUserAId])
    ]);

    const res = await pool.query('SELECT failed_login_attempts FROM users WHERE id = $1', [testUserAId]);
    expect(res.rows[0].failed_login_attempts).toBe(3);

    // Bereinigung
    await pool.query('UPDATE users SET failed_login_attempts = 0 WHERE id = $1', [testUserAId]);
  });

  // Test 7: Mehrdeutige Mandantenauswahl
  test('7. Login mit mehreren Mandanten ohne requestedTenantId wird mit HTTP 400 abgefangen', async () => {
    const multiUserEmail = (await pool.query('SELECT email FROM users WHERE id = $1', [testUserMultiTenantId])).rows[0].email;

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: multiUserEmail,
        password: 'TestSecurePassword2025!'
      });

    // Erwartet HTTP 400 mit AMBIGUOUS_TENANT_SELECTION Code
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AMBIGUOUS_TENANT_SELECTION');
    expect(res.body.availableTenants.length).toBe(2);
  });

  // Test 8: Login mit expliziter requestedTenantId gelingt
  test('8. Login mit mehreren Mandanten und gültiger requestedTenantId gelingt', async () => {
    const multiUserEmail = (await pool.query('SELECT email FROM users WHERE id = $1', [testUserMultiTenantId])).rows[0].email;

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: multiUserEmail,
        password: 'TestSecurePassword2025!',
        requestedTenantId: testTenantB
      });

    expect(res.status).toBe(200);
    expect(res.body.data.user.tenantId).toBe(testTenantB);
  });

  // Test 9: Append-Only Schutz für Wachbuch auf PostgreSQL-Ebene
  test('9. Append-Only Trigger: UPDATE von Kernfeldern im Wachbuch wird physisch verweigert', async () => {
    const { siteId, guardId } = await withTenantTransaction(testTenantA, async (tx) => {
      const s = await tx.query(`
        INSERT INTO sites (tenant_id, client_id, site_code, name, address)
        VALUES ($1, (SELECT id FROM clients WHERE tenant_id = $1 LIMIT 1), 'OBJ-APP-1', 'Append Site', 'Weg')
        RETURNING id;
      `, [testTenantA]);

      const e = await tx.query(`
        INSERT INTO employees (tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
        VALUES ($1, 'MA-APP-1', 'Gerd', 'Guard', 'g@g.de', '01', 'Wachkraft', '2025-01-01')
        RETURNING id;
      `, [testTenantA]);

      return { siteId: s.rows[0].id, guardId: e.rows[0].id };
    });

    const entryId = await withTenantTransaction(testTenantA, async (tx) => {
      const r = await tx.query(`
        INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description)
        VALUES ($1, $2, $3, 'Vorkommnis', 'Normal', 'Unfall Parkdeck', 'PKW touchiert Schranke')
        RETURNING id;
      `, [testTenantA, siteId, guardId]);
      return r.rows[0].id;
    });

    // Versuch: Manipulatives Überschreiben der Beschreibung -> Trigger bricht ab!
    await expect(
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query(`
          UPDATE guardbook_entries 
          SET description = 'Manipulation: Nichts passiert' 
          WHERE id = $1;
        `, [entryId]);
      })
    ).rejects.toThrow(/Nachträgliche Manipulation von Kernfeldern im Wachbuch ist verboten/);

    // Versuch: Löschen des Eintrags -> Trigger bricht ab!
    await expect(
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query('DELETE FROM guardbook_entries WHERE id = $1', [entryId]);
      })
    ).rejects.toThrow(/Löschen von Einträgen in guardbook_entries ist nach DIN 77200 unzulässig/);
  });

  // Test 10: Revisionen sind unlöschbar und unveränderlich
  test('10. Append-Only Trigger: guardbook_revisions können weder geändert noch gelöscht werden', async () => {
    const entryId = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query('SELECT id FROM guardbook_entries WHERE tenant_id = $1 LIMIT 1', [testTenantA])).rows[0].id;
    });

    const revId = await withTenantTransaction(testTenantA, async (tx) => {
      const res = await tx.query(`
        INSERT INTO guardbook_revisions (tenant_id, entry_id, author_name, note)
        VALUES ($1, $2, 'Prüfer', 'Erstnotiz') RETURNING id;
      `, [testTenantA, entryId]);
      return res.rows[0].id;
    });

    await expect(
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query("UPDATE guardbook_revisions SET note = 'Geändert' WHERE id = $1", [revId]);
      })
    ).rejects.toThrow(/unveränderlich und unlöschbar/);

    await expect(
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query("DELETE FROM guardbook_revisions WHERE id = $1", [revId]);
      })
    ).rejects.toThrow(/unveränderlich und unlöschbar/);
  });

  // Test 11: Parallele Wachbuch-Idempotenz via ON CONFLICT
  test('11. Parallele Wachbuch-Idempotenz: Identische client_mutation_id erzeugt exakt 1 Eintrag', async () => {
    const mutId = `atomic-mut-${Date.now()}`;
    const { siteId, guardId } = await withTenantTransaction(testTenantA, async (tx) => {
      const s = (await tx.query('SELECT id FROM sites WHERE tenant_id = $1 LIMIT 1', [testTenantA])).rows[0].id;
      const e = (await tx.query('SELECT id FROM employees WHERE tenant_id = $1 LIMIT 1', [testTenantA])).rows[0].id;
      return { siteId: s, guardId: e };
    });

    // 2 gleichzeitige INSERTs mit derselben client_mutation_id
    const [res1, res2] = await Promise.all([
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query(`
          INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, client_mutation_id)
          VALUES ($1, $2, $3, 'Routinemeldung', 'Normal', 'Idempotent 1', 'Text', $4)
          ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
          RETURNING id;
        `, [testTenantA, siteId, guardId, mutId]);
      }),
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query(`
          INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, client_mutation_id)
          VALUES ($1, $2, $3, 'Routinemeldung', 'Normal', 'Idempotent 2', 'Text', $4)
          ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
          RETURNING id;
        `, [testTenantA, siteId, guardId, mutId]);
      })
    ]);

    const totalInserted = (res1.rows.length + res2.rows.length);
    expect(totalInserted).toBe(1); // Genau 1 Eintrag erzeugt
  });

  // Test 12: Sitzungs- und Berechtigungsprüfungen
  test('12. Widerrufene Sitzung wird mit HTTP 401 abgefangen', async () => {
    const res = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${testRevokedTokenA}`);
    expect(res.status).toBe(401);
  });

  test('13. Fehlende Berechtigung liefert HTTP 403 (kein Admin-Bypass)', async () => {
    // Admin-Token OHNE 'customers:read'
    const adminToken = jwt.sign(
      { sub: testUserAId, email: 'admin@secops.local', tenantId: testTenantA, role: 'Systemadministrator', permissions: [] },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const hash = crypto.createHash('sha256').update(adminToken).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantA, hash]);

    const res = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });
});
