import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool, withTenantTransaction, verifyAppDatabaseRole } from '../config/database';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 5R.1: Sync Push aller 6 Mutationstypen, Idempotenz & Rollentrennung', () => {
  let testTenantA: string;
  let testTenantB: string;
  let testUserAId: string;
  let testRoleEinsatzId: string;
  let testTokenA: string;
  let siteAId: string;
  let guardAId: string;

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

    // Testdaten für Mandant A anlegen
    await withTenantTransaction(testTenantA, async (tx) => {
      const c = await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'K-S-1', 'Firma S', 'Anspr.', 's@s.de', '01', 'Adr', '2025-01-01', '2026-01-01') RETURNING id;
      `, [testTenantA]);

      const sRes = await tx.query(`
        INSERT INTO sites (tenant_id, client_id, site_code, name, address)
        VALUES ($1, $2, 'OBJ-SYNC', 'Objekt Sync', 'Weg') RETURNING id;
      `, [testTenantA, c.rows[0].id]);
      siteAId = sRes.rows[0].id;

      const eRes = await tx.query(`
        INSERT INTO employees (tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
        VALUES ($1, 'MA-SYNC', 'Wach', 'Kraft', 'w@w.de', '02', 'Wachkraft', '2025-01-01') RETURNING id;
      `, [testTenantA]);
      guardAId = eRes.rows[0].id;

      await tx.query(`
        INSERT INTO keys (tenant_id, site_id, key_number, label)
        VALUES ($1, $2, 'KEY-SYNC-01', 'Hauptschlüssel Depot') ON CONFLICT DO NOTHING;
      `, [testTenantA, siteAId]);
    });
  });

  afterAll(async () => {
    if (testTenantA) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantA]);
    if (testTenantB) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantB]);
    if (testUserAId) await pool.query('DELETE FROM users WHERE id = $1', [testUserAId]);
    await pool.end();
  });

  // 1. Datenbankrollen-Verifikation
  test('1. verifyAppDatabaseRole bestätigt unprivilegierte Anwendungsrolle', async () => {
    await expect(verifyAppDatabaseRole()).resolves.toBeUndefined();
  });

  // 2. Behebung des ReferenceErrors & Test für guardbook
  test('2. POST /api/v1/sync/push speichert Wachbucheintrag idempotent (Korrektur payload / syncPayload)', async () => {
    const clientUuid = `sync-mut-${Date.now()}`;

    const syncPayload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid,
          entityType: 'guardbook',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            siteId: siteAId,
            guardId: guardAId,
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

    // Zweiter identischer Push (Wiederholung nach Verbindungsabbruch)
    const res2 = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(syncPayload);

    expect(res2.status).toBe(200);
    expect(res2.body.data[0].status).toBe('SYNCED');

    // Überprüfung: Exakt 1 Eintrag vorhanden
    const countCheck = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT count(*) as count FROM guardbook_entries WHERE client_mutation_id = $1', [clientUuid]);
    });
    expect(parseInt(countCheck.rows[0].count, 10)).toBe(1);
  });

  // 3. Test für Mutationstyp 'shift'
  test('3. Sync-Endpunkt verarbeitet Schichtmutationen (shift)', async () => {
    const shiftUuid = `shift-mut-${Date.now()}`;
    const syncPayload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid: shiftUuid,
          entityType: 'shift',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            siteId: siteAId,
            employeeId: guardAId,
            shiftDate: '2025-07-01',
            startTime: '06:00',
            endTime: '18:00',
            type: 'Tagdienst',
            status: 'Besetzt'
          }
        }
      ]
    };

    const res = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(syncPayload);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');

    const dbCheck = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT * FROM shifts WHERE client_mutation_id = $1', [shiftUuid]);
    });
    expect(dbCheck.rows.length).toBe(1);
  });

  // 4. Test für Mutationstyp 'task' inklusive Konflikterkennung
  test('4. Sync-Endpunkt verarbeitet Aufgaben (task) und erkennt Versionskonflikte', async () => {
    const taskUuid = `task-mut-${Date.now()}`;
    // 1. Task anlegen
    const createPayload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid: taskUuid,
          entityType: 'task',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            title: 'Wartung Tor 2',
            status: 'Offen'
          }
        }
      ]
    };

    const resCreate = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(createPayload);

    expect(resCreate.status).toBe(200);
    const taskId = resCreate.body.data[0].serverId;

    // 2. Parallele Änderung auf Server simulieren (Version erhöht sich auf 2)
    await withTenantTransaction(testTenantA, async (tx) => {
      await tx.query('UPDATE tasks SET status = $1, revision_version = 2 WHERE id = $2', ['Erledigt', taskId]);
    });

    // 3. Client sendet Update mit alter baseVersion = 1 -> Muss CONFLICT liefern!
    const conflictPayload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid: `update-mut-${Date.now()}`,
          entityType: 'task',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1, // veraltet!
          payload: {
            id: taskId,
            status: 'In Bearbeitung'
          }
        }
      ]
    };

    const resConflict = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(conflictPayload);

    expect(resConflict.status).toBe(200);
    expect(resConflict.body.data[0].status).toBe('CONFLICT');
  });

  // 5. Test für Mutationstyp 'key'
  test('5. Sync-Endpunkt aktualisiert Schlüsselstatus (key)', async () => {
    const keyId = await withTenantTransaction(testTenantA, async (tx) => {
      const res = await tx.query('SELECT id FROM keys WHERE tenant_id = $1 LIMIT 1', [testTenantA]);
      return res.rows[0].id;
    });

    const keyPayload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid: `key-mut-${Date.now()}`,
          entityType: 'key',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            id: keyId,
            status: 'Ausgegeben',
            currentHolderId: guardAId,
            issuedAt: new Date().toISOString()
          }
        }
      ]
    };

    const res = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(keyPayload);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');

    const check = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT status FROM keys WHERE id = $1', [keyId]);
    });
    expect(check.rows[0].status).toBe('Ausgegeben');
  });

  // 6. Test für Mutationstyp 'patrol' (Kontrollgang-Scan)
  test('6. Sync-Endpunkt verarbeitet Kontrollgang-Scans (patrol)', async () => {
    const patrolUuid = `patrol-mut-${Date.now()}`;
    const patrolPayload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid: patrolUuid,
          entityType: 'patrol',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            siteId: siteAId,
            checkpointCode: 'CP-TIEF-1',
            checkpointName: 'Notausgang West',
            guardId: guardAId,
            verifiedTag: 'RFID-9901-A',
            method: 'NFC_TAG'
          }
        }
      ]
    };

    const res = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(patrolPayload);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');

    const check = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT * FROM patrol_scans WHERE client_mutation_id = $1', [patrolUuid]);
    });
    expect(check.rows.length).toBe(1);
    expect(check.rows[0].checkpoint_code).toBe('CP-TIEF-1');
  });

  // 7. Test für Mutationstyp 'handover' (Schichtübergabe)
  test('7. Sync-Endpunkt verarbeitet Schichtübergaben (handover)', async () => {
    const handoverUuid = `ho-mut-${Date.now()}`;
    const handoverPayload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid: handoverUuid,
          entityType: 'handover',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            siteId: siteAId,
            relievingGuardId: guardAId,
            relievedGuardId: guardAId,
            keyRegisterChecked: true,
            openIncidentsCount: 0,
            remarks: 'Alles ordnungsgemäß übergeben'
          }
        }
      ]
    };

    const res = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(handoverPayload);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');

    const check = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT * FROM shift_handovers WHERE client_mutation_id = $1', [handoverUuid]);
    });
    expect(check.rows.length).toBe(1);
  });

  // 8. Test für unzulässigen/unbekannten Mutationstyp
  test('8. Unbekannte Mutationen werden ausdrücklich als REJECTED zurückgewiesen', async () => {
    const badPayload = {
      deviceId: 'dev-test-terminal-01',
      mutations: [
        {
          clientUuid: `bad-mut-${Date.now()}`,
          entityType: 'guardbook',
          action: 'DELETE', // Unzulässig bei Wachbuch
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {}
        }
      ]
    };

    const res = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send(badPayload);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('REJECTED');
  });

  // 9. Mandantentrennung beim Sync
  test('9. Sync-Endpunkt erzwingt strikte Mandantentrennung (RLS)', async () => {
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
            siteId: siteAId,
            guardId: guardAId,
            category: 'Vorkommnis',
            priority: 'Dringend',
            title: 'Infiltrationsversuch',
            description: 'Sollte in Mandant A landen, niemals in B.'
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

  // 10. Reale Server-Konfliktauflösung
  test('10. POST /api/v1/sync/conflicts/resolve wendet Konfliktstrategie auf Server an', async () => {
    const res = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send({
        clientUuid: `conflict-${Date.now()}`,
        entityType: 'task',
        strategy: 'USE_SERVER'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
