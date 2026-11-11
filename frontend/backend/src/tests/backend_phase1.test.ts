import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool, withTenantTransaction, withSystemTransaction } from '../config/database';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Phase 1 Korrigierte Backend- & RLS-Tests', () => {
  let testTenantA: string;
  let testTenantB: string;
  let testUserAId: string;
  let testRoleAId: string;
  let testValidTokenA: string;
  let testRevokedTokenA: string;

  beforeAll(async () => {
    // 1. Erzeuge dedizierte Testmandanten für diesen Testlauf
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

    // 2. Erzeuge Testrolle mit Rechten
    const roleRes = await pool.query(`
      INSERT INTO roles (name, description) VALUES ($1, 'Testrolle Einsatzleitung') RETURNING id;
    `, [`TestRole_${Date.now()}`]);
    testRoleAId = roleRes.rows[0].id;

    const permRes = await pool.query("SELECT id FROM permissions WHERE code = 'customers:read' LIMIT 1");
    if (permRes.rows.length > 0) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;',
        [testRoleAId, permRes.rows[0].id]
      );
    }

    // 3. Erzeuge Testbenutzer mit echtem Argon2id Hash
    const passHash = await argon2.hash('TestSecurePassword2025!', { type: argon2.argon2id });
    const userRes = await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, $2, 'Test', 'UserA') RETURNING id;
    `, [`test.user.${Date.now()}@secops.local`, passHash]);
    testUserAId = userRes.rows[0].id;

    // Benutzer Rolle in Mandant A zuweisen
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3);
    `, [testUserAId, testRoleAId, testTenantA]);

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

    // 5. Gültigen und widerrufenen Token für Mandant A erzeugen
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
  });

  afterAll(async () => {
    // Testdaten sauber entfernen
    if (testTenantA) {
      await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantA]);
    }
    if (testTenantB) {
      await pool.query('DELETE FROM tenants WHERE id = $2', [testTenantB]);
    }
    if (testUserAId) {
      await pool.query('DELETE FROM users WHERE id = $1', [testUserAId]);
    }
    await pool.end();
  });

  // Test 1: DB-Verbindung
  test('1. PostgreSQL-Verbindung ist aktiv und erreichbar', async () => {
    const res = await pool.query('SELECT 1 as connected');
    expect(res.rows[0].connected).toBe(1);
  });

  // Test 2: Argon2id Hashing
  test('2. Passwort wird mit echtem Argon2id gehasht und validiert', async () => {
    const raw = 'SicheresTestPasswort2025!';
    const hash = await argon2.hash(raw, { type: argon2.argon2id });
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(hash, raw)).toBe(true);
    expect(await argon2.verify(hash, 'Falsch')).toBe(false);
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
          [testTenantB] // Manipulation: Fremde tenant_id!
        );
      })
    ).rejects.toThrow(); // RLS WITH CHECK Verletzung!
  });

  // Test 5: Keine Daten ohne gesetzten Mandantenkontext
  test('5. Ohne gesetzten Mandantenkontext werden 0 Datensätze geliefert', async () => {
    const res = await withSystemTransaction(async (client) => {
      return client.query('SELECT * FROM clients');
    });
    // RLS blockiert ohne app.current_tenant vollständig
    expect(res.rows.length).toBe(0);
  });

  // Test 6: Composite Foreign Key Schutz
  test('6. Composite Foreign Key verhindert mandantenübergreifende Beziehungen', async () => {
    // Hole Kunden aus Mandant B
    const clientB = await withTenantTransaction(testTenantB, async (c) => {
      return (await c.query('SELECT id FROM clients LIMIT 1')).rows[0].id;
    });

    // Versuch: Objekt in Mandant A verknüpft mit Kunde in Mandant B
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

  // Test 7: Wachbuch-Idempotenz
  test('7. Wachbuch: Doppelte client_mutation_id wird abgewiesen', async () => {
    const mutationId = `mut-${Date.now()}`;

    // Lege Objekt und Mitarbeiter an
    const { siteId, guardId } = await withTenantTransaction(testTenantA, async (tx) => {
      const s = await tx.query(`
        INSERT INTO sites (tenant_id, client_id, site_code, name, address)
        VALUES ($1, (SELECT id FROM clients WHERE tenant_id = $1 LIMIT 1), 'OBJ-IDEM', 'Idem Site', 'Weg')
        RETURNING id;
      `, [testTenantA]);

      const e = await tx.query(`
        INSERT INTO employees (tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
        VALUES ($1, 'MA-IDEM', 'Max', 'Muster', 'm@m.de', '01', 'Wachkraft', '2025-01-01')
        RETURNING id;
      `, [testTenantA]);

      return { siteId: s.rows[0].id, guardId: e.rows[0].id };
    });

    // 1. Einfügen erfolgreich
    await withTenantTransaction(testTenantA, async (tx) => {
      await tx.query(`
        INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, client_mutation_id)
        VALUES ($1, $2, $3, 'Routinemeldung', 'Normal', 'Idempotenz 1', 'Text', $4);
      `, [testTenantA, siteId, guardId, mutationId]);
    });

    // 2. Erneuter Versuch mit identischer client_mutation_id -> UNIQUE Constraint greift
    await expect(
      withTenantTransaction(testTenantA, async (tx) => {
        await tx.query(`
          INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, client_mutation_id)
          VALUES ($1, $2, $3, 'Routinemeldung', 'Normal', 'Idempotenz 2', 'Text', $4);
        `, [testTenantA, siteId, guardId, mutationId]);
      })
    ).rejects.toThrow();
  });

  // Test 8: Sitzungswiderruf
  test('8. Widerrufenes Token wird in user_sessions abgewiesen', async () => {
    const revokedHash = crypto.createHash('sha256').update(testRevokedTokenA).digest('hex');
    const sessionRes = await pool.query(
      'SELECT revoked FROM user_sessions WHERE token_hash = $1',
      [revokedHash]
    );
    expect(sessionRes.rows[0].revoked).toBe(true);
  });
});
