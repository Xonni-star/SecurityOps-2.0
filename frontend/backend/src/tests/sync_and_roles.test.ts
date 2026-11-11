import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { app } from '../app';
import { pool, withTenantTransaction } from '../config/database';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 5 Offline-Synchronisation & Rollentrennung Tests', () => {
  let testTenantA: string;
  let testUserAId: string;
  let testSiteId: string;
  let testValidToken: string;

  beforeAll(async () => {
    // 1. Testmandant anlegen
    const tRes = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('Sync Test Mandant Frankfurt', $1, 'DE-SYNC-A', 'BWR-SYNC-A')
      RETURNING id;
    `, [`sync-a-${Date.now()}`]);
    testTenantA = tRes.rows[0].id;

    // 2. Testbenutzer anlegen
    const uRes = await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name)
      VALUES ($1, 'dummy_hash', 'Sync', 'Tester')
      RETURNING id;
    `, [`sync.user.${Date.now()}@secops.local`]);
    testUserAId = uRes.rows[0].id;

    // 3. Testkunde und Schutzobjekt anlegen
    await withTenantTransaction(testTenantA, async (tx) => {
      const cRes = await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'KUN-SYNC-01', 'Sync Firma', 'Hr. Tester', 'test@sync.de', '+49 111', 'Mainzer Str', '2025-01-01', '2026-01-01')
        RETURNING id;
      `, [testTenantA]);
      const cId = cRes.rows[0].id;

      const sRes = await tx.query(`
        INSERT INTO sites (tenant_id, client_id, site_code, name, address)
        VALUES ($1, $2, 'OBJ-SYNC-01', 'Sync Tower', 'Mainzer Str 50')
        RETURNING id;
      `, [testTenantA, cId]);
      testSiteId = sRes.rows[0].id;
    });

    // 4. Token & Session anlegen
    testValidToken = jwt.sign(
      { sub: testUserAId, email: 'sync.user@secops.local', tenantId: testTenantA, role: 'Einsatzleitung', permissions: ['logbook:create', 'logbook:read'] },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const hash = crypto.createHash('sha256').update(testValidToken).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantA, hash]);
  });

  afterAll(async () => {
    if (testTenantA) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantA]);
    if (testUserAId) await pool.query('DELETE FROM users WHERE id = $1', [testUserAId]);
    await pool.end();
  });

  test('1. Sync Push: Überträgt Offline-Mutationen an das Backend und bestätigt Status SYNCED', async () => {
    const clientUuid = `mut-offline-${Date.now()}`;
    const payload = {
      device_id: 'dev-terminal-001',
      mutations: [
        {
          client_uuid: clientUuid,
          entity_type: 'guardbook',
          action: 'CREATE',
          client_timestamp: new Date().toISOString(),
          version: 1,
          payload: {
            siteId: testSiteId,
            guardId: testUserAId,
            category: 'Kontrollgang',
            priority: 'Normal',
            title: 'Rundgang Tiefgarage Westtor',
            description: 'Alle Fluchtwege frei, Schranke funktionstüchtig.'
          }
        }
      ]
    };

    const res = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testValidToken}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].status).toBe('SYNCED');
    expect(res.body.data[0].client_uuid).toBe(clientUuid);

    // Verifikation: Datensatz ist tatsächlich in PostgreSQL vorhanden
    const checkDb = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT title FROM guardbook_entries WHERE client_mutation_id = $1', [clientUuid]);
    });
    expect(checkDb.rows.length).toBe(1);
    expect(checkDb.rows[0].title).toBe('Rundgang Tiefgarage Westtor');
  });

  test('2. Sync Push Idempotenz: Wiederholte Übertragung erzeugt kein Duplikat', async () => {
    const clientUuid = `mut-idem-${Date.now()}`;
    const mutation = {
      client_uuid: clientUuid,
      entity_type: 'guardbook',
      action: 'CREATE',
      client_timestamp: new Date().toISOString(),
      version: 1,
      payload: {
        siteId: testSiteId,
        guardId: testUserAId,
        category: 'Routinemeldung',
        priority: 'Normal',
        title: 'Idempotenz-Testlauf',
        description: 'Darf nur genau einmal in der DB vorkommen.'
      }
    };

    // Erster Push
    await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testValidToken}`)
      .send({ device_id: 'dev-terminal-001', mutations: [mutation] });

    // Zweiter Push mit derselben client_uuid
    const res2 = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testValidToken}`)
      .send({ device_id: 'dev-terminal-001', mutations: [mutation] });

    expect(res2.status).toBe(200);
    expect(res2.body.data[0].status).toBe('SYNCED');

    // Prüfe Zeilenzahl in PostgreSQL
    const checkDb = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT count(*) as total FROM guardbook_entries WHERE client_mutation_id = $1', [clientUuid]);
    });
    expect(parseInt(checkDb.rows[0].total, 10)).toBe(1);
  });

  test('3. Rollentrennung: Anwendungsbenutzer besitzt keine DDL-Rechte (DROP TABLE blockiert)', async () => {
    await expect(
      pool.query('DROP TABLE IF EXISTS test_dummy_drop;')
    ).rejects.toThrow(); // secops_app_user besitzt keine CREATE/DROP DDL Rechte auf schema public!
  });
});
