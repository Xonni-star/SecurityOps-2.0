import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool, migrationPool, withTenantTransaction, verifyAppDatabaseRole } from '../config/database';
import { cleanupTestData, authHeaders } from './testUtils';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 5R.2.7: Idempotenz zwischen Sync-Push und Konfliktauflösung', () => {
  let testTenantA: string;
  let testTenantB: string;
  let testUserAId: string;
  let restrictedUserId: string;
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

    const pRes = await pool.query(
      "SELECT id FROM permissions WHERE code = ANY($1::text[])",
      [['logbook:create', 'shifts:manage', 'tasks:manage', 'keys:manage', 'patrol:create', 'handover:create', 'employees:create', 'employees:update', 'employees:archive', 'employees:restore', 'qualifications:manage', 'employees:absence:manage', 'employees:absence:approve']]
    );
    for (const permission of pRes.rows) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;',
        [testRoleEinsatzId, permission.id]
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

    testTokenA = crypto.randomBytes(32).toString('base64url');
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

  test('Mitarbeiter-Sync wahrt Payload-IDs, Revisionen, Idempotenz, Null-Daten und Mandantengrenzen', async () => {
    const foreignEmployeeId = await withTenantTransaction(testTenantB, async tx => {
      const row = await tx.query("INSERT INTO employees (tenant_id,personnel_number,first_name,last_name,email,phone,role,date_of_joining) VALUES ($1,'MA-FOREIGN','Fremd','Mandant','foreign@secops.test','030','Wache','2024-01-01') RETURNING id", [testTenantB]);
      return row.rows[0].id as string;
    });
    const qualificationId = await withTenantTransaction(testTenantA, async tx => {
      const row = await tx.query("INSERT INTO employee_qualifications (tenant_id,employee_id,qualification_type,certificate_number,issue_date,expiry_date,verified,status) VALUES ($1,$2,'Sachkunde','Q-NULL','2024-01-01','2027-01-01',true,'VALID') RETURNING id", [testTenantA, guardAId]);
      return row.rows[0].id as string;
    });
    const mutation = (clientUuid: string, action: string, baseVersion: number, payload: object) => ({
      deviceId: 'employee-regression-device', mutations: [{ clientUuid, entityType: 'employee', action,
        clientTimestamp: new Date().toISOString(), baseVersion, payload }]
    });
    const updateId = 'emp-update-' + Date.now();
    const updatePayload = mutation(updateId, 'UPDATE', 1, { id: guardAId, firstName: 'OfflineAktualisiert' });
    const first = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA)).send(updatePayload);
    expect(first.status).toBe(200);
    expect(first.body.data[0]).toMatchObject({ status: 'SYNCED', serverVersion: 2, serverId: guardAId });
    const repeat = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA)).send(updatePayload);
    expect(repeat.body.data[0]).toEqual(first.body.data[0]);
    const changedReuse = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation(updateId, 'UPDATE', 1, { id: guardAId, firstName: 'Veränderter Inhalt' }));
    expect(changedReuse.body.data[0].status).toBe('REJECTED');

    const stale = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('emp-stale-' + Date.now(), 'UPDATE', 1, { id: guardAId, firstName: 'Veraltet' }));
    expect(stale.body.data[0]).toMatchObject({ status: 'CONFLICT', serverVersion: 2 });

    const qualification = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('qual-null-' + Date.now(), 'QUALIFICATION_UPDATE', 1, { id: qualificationId, qualificationId, expiryDate: null }));
    expect(qualification.body.data[0]).toMatchObject({ status: 'SYNCED', serverVersion: 2, serverId: qualificationId });
    const expiry = await withTenantTransaction(testTenantA, tx => tx.query('SELECT expiry_date FROM employee_qualifications WHERE id=$1 AND tenant_id=$2', [qualificationId, testTenantA]));
    expect(expiry.rows[0].expiry_date).toBeNull();

    const newEmployeeId = crypto.randomUUID();
    const createdEmployee = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('emp-create-' + Date.now(), 'CREATE', 1, { id: newEmployeeId, personnelNumber: 'MA-OFFLINE-CREATE',
        firstName: 'Neu', lastName: 'Offline', email: 'new.offline@secops.test', phone: '+49 30 111', role: 'Wachkraft',
        status: 'Aktiv', weeklyHours: 40, hourlyRate: 20, dateOfJoining: '2025-01-01' }));
    expect(createdEmployee.body.data[0]).toMatchObject({ status: 'SYNCED', serverId: newEmployeeId, serverVersion: 1 });
    const archived = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('emp-delete-' + Date.now(), 'DELETE', 1, { id: newEmployeeId }));
    expect(archived.body.data[0]).toMatchObject({ status: 'SYNCED', serverVersion: 2 });
    const restored = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('emp-restore-' + Date.now(), 'RESTORE', 2, { id: newEmployeeId }));
    expect(restored.body.data[0]).toMatchObject({ status: 'SYNCED', serverVersion: 3 });

    const createdQualificationId = crypto.randomUUID();
    const createdQualification = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('qual-create-' + Date.now(), 'QUALIFICATION_CREATE', 1, { id: createdQualificationId, employeeId: guardAId,
        type: 'Erste Hilfe', certificateNumber: 'EH-1', issueDate: '2024-01-01', expiryDate: '2027-01-01', verified: true, documentReference: null }));
    expect(createdQualification.body.data[0]).toMatchObject({ status: 'SYNCED', serverId: createdQualificationId });

    const createdAbsenceId = crypto.randomUUID();
    const createdAbsence = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('absence-create-' + Date.now(), 'ABSENCE_CREATE', 1, { id: createdAbsenceId, employeeId: guardAId,
        type: 'Urlaub', startDate: '2028-02-01', endDate: '2028-02-03', notes: 'offline test' }));
    expect(createdAbsence.body.data[0]).toMatchObject({ status: 'SYNCED', serverId: createdAbsenceId });
    const reviewedAbsence = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('absence-review-' + Date.now(), 'ABSENCE_REVIEW', 1, { id: createdAbsenceId, absenceId: createdAbsenceId, decision: 'APPROVED' }));
    expect(reviewedAbsence.body.data[0]).toMatchObject({ status: 'SYNCED', serverVersion: 2 });

    const crossTenant = await request(app).post('/api/v1/employees/sync').set(authHeaders(testTokenA))
      .send(mutation('emp-foreign-' + Date.now(), 'UPDATE', 1, { id: foreignEmployeeId, firstName: 'Fremdzugriff' }));
    expect(crossTenant.body.data[0].status).toBe('REJECTED');
    const foreignState = await withTenantTransaction(testTenantB, tx => tx.query('SELECT first_name FROM employees WHERE id=$1', [foreignEmployeeId]));
    expect(foreignState.rows[0].first_name).toBe('Fremd');

    const restrictedRoleId = (await pool.query("INSERT INTO roles (name,description) VALUES ($1,'restricted sync role') RETURNING id", [`RestrictedSync_${Date.now()}`])).rows[0].id;
    restrictedUserId = (await pool.query("INSERT INTO users (email,password_hash,first_name,last_name) VALUES ($1,'unused','Restricted','Sync') RETURNING id", [`restricted.${Date.now()}@secops.local`])).rows[0].id;
    await pool.query('INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)', [restrictedUserId, restrictedRoleId, testTenantA]);
    const restrictedToken = crypto.randomBytes(32).toString('base64url');
    await pool.query("INSERT INTO user_sessions (user_id,tenant_id,token_hash,expires_at,revoked) VALUES ($1,$2,$3,NOW()+interval '1 hour',false)",
      [restrictedUserId, testTenantA, crypto.createHash('sha256').update(restrictedToken).digest('hex')]);
    const denied = await request(app).post('/api/v1/employees/sync').set(authHeaders(restrictedToken))
      .send(mutation('emp-denied-' + Date.now(), 'UPDATE', 2, { id: guardAId, firstName: 'NichtErlaubt' }));
    expect(denied.body.data[0]).toMatchObject({ status: 'REJECTED', message: expect.stringContaining('employees:update') });
  });

  afterAll(async () => {
    // Administrative Bereinigung inkl. Append-Only-Trigger (nur Testdatenbank).
    await cleanupTestData([testTenantA, testTenantB], [testUserAId, restrictedUserId]);
    await pool.end();
    await migrationPool.end();
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

    const res1 = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(payload);
    expect(res1.status).toBe(200);
    expect(res1.body.data[0].status).toBe('SYNCED');

    const res2 = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(payload);
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

    const res = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(corrPayload);
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

    const res1 = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(payload);
    expect(res1.body.data[0].status).toBe('SYNCED');

    const res2 = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(payload);
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
          baseVersion: 1,
          payload: { id: shiftId, status: 'Konflikt' }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(conflictPayload);
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

    const res = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(delPayload);
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
          baseVersion: 2,
          payload: { id: taskId, status: 'Erledigt' }
        }
      ]
    };

    const res = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(payload);
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
    const resUp = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(upPayload);
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
    const resDel = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(delPayload);
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

    const res = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(keyPayload);
    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('SYNCED');
    expect(res.body.data[0].serverVersion).toBe(2);
  });

  // 9. Kontrollgänge: Unveränderlichkeit
  test('Offline-Sync weist andere Entität ohne deren Berechtigung ab, bevor ein Receipt entsteht', async () => {
    const roleId = (await pool.query("INSERT INTO roles (name, description) VALUES ($1, 'Nur Wachbuch') RETURNING id", [`LogOnly_${Date.now()}`])).rows[0].id;
    const logbookPermissionId = (await pool.query("SELECT id FROM permissions WHERE code='logbook:create'")).rows[0].id;
    await pool.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)', [roleId, logbookPermissionId]);
    const userId = (await pool.query("INSERT INTO users (email,password_hash,first_name,last_name) VALUES ($1,'unused','Nur','Wachbuch') RETURNING id", [`log-only-${Date.now()}@secops.test`])).rows[0].id;
    await pool.query('INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)', [userId, roleId, testTenantA]);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query("INSERT INTO user_sessions (user_id,tenant_id,token_hash,expires_at,revoked) VALUES ($1,$2,$3,NOW()+interval '1 hour',false)", [userId,testTenantA,tokenHash]);

    const mutationId = `forbidden-shift-${Date.now()}`;
    const result = await request(app).post('/api/v1/sync/push').set(authHeaders(token)).send({
      deviceId: 'limited-device',
      mutations: [{ clientUuid: mutationId, entityType: 'shift', action: 'UPDATE', clientTimestamp: new Date().toISOString(), baseVersion: 1, payload: { id: 'not-used', status: 'Erledigt' } }]
    });
    expect(result.status).toBe(200);
    expect(result.body.data[0]).toMatchObject({ status: 'REJECTED', clientUuid: mutationId });
    const receipt = await withTenantTransaction(testTenantA, (tx) =>
      tx.query('SELECT 1 FROM sync_idempotency_receipts WHERE tenant_id=$1 AND client_mutation_id=$2', [testTenantA, mutationId])
    );
    expect(receipt.rowCount).toBe(0);
    const conflict = await request(app).post('/api/v1/sync/conflicts/resolve').set(authHeaders(token)).send({
      clientUuid: `forbidden-conflict-${Date.now()}`, entityType: 'shift', strategy: 'USE_SERVER', expectedVersion: 1
    });
    expect(conflict.status).toBe(403);
  });

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

    const res = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(pPayload);
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

    const res = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send(hPayload);
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
      .set(authHeaders(testTokenA))
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

  // 12. Konfliktauflösung: Veraltete Version liefert HTTP 409 Conflict
  test('12. Konfliktauflösung: USE_LOCAL mit veralteter expectedVersion liefert HTTP 409 Conflict', async () => {
    const taskId = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query("INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, status, revision_version) VALUES ($1, 'Task Veraltet', 'Leitung', CURRENT_DATE, 'Offen', 3) RETURNING id", [testTenantA])).rows[0].id;
    });

    const res = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(testTokenA))
      .send({
        clientUuid: `res-loc-fail-${Date.now()}`,
        entityType: 'task',
        strategy: 'USE_LOCAL',
        expectedVersion: 1,
        localPayload: { id: taskId, status: 'In Bearbeitung' }
      });

    expect(res.status).toBe(409);
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
      .set(authHeaders(testTokenA))
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

  // 14. SCHRITT 5R.2.7 KERN-TEST: Push-CONFLICT blockiert NICHT die nachfolgende Konfliktauflösung derselben clientUuid
  test('14. SCHRITT 5R.2.7: Push-CONFLICT blockiert nicht die nachfolgende Konfliktauflösung derselben clientUuid', async () => {
    // 1. Erstelle Task mit Serverversion 2
    const taskId = await withTenantTransaction(testTenantA, async (tx) => {
      const t = await tx.query(`
        INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, status, revision_version)
        VALUES ($1, 'Task für Konflikttest', 'Einsatzleitung', CURRENT_DATE, 'Offen', 2)
        RETURNING id;
      `, [testTenantA]);
      return t.rows[0].id;
    });

    const outboxUuid = `sync-task-collision-${Date.now()}`;

    // 2. Normaler /sync/push scheitert mit CONFLICT und speichert Quittung in sync_idempotency_receipts
    const pushRes = await request(app)
      .post('/api/v1/sync/push')
      .set(authHeaders(testTokenA))
      .send({
        deviceId: 'dev-01',
        mutations: [
          {
            clientUuid: outboxUuid,
            entityType: 'task',
            action: 'UPDATE',
            clientTimestamp: new Date().toISOString(),
            baseVersion: 1, // veraltet!
            payload: { id: taskId, status: 'In Bearbeitung' }
          }
        ]
      });

    expect(pushRes.status).toBe(200);
    expect(pushRes.body.data[0].status).toBe('CONFLICT');

    // 3. Nachfolgende Konfliktauflösung mit DIESERSELBEN Outbox-ID (outboxUuid):
    // Zuvor scheiterte dies fälschlich als HTTP 409 Integritätsverletzung, weil
    // sync_idempotency_receipts denselben Hash erwartete.
    // Mit der neuen Tabelle sync_conflict_resolution_receipts gelingt die Auflösung sauber!
    const resolveRes = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(testTokenA))
      .send({
        clientUuid: outboxUuid,
        entityType: 'task',
        strategy: 'USE_LOCAL',
        expectedVersion: 2, // Korrekte aktuelle Serverversion
        localPayload: { id: taskId, status: 'In Bearbeitung' }
      });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.data.applied).toBe(true);
    expect(resolveRes.body.data.serverState.status).toBe('In Bearbeitung');
    expect(resolveRes.body.data.serverState.revision_version).toBe(3);

    // 4. Wiederholung der Konfliktauflösung mit derselben UUID:
    // Muss idempotent denselben Zustand liefern, OHNE zweiten Audit-Log!
    const repeatRes = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(testTokenA))
      .send({
        clientUuid: outboxUuid,
        entityType: 'task',
        strategy: 'USE_LOCAL',
        expectedVersion: 2,
        localPayload: { id: taskId, status: 'In Bearbeitung' }
      });

    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.data.applied).toBe(true);

    const auditCount = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query("SELECT count(*) as count FROM audit_logs WHERE target_entity = $1", [`Conflict:${outboxUuid}`]);
    });
    expect(parseInt(auditCount.rows[0].count, 10)).toBe(1); // Exakt 1 Audit-Log!
  });

  // 15. Wachbuch: Wiederholte Konfliktauflösung erzeugt WEDER zweite Revision NOCH zweiten Audit-Eintrag
  test('15. Wachbuch: Wiederholte Konfliktauflösung erzeugt WEDER zweite Revision NOCH zweiten Audit-Eintrag', async () => {
    const entryId = await withTenantTransaction(testTenantA, async (tx) => {
      const r = await tx.query(`
        INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description)
        VALUES ($1, $2, $3, 'Vorkommnis', 'Dringend', 'Konflikteintrag Idem 2', 'Basis')
        RETURNING id;
      `, [testTenantA, siteAId, guardAId]);
      return r.rows[0].id;
    });

    const stableConflictUuid = `conf-gb-stable2-${Date.now()}`;

    // 1. Erste Konfliktauflösung
    const res1 = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(testTokenA))
      .send({
        clientUuid: stableConflictUuid,
        entityType: 'guardbook',
        strategy: 'USE_LOCAL',
        expectedVersion: 1,
        localPayload: { id: entryId, correctionNote: 'Stabile Konfliktrevision' }
      });
    expect(res1.status).toBe(200);
    expect(res1.body.data.applied).toBe(true);

    // 2. Zweiter identischer Aufruf
    const res2 = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(testTokenA))
      .send({
        clientUuid: stableConflictUuid,
        entityType: 'guardbook',
        strategy: 'USE_LOCAL',
        expectedVersion: 1,
        localPayload: { id: entryId, correctionNote: 'Stabile Konfliktrevision' }
      });
    expect(res2.status).toBe(200);
    expect(res2.body.data.applied).toBe(true);

    const auditCount = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query("SELECT count(*) as count FROM audit_logs WHERE target_entity = $1", [`Conflict:${stableConflictUuid}`]);
    });
    const revCount = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query("SELECT count(*) as count FROM guardbook_revisions WHERE client_mutation_id = $1", [`rev-${stableConflictUuid}`]);
    });

    expect(parseInt(auditCount.rows[0].count, 10)).toBe(1);
    expect(parseInt(revCount.rows[0].count, 10)).toBe(1);
  });

  // 16. Gleiche Konflikt-UUID mit verändertem Inhalt wird mit HTTP 409 abgewiesen
  test('16. Gleiche Konflikt-UUID mit verändertem Inhalt wird mit HTTP 409 abgewiesen', async () => {
    const entryId = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query("SELECT id FROM guardbook_entries WHERE tenant_id = $1 LIMIT 1", [testTenantA])).rows[0].id;
    });

    const conflictUuid = `conf-tamper-${Date.now()}`;

    // Erstausführung
    await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(testTokenA))
      .send({
        clientUuid: conflictUuid,
        entityType: 'guardbook',
        strategy: 'USE_LOCAL',
        expectedVersion: 1,
        localPayload: { id: entryId, correctionNote: 'Echter Nachtrag' }
      });

    // Manipulierter zweiter Aufruf mit geänderter Korrektur aber identischer UUID
    const resTamper = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(testTokenA))
      .send({
        clientUuid: conflictUuid,
        entityType: 'guardbook',
        strategy: 'USE_LOCAL',
        expectedVersion: 1,
        localPayload: { id: entryId, correctionNote: 'Manipulierter Nachtrag (Fälschung)' }
      });

    expect(resTamper.status).toBe(409);
    expect(resTamper.body.message).toContain('Integritätsverletzung');
  });

  // 17. Mandantenisolation bei Konfliktauflösung
  test('17. Mandantenisolation bei Konfliktauflösung: Mandant B kann keine Aufgaben von A auflösen', async () => {
    const taskIdA = await withTenantTransaction(testTenantA, async (tx) => {
      return (await tx.query("INSERT INTO tasks (tenant_id, title, assigned_to_name, due_date, status) VALUES ($1, 'Task A geheim', 'Leitung A', CURRENT_DATE, 'Offen') RETURNING id", [testTenantA])).rows[0].id;
    });

    const tokenB = crypto.randomBytes(32).toString('base64url');
    const tokenHashB = crypto.createHash('sha256').update(tokenB).digest('hex');
    await pool.query('INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)', [testUserAId, testRoleEinsatzId, testTenantB]);
    await pool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantB, tokenHashB]);

    const resB = await request(app)
      .post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(tokenB))
      .send({
        clientUuid: `hack-conflict-${Date.now()}`,
        entityType: 'task',
        strategy: 'USE_SERVER',
        expectedVersion: 1,
        localPayload: { id: taskIdA }
      });

    expect(resB.status).toBe(409);
    expect(resB.body.success).toBe(false);
    expect(resB.body.message).toContain('nicht gefunden oder fremder Mandant');
  });

  // 18. Parallele Konfliktauflösung mit identischer UUID
  test('18. Zwei parallele identische Konfliktauflösungen führen zu exakt einer Ausführung', async () => {
    const entryId = await withTenantTransaction(testTenantA, async (tx) => {
      const r = await tx.query(`
        INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description)
        VALUES ($1, $2, $3, 'Vorkommnis', 'Dringend', 'Parallel Konflikt Eintrag 2', 'Text')
        RETURNING id;
      `, [testTenantA, siteAId, guardAId]);
      return r.rows[0].id;
    });

    const parallelConflictUuid = `conf-parallel2-${Date.now()}`;
    const payload = {
      clientUuid: parallelConflictUuid,
      entityType: 'guardbook',
      strategy: 'USE_LOCAL',
      expectedVersion: 1,
      localPayload: { id: entryId, correctionNote: 'Parallele Konfliktauflösung' }
    };

    const [res1, res2] = await Promise.all([
      request(app).post('/api/v1/sync/conflicts/resolve').set(authHeaders(testTokenA)).send(payload),
      request(app).post('/api/v1/sync/conflicts/resolve').set(authHeaders(testTokenA)).send(payload)
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.data.applied).toBe(true);
    expect(res2.body.data.applied).toBe(true);

    const revCount = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query("SELECT count(*) as count FROM guardbook_revisions WHERE client_mutation_id = $1", [`rev-${parallelConflictUuid}`]);
    });
    const auditCount = await withTenantTransaction(testTenantA, async (tx) => {
      return tx.query("SELECT count(*) as count FROM audit_logs WHERE target_entity = $1", [`Conflict:${parallelConflictUuid}`]);
    });

    expect(parseInt(revCount.rows[0].count, 10)).toBe(1);
    expect(parseInt(auditCount.rows[0].count, 10)).toBe(1);
  });
});
