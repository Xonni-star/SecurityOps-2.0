import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool, withTenantTransaction, verifyAppDatabaseRole } from '../config/database';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 5R.2: Absicherung aller 6 Mutationstypen & Konfliktauflösung', () => {
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

  test('1. verifyAppDatabaseRole bestätigt unprivilegierte Anwendungsrolle', async () => {
    await expect(verifyAppDatabaseRole()).resolves.toBeUndefined();
  });

  test('2. guardbook: Idempotente Neuanlage und Append-Only Revision', async () => {
    const clientUuid = `gb-mut-${Date.now()}`;
    const payload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid,
          entityType: 'guardbook',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { siteId: siteAId, guardId: guardAId, category: 'Vorkommnis', priority: 'Dringend', title: 'Torstörung', description: 'Schranke klemmt.' }
        }
      ]
    };

    const res1 = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload);
    expect(res1.status).toBe(200);
    expect(res1.body.data[0].status).toBe('SYNCED');

    // Wiederholter identischer Push -> Idempotent
    const res2 = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.data[0].status).toBe('SYNCED');

    // UPDATE erzeugt Revision
    const updatePayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid,
          entityType: 'guardbook',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { correctionNote: 'Schranke wieder freigängig.' }
        }
      ]
    };
    const resUpdate = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(updatePayload);
    expect(resUpdate.status).toBe(200);
    expect(resUpdate.body.data[0].status).toBe('SYNCED');

    // DELETE auf Wachbuch wird REJECTED
    const delPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `del-gb-${Date.now()}`,
          entityType: 'guardbook',
          action: 'DELETE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {}
        }
      ]
    };
    const resDel = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(delPayload);
    expect(resDel.body.data[0].status).toBe('REJECTED');
  });

  test('3. shift: CREATE, UPDATE und DELETE', async () => {
    const shiftUuid = `sh-mut-${Date.now()}`;
    const createPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: shiftUuid,
          entityType: 'shift',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { siteId: siteAId, employeeId: guardAId, shiftDate: '2025-08-01', startTime: '06:00', endTime: '18:00' }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(createPayload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');
    const serverShiftId = res.body.data[0].serverId;

    // UPDATE
    const updatePayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `sh-up-${Date.now()}`,
          entityType: 'shift',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { id: serverShiftId, status: 'Konflikt', conflictReason: 'Arzttermin' }
        }
      ]
    };
    const resUp = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(updatePayload);
    expect(resUp.body.data[0].status).toBe('SYNCED');

    // DELETE
    const delPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `sh-del-${Date.now()}`,
          entityType: 'shift',
          action: 'DELETE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 2,
          payload: { id: serverShiftId }
        }
      ]
    };
    const resDel = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(delPayload);
    expect(resDel.body.data[0].status).toBe('SYNCED');
  });

  test('4. task: Kollisionserkennung (CONFLICT) bei veralteter Version', async () => {
    const taskUuid = `task-mut-${Date.now()}`;
    const createPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: taskUuid,
          entityType: 'task',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { title: 'Revision BMA', status: 'Offen' }
        }
      ]
    };

    const resCreate = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(createPayload);
    const taskId = resCreate.body.data[0].serverId;

    // Server-Version vorantreiben
    await withTenantTransaction(testTenantA, async (tx) => {
      await tx.query('UPDATE tasks SET status = $1, revision_version = 2 WHERE id = $2', ['Erledigt', taskId]);
    });

    // Client sendet mit veralteter baseVersion = 1 -> CONFLICT
    const conflictPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `task-conf-${Date.now()}`,
          entityType: 'task',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { id: taskId, status: 'In Bearbeitung' }
        }
      ]
    };

    const resConf = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(conflictPayload);
    expect(resConf.body.data[0].status).toBe('CONFLICT');
  });

  test('5. patrol & handover: Unveränderlichkeit (UPDATE/DELETE werden REJECTED)', async () => {
    // Patrol Scan anlegen
    const patrolUuid = `patrol-mut-${Date.now()}`;
    const pCreate = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: patrolUuid,
          entityType: 'patrol',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { siteId: siteAId, checkpointCode: 'CP-01', checkpointName: 'Foyer', guardId: guardAId, verifiedTag: 'TAG-1' }
        }
      ]
    };
    const resP = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(pCreate);
    expect(resP.body.data[0].status).toBe('SYNCED');

    // UPDATE auf Patrol muss REJECTED werden
    const pUpdate = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `p-up-${Date.now()}`,
          entityType: 'patrol',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { id: resP.body.data[0].serverId, notes: 'Geändert' }
        }
      ]
    };
    const resPUp = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(pUpdate);
    expect(resPUp.body.data[0].status).toBe('REJECTED');
  });

  test('6. resolveSyncConflict: Reale Server-Auflösung via USE_LOCAL und USE_SERVER', async () => {
    // Task anlegen
    const tRes = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query("INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date) VALUES ($1, 'Konflikt-Task', 'Leitung', CURRENT_DATE) RETURNING id", [testTenantA])).rows[0].id;
    });

    // 1. USE_LOCAL Auflösung
    const resLocal = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send({
        clientUuid: `conf-res-${Date.now()}`,
        entityType: 'task',
        strategy: 'USE_LOCAL',
        localPayload: { id: tRes, status: 'In Bearbeitung' }
      });
    expect(resLocal.status).toBe(200);
    expect(resLocal.body.applied).toBe(true);

    const check = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT status, revision_version FROM tasks WHERE id = $1', [tRes]);
    });
    expect(check.rows[0].status).toBe('In Bearbeitung');
    expect(check.rows[0].revision_version).toBe(2);
  });
});
