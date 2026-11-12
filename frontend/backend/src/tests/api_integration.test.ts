import request from 'supertest';
import argon2 from 'argon2';
import crypto from 'crypto';
import { app } from '../app';
import { pool, migrationPool } from '../config/database';
import { authHeaders } from './testUtils';
import { removeDocumentBlob } from '../services/documentFiles';

const SEED_PASSWORD = 'SecOpsVault2025SecurePassword!';
const SEED_USER_EMAIL = 'a.schmidt@ffm-sec.de';
const BAVARIA_USER_EMAIL = 'api.bavaria@secops.local';
const SITE_RESTRICTED_USER_EMAIL = 'api.site-restricted@secops.local';
const DMS_RESTRICTED_USER_EMAIL = 'api.dms-restricted@secops.local';
const DMS_RESTRICTED_ROLE = 'DMS API restricted test';
const TENANT_BAVARIA_ID = '22222222-2222-2222-2222-222222222222';
const clientNumber = `API-TEST-${Date.now()}`;
const siteCode = `API-SITE-${Date.now()}`;
const personnelNumber = `API-MA-${Date.now()}`;
let createdSiteId: string | undefined;
let createdEmployeeId: string | undefined;
let createdSyncedEmployeeId: string | undefined;
let createdShiftId: string | undefined;
let createdKeyId: string | undefined;
let archivedCustomerSiteCode: string | undefined;
let createdTaskId: string | undefined;
let createdDmsDocumentId: string | undefined;
let createdDmsFolderId: string | undefined;
const keyNumber = `API-KEY-${Date.now()}`;

async function login(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email, password: SEED_PASSWORD });

  expect(response.status).toBe(200);
  const setCookies = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies || '']).find((value) => value.startsWith('secops_session='));
  const sessionId = cookie?.match(/^secops_session=([^;]+)/)?.[1];
  return sessionId + '|' + response.body.data.csrfToken;
}

beforeAll(async () => {
  await migrationPool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [
    BAVARIA_USER_EMAIL
  ]);
  await migrationPool.query('DELETE FROM users WHERE email = $1', [BAVARIA_USER_EMAIL]);
  await migrationPool.query('DELETE FROM users WHERE email = $1', [SITE_RESTRICTED_USER_EMAIL]);
  await migrationPool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [DMS_RESTRICTED_USER_EMAIL]);
  await migrationPool.query('DELETE FROM users WHERE email = $1', [DMS_RESTRICTED_USER_EMAIL]);
  await migrationPool.query('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name=$1)', [DMS_RESTRICTED_ROLE]);
  await migrationPool.query('DELETE FROM roles WHERE name=$1', [DMS_RESTRICTED_ROLE]);

  const passwordHash = await argon2.hash(SEED_PASSWORD, { type: argon2.argon2id });
  const userResult = await migrationPool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, phone)
     VALUES ($1, $2, 'API', 'Bavaria', '+49 89 000')
     RETURNING id`,
    [BAVARIA_USER_EMAIL, passwordHash]
  );

  const roleResult = await migrationPool.query(
    `SELECT id FROM roles WHERE name = 'Einsatzleitung' LIMIT 1`
  );

  if (roleResult.rows.length === 0) {
    throw new Error('Seed-Rolle Einsatzleitung fehlt. Bitte `npm run seed` ausführen.');
  }

  await migrationPool.query(
    `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userResult.rows[0].id, roleResult.rows[0].id, TENANT_BAVARIA_ID]
  );

  const restrictedUser = await migrationPool.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,phone) VALUES ($1,$2,'API','Restricted','+49 30 001') RETURNING id`,
    [SITE_RESTRICTED_USER_EMAIL, passwordHash]
  );
  const restrictedRole = await migrationPool.query("SELECT id FROM roles WHERE name='Wachdienstmitarbeiter' LIMIT 1");
  if (!restrictedRole.rows.length) throw new Error('Seed-Rolle Wachdienstmitarbeiter fehlt.');
  await migrationPool.query('INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [restrictedUser.rows[0].id, restrictedRole.rows[0].id, '11111111-1111-1111-1111-111111111111']);

  const dmsRestricted = await migrationPool.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,phone)
     VALUES ($1,$2,'DMS','Restricted','+49 30 002') RETURNING id`,
    [DMS_RESTRICTED_USER_EMAIL, passwordHash]
  );
  const dmsRole = await migrationPool.query(
    `INSERT INTO roles (name,description) VALUES ($1,'DMS permission boundary test') RETURNING id`,
    [DMS_RESTRICTED_ROLE]
  );
  await migrationPool.query(
    `INSERT INTO role_permissions (role_id,permission_id)
     SELECT $1,id FROM permissions WHERE code='documents:read'`,
    [dmsRole.rows[0].id]
  );
  await migrationPool.query(
    `INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)`,
    [dmsRestricted.rows[0].id, dmsRole.rows[0].id, '11111111-1111-1111-1111-111111111111']
  );
});

afterAll(async () => {
  if (createdDmsDocumentId) {
    const cleanup = await migrationPool.connect();
    try {
      await cleanup.query('SET session_replication_role = replica');
      const versions = await cleanup.query(
        'SELECT DISTINCT storage_key FROM document_versions WHERE tenant_id=$1 AND document_id=$2',
        ['11111111-1111-1111-1111-111111111111', createdDmsDocumentId]
      );
      await cleanup.query('DELETE FROM document_audit_events WHERE tenant_id=$1 AND document_id=$2', ['11111111-1111-1111-1111-111111111111', createdDmsDocumentId]);
      await cleanup.query('DELETE FROM document_tag_assignments WHERE tenant_id=$1 AND document_id=$2', ['11111111-1111-1111-1111-111111111111', createdDmsDocumentId]);
      await cleanup.query('DELETE FROM document_relationships WHERE tenant_id=$1 AND document_id=$2', ['11111111-1111-1111-1111-111111111111', createdDmsDocumentId]);
      await cleanup.query('UPDATE document_versions SET restored_from_version=NULL WHERE tenant_id=$1 AND document_id=$2', ['11111111-1111-1111-1111-111111111111', createdDmsDocumentId]);
      await cleanup.query('DELETE FROM document_versions WHERE tenant_id=$1 AND document_id=$2', ['11111111-1111-1111-1111-111111111111', createdDmsDocumentId]);
      await cleanup.query('DELETE FROM documents WHERE tenant_id=$1 AND id=$2', ['11111111-1111-1111-1111-111111111111', createdDmsDocumentId]);
      for (const version of versions.rows) await removeDocumentBlob(version.storage_key);
    } finally {
      await cleanup.query('SET session_replication_role = origin');
      cleanup.release();
    }
  }
  if (createdDmsFolderId) {
    await migrationPool.query('DELETE FROM document_folders WHERE tenant_id=$1 AND id=$2', ['11111111-1111-1111-1111-111111111111', createdDmsFolderId]);
  }
  if (archivedCustomerSiteCode) await migrationPool.query('DELETE FROM sites WHERE site_code = $1', [archivedCustomerSiteCode]);
  await migrationPool.query('DELETE FROM tasks WHERE id = $1', [createdTaskId ?? null]);
  await migrationPool.query('DELETE FROM keys WHERE id = $1 OR key_number = $2', [createdKeyId ?? null, keyNumber]);
  await migrationPool.query('DELETE FROM shifts WHERE id = $1', [createdShiftId ?? null]);
  await migrationPool.query('DELETE FROM employees WHERE id = $1 OR personnel_number = $2', [createdEmployeeId ?? null, personnelNumber]);
  await migrationPool.query('DELETE FROM employees WHERE id = $1', [createdSyncedEmployeeId ?? null]);
  await migrationPool.query('DELETE FROM sites WHERE id = $1 OR site_code = $2', [createdSiteId ?? null, siteCode]);
  await migrationPool.query('DELETE FROM clients WHERE client_number = ANY($1::text[])', [[`${clientNumber}-ARCH`, `${clientNumber}-OFF`]]);
  await migrationPool.query('DELETE FROM clients WHERE client_number = $1', [clientNumber]);
  await migrationPool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [
    BAVARIA_USER_EMAIL
  ]);
  await migrationPool.query('DELETE FROM users WHERE email = $1', [BAVARIA_USER_EMAIL]);
  await migrationPool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [SITE_RESTRICTED_USER_EMAIL]);
  await migrationPool.query('DELETE FROM users WHERE email = $1', [SITE_RESTRICTED_USER_EMAIL]);
  await migrationPool.query('DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [DMS_RESTRICTED_USER_EMAIL]);
  await migrationPool.query('DELETE FROM users WHERE email = $1', [DMS_RESTRICTED_USER_EMAIL]);
  await migrationPool.query('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name=$1)', [DMS_RESTRICTED_ROLE]);
  await migrationPool.query('DELETE FROM roles WHERE name=$1', [DMS_RESTRICTED_ROLE]);
  await pool.end();
  await migrationPool.end();
});

describe('SecurityOps 2.0 – API-Persistenz & Mandantentrennung', () => {
  test('1. Kunde wird über die API in PostgreSQL gespeichert und nach erneutem Login wieder geladen', async () => {
    const firstToken = await login(SEED_USER_EMAIL);

    const createResponse = await request(app)
      .post('/api/v1/customers')
      .set(authHeaders(firstToken))
      .send({
        clientNumber,
        companyName: 'API Persistenz GmbH',
        contactPerson: 'Max Test',
        email: 'max@persistenz.de',
        phone: '+49 69 123456',
        address: 'Teststraße 1, 60311 Frankfurt',
        contractStart: '2026-01-01',
        contractEnd: '2028-12-31',
        slaLevel: 'Gold (24/7 Vor-Ort)'
      });

    expect(createResponse.status).toBe(201);

    // Neue Sitzung: Login erneut, danach muss der Datensatz aus PostgreSQL kommen.
    const secondToken = await login(SEED_USER_EMAIL);
    const listResponse = await request(app)
      .get('/api/v1/customers')
      .set(authHeaders(secondToken));

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          client_number: clientNumber,
          company_name: 'API Persistenz GmbH'
        })
      ])
    );
  });

  test('2. Ein Benutzer aus Mandant B sieht den Kunden aus Mandant A nicht', async () => {
    const bavariaToken = await login(BAVARIA_USER_EMAIL);

    const listResponse = await request(app)
      .get('/api/v1/customers')
      .set(authHeaders(bavariaToken));

    expect(listResponse.status).toBe(200);
    const clientNumbers = (listResponse.body.data as Array<{ client_number: string }>).map(
      (row) => row.client_number
    );
    expect(clientNumbers).not.toContain(clientNumber);
  });

  test('Kundenänderung ist revisionsgeschützt und Archivierung erhält verknüpfte Daten', async () => {
    const token = await login(SEED_USER_EMAIL);
    const create = await request(app).post('/api/v1/customers').set(authHeaders(token)).send({
      clientNumber: `${clientNumber}-ARCH`, companyName: 'Archiv Test GmbH', contactPerson: 'Test Person', email: 'archiv@test.de',
      phone: '+49 30 123', address: 'Testweg 2', contractStart: '2026-01-01', contractEnd: '2028-12-31'
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    archivedCustomerSiteCode = `ARCH-SITE-${Date.now()}`;
    await migrationPool.query(`INSERT INTO sites (tenant_id, client_id, site_code, name, address) VALUES ($1, $2, $3, 'Verknüpfter Standort', 'Teststraße 9')`, ['11111111-1111-1111-1111-111111111111', id, archivedCustomerSiteCode]);
    const update = await request(app).patch(`/api/v1/customers/${id}`).set(authHeaders(token)).send({ companyName: 'Aktualisiert GmbH', revisionVersion: 1 });
    expect(update.status).toBe(200);
    expect(update.body.data.revision_version).toBe(2);
    const stale = await request(app).patch(`/api/v1/customers/${id}`).set(authHeaders(token)).send({ companyName: 'Veraltet', revisionVersion: 1 });
    expect(stale.status).toBe(409);
    const foreign = await request(app).patch(`/api/v1/customers/${id}`).set(authHeaders(await login(BAVARIA_USER_EMAIL))).send({ companyName: 'Fremd', revisionVersion: 2 });
    expect(foreign.status).toBe(404);
    const archived = await request(app).post(`/api/v1/customers/${id}/archive`).set(authHeaders(token)).send({ revisionVersion: 2 });
    expect(archived.status).toBe(200);
    expect(archived.body.data.archived_at).toBeTruthy();
    const siteStillExists = await migrationPool.query('SELECT id FROM sites WHERE tenant_id=$1 AND client_id=$2 AND site_code=$3', ['11111111-1111-1111-1111-111111111111', id, archivedCustomerSiteCode]);
    expect(siteStillExists.rows).toHaveLength(1);
    const visible = await request(app).get('/api/v1/customers').set(authHeaders(token));
    expect(visible.body.data.some((row: any) => row.id === id)).toBe(false);
  });

  test('Offline-Kundenerstellung ist mandantengebunden und bei Wiederholung idempotent', async () => {
    const token = await login(SEED_USER_EMAIL);
    const mutationId = `client-offline-${Date.now()}`;
    const payload = { id: crypto.randomUUID(), clientNumber: `${clientNumber}-OFF`, companyName: 'Offline Kunde GmbH', contactPerson: 'Offline Test', email: 'offline@test.de', phone: '+49 40 123', address: 'Offlineweg 1', contractStart: '2026-01-01', contractEnd: '2028-12-31', slaLevel: 'Gold (24/7 Vor-Ort)' };
    const send = () => request(app).post('/api/v1/customers/sync').set(authHeaders(token)).send({ mutations: [{ clientUuid: mutationId, action: 'CREATE', baseVersion: 1, payload }] });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(200);
    expect(first.body.data[0].status).toBe('SYNCED');
    expect(second.body.data).toEqual(first.body.data);
    const stored = await migrationPool.query('SELECT id FROM clients WHERE tenant_id = $1 AND client_mutation_id = $2', ['11111111-1111-1111-1111-111111111111', mutationId]);
    expect(stored.rows).toHaveLength(1);
    await migrationPool.query('DELETE FROM clients WHERE id = $1', [payload.id]);
  });

  test('3. Objekte und Mitarbeiter werden mandantengetrennt aus PostgreSQL gelesen', async () => {
    const token = await login(SEED_USER_EMAIL);

    const sitesResponse = await request(app)
      .get('/api/v1/sites')
      .set(authHeaders(token));
    const employeesResponse = await request(app)
      .get('/api/v1/employees')
      .set(authHeaders(token));

    expect(sitesResponse.status).toBe(200);
    expect(Array.isArray(sitesResponse.body.data)).toBe(true);
    expect(employeesResponse.status).toBe(200);
    expect(Array.isArray(employeesResponse.body.data)).toBe(true);
  });

  test('4. Objekt und Mitarbeiter werden gespeichert, nach erneutem Login geladen und aktualisiert', async () => {
    const token = await login(SEED_USER_EMAIL);

    const customersResponse = await request(app)
      .get('/api/v1/customers')
      .set(authHeaders(token));
    expect(customersResponse.status).toBe(200);
    const clientId = customersResponse.body.data[0].id as string;

    const siteResponse = await request(app)
      .post('/api/v1/sites')
      .set(authHeaders(token))
      .send({
        clientId,
        siteCode,
        name: 'API Testobjekt',
        address: 'Testweg 1, 60311 Frankfurt',
        securityLevel: 'Hoch (KRITIS / BSI)',
        requiredGuardsDay: 2,
        requiredGuardsNight: 1,
        alarmSystem: 'EMA Test',
        accessRules: 'Ausweispflicht'
      });
    expect(siteResponse.status).toBe(201);
    createdSiteId = siteResponse.body.data.id;

    const employeeResponse = await request(app)
      .post('/api/v1/employees')
      .set(authHeaders(token))
      .send({
        personnelNumber,
        firstName: 'API',
        lastName: 'Mitarbeiter',
        email: 'api.mitarbeiter@secops.local',
        phone: '+49 69 999',
        role: 'Wachdienstmitarbeiter',
        status: 'Aktiv',
        weeklyHours: 40,
        hourlyRate: 19.5,
        dateOfJoining: '2026-01-01'
      });
    expect(employeeResponse.status).toBe(201);
    createdEmployeeId = employeeResponse.body.data.id;

    const updateResponse = await request(app)
      .patch(`/api/v1/employees/${createdEmployeeId}`)
      .set(authHeaders(token))
      .send({ status: 'Urlaub', revisionVersion: employeeResponse.body.data.revision_version });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.revision_version).toBe(employeeResponse.body.data.revision_version + 1);
    const staleUpdate = await request(app).patch(`/api/v1/employees/${createdEmployeeId}`).set(authHeaders(token)).send({ status: 'Aktiv', revisionVersion: employeeResponse.body.data.revision_version });
    expect(staleUpdate.status).toBe(409);

    const secondToken = await login(SEED_USER_EMAIL);

    const sitesResponse = await request(app)
      .get('/api/v1/sites')
      .set(authHeaders(secondToken));
    expect(sitesResponse.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ site_code: siteCode, name: 'API Testobjekt' })])
    );

    const employeesResponse = await request(app)
      .get('/api/v1/employees')
      .set(authHeaders(secondToken));
    expect(employeesResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ personnel_number: personnelNumber, status: 'Urlaub' })
      ])
    );
  });

  test('5a. Qualifikationen, Abwesenheiten und Mitarbeiterarchiv sind persistent und revisionsgeschützt', async () => {
    if (!createdEmployeeId) throw new Error('Mitarbeiter aus Test 4 fehlt.');
    const token = await login(SEED_USER_EMAIL);
    const qualification = await request(app).post(`/api/v1/employees/${createdEmployeeId}/qualifications`).set(authHeaders(token)).send({ type: 'Sachkundeprüfung § 34a', certificateNumber: 'CERT-API-1', issueDate: '2026-01-01', expiryDate: '2027-01-01', verified: true, documentReference: 'DOC-TEST-1' });
    expect(qualification.status).toBe(201);
    expect(qualification.body.data.document_reference).toBe('DOC-TEST-1');
    const absence = await request(app).post(`/api/v1/employees/${createdEmployeeId}/absences`).set(authHeaders(token)).send({ type: 'Urlaub', startDate: '2026-12-01', endDate: '2026-12-05', notes: 'Regressionstest' });
    expect(absence.status).toBe(201);
    const overlap = await request(app).post(`/api/v1/employees/${createdEmployeeId}/absences`).set(authHeaders(token)).send({ type: 'Sonstige', startDate: '2026-12-02', endDate: '2026-12-03' });
    expect(overlap.status).toBe(409);
    const approved = await request(app).post(`/api/v1/employees/${createdEmployeeId}/absences/${absence.body.data.id}/review`).set(authHeaders(token)).send({ revisionVersion: absence.body.data.revision_version, decision: 'APPROVED' });
    expect(approved.status).toBe(200);
    const loaded = await request(app).get('/api/v1/employees').set(authHeaders(token));
    const employee = loaded.body.data.find((item: any) => item.id === createdEmployeeId);
    expect(employee.qualifications).toEqual(expect.arrayContaining([expect.objectContaining({ certificate_number: 'CERT-API-1' })]));
    expect(employee.absences).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'APPROVED' })]));
    const archive = await request(app).post(`/api/v1/employees/${createdEmployeeId}/archive`).set(authHeaders(token)).send({ revisionVersion: employee.revision_version });
    expect(archive.status).toBe(200);
    const restore = await request(app).post(`/api/v1/employees/${createdEmployeeId}/restore`).set(authHeaders(token)).send({ revisionVersion: archive.body.data.revision_version });
    expect(restore.status).toBe(200);
  });

  test('5b. Mitarbeiter-Outbox nimmt das IndexedDB-Envelope an und ist idempotent', async () => {
    const token = await login(SEED_USER_EMAIL);
    const employeeId = crypto.randomUUID();
    const mutationId = crypto.randomUUID();
    createdSyncedEmployeeId = employeeId;
    const mutation = {
      clientUuid: mutationId,
      entityType: 'employee',
      action: 'CREATE',
      clientTimestamp: new Date().toISOString(),
      baseVersion: 1,
      payload: {
        id: employeeId,
        personnelNumber: 'API-OFF-' + Date.now(),
        firstName: 'Offline',
        lastName: 'Mitarbeiter',
        email: 'offline-' + Date.now() + '@secops.local',
        phone: '+49 69 123',
        role: 'Wachdienstmitarbeiter',
        status: 'Aktiv',
        weeklyHours: 40,
        hourlyRate: 19,
        dateOfJoining: '2026-01-01'
      }
    };
    const send = () => request(app).post('/api/v1/employees/sync').set(authHeaders(token)).send({
      deviceId: 'employee-outbox-test',
      mutations: [mutation]
    });
    const first = await send();
    const repeated = await send();
    expect(first.status).toBe(200);
    expect(first.body.data[0]).toEqual(expect.objectContaining({ clientUuid: mutationId, serverId: employeeId, status: 'SYNCED', serverVersion: 1 }));
    expect(repeated.body.data).toEqual(first.body.data);
    const stored = await migrationPool.query('SELECT id FROM employees WHERE tenant_id=$1 AND id=$2', ['11111111-1111-1111-1111-111111111111', employeeId]);
    expect(stored.rows).toHaveLength(1);
  });

  test('5. Mandant B sieht die neu angelegten Objekte und Mitarbeiter nicht', async () => {
    const bavariaToken = await login(BAVARIA_USER_EMAIL);

    const sitesResponse = await request(app)
      .get('/api/v1/sites')
      .set(authHeaders(bavariaToken));
    const employeesResponse = await request(app)
      .get('/api/v1/employees')
      .set(authHeaders(bavariaToken));

    expect(sitesResponse.status).toBe(200);
    expect(employeesResponse.status).toBe(200);

    const siteCodes = (sitesResponse.body.data as Array<{ site_code: string }>).map((row) => row.site_code);
    const personnelNumbers = (employeesResponse.body.data as Array<{ personnel_number: string }>).map(
      (row) => row.personnel_number
    );

    expect(siteCodes).not.toContain(siteCode);
    expect(personnelNumbers).not.toContain(personnelNumber);
  });


  test('6. Schicht, Schlüssel und Aufgabe werden gespeichert, geladen und aktualisiert', async () => {
    if (!createdSiteId || !createdEmployeeId) {
      throw new Error('Test 4 muss zuerst Objekt und Mitarbeiter anlegen.');
    }

    const token = await login(SEED_USER_EMAIL);

    const shiftResponse = await request(app)
      .post('/api/v1/shifts')
      .set(authHeaders(token))
      .send({
        siteId: createdSiteId,
        employeeId: createdEmployeeId,
        date: '2026-11-12',
        startTime: '06:00',
        endTime: '18:00',
        type: 'Tagdienst',
        status: 'Besetzt',
        requiredQualification: 'Unterrichtung § 34a GewO'
      });
    expect(shiftResponse.status).toBe(201);
    createdShiftId = shiftResponse.body.data.id;

    const keyResponse = await request(app)
      .post('/api/v1/keys')
      .set(authHeaders(token))
      .send({
        siteId: createdSiteId,
        keyNumber,
        label: 'API Testsclüssel',
        type: 'Transponder',
        status: 'Im Tresor'
      });
    expect(keyResponse.status).toBe(201);
    createdKeyId = keyResponse.body.data.id;

    const taskResponse = await request(app)
      .post('/api/v1/tasks')
      .set(authHeaders(token))
      .send({
        title: 'API Testaufgabe',
        assignedToName: 'Einsatzleitung',
        siteName: 'API Testobjekt',
        dueDate: '2026-11-20',
        priority: 'Hoch',
        status: 'Offen',
        category: 'Audit'
      });
    expect(taskResponse.status).toBe(201);
    createdTaskId = taskResponse.body.data.id;

    const issueResponse = await request(app)
      .patch(`/api/v1/keys/${createdKeyId}`)
      .set(authHeaders(token))
      .send({
        status: 'Ausgegeben',
        currentHolderId: createdEmployeeId,
        issuedAt: new Date().toISOString(),
        expectedReturn: '2026-11-20T18:00:00.000Z'
      });
    expect(issueResponse.status).toBe(200);

    const completeTaskResponse = await request(app)
      .patch(`/api/v1/tasks/${createdTaskId}`)
      .set(authHeaders(token))
      .send({ status: 'Erledigt' });
    expect(completeTaskResponse.status).toBe(200);

    const closeShiftResponse = await request(app)
      .patch(`/api/v1/shifts/${createdShiftId}`)
      .set(authHeaders(token))
      .send({ status: 'Abgeschlossen' });
    expect(closeShiftResponse.status).toBe(200);

    const secondToken = await login(SEED_USER_EMAIL);

    const shiftsResponse = await request(app)
      .get('/api/v1/shifts')
      .set(authHeaders(secondToken));
    expect(shiftsResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdShiftId, status: 'Abgeschlossen', site_name: 'API Testobjekt' })
      ])
    );

    const keysResponse = await request(app)
      .get('/api/v1/keys')
      .set(authHeaders(secondToken));
    expect(keysResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdKeyId, key_number: keyNumber, status: 'Ausgegeben' })
      ])
    );

    const tasksResponse = await request(app)
      .get('/api/v1/tasks')
      .set(authHeaders(secondToken));
    expect(tasksResponse.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createdTaskId, status: 'Erledigt' })])
    );
  });

  test('7. Mandant B sieht Schichten, Schlüssel und Aufgaben aus Mandant A nicht', async () => {
    const bavariaToken = await login(BAVARIA_USER_EMAIL);

    const shiftsResponse = await request(app).get('/api/v1/shifts').set(authHeaders(bavariaToken));
    const keysResponse = await request(app).get('/api/v1/keys').set(authHeaders(bavariaToken));
    const tasksResponse = await request(app).get('/api/v1/tasks').set(authHeaders(bavariaToken));

    expect(shiftsResponse.status).toBe(200);
    expect(keysResponse.status).toBe(200);
    expect(tasksResponse.status).toBe(200);

    expect((shiftsResponse.body.data as Array<{ id: string }>).some((row) => row.id === createdShiftId)).toBe(false);
    expect((keysResponse.body.data as Array<{ key_number: string }>).some((row) => row.key_number === keyNumber)).toBe(false);
    expect((tasksResponse.body.data as Array<{ id: string }>).some((row) => row.id === createdTaskId)).toBe(false);
  });

  test('Standorte werden revisionsgeschützt archiviert/wiederhergestellt; operative Beziehungen bleiben erhalten', async () => {
    const token = await login(SEED_USER_EMAIL);
    expect(createdSiteId).toBeTruthy();
    const update = await request(app).patch(`/api/v1/sites/${createdSiteId}`).set(authHeaders(token)).send({ name: 'API Testobjekt aktualisiert', revisionVersion: 1 });
    expect(update.status).toBe(200);
    expect(update.body.data.revision_version).toBe(2);
    const stale = await request(app).patch(`/api/v1/sites/${createdSiteId}`).set(authHeaders(token)).send({ name: 'Veraltet', revisionVersion: 1 });
    expect(stale.status).toBe(409);
    const foreign = await request(app).post(`/api/v1/sites/${createdSiteId}/archive`).set(authHeaders(await login(BAVARIA_USER_EMAIL))).send({ revisionVersion: 2 });
    expect(foreign.status).toBe(404);
    const archive = await request(app).post(`/api/v1/sites/${createdSiteId}/archive`).set(authHeaders(token)).send({ revisionVersion: 2 });
    expect(archive.status).toBe(200);
    expect(archive.body.data.revision_version).toBe(3);
    const staleRestore = await request(app).post(`/api/v1/sites/${createdSiteId}/restore`).set(authHeaders(token)).send({ revisionVersion: 2 });
    expect(staleRestore.status).toBe(409);
    const rows = await migrationPool.query('SELECT (SELECT count(*) FROM shifts WHERE id=$1) AS shifts, (SELECT count(*) FROM keys WHERE id=$2) AS keys, (SELECT count(*) FROM tasks WHERE id=$3) AS tasks FROM sites WHERE id=$4', [createdShiftId, createdKeyId, createdTaskId, createdSiteId]);
    expect(rows.rows[0]).toMatchObject({ shifts: '1', keys: '1', tasks: '1' });
    const restore = await request(app).post(`/api/v1/sites/${createdSiteId}/restore`).set(authHeaders(token)).send({ revisionVersion: 3 });
    expect(restore.status).toBe(200);
    expect(restore.body.data.revision_version).toBe(4);
  });

  test('Site-Outbox unterstützt idempotente Offline-Anlage und weist Mutation-ID-Inhaltsänderung ab', async () => {
    const token = await login(SEED_USER_EMAIL);
    const mutationId = `site-offline-${Date.now()}`;
    const id = crypto.randomUUID();
    const payload = { id, clientId: 'c1111111-1111-1111-1111-111111111111', siteCode: `OFF-${Date.now()}`, name: 'Offline Standort', address: 'Offlineweg 1', securityLevel: 'Mittel', requiredGuardsDay: 1, requiredGuardsNight: 1, alarmSystem: '', accessRules: '' };
    const send = (p: any) => request(app).post('/api/v1/sites/sync').set(authHeaders(token)).send({ mutations: [{ clientUuid: mutationId, action: 'CREATE', baseVersion: 1, payload: p }] });
    const first = await send(payload); const replay = await send(payload); const altered = await send({ ...payload, name: 'Manipuliert' });
    expect(first.status).toBe(200); expect(first.body.data[0].status).toBe('SYNCED'); expect(replay.body.data).toEqual(first.body.data); expect(altered.body.data[0].status).toBe('REJECTED');
    await migrationPool.query('DELETE FROM sites WHERE id=$1', [id]);
  });

  test('Site-API weist unauthentifizierte Änderungsanfragen zurück', async () => {
    const response = await request(app).post(`/api/v1/sites/${createdSiteId}/archive`).send({ revisionVersion: 1 });
    expect(response.status).toBe(401);
  });

  test('Standortänderungen ohne sites:update-Berechtigung werden abgewiesen', async () => {
    const token = await login(SITE_RESTRICTED_USER_EMAIL);
    const response = await request(app).patch(`/api/v1/sites/${createdSiteId}`).set(authHeaders(token)).send({ name: 'Nicht erlaubt', revisionVersion: 4 });
    expect(response.status).toBe(403);
  });

  test('8. Wachbucheinträge können weiterhin manuell über die geschützte API gespeichert und geladen werden', async () => {
    const token = await login(SEED_USER_EMAIL);
    const title = `Manueller Regressionseintrag ${Date.now()}`;
    const create = await request(app)
      .post('/api/v1/logbook')
      .set(authHeaders(token))
      .send({
        siteId: 'b1111111-1111-1111-1111-111111111111',
        guardId: 'e1111111-1111-1111-1111-111111111111',
        category: 'Vorkommnis',
        priority: 'Normal',
        title,
        description: 'Manuell dokumentierter Regressionstest des Wachbuchs.',
        policeInvolved: false
      });
    expect(create.status).toBe(201);
    expect(create.body.data.title).toBe(title);

    const list = await request(app).get('/api/v1/logbook').set(authHeaders(token));
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ title })]));
  });

  test('DMS-Upload, Download, Versionierung, Archiv, Audit und Mandantentrennung funktionieren serverseitig', async () => {
    const token = await login(SEED_USER_EMAIL);
    const categories = await request(app).get('/api/v1/documents/categories').set(authHeaders(token));
    expect(categories.status).toBe(200);
    const categoryId = categories.body.data.find((item: any) => item.name === 'Verträge')?.id;
    expect(categoryId).toBeTruthy();

    const folder = await request(app).post('/api/v1/documents/folders').set(authHeaders(token)).send({ name: `DMS API ${Date.now()}` });
    expect(folder.status).toBe(201);
    createdDmsFolderId = folder.body.data.id;

    const filename = 'integration-contract.pdf';
    const firstBytes = Buffer.from('%PDF-1.7\nDMS integration test v1\n');
    const upload = await request(app)
      .post('/api/v1/documents')
      .query({ title: `DMS integration ${Date.now()}`, categoryId, folderId: createdDmsFolderId })
      .set(authHeaders(token))
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent(filename))
      .send(firstBytes);
    expect(upload.status).toBe(201);
    createdDmsDocumentId = upload.body.data.id;
    expect(upload.body.data.size_bytes).toBe(firstBytes.length);
    expect(upload.body.data.scan_status).toBe('not_scanned');

    const invalidUpload = await request(app)
      .post('/api/v1/documents')
      .query({ title: 'Bad signature', categoryId })
      .set(authHeaders(token))
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent('fake.pdf'))
      .send(Buffer.from('not actually a PDF'));
    expect(invalidUpload.status).toBe(415);

    const listed = await request(app).get('/api/v1/documents').set(authHeaders(token));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: createdDmsDocumentId, original_filename: filename, current_version: 1 })
    ]));

    const downloaded = await request(app)
      .get(`/api/v1/documents/${createdDmsDocumentId}/download`)
      .set(authHeaders(token))
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(downloaded.status).toBe(200);
    expect(downloaded.body).toEqual(firstBytes);

    const secondBytes = Buffer.from('%PDF-1.7\nDMS integration test v2\n');
    const version = await request(app)
      .post(`/api/v1/documents/${createdDmsDocumentId}/versions`)
      .set(authHeaders(token))
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent('integration-contract-v2.pdf'))
      .send(secondBytes);
    expect(version.status).toBe(201);
    expect(version.body.data.version_number).toBe(2);

    const history = await request(app).get(`/api/v1/documents/${createdDmsDocumentId}/versions`).set(authHeaders(token));
    expect(history.body.data.map((item: any) => item.version_number)).toEqual([2, 1]);
    const restoreVersion = await request(app)
      .post(`/api/v1/documents/${createdDmsDocumentId}/versions/1/restore`)
      .set(authHeaders(token))
      .send({});
    expect(restoreVersion.status).toBe(201);
    expect(restoreVersion.body.data.version_number).toBe(3);

    const bavariaToken = await login(BAVARIA_USER_EMAIL);
    const foreignDetail = await request(app).get(`/api/v1/documents/${createdDmsDocumentId}`).set(authHeaders(bavariaToken));
    const foreignDownload = await request(app).get(`/api/v1/documents/${createdDmsDocumentId}/download`).set(authHeaders(bavariaToken));
    const foreignUpdate = await request(app).patch(`/api/v1/documents/${createdDmsDocumentId}`).set(authHeaders(bavariaToken)).send({ title: 'Fremder Zugriff' });
    expect(foreignDetail.status).toBe(404);
    expect(foreignDownload.status).toBe(404);
    expect(foreignUpdate.status).toBe(404);

    const restrictedToken = await login(DMS_RESTRICTED_USER_EMAIL);
    const restrictedList = await request(app).get('/api/v1/documents').set(authHeaders(restrictedToken));
    const restrictedDownload = await request(app).get(`/api/v1/documents/${createdDmsDocumentId}/download`).set(authHeaders(restrictedToken));
    const restrictedUpdate = await request(app).patch(`/api/v1/documents/${createdDmsDocumentId}`).set(authHeaders(restrictedToken)).send({ title: 'Nicht erlaubt' });
    expect(restrictedList.status).toBe(200);
    expect(restrictedDownload.status).toBe(403);
    expect(restrictedUpdate.status).toBe(403);

    const archive = await request(app).post(`/api/v1/documents/${createdDmsDocumentId}/archive`).set(authHeaders(token)).send({});
    expect(archive.status).toBe(200);
    const restore = await request(app).post(`/api/v1/documents/${createdDmsDocumentId}/restore`).set(authHeaders(token)).send({});
    expect(restore.status).toBe(200);

    const audit = await request(app).get(`/api/v1/documents/${createdDmsDocumentId}/audit`).set(authHeaders(token));
    expect(audit.status).toBe(200);
    expect(audit.body.data.map((item: any) => item.action)).toEqual(
      expect.arrayContaining(['created', 'uploaded', 'downloaded', 'version_created', 'version_restored', 'archived', 'restored'])
    );
  });

  test('Öffentlicher Health-Endpunkt gibt keine Datenbankfehlerdetails preis', async () => {
    const querySpy = jest.spyOn(pool, 'query').mockImplementationOnce((() => Promise.reject(new Error('db-password=never-expose-this'))) as any);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app).get('/api/v1/health');
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ status: 'DOWN', database: 'Disconnected' });
      expect(response.body.error).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('db-password=never-expose-this');
      expect(JSON.stringify(log.mock.calls)).not.toContain('db-password=never-expose-this');
    } finally {
      querySpy.mockRestore();
      log.mockRestore();
    }
  });

});
