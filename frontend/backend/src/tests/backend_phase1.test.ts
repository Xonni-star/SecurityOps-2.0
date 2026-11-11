import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool, withTenantTransaction, withSystemTransaction } from '../config/database';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 3 PostgreSQL-RLS & Backend-Sicherheitstests', () => {
  let testTenantA: string;
  let testTenantB: string;
  let testUserAId: string;
  let testRoleAdminId: string;
  let testRoleEinsatzId: string;
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

    // Nur der Einsatzleiter erhält 'customers:read'; der Admin erhält es in diesem Test absichtlich nicht,
    // um zu beweisen, dass die Rolle Systemadministrator KEINEN pauschalen Bypass mehr besitzt!
    const permRes = await pool.query("SELECT id FROM permissions WHERE code = 'customers:read' LIMIT 1");
    if (permRes.rows.length > 0) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;',
        [testRoleEinsatzId, permRes.rows[0].id]
      );
    }

    // 3. Testbenutzer mit echtem Argon2id Hash anlegen
    const passHash = await argon2.hash('TestSecurePassword2025!', { type: argon2.argon2id });
    const userRes = await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, $2, 'Test', 'UserA') RETURNING id;
    `, [`test.user.${Date.now()}@secops.local`, passHash]);
    testUserAId = userRes.rows[0].id;

    // Benutzer Rolle Einsatzleitung in Mandant A zuweisen
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3);
    `, [testUserAId, testRoleEinsatzId, testTenantA]);

    // 4. Testkunden für Mandant A und Mandant B anlegen
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

    // 5. Gültigen, widerrufenen und abgelaufenen Token für Mandant A anlegen
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
      { expiresIn: '-10m' } // bereits abgelaufen
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
    await pool.end();
  });

  // Test 1: PostgreSQL Verbindung
  test('1. PostgreSQL-Verbindung antwortet stabil', async () => {
    const res = await pool.query('SELECT 1 as connected');
    expect(res.rows[0].connected).toBe(1);
  });

  // Test 2: Unprivilegierter DB-User Prüfung (KEIN Superuser, KEIN BYPASSRLS)
  test('2. Anwendungsdatenbankrolle besitzt weder SUPERUSER noch BYPASSRLS', async () => {
    const res = await pool.query(`
      SELECT rolname, rolsuper, rolbypassrls 
      FROM pg_roles 
      WHERE rolname = 'secops_app_user'
    `);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].rolsuper).toBe(false);
    expect(res.rows[0].rolbypassrls).toBe(false);
  });

  // Test 3: RLS Leseisolation
  test('3. Mandant A kann NIEMALS Daten von Mandant B lesen', async () => {
    const dataForA = await withTenantTransaction(testTenantA, async (client) => {
      const res = await client.query('SELECT id, company_name, tenant_id FROM clients');
      return res.rows;
    });

    expect(dataForA.length).toBeGreaterThan(0);
    expect(dataForA.every((c) => c.tenant_id === testTenantA)).toBe(true);
    expect(dataForA.some((c) => c.tenant_id === testTenantB)).toBe(false);
  });

  // Test 4: RLS Schreibisolation
  test('4. Mandant A kann keine Datensätze für Mandant B anlegen', async () => {
    await expect(
      withTenantTransaction(testTenantA, async (client) => {
        return client.query(
          `INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
           VALUES ($1, 'KUN-HACK', 'Illegal Client', 'Spion', 's@dark.net', '00', 'Weg', '2025-01-01', '2026-01-01')`,
          [testTenantB] // Manipulation: Fremde tenant_id
        );
      })
    ).rejects.toThrow(); // RLS WITH CHECK Verletzung
  });

  // Test 5: Keine Daten ohne gesetzten Mandantenkontext
  test('5. Ohne gesetzten Mandantenkontext liefert die DB 0 Datensätze', async () => {
    const res = await withSystemTransaction(async (client) => {
      return client.query('SELECT * FROM clients');
    });
    expect(res.rows.length).toBe(0);
  });

  // Test 6: Composite Foreign Key Schutz (Objekt A darf Kunde B nicht referenzieren)
  test('6. Composite Foreign Key verhindert mandantenübergreifende Beziehungen', async () => {
    const clientB = await withTenantTransaction(testTenantB, async (c) => {
      return (await c.query('SELECT id FROM clients LIMIT 1')).rows[0].id;
    });

    await expect(
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query(
          `INSERT INTO sites (tenant_id, client_id, site_code, name, address)
           VALUES ($1, $2, 'OBJ-CROSS', 'Cross Site', 'Weg 1')`,
          [testTenantA, clientB]
        );
      })
    ).rejects.toThrow(); // PostgreSQL foreign key constraint violation
  });

  // Test 7: Composite Foreign Key Schutz bei Schichten (Shift A darf Mitarbeiter B nicht referenzieren)
  test('7. Composite Foreign Key bei Schichten verhindert Mitarbeiter aus fremdem Mandanten', async () => {
    // Lege Mitarbeiter in Mandant B an
    const empB = await withTenantTransaction(testTenantB, async (tx) => {
      const res = await tx.query(`
        INSERT INTO employees (tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
        VALUES ($1, 'MA-B-99', 'Bavaria', 'Guard', 'b@guard.de', '089', 'Wachkraft', '2025-01-01')
        RETURNING id;
      `, [testTenantB]);
      return res.rows[0].id;
    });

    // Hole Objekt aus Mandant A
    const siteA = await withTenantTransaction(testTenantA, async (tx) => {
      const s = await tx.query(`
        INSERT INTO sites (tenant_id, client_id, site_code, name, address)
        VALUES ($1, (SELECT id FROM clients WHERE tenant_id = $1 LIMIT 1), 'OBJ-SHIFT-TEST', 'Site Shift', 'Weg')
        RETURNING id;
      `, [testTenantA]);
      return s.rows[0].id;
    });

    // Versuch: Schicht in Mandant A mit Mitarbeiter aus Mandant B verknüpfen
    await expect(
      withTenantTransaction(testTenantA, async (tx) => {
        return tx.query(`
          INSERT INTO shifts (tenant_id, site_id, employee_id, shift_date, start_time, end_time, required_qualification)
          VALUES ($1, $2, $3, '2025-06-01', '06:00', '18:00', 'Sachkunde');
        `, [testTenantA, siteA, empB]);
      })
    ).rejects.toThrow(); // fk_shifts_employee_tenant blockiert!
  });

  // Test 8: Atomare Idempotenz bei Wachbucheinträgen
  test('8. Wachbuch: Doppelte client_mutation_id erzeugt nur genau 1 Eintrag (atomare Idempotenz)', async () => {
    const mutationId = `mut-atomic-${Date.now()}`;

    const { siteId, guardId } = await withTenantTransaction(testTenantA, async (tx) => {
      const s = await tx.query(`SELECT id FROM sites WHERE tenant_id = $1 LIMIT 1`, [testTenantA]);
      const e = await tx.query(`
        INSERT INTO employees (tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
        VALUES ($1, 'MA-GUARD-1', 'Gerd', 'Guard', 'g@g.de', '01', 'Wachkraft', '2025-01-01')
        RETURNING id;
      `, [testTenantA]);
      return { siteId: s.rows[0].id, guardId: e.rows[0].id };
    });

    // 1. Erster Aufruf
    const firstInsert = await withTenantTransaction(testTenantA, async (tx) => {
      const res = await tx.query(`
        INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, client_mutation_id)
        VALUES ($1, $2, $3, 'Routinemeldung', 'Normal', 'Atomar 1', 'Text', $4)
        ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
        RETURNING id;
      `, [testTenantA, siteId, guardId, mutationId]);
      return res.rows[0]?.id;
    });
    expect(firstInsert).toBeDefined();

    // 2. Zweiter paralleler Aufruf mit identischer client_mutation_id -> liefert keine neue Zeile
    const secondInsert = await withTenantTransaction(testTenantA, async (tx) => {
      const res = await tx.query(`
        INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, client_mutation_id)
        VALUES ($1, $2, $3, 'Routinemeldung', 'Normal', 'Atomar 2', 'Text', $4)
        ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
        RETURNING id;
      `, [testTenantA, siteId, guardId, mutationId]);
      return res.rows[0]?.id;
    });
    expect(secondInsert).toBeUndefined(); // Abgewiesen ohne Fehler

    // Exakt 1 Eintrag in der Datenbank vorhanden
    const countRes = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT count(*) as total FROM guardbook_entries WHERE client_mutation_id = $1', [mutationId]);
    });
    expect(parseInt(countRes.rows[0].total, 10)).toBe(1);
  });

  // Test 9: Widerrufene Sitzung wird via API abgewiesen
  test('9. Widerrufenes Token wird von geschützter Route mit HTTP 401 abgewiesen', async () => {
    const res = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${testRevokedTokenA}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('widerrufen');
  });

  // Test 10: Abgelaufene Sitzung wird via API abgewiesen
  test('10. Abgelaufenes Token wird mit HTTP 401 abgewiesen', async () => {
    const res = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${testExpiredTokenA}`);
    expect(res.status).toBe(401);
  });

  // Test 11: Fehlende Berechtigung liefert HTTP 403
  test('11. Benutzer ohne passende Berechtigung erhält HTTP 403', async () => {
    // Token ohne 'customers:read'
    const noPermToken = jwt.sign(
      { sub: testUserAId, email: 'test.user@secops.local', tenantId: testTenantA, role: 'Wachkraft', permissions: [] },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const hash = crypto.createHash('sha256').update(noPermToken).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantA, hash]);

    const res = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${noPermToken}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Fehlende Berechtigung');
  });

  // Test 12: Kein pauschaler Bypass für Systemadministrator
  test('12. Rolle Systemadministrator besitzt keinen pauschalen Berechtigungs-Bypass im Code', async () => {
    // Admin-Token OHNE 'customers:read'
    const adminNoPermToken = jwt.sign(
      { sub: testUserAId, email: 'admin@secops.local', tenantId: testTenantA, role: 'Systemadministrator', permissions: [] },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const hash = crypto.createHash('sha256').update(adminNoPermToken).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantA, hash]);

    const res = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${adminNoPermToken}`);
    expect(res.status).toBe(403); // Strikt abgewiesen!
  });
});
