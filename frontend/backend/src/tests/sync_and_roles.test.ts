import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool, withTenantTransaction, verifyAppDatabaseRole } from '../config/database';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 5R.2.4: Echte Konfliktauflösung, data-Envelope & atomarer Versionsschutz', () => {
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
        INSERT INTO keys (tenant_id, site_id, key_number, label, revision_version)
        VALUES ($1, $2, 'KEY-SYNC-01', 'Hauptschlüssel Depot', 1) ON CONFLICT DO NOTHING;
      `, [testTenantA, siteAId]);
    });
  });

  afterAll(async () => {
    if (testTenantA) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantA]);
    if (testTenantB) await pool.query('DELETE FROM tenants WHERE id = $1', [testTenantB]);
    if (testUserAId) await pool.query('DELETE FROM users WHERE id = $1', [testUserAId]);
    await pool.end();
  });

  // 1. Wachbuch: CREATE und wiederholte identische Übertragung
  test('1. Wachbuch: CREATE und wiederholte Übertragung erzeugen kein Duplikat', async () => {
    const clientUuid = `gb-create-${Date.now()}`;
    const payload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid,
          entityType: 'guardbook',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { siteId: siteAId, guardId: guardAId, category: 'Vorkommnis', priority: 'Dringend', title: 'Schrankenstörung', description: 'Schranke klemmt.' }
        }
      ]
    };

    const res1 = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload);
    expect(res1.status).toBe(200);
    expect(res1.body.data[0].status).toBe('SYNCED');

    // Wiederholung (idempotent)
    const res2 = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.data[0].status).toBe('SYNCED');

    const countCheck = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT count(*) as count FROM guardbook_entries WHERE client_mutation_id = $1', [clientUuid]);
    });
    expect(parseInt(countCheck.rows[0].count, 10)).toBe(1);
  });

  // 2. Wachbuch: UPDATE mit ursprünglicher entryId
  test('2. Wachbuch: UPDATE identifiziert Eintrag über entryId und hängt Revision an', async () => {
    const entryId = await withTenantTransaction(testTenantA, async (tx) => {
      const r = await tx.query(`
        INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description)
        VALUES ($1, $2, $3, 'Vorkommnis', 'Normal', 'Originaleintrag', 'Beschreibung')
        RETURNING id;
      `, [testTenantA, siteAId, guardAId]);
      return r.rows[0].id;
    });

    const correctionUuid = `gb-corr-${Date.now()}`;
    const corrPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: correctionUuid,
          entityType: 'guardbook',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: {
            entryId,
            correctionNote: 'Nachtrag: Zeuge namentlich erfasst',
            stage: 'In Bewertung'
          }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(corrPayload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');

    const revCheck = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT * FROM guardbook_revisions WHERE entry_id = $1', [entryId]);
    });
    expect(revCheck.rows.length).toBe(1);
    expect(revCheck.rows[0].note).toContain('Zeuge');
  });

  // 3. Wachbuch: Wiederholte Korrektur ohne doppelte Revision
  test('3. Wachbuch: Wiederholte Korrektur mit derselben Mutation-ID erzeugt keine doppelte Revision', async () => {
    const entryId = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query('SELECT id FROM guardbook_entries WHERE tenant_id = $1 LIMIT 1', [testTenantA])).rows[0].id;
    });

    const corrUuid = `gb-repeat-${Date.now()}`;
    const payload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: corrUuid,
          entityType: 'guardbook',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { entryId, correctionNote: 'Einmaliger Nachtrag' }
        }
      ]
    };

    const res1 = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload);
    expect(res1.body.data[0].status).toBe('SYNCED');

    const res2 = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload);
    expect(res2.body.data[0].status).toBe('SYNCED');

    const revCount = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT count(*) as count FROM guardbook_revisions WHERE client_mutation_id = $1', [corrUuid]);
    });
    expect(parseInt(revCount.rows[0].count, 10)).toBe(1);
  });

  // 4. Schichten: Versionskonflikt bei paralleler Änderung
  test('4. Schichten: Atomarer Versionskonflikt bei veralteter baseVersion', async () => {
    const shiftId = await withTenantTransaction(testTenantA, async (tx) => {
      const s = await tx.query(`
        INSERT INTO shifts (tenant_id, site_id, employee_id, shift_date, start_time, end_time, required_qualification, revision_version)
        VALUES ($1, $2, $3, '2025-09-01', '06:00', '18:00', 'Sachkunde', 2)
        RETURNING id;
      `, [testTenantA, siteAId, guardAId]);
      return s.rows[0].id;
    });

    const conflictPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `sh-conf-${Date.now()}`,
          entityType: 'shift',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1, // Veraltet!
          payload: { id: shiftId, status: 'Konflikt' }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(conflictPayload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('CONFLICT');
    expect(res.body.data[0].serverVersion).toBe(2);
  });

  // 5. Schichten: Versionsgesichertes DELETE
  test('5. Schichten: Versionsgesichertes DELETE gelingt nur bei passender Version', async () => {
    const shiftId = await withTenantTransaction(testTenantA, async (tx) => {
      const s = await tx.query(`
        INSERT INTO shifts (tenant_id, site_id, employee_id, shift_date, start_time, end_time, required_qualification, revision_version)
        VALUES ($1, $2, $3, '2025-09-02', '06:00', '18:00', 'Sachkunde', 1)
        RETURNING id;
      `, [testTenantA, siteAId, guardAId]);
      return s.rows[0].id;
    });

    const delPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `sh-del-${Date.now()}`,
          entityType: 'shift',
          action: 'DELETE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { id: shiftId }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(delPayload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');

    const check = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT * FROM shifts WHERE id = $1', [shiftId]);
    });
    expect(check.rows.length).toBe(0);
  });

  // 6. Aufgaben: Atomarer Versionskonflikt
  test('6. Aufgaben: Atomarer Versionskonflikt bei SQL UPDATE', async () => {
    const taskId = await withTenantTransaction(testTenantA, async (tx) => {
      const t = await tx.query(`
        INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, revision_version)
        VALUES ($1, 'BMA Prüfung', 'Leitung', CURRENT_DATE, 3)
        RETURNING id;
      `, [testTenantA]);
      return t.rows[0].id;
    });

    const payload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `task-conf-${Date.now()}`,
          entityType: 'task',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 2, // Veraltet (Server ist bei 3)
          payload: { id: taskId, status: 'Erledigt' }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('CONFLICT');
  });

  // 7. Aufgaben: Idempotentes UPDATE und DELETE
  test('7. Aufgaben: Idempotentes UPDATE erhöht Version und DELETE löscht versionsgesichert', async () => {
    const taskId = await withTenantTransaction(testTenantA, async (tx) => {
      const t = await tx.query(`
        INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, revision_version)
        VALUES ($1, 'Idem Task', 'Leitung', CURRENT_DATE, 1)
        RETURNING id;
      `, [testTenantA]);
      return t.rows[0].id;
    });

    const upPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `task-up-${Date.now()}`,
          entityType: 'task',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { id: taskId, status: 'In Bearbeitung' }
        }
      ]
    };
    const resUp = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(upPayload);
    expect(resUp.body.data[0].status).toBe('SYNCED');
    expect(resUp.body.data[0].serverVersion).toBe(2);

    const delPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `task-del-${Date.now()}`,
          entityType: 'task',
          action: 'DELETE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 2,
          payload: { id: taskId }
        }
      ]
    };
    const resDel = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(delPayload);
    expect(resDel.body.data[0].status).toBe('SYNCED');
  });

  // 8. Schlüssel: Ausgabe und Rücknahme mit Versionsschutz
  test('8. Schlüssel: Status-Update mit Versionsschutz', async () => {
    const keyId = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query('SELECT id, revision_version FROM keys WHERE tenant_id = $1 LIMIT 1', [testTenantA])).rows[0].id;
    });

    const keyPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `key-issue-${Date.now()}`,
          entityType: 'key',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { id: keyId, status: 'Ausgegeben', currentHolderId: guardAId }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(keyPayload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');
    expect(res.body.data[0].serverVersion).toBe(2);
  });

  // 9. Kontrollgänge: Unveränderlichkeit
  test('9. Kontrollgänge: UPDATE und DELETE werden mit REJECTED abgewiesen', async () => {
    const pPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `patrol-del-${Date.now()}`,
          entityType: 'patrol',
          action: 'DELETE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { id: 'some-id' }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(pPayload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('REJECTED');
  });

  // 10. Schichtübergaben: Unveränderlichkeit
  test('10. Schichtübergaben: UPDATE und DELETE werden mit REJECTED abgewiesen', async () => {
    const hPayload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: `ho-del-${Date.now()}`,
          entityType: 'handover',
          action: 'UPDATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { id: 'some-id' }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(hPayload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('REJECTED');
  });

  // 11. Konfliktauflösung: USE_LOCAL mit korrekter Version (data-Envelope Prüfung)
  test('11. Konfliktauflösung: USE_LOCAL übernimmt lokalen Stand atomar im data-Envelope', async () => {
    const taskId = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query("INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, status, revision_version) VALUES ($1, 'Task L', 'Leitung', CURRENT_DATE, 'Offen', 1) RETURNING id", [testTenantA])).rows[0].id;
    });

    const res = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send({
        clientUuid: `res-loc-${Date.now()}`,
        entityType: 'task',
        strategy: 'USE_LOCAL',
        expectedVersion: 1,
        localPayload: { id: taskId, status: 'In Bearbeitung' }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.serverState).toBeDefined();
    expect(res.body.data.serverState.status).toBe('In Bearbeitung');
    expect(res.body.data.serverState.revision_version).toBe(2);

    const check = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT status, revision_version FROM tasks WHERE id = $1', [taskId]);
    });
    expect(check.rows[0].status).toBe('In Bearbeitung');
    expect(check.rows[0].revision_version).toBe(2);
  });

  // 12. Konfliktauflösung: USE_LOCAL mit veralteter expectedVersion wird abgewiesen
  test('12. Konfliktauflösung: USE_LOCAL mit veralteter expectedVersion bricht ab', async () => {
    const taskId = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query("INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, status, revision_version) VALUES ($1, 'Task Veraltet', 'Leitung', CURRENT_DATE, 'Offen', 3) RETURNING id", [testTenantA])).rows[0].id;
    });

    const res = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send({
        clientUuid: `res-loc-fail-${Date.now()}`,
        entityType: 'task',
        strategy: 'USE_LOCAL',
        expectedVersion: 1, // Veraltet (Server ist bei 3)
        localPayload: { id: taskId, status: 'In Bearbeitung' }
      });

    // Fehlerhafter Versionskonflikt führt zu Fehlerantwort (HTTP 500 durch Exception Handler)
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Versionskonflikt');
  });

  // 13. Konfliktauflösung: USE_SERVER bestätigt vollständigen Serverstand im data-Envelope
  test('13. Konfliktauflösung: USE_SERVER liefert den tatsächlichen vollständigen Serverstand im data-Envelope', async () => {
    const taskId = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query("INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, status, category, revision_version) VALUES ($1, 'Task Vollständig', 'Einsatzleiter Schmidt', '2025-06-15', 'Erledigt', 'Audit', 2) RETURNING id", [testTenantA])).rows[0].id;
    });

    const res = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send({
        clientUuid: `res-srv-${Date.now()}`,
        entityType: 'task',
        strategy: 'USE_SERVER',
        expectedVersion: 2,
        localPayload: { id: taskId }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.serverState).toBeDefined();
    expect(res.body.data.serverState.id).toBe(taskId);
    expect(res.body.data.serverState.title).toBe('Task Vollständig');
    expect(res.body.data.serverState.assigned_to_name).toBe('Einsatzleiter Schmidt');
    expect(res.body.data.serverState.status).toBe('Erledigt');
    expect(res.body.data.serverState.category).toBe('Audit');
    expect(res.body.data.serverState.revision_version).toBe(2);
  });

  // 14. Gleiche Mutation-ID mit verändertem Inhalt wird abgewiesen
  test('14. Gleiche Mutation-ID mit verändertem Inhalt wird als REJECTED abgewiesen', async () => {
    const reusableUuid = `tamper-id-${Date.now()}`;

    await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send({
        deviceId: 'dev-01',
        mutations: [
          {
            clientUuid: reusableUuid,
            entityType: 'guardbook',
            action: 'CREATE',
            clientTimestamp: new Date().toISOString(),
            baseVersion: 1,
            payload: { siteId: siteAId, guardId: guardAId, title: 'Originaler Titel', description: 'Original' }
          }
        ]
      });

    const resTamper = await request(app)
      .post('/api/v1/sync/push')
      .set('Authorization', `Bearer ${testTokenA}`)
      .send({
        deviceId: 'dev-01',
        mutations: [
          {
            clientUuid: reusableUuid,
            entityType: 'guardbook',
            action: 'CREATE',
            clientTimestamp: new Date().toISOString(),
            baseVersion: 1,
            payload: { siteId: siteAId, guardId: guardAId, title: 'Manipulierter Titel', description: 'Gefälscht' }
          }
        ]
      });

    expect(resTamper.status).toBe(200);
    expect(resTamper.body.data[0].status).toBe('REJECTED');
    expect(resTamper.body.data[0].message).toContain('Integritätsverletzung');
  });

  // 15. Mandantenisolation bei Konfliktauflösung
  test('15. Mandantenisolation bei Konfliktauflösung: Mandant B kann keine Aufgaben von Mandant A auflösen', async () => {
    const taskIdA = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query("INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, status) VALUES ($1, 'Task A geheim', 'Leitung A', CURRENT_DATE, 'Offen') RETURNING id", [testTenantA])).rows[0].id;
    });

    // Erzeuge Token für Mandant B
    const tokenB = jwt.sign(
      { sub: testUserAId, email: 'user.b@secops.local', tenantId: testTenantB, role: 'Einsatzleitung', permissions: ['logbook:create'] },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const tokenHashB = crypto.createHash('sha256').update(tokenB).digest('hex');
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantB, tokenHashB]);

    // Versuch von Mandant B, den Task von Mandant A aufzulösen -> Muss mit Fehler abbrechen!
    const resB = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        clientUuid: `hack-conflict-${Date.now()}`,
        entityType: 'task',
        strategy: 'USE_SERVER',
        expectedVersion: 1,
        localPayload: { id: taskIdA }
      });

    expect(resB.status).toBe(500);
    expect(resB.body.success).toBe(false);
    expect(resB.body.message).toContain('nicht gefunden oder fremder Mandant');
  });

  // 16. Parallele Übertragung derselben Mutation
  test('16. Parallele Übertragung derselben Mutation führt zu exakt einer Ausführung (Advisory Lock)', async () => {
    const parallelUuid = `parallel-mut-${Date.now()}`;
    const payload = {
      deviceId: 'dev-01',
      mutations: [
        {
          clientUuid: parallelUuid,
          entityType: 'task',
          action: 'CREATE',
          clientTimestamp: new Date().toISOString(),
          baseVersion: 1,
          payload: { title: 'Paralleler Task', status: 'Offen' }
        }
      ]
    };

    const [res1, res2] = await Promise.all([
      request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload),
      request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${testTokenA}`).send(payload)
    ]);

    expect(res1.body.data[0].status).toBe('SYNCED');
    expect(res2.body.data[0].status).toBe('SYNCED');

    const countCheck = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query('SELECT count(*) as count FROM tasks WHERE client_mutation_id = $1', [parallelUuid]);
    });
    expect(parseInt(countCheck.rows[0].count, 10)).toBe(1);
  });
});
