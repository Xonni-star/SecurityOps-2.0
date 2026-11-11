import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool, withTenantTransaction, verifyAppDatabaseRole } from '../config/database';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 5R: Sync Push, Rollentrennung & Idempotenz Tests', () => {
  let testTenantA: string;
  let testTenantB: string;
  let testUserAId: string;
  let testRoleEinsatzId: string;
  let testTokenA: string;

  beforeAll(async () => {
    const tARes = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('Sync Test Mandant A', $1, 'DE-SYNC-A', 'BWR-SYNC-A') RETURNING id;
    `, [`sync-a-${Date.now()}`]);
    testTenantA = tARes.rows[0].id;

    const tBRes = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('Sync Test Mandant B', $1, 'DE-SYNC-B', 'BWR-SYNC-B') RETURNING id;
    `, [`sync-b-${Date.now()}`]);
    testTenantB = tBRes.rows[0].id;

    const rRes = await pool.query(`
      INSERT INTO roles (name, description) VALUES ($1, 'Rolle mit logbook:create') RETURNING id;
    `, [`SyncRole_${Date.now()}`]);
    testRoleEinsatzId = rRes.rows[0].id;

    const pRes = await pool.query("SELECT id FROM permissions WHERE code = 'logbook:create' LIMIT 1");
    if (pRes.rows.length > 0) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;',
        [testRoleEinsatzId, pRes.rows[0].id]
      );
    }

    const uRes = await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, 'dummy_hash', 'Sync', 'User') RETURNING id;
    `, [`sync.user.${Date.now()}@secops.local`]);
    testUserAId = uRes.rows[0].id;

    await pool.query(
      'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3);',
      [testUserAId, testRoleEinsatzId, testTenantA]
    );

    testTokenA = jwt.sign(
      { sub: testUserAId, email: 'sync.user@secops.local', tenantId: testTenantA, role: 'Einsatzleitung', permissions: ['logbook:create'] },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const tokenHash = crypto.createHash('sha256').update(testTokenA).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantA, tokenHash]);

    // Testobjekt für Mandant A anlegen
    await withTenantTransaction(testTenantA, async (tx) => {
      const c = await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'K-S-1', 'Firma S', 'Anspr.', 's@s.de', '01', 'Adr', '2025-01-01', '2026-01-01') RETURNING id;
      `, [testTenantA]);

      await tx.query(`
        INSERT INTO sites (id, tenant_id, client_id, site_code, name, address)
        VALUES ('s1111111-2222-3333-4444-555555555555', $1, $2, 'OBJ-SYNC', 'Objekt Sync', 'Weg')
        ON CONFLICT DO NOTHING;
      `, [testTenantA, c.rows[0].id]);

      await tx.query(`
        INSERT INTO employees (id, tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
        VALUES ('e1111111-2222-3333-4444-555555555555', $1, 'MA-SYNC', 'Wach', 'Kraft', 'w@w.de', '02', 'Wachkraft', '2025-01-01')
        ON CONFLICT DO NOTHING;
      `, [testTenantA]);
    });
  });

  afterAll(async () => {
    if (testTenantA) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantA]);
    if (testTenantB) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantB]);
    if (testUserAId) await pool.query('DELETE FROM users WHERE id = $1', [testUserAId]);
    await pool.end();
  });

  test('1. verifyAppDatabaseRole bestätigt unprivilegierte Anwendungsrolle', async () => {
    await expect(verifyAppDatabaseRole()).resolves.toBeUndefined();
  });

  test('2. POST /api/v1/sync/push speichert Wachbucheintrag idempotent in PostgreSQL', async () => {
    const clientUuid = `sync-mut-${Date.now()}`;

    const payload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid,
          entityType: 'guardbook',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            siteId: 's1111111-2222-3333-4444-555555555555',
            guardId: 'e1111111-2222-3333-4444-555555555555',
            category: 'Kontrollgang',
            priority: 'Normal',
            title: 'Tiefgaragenrundgang Sektor West',
            description: 'Notausgangstüren verriegelt und frei.'
          }
        }
      ]
    };

    // Erster Push
    const res1 = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(syncPayload);

    expect(res1.status).toBe(200);
    expect(res1.body.data[0].status).toBe('SYNCED');

    // Zweiter identischer Push (Simulation eines wiederholten Verbindungsversuchs)
    const res2 = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(syncPayload);

    expect(res2.status).toBe(200);
    expect(res2.body.data[0].status).toBe('SYNCED');

    // Überprüfung in der Datenbank: Es darf exakt nur 1 Eintrag vorhanden sein!
    const countCheck = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT count(*) as count FROM guardbook_entries WHERE client_mutation_id = $1', [clientUuid]);
    });
    expect(parseInt(countCheck.rows[0].count, 10)).toBe(1);
  });

  test('3. Sync-Endpunkt erzwingt strikte Mandantentrennung (RLS)', async () => {
    // Versuch, mit Token von Mandant A einen Eintrag für Mandant B einzuschleusen
    const clientUuidB = `hack-mut-${Date.now()}`;

    const maliciousPayload = {
      deviceId: 'dev-hacker-01',
      mutations: [
        {
          clientUuid: clientUuidB,
          entityType: 'guardbook',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            siteId: 's1111111-2222-3333-4444-555555555555',
            guardId: 'e1111111-2222-3333-4444-555555555555',
            category: 'Vorkommnis',
            priority: 'Dringend',
            title: 'Infiltrationsversuch',
            description: 'Sollte in Mandant A landen, nicht in B.'
          }
        }
      ]
    };

    await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(maliciousPayload);

    // Mandant B darf diesen Eintrag NIEMALS sehen
    const bCheck = await withTenantTransaction(testTenantB, async (tx) => {
      return tx.query('SELECT * FROM guardbook_entries WHERE client_mutation_id = $1', [clientUuidB]);
    });
    expect(bCheck.rows.length).toBe(0);
  });
});
