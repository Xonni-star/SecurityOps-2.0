import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool, migrationPool, withTenantTransaction, verifyAppDatabaseRole } from '../config/database';
import { cleanupTestData, authHeaders, insertTenantMembership } from './testUtils';
import { env } from '../config/env';

describe('SecurityOps 2.0 - Schritt 5R.2.7: Idempotenz zwischen Sync-Push und Konfliktauflösung', () => {
  let testTenantA: string;
  let testTenantB: string;
  let testUserAId: string;
  let planningApproverId: string;
  let planningApproverToken: string;
  let planningDeniedUserId: string;
  let planningDeniedToken: string;
  let restrictedUserId: string;
  let siteScopedUserId: string;
  let siteScopedTargetUserId: string;
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
      [['logbook:create', 'shifts:manage', 'tasks:manage', 'keys:manage', 'patrol:create', 'handover:create',
        'employees:create', 'employees:update', 'employees:archive', 'employees:restore', 'qualifications:manage',
        'employees:absence:manage', 'employees:absence:approve', 'planning:read', 'planning:manage', 'planning:publish',
        'planning:rules:manage', 'planning:rules:approve', 'planning:reports:read',
        'planning:covers:manage', 'planning:covers:approve', 'planning:actuals:manage',
        'planning:actuals:approve']]
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

    await insertTenantMembership(testTenantA, testUserAId);
    await migrationPool.query(
      'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3);',
      [testUserAId, testRoleEinsatzId, testTenantA]
    );

    testTokenA = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(testTokenA).digest('hex');
    await migrationPool.query(`
      INSERT INTO user_sessions (user_id, tenant_id, token_hash, expires_at, revoked)
      VALUES ($1, $2, $3, NOW() + interval '1 hour', false);
    `, [testUserAId, testTenantA, tokenHash]);

    planningApproverId = (await pool.query(
      `INSERT INTO users (email,password_hash,first_name,last_name)
       VALUES ($1,'unused-test-hash','Planning','Approver') RETURNING id`,
      [`planning.approver.${Date.now()}@secops.local`]
    )).rows[0].id;
    await insertTenantMembership(testTenantA, planningApproverId);
    await migrationPool.query('INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)',
      [planningApproverId, testRoleEinsatzId, testTenantA]);
    planningApproverToken = crypto.randomBytes(32).toString('base64url');
    await migrationPool.query(
      `INSERT INTO user_sessions (user_id,tenant_id,token_hash,expires_at,revoked)
       VALUES ($1,$2,$3,NOW()+interval '1 hour',false)`,
      [planningApproverId, testTenantA, crypto.createHash('sha256').update(planningApproverToken).digest('hex')]
    );

    const deniedRoleId = (await pool.query(
      `INSERT INTO roles (name,description) VALUES ($1,'Planning permission regression role') RETURNING id`,
      [`PlanningDenied_${Date.now()}`]
    )).rows[0].id;
    planningDeniedUserId = (await pool.query(
      `INSERT INTO users (email,password_hash,first_name,last_name)
       VALUES ($1,'unused-test-hash','Planning','Denied') RETURNING id`,
      [`planning.denied.${Date.now()}@secops.local`]
    )).rows[0].id;
    await insertTenantMembership(testTenantA, planningDeniedUserId);
    await migrationPool.query('INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)',
      [planningDeniedUserId, deniedRoleId, testTenantA]);
    planningDeniedToken = crypto.randomBytes(32).toString('base64url');
    await migrationPool.query(
      `INSERT INTO user_sessions (user_id,tenant_id,token_hash,expires_at,revoked)
       VALUES ($1,$2,$3,NOW()+interval '1 hour',false)`,
      [planningDeniedUserId, testTenantA, crypto.createHash('sha256').update(planningDeniedToken).digest('hex')]
    );

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

      await tx.query(
        `INSERT INTO employee_site_assignments (tenant_id,employee_id,site_id) VALUES ($1,$2,$3)`,
        [testTenantA, guardAId, siteAId]
      );
      await tx.query(
        `INSERT INTO employee_qualifications
          (tenant_id,employee_id,qualification_type,certificate_number,issue_date,expiry_date,verified,status)
         VALUES ($1,$2,'Sachkunde','Q-SYNC','2025-01-01','2028-01-01',TRUE,'VALID')`,
        [testTenantA, guardAId]
      );

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
    await insertTenantMembership(testTenantA, restrictedUserId);
    await migrationPool.query('INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)', [restrictedUserId, restrictedRoleId, testTenantA]);
    const restrictedToken = crypto.randomBytes(32).toString('base64url');
    await migrationPool.query("INSERT INTO user_sessions (user_id,tenant_id,token_hash,expires_at,revoked) VALUES ($1,$2,$3,NOW()+interval '1 hour',false)",
      [restrictedUserId, testTenantA, crypto.createHash('sha256').update(restrictedToken).digest('hex')]);
    const denied = await request(app).post('/api/v1/employees/sync').set(authHeaders(restrictedToken))
      .send(mutation('emp-denied-' + Date.now(), 'UPDATE', 2, { id: guardAId, firstName: 'NichtErlaubt' }));
    expect(denied.body.data[0]).toMatchObject({ status: 'REJECTED', message: expect.stringContaining('employees:update') });
  });

  afterAll(async () => {
    // Administrative Bereinigung inkl. Append-Only-Trigger (nur Testdatenbank).
    await cleanupTestData([testTenantA, testTenantB], [testUserAId, planningApproverId, planningDeniedUserId, restrictedUserId, siteScopedUserId, siteScopedTargetUserId]);
    await pool.end();
    await migrationPool.end();
  });

  test('site-scoped sync grants authorize only mutations for their assigned site', async () => {
    const siteB = await withTenantTransaction(testTenantA, async tx => {
      const client = await tx.query(
        `INSERT INTO clients (tenant_id,client_number,company_name,contract_start,contract_end)
         VALUES ($1,$2,'Site Scope Test','2025-01-01','2026-01-01') RETURNING id`,
        [testTenantA, `SITE-SCOPE-${Date.now()}`]
      );
      const site = await tx.query(
        `INSERT INTO sites (tenant_id,client_id,site_code,name,address)
         VALUES ($1,$2,$3,'Site B','Test') RETURNING id`,
        [testTenantA, client.rows[0].id, `SITE-B-${Date.now()}`]
      );
      const employee = await tx.query(
        `INSERT INTO employees (tenant_id,personnel_number,first_name,last_name,email,phone,role,date_of_joining)
         VALUES ($1,$2,'Site','B Employee',$3,'030','Wachkraft','2025-01-01') RETURNING id`,
        [testTenantA, `MA-SITE-B-${Date.now()}`, `site-b-${Date.now()}@secops.test`]
      );
      await tx.query(
        `INSERT INTO employee_site_assignments (tenant_id,employee_id,site_id) VALUES ($1,$2,$3)`,
        [testTenantA, employee.rows[0].id, site.rows[0].id]
      );
      await tx.query(
        `INSERT INTO guardbook_entries (tenant_id,site_id,guard_id,category,title,description)
         VALUES ($1,$2,$3,'Vorkommnis','Site B entry','Must remain inaccessible')`,
        [testTenantA, site.rows[0].id, guardAId]
      );
      return { id: site.rows[0].id as string, employeeId: employee.rows[0].id as string };
    });

    const roleId = (await pool.query(
      `INSERT INTO tenant_roles (tenant_id,name,description) VALUES ($1,$2,'Site-scoped sync test') RETURNING id`,
      [testTenantA, `SiteSync_${Date.now()}`]
    )).rows[0].id as string;
    await pool.query(
      `INSERT INTO tenant_role_permissions (tenant_id,role_id,permission_id,site_id,data_scope)
       SELECT $1,$2,p.id,$3,'SITE' FROM permissions p WHERE p.code=ANY($4::text[])`,
      [testTenantA, roleId, siteAId, ['logbook:create', 'employees:read', 'users:read']]
    );
    siteScopedUserId = (await pool.query(
      `INSERT INTO users (email,password_hash,first_name,last_name)
       VALUES ($1,'unused-test-hash','Site','Scoped') RETURNING id`,
      [`site.scoped.${Date.now()}@secops.local`]
    )).rows[0].id as string;
    await insertTenantMembership(testTenantA, siteScopedUserId);
    await pool.query(
      `INSERT INTO tenant_user_roles (tenant_id,user_id,role_id) VALUES ($1,$2,$3)`,
      [testTenantA, siteScopedUserId, roleId]
    );
    siteScopedTargetUserId = (await pool.query(
      `INSERT INTO users (email,password_hash,first_name,last_name)
       VALUES ($1,'unused-test-hash','Site','Assignment Target') RETURNING id`,
      [`site.assignment.target.${Date.now()}@secops.local`]
    )).rows[0].id as string;
    await insertTenantMembership(testTenantA, siteScopedTargetUserId);
    await pool.query(
      `INSERT INTO tenant_user_roles (tenant_id,user_id,role_id,site_id)
       VALUES ($1,$2,$3,$4),($1,$2,$3,$5)`,
      [testTenantA, siteScopedTargetUserId, roleId, siteAId, siteB.id]
    );
    const token = crypto.randomBytes(32).toString('base64url');
    await migrationPool.query(
      `INSERT INTO user_sessions (user_id,tenant_id,token_hash,expires_at,revoked)
       VALUES ($1,$2,$3,NOW()+interval '1 hour',false)`,
      [siteScopedUserId, testTenantA, crypto.createHash('sha256').update(token).digest('hex')]
    );

    const employeeList = await request(app).get('/api/v1/employees').set(authHeaders(token));
    expect(employeeList.status).toBe(200);
    expect(employeeList.body.data.map((employee: { id: string }) => employee.id)).toContain(guardAId);
    expect(employeeList.body.data.map((employee: { id: string }) => employee.id)).not.toContain(siteB.employeeId);

    const filteredForeignSite = await request(app).get(`/api/v1/employees?siteId=${siteB.id}`).set(authHeaders(token));
    expect(filteredForeignSite.status).toBe(404);
    expect(filteredForeignSite.body.data).toBeUndefined();

    const siteFilteredUsers = await request(app).get(`/api/v1/admin/users?siteId=${siteAId}`).set(authHeaders(token));
    expect(siteFilteredUsers.status).toBe(200);
    const targetUser = siteFilteredUsers.body.data.find((entry: { id: string }) => entry.id === siteScopedTargetUserId);
    expect(targetUser.roles).toHaveLength(1);
    expect(targetUser.roles[0].siteId).toBe(siteAId);
    expect(targetUser.sites).toEqual([{ id: siteAId, name: expect.any(String) }]);

    const push = (clientUuid: string, action: 'CREATE' | 'UPDATE', payload: Record<string, unknown>) =>
      request(app).post('/api/v1/sync/push').set(authHeaders(token)).send({
        deviceId: 'site-scope-device',
        mutations: [{ clientUuid, entityType: 'guardbook', action, clientTimestamp: new Date().toISOString(), payload }]
      });

    const ownSite = await push(`site-a-${Date.now()}`, 'CREATE', {
      siteId: siteAId, guardId: guardAId, title: 'Site A entry', description: 'Authorized'
    });
    expect(ownSite.body.data[0].status).toBe('SYNCED');
    const ownSiteRetry = await push(ownSite.body.data[0].clientUuid, 'CREATE', {
      siteId: siteAId, guardId: guardAId, title: 'Site A entry', description: 'Authorized'
    });
    expect(ownSiteRetry.body.data[0]).toEqual(ownSite.body.data[0]);

    const foreignSite = await push(`site-b-${Date.now()}`, 'CREATE', {
      siteId: siteB.id, guardId: guardAId, title: 'Denied Site B entry', description: 'Denied'
    });
    expect(foreignSite.body.data[0]).toMatchObject({
      status: 'REJECTED',
      message: expect.stringContaining('fehlende Berechtigung')
    });

    const foreignEntryId = await withTenantTransaction(testTenantA, async tx => {
      const entry = await tx.query(
        `SELECT id FROM guardbook_entries WHERE tenant_id=$1 AND site_id=$2 AND title='Site B entry'`,
        [testTenantA, siteB.id]
      );
      return entry.rows[0].id as string;
    });
    const foreignUpdate = await push(`site-b-update-${Date.now()}`, 'UPDATE', {
      entryId: foreignEntryId, correctionNote: 'Denied'
    });
    expect(foreignUpdate.body.data[0]).toMatchObject({
      status: 'REJECTED',
      message: expect.stringContaining('fehlende Berechtigung')
    });
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

  test('Sync-Push weist Wiederverwendung einer Mutation-ID mit geändertem Entity-Typ oder Vorgang ab', async () => {
    const clientUuid = `shift-reuse-${Date.now()}`;
    const mutation = {
      clientUuid,
      entityType: 'shift',
      action: 'CREATE',
      clientTimestamp: new Date().toISOString(),
      baseVersion: 1,
      payload: {
        siteId: siteAId, shiftDate: '2026-11-12', startTime: '06:00', endTime: '18:00',
        requiredQualification: 'Sachkunde'
      }
    };
    const first = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send({
      deviceId: 'dev-01',
      mutations: [mutation]
    });

    expect(first.body.data[0].status).toBe('SYNCED');

    const changedEntityType = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send({
      deviceId: 'dev-01',
      mutations: [{ ...mutation, entityType: 'task' }]
    });
    expect(changedEntityType.body.data[0]).toMatchObject({
      clientUuid,
      status: 'REJECTED',
      message: expect.stringContaining('abweichendem Inhalt oder Vorgang')
    });

    const changedAction = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send({
      deviceId: 'dev-01',
      mutations: [{ ...mutation, action: 'UPDATE' }]
    });
    expect(changedAction.body.data[0]).toMatchObject({
      clientUuid,
      status: 'REJECTED',
      message: expect.stringContaining('abweichendem Inhalt oder Vorgang')
    });

    const shiftCount = await withTenantTransaction(testTenantA, (tx) =>
      tx.query('SELECT count(*)::int AS count FROM shifts WHERE tenant_id = $1 AND client_mutation_id = $2', [testTenantA, clientUuid])
    );
    expect(shiftCount.rows[0].count).toBe(1);
  });

  test('Planning shift remains draft until assignment passes validation and period publication succeeds', async () => {
    const period = await request(app).post('/api/v1/planning/periods').set(authHeaders(testTokenA)).send({
      name: `Planning API ${Date.now()}`,
      dateFrom: '2027-01-10',
      dateTo: '2027-01-10',
      timeZone: 'UTC'
    });
    expect(period.status).toBe(201);

    const shiftInput = {
      siteId: siteAId,
      schedulePeriodId: period.body.data.id,
      date: '2027-01-10',
      startTime: '08:00',
      endTime: '16:00',
      type: 'Tagdienst',
      requiredQualification: 'Sachkunde',
      requiredStaffCount: 1,
      clientMutationId: `planning-shift-${Date.now()}`
    };
    const outsidePeriod = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA))
      .send({ ...shiftInput, date: '2027-01-09', clientMutationId: `planning-outside-${Date.now()}` });
    expect(outsidePeriod.status).toBe(422);
    expect(outsidePeriod.body.data.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OUTSIDE_SCHEDULE_PERIOD', severity: 'blocking' })
    ]));

    const created = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA)).send(shiftInput);
    expect(created.status).toBe(201);
    expect(created.body.data.shift.planning_status).toBe('draft');

    const listed = await request(app).get('/api/v1/planning/shifts?from=2027-01-10&to=2027-01-10')
      .set(authHeaders(testTokenA));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.data.shift.id, required_count: 1, assigned_count: 0 })
    ]));

    const replay = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA)).send(shiftInput);
    expect(replay.status).toBe(200);
    expect(replay.body.data.shift.id).toBe(created.body.data.shift.id);
    const conflictingReplay = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA))
      .send({ ...shiftInput, endTime: '17:00' });
    expect(conflictingReplay.status).toBe(409);

    const blockedPublish = await request(app)
      .post(`/api/v1/planning/periods/${period.body.data.id}/publish`)
      .set(authHeaders(testTokenA))
      .send({ expectedVersion: period.body.data.revision_version });
    expect(blockedPublish.status).toBe(422);
    expect(blockedPublish.body.data.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNASSIGNED_SHIFT', severity: 'blocking' })
    ]));

    const assigned = await request(app)
      .post(`/api/v1/planning/shifts/${created.body.data.shift.id}/assignments`)
      .set(authHeaders(testTokenA))
      .send({ employeeId: guardAId, expectedVersion: created.body.data.shift.revision_version });
    expect(assigned.status).toBe(200);
    expect(assigned.body.success).toBe(true);

    const published = await request(app)
      .post(`/api/v1/planning/periods/${period.body.data.id}/publish`)
      .set(authHeaders(testTokenA))
      .send({ expectedVersion: period.body.data.revision_version });
    expect(published.status).toBe(200);
    expect(published.body.data.period.status).toBe('published');

    const editPublished = await request(app).patch(`/api/v1/shifts/${created.body.data.shift.id}`)
      .set(authHeaders(testTokenA))
      .send({ status: 'Abgeschlossen', revisionVersion: assigned.body.data.revisionVersion + 1 });
    expect(editPublished.status).toBe(409);
    expect(editPublished.body.code).toBe('SCHEDULE_PERIOD_PUBLISHED');
  });

  test('Planning revalidates the full multi-day shift interval during publication', async () => {
    const period = await request(app).post('/api/v1/planning/periods').set(authHeaders(testTokenA)).send({
      name: `Multi-day planning ${Date.now()}`,
      dateFrom: '2027-01-20',
      dateTo: '2027-01-22',
      timeZone: 'UTC'
    });
    expect(period.status).toBe(201);

    const created = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA)).send({
      siteId: siteAId,
      schedulePeriodId: period.body.data.id,
      date: '2027-01-20',
      endDate: '2027-01-22',
      startTime: '08:00',
      endTime: '08:00',
      type: 'Tagdienst',
      requiredQualification: 'Sachkunde',
      requiredStaffCount: 1
    });
    expect(created.status).toBe(201);
    expect(created.body.data.shift.end_date).toBe('2027-01-22');

    const assigned = await request(app).post(`/api/v1/planning/shifts/${created.body.data.shift.id}/assignments`)
      .set(authHeaders(testTokenA))
      .send({ employeeId: guardAId, expectedVersion: created.body.data.shift.revision_version });
    expect(assigned.status).toBe(200);
    const secondShift = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA)).send({
      siteId: siteAId,
      schedulePeriodId: period.body.data.id,
      date: '2027-01-20',
      endDate: '2027-01-22',
      startTime: '08:00',
      endTime: '08:00',
      type: 'Tagdienst',
      requiredQualification: 'Sachkunde',
      requiredStaffCount: 1
    });
    expect(secondShift.status).toBe(201);

    const profile = await request(app).post('/api/v1/planning/rule-profiles')
      .set(authHeaders(testTokenA)).send({
        name: `Multi-day duration ${Date.now()}`,
        scope: { siteId: siteAId },
        effectiveFrom: '2027-01-20',
        effectiveUntil: '2027-01-22',
        sourceName: 'Test-configured-duration',
        sourceReference: 'fixture:multi-day-duration',
        rules: [{ code: 'maximum_shift_minutes', value: 1000, source: 'fixture:multi-day-duration' }]
      });
    expect(profile.status).toBe(201);
    const versionId = profile.body.data.version.id;
    const approved = await request(app)
      .post(`/api/v1/planning/rule-profiles/${profile.body.data.profile.id}/versions/${versionId}/approve`)
      .set(authHeaders(planningApproverToken)).send({});
    expect(approved.status).toBe(200);
    const activated = await request(app).patch(`/api/v1/planning/rule-profiles/${profile.body.data.profile.id}`)
      .set(authHeaders(testTokenA)).send({ active: true });
    expect(activated.status).toBe(200);

    const assignmentBlocked = await request(app)
      .post(`/api/v1/planning/shifts/${secondShift.body.data.shift.id}/assignments`)
      .set(authHeaders(testTokenA))
      .send({ employeeId: guardAId, expectedVersion: secondShift.body.data.shift.revision_version });
    expect(assignmentBlocked.status).toBe(409);
    expect(assignmentBlocked.body.data.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MAXIMUM_SHIFT_DURATION', severity: 'blocking' })
    ]));

    const published = await request(app)
      .post(`/api/v1/planning/periods/${period.body.data.id}/publish`)
      .set(authHeaders(testTokenA)).send({ expectedVersion: period.body.data.revision_version });
    expect(published.status).toBe(422);
    expect(published.body.data.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MAXIMUM_SHIFT_DURATION', severity: 'blocking' })
    ]));
  });

  test('Template application rejects an overnight occurrence crossing its schedule period', async () => {
    const period = await request(app).post('/api/v1/planning/periods').set(authHeaders(testTokenA)).send({
      name: `Template boundary ${Date.now()}`,
      dateFrom: '2027-01-10',
      dateTo: '2027-01-10',
      timeZone: 'UTC'
    });
    expect(period.status).toBe(201);
    const template = await request(app).post('/api/v1/planning/templates').set(authHeaders(testTokenA)).send({
      siteId: siteAId,
      name: `Boundary night ${Date.now()}`,
      startTime: '22:00',
      endTime: '06:00',
      requiredQualification: 'Sachkunde',
      frequency: 'DAILY',
      interval: 1
    });
    expect(template.status).toBe(201);

    const applied = await request(app)
      .post(`/api/v1/planning/templates/${template.body.data.id}/apply`)
      .set(authHeaders(testTokenA))
      .send({
        dateFrom: '2027-01-10',
        dateTo: '2027-01-10',
        schedulePeriodId: period.body.data.id,
        clientMutationId: `template-boundary-${Date.now()}`
      });
    expect(applied.status).toBe(201);
    expect(applied.body.data.occurrences).toEqual([
      expect.objectContaining({
        date: '2027-01-10',
        status: 'REJECTED',
        findings: expect.arrayContaining([expect.objectContaining({ code: 'OUTSIDE_SCHEDULE_PERIOD' })])
      })
    ]);
    const shifts = await withTenantTransaction(testTenantA, client => client.query(
      'SELECT id FROM shifts WHERE tenant_id=$1 AND schedule_period_id=$2',
      [testTenantA, period.body.data.id]
    ));
    expect(shifts.rows).toHaveLength(0);
  });

  test('Planning templates support revisioned edits, deactivation, and reactivation', async () => {
    const template = await request(app).post('/api/v1/planning/templates').set(authHeaders(testTokenA)).send({
      siteId: siteAId,
      name: `Lifecycle ${Date.now()}`,
      startTime: '08:00',
      endTime: '16:00',
      requiredQualification: 'Sachkunde',
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: [1, 3, 5]
    });
    expect(template.status).toBe(201);
    expect(template.body.data).toMatchObject({ active: true, revision_version: 1 });

    const deactivated = await request(app)
      .patch(`/api/v1/planning/templates/${template.body.data.id}`)
      .set(authHeaders(testTokenA))
      .send({ expectedVersion: 1, active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data).toMatchObject({ active: false, revision_version: 2 });

    const stale = await request(app)
      .patch(`/api/v1/planning/templates/${template.body.data.id}`)
      .set(authHeaders(testTokenA))
      .send({ expectedVersion: 1, name: 'Stale template edit' });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(2);

    const inactiveApply = await request(app)
      .post(`/api/v1/planning/templates/${template.body.data.id}/apply`)
      .set(authHeaders(testTokenA))
      .send({
        dateFrom: '2027-01-11', dateTo: '2027-01-11',
        clientMutationId: `inactive-template-${Date.now()}`
      });
    expect(inactiveApply.status).toBe(404);

    const reactivated = await request(app)
      .patch(`/api/v1/planning/templates/${template.body.data.id}`)
      .set(authHeaders(testTokenA))
      .send({
        expectedVersion: 2,
        active: true,
        startTime: '09:00',
        endTime: '17:00',
        weekdays: [2, 4]
      });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data).toMatchObject({
      active: true,
      revision_version: 3,
      local_start_time: '09:00:00',
      recurrence: { frequency: 'WEEKLY', interval: 1, weekdays: [2, 4] }
    });
    const application = {
      dateFrom: '2027-01-12',
      dateTo: '2027-01-12',
      clientMutationId: `template-apply-${Date.now()}`
    };
    const applied = await request(app)
      .post(`/api/v1/planning/templates/${template.body.data.id}/apply`)
      .set(authHeaders(testTokenA)).send(application);
    expect(applied.status).toBe(201);
    const replay = await request(app)
      .post(`/api/v1/planning/templates/${template.body.data.id}/apply`)
      .set(authHeaders(testTokenA)).send(application);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ replayed: true });
    const changedReuse = await request(app)
      .post(`/api/v1/planning/templates/${template.body.data.id}/apply`)
      .set(authHeaders(testTokenA))
      .send({ ...application, dateTo: '2027-01-14' });
    expect(changedReuse.status).toBe(409);
    const generated = await withTenantTransaction(testTenantA, tx => tx.query(
      `SELECT count(*)::int AS count FROM shifts
        WHERE tenant_id=$1 AND site_id=$2 AND shift_date='2027-01-12' AND start_time='09:00:00'`,
      [testTenantA, siteAId]
    ));
    expect(generated.rows[0].count).toBe(1);
    const audit = await withTenantTransaction(testTenantA, tx => tx.query(
      `SELECT event_type,entity_id FROM planning_audit_events
        WHERE tenant_id=$1 AND entity_type='schedule_template' AND entity_id=$2
        ORDER BY created_at,id`,
      [testTenantA, template.body.data.id]
    ));
    expect(audit.rows.map(row => row.event_type)).toEqual([
      'template.created', 'template.updated', 'template.updated', 'template.applied'
    ]);
  });

  test('Overlapping approved rule profiles block validation instead of selecting one silently', async () => {
    for (const [suffix, threshold] of [['one', 600], ['two', 540]] as const) {
      const profile = await request(app).post('/api/v1/planning/rule-profiles')
        .set(authHeaders(testTokenA)).send({
          name: `Ambiguous ${suffix} ${Date.now()}`,
          scope: { siteId: siteAId },
          effectiveFrom: '2027-02-10',
          effectiveUntil: '2027-02-20',
          sourceName: `Test-ambiguous-${suffix}`,
          sourceReference: `fixture:ambiguous-${suffix}`,
          rules: [{ code: 'maximum_shift_minutes', value: threshold, source: `fixture:${suffix}` }]
        });
      expect(profile.status).toBe(201);
      const approved = await request(app)
        .post(`/api/v1/planning/rule-profiles/${profile.body.data.profile.id}/versions/${profile.body.data.version.id}/approve`)
        .set(authHeaders(planningApproverToken)).send({});
      expect(approved.status).toBe(200);
    }

    const shift = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA)).send({
      siteId: siteAId,
      date: '2027-02-10',
      startTime: '08:00',
      endTime: '16:00',
      requiredQualification: 'Sachkunde',
      clientMutationId: `ambiguous-profile-shift-${Date.now()}`
    });
    expect(shift.status).toBe(422);
    expect(shift.body.data.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RULE_PROFILE_AMBIGUOUS', severity: 'blocking' })
    ]));
  });

  test('Planning templates, approved sourced rules, cover approval, actuals and configured reports', async () => {
    const template = await request(app).post('/api/v1/planning/templates').set(authHeaders(testTokenA)).send({
      siteId: siteAId,
      name: `Night coverage ${Date.now()}`,
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 30,
      requiredStaffCount: 2,
      requiredQualification: 'Sachkunde',
      effectiveFrom: '2027-01-15',
      effectiveUntil: '2027-01-16',
      frequency: 'DAILY',
      interval: 1
    });
    expect(template.status).toBe(201);
    expect(template.body.data).toMatchObject({
      break_minutes: 30, required_staff_count: 2,
      effective_from: '2027-01-15', effective_until: '2027-01-16'
    });
    const templates = await request(app).get(`/api/v1/planning/templates?siteId=${siteAId}`)
      .set(authHeaders(testTokenA));
    expect(templates.status).toBe(200);
    expect(templates.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: template.body.data.id, active: true, break_minutes: 30,
        required_staff_count: 2, effective_from: '2027-01-15', effective_until: '2027-01-16'
      })
    ]));
    const templateApplication = await request(app)
      .post(`/api/v1/planning/templates/${template.body.data.id}/apply`)
      .set(authHeaders(testTokenA)).send({
        dateFrom: '2027-01-15', dateTo: '2027-01-17',
        clientMutationId: `bounded-template-${Date.now()}`
      });
    expect(templateApplication.status).toBe(201);
    expect(templateApplication.body.data.occurrences).toEqual([
      expect.objectContaining({ date: '2027-01-15', status: 'draft' }),
      expect.objectContaining({ date: '2027-01-16', status: 'draft' }),
      expect.objectContaining({
        date: '2027-01-17', status: 'REJECTED',
        findings: expect.arrayContaining([expect.objectContaining({ code: 'TEMPLATE_OUTSIDE_VALIDITY' })])
      })
    ]);
    const generatedTemplateShift = await withTenantTransaction(testTenantA, tx => tx.query(
      `SELECT s.break_minutes,r.required_count FROM shifts s
         JOIN shift_staffing_requirements r ON r.tenant_id=s.tenant_id AND r.shift_id=s.id
        WHERE s.tenant_id=$1 AND s.id=$2`,
      [testTenantA, templateApplication.body.data.occurrences[0].shiftId]
    ));
    expect(generatedTemplateShift.rows).toEqual([{ break_minutes: 30, required_count: 2 }]);
    const suggestionShift = await request(app).post('/api/v1/planning/shifts')
      .set(authHeaders(testTokenA)).send({
        siteId: siteAId, date: '2027-01-15', startTime: '08:00', endTime: '16:00',
        requiredQualification: 'Sachkunde', clientMutationId: `suggestion-shift-${Date.now()}`
      });
    expect(suggestionShift.status).toBe(201);
    const excludedEmployee = await withTenantTransaction(testTenantA, tx => tx.query(
      `INSERT INTO employees
        (tenant_id,personnel_number,first_name,last_name,email,phone,role,status,date_of_joining)
       VALUES ($1,$2,'Inactive','Candidate',$3,'030','Wachdienstmitarbeiter','Inaktiv','2025-01-01')
       RETURNING id`,
      [testTenantA, `MA-EXCLUDED-${Date.now()}`, `excluded.${Date.now()}@secops.test`]
    ));
    const suggestions = await request(app)
      .get(`/api/v1/planning/shifts/${suggestionShift.body.data.shift.id}/staffing-suggestions`)
      .set(authHeaders(testTokenA));
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.data).toMatchObject({ finalAssignmentRequiresConfirmation: true });
    expect(suggestions.body.data.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        qualificationType: 'Sachkunde',
        candidates: expect.arrayContaining([
          expect.objectContaining({
            employeeId: guardAId, eligible: true,
            reasons: expect.arrayContaining(['active', 'site_assigned', 'qualified'])
          })
        ])
      })
    ]));
    expect(suggestions.body.data.requirements[0].excludedCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        employeeId: excludedEmployee.rows[0].id,
        reasons: expect.arrayContaining([
          'inactive_or_archived', 'site_not_assigned', 'qualification_missing'
        ])
      })
    ]));
    const unauthorizedSuggestions = await request(app)
      .get(`/api/v1/planning/shifts/${suggestionShift.body.data.shift.id}/staffing-suggestions`)
      .set(authHeaders(planningDeniedToken));
    expect(unauthorizedSuggestions.status).toBe(403);

    const profile = await request(app).post('/api/v1/planning/rule-profiles')
      .set(authHeaders(testTokenA)).send({
        name: `Calendar and overtime ${Date.now()}`,
        scope: { siteId: siteAId },
        effectiveFrom: '2027-01-11',
        effectiveUntil: '2027-01-31',
        sourceName: 'Test-approved-calendar',
        sourceReference: 'fixture:planning-report',
        rules: [
          { code: 'weekend_weekdays', value: [0, 6], source: 'fixture:weekend-days' },
          { code: 'holiday_dates', value: ['2027-01-11'], source: 'fixture:holidays', severity: 'warning' },
          { code: 'night_window_start_minute', value: 1200, source: 'fixture:night-window' },
          { code: 'night_window_end_minute', value: 360, source: 'fixture:night-window' },
          { code: 'overtime_threshold_weekly_minutes', value: 60, source: 'fixture:overtime-policy' }
        ]
      });
    expect(profile.status).toBe(201);
    const versionId = profile.body.data.version.id;
    const approved = await request(app)
      .post(`/api/v1/planning/rule-profiles/${profile.body.data.profile.id}/versions/${versionId}/approve`)
      .set(authHeaders(planningApproverToken)).send({});
    expect(approved.status).toBe(200);
    const versions = await request(app)
      .get(`/api/v1/planning/rule-profiles/${profile.body.data.profile.id}/versions`)
      .set(authHeaders(testTokenA));
    expect(versions.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: versionId, status: 'approved', source_name: 'Test-approved-calendar' })
    ]));

    const actualShift = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA)).send({
      siteId: siteAId,
      date: '2027-01-11',
      startTime: '22:00',
      endTime: '06:00',
      requiredQualification: 'Sachkunde',
      requiredStaffCount: 1,
      clientMutationId: `actual-shift-${Date.now()}`
    });
    expect(actualShift.status).toBe(201);
    const assigned = await request(app)
      .post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/assignments`)
      .set(authHeaders(testTokenA))
      .send({ employeeId: guardAId, expectedVersion: actualShift.body.data.shift.revision_version });
    expect(assigned.status).toBe(200);
    const emptyActual = await request(app)
      .get(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .query({ employeeId: guardAId }).set(authHeaders(testTokenA));
    expect(emptyActual.status).toBe(200);
    expect(emptyActual.body.data).toEqual({ current: null, history: [], revisions: [] });
    const foreignShiftId = await withTenantTransaction(testTenantB, async tx => {
      const client = await tx.query(
        `INSERT INTO clients
          (tenant_id,client_number,company_name,contact_person,email,phone,address,contract_start,contract_end)
         VALUES ($1,$2,'Foreign actuals','Contact','foreign.actuals@example.test','030','Address','2025-01-01','2028-01-01')
         RETURNING id`,
        [testTenantB, `FOREIGN-ACTUALS-${Date.now()}`]
      );
      const site = await tx.query(
        `INSERT INTO sites (tenant_id,client_id,site_code,name,address)
         VALUES ($1,$2,$3,'Foreign site','Address') RETURNING id`,
        [testTenantB, client.rows[0].id, `SITE-${Date.now()}`]
      );
      const foreignShift = await tx.query(
        `INSERT INTO shifts
          (tenant_id,site_id,shift_date,end_date,start_time,end_time,type,status,required_qualification)
         VALUES ($1,$2,'2027-01-11','2027-01-11','08:00','16:00','Tagdienst','Offen','Sachkunde')
         RETURNING id`,
        [testTenantB, site.rows[0].id]
      );
      return foreignShift.rows[0].id as string;
    });
    const foreignActualRead = await request(app)
      .get(`/api/v1/planning/shifts/${foreignShiftId}/actual-time`)
      .query({ employeeId: guardAId }).set(authHeaders(testTokenA));
    expect(foreignActualRead.status).toBe(404);

    const actualPayload = {
      employeeId: guardAId,
      actualStartAt: '2027-01-11T22:00:00Z',
      actualEndAt: '2027-01-12T06:00:00Z',
      expectedVersion: 0,
      clientMutationId: `actual-time-${Date.now()}`
    };
    const actual = await request(app).post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .set(authHeaders(testTokenA)).send(actualPayload);
    expect(actual.status).toBe(201);
    const actualReplay = await request(app).post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .set(authHeaders(testTokenA)).send(actualPayload);
    expect(actualReplay.status).toBe(200);
    expect(actualReplay.body.data.id).toBe(actual.body.data.id);
    const changedMutationReplay = await request(app).post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .set(authHeaders(testTokenA)).send({ ...actualPayload, breakMinutes: 1 });
    expect(changedMutationReplay.status).toBe(409);
    const corrected = await request(app).post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .set(authHeaders(testTokenA)).send({
        ...actualPayload, expectedVersion: 1, breakMinutes: 10,
        clientMutationId: `actual-correction-${Date.now()}`
      });
    expect(corrected.status).toBe(200);
    expect(corrected.body.data.revision_version).toBe(2);
    const currentActual = await request(app)
      .get(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .query({ employeeId: guardAId }).set(authHeaders(testTokenA));
    expect(currentActual.status).toBe(200);
    expect(currentActual.body.data.current).toMatchObject({
      id: actual.body.data.id, employee_id: guardAId, revision_version: 2, approval_status: 'pending'
    });
    expect(currentActual.body.data.history).toHaveLength(2);
    expect(currentActual.body.data.revisions).toHaveLength(1);
    const actualNotifications = await request(app).get('/api/v1/planning/notifications')
      .set(authHeaders(planningApproverToken));
    expect(actualNotifications.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity_id: actual.body.data.id, event_type: 'shift.actual_time.corrected'
      })
    ]));
    const actualHistory = await withTenantTransaction(testTenantA, tx => tx.query(
      `SELECT event_type,details FROM planning_audit_events
        WHERE tenant_id=$1 AND entity_type='shift_actual_time' AND entity_id=$2
        ORDER BY created_at,id`,
      [testTenantA, actual.body.data.id]
    ));
    expect(actualHistory.rows.map(row => row.event_type)).toEqual([
      'shift.actual_time.recorded', 'shift.actual_time.corrected'
    ]);
    expect(actualHistory.rows[1].details.previous).toMatchObject({ revision_version: 1 });
    const unsafeDirectCorrection = withTenantTransaction(testTenantA, tx => tx.query(
      `UPDATE shift_actual_times SET notes='unversioned change'
        WHERE tenant_id=$1 AND id=$2`,
      [testTenantA, actual.body.data.id]
    ));
    await expect(unsafeDirectCorrection).rejects.toThrow('Actual-time corrections must increment the revision');
    const selfApproval = await request(app)
      .post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time/approve`)
      .set(authHeaders(testTokenA)).send({ employeeId: guardAId, expectedVersion: 2 });
    expect(selfApproval.status).toBe(403);
    const staleApproval = await request(app)
      .post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time/approve`)
      .set(authHeaders(planningApproverToken)).send({ employeeId: guardAId, expectedVersion: 1 });
    expect(staleApproval.status).toBe(409);
    const staleActual = await request(app).post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .set(authHeaders(testTokenA)).send({
        ...actualPayload, expectedVersion: 1, clientMutationId: `actual-stale-${Date.now()}`
      });
    expect(staleActual.status).toBe(409);
    const malformedActual = await request(app).post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .set(authHeaders(testTokenA)).send({
        ...actualPayload, actualStartAt: '2027-01-11T22:00:00',
        clientMutationId: `actual-malformed-${Date.now()}`
      });
    expect(malformedActual.status).toBe(400);
    const unauthorizedActual = await request(app)
      .post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .set(authHeaders(planningDeniedToken)).send(actualPayload);
    expect(unauthorizedActual.status).toBe(403);
    const unauthorizedActualRead = await request(app)
      .get(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .query({ employeeId: guardAId }).set(authHeaders(planningDeniedToken));
    expect(unauthorizedActualRead.status).toBe(403);
    const unapprovedReport = await request(app).get(
      '/api/v1/planning/reports/work-hours?from=2027-01-11&to=2027-01-11'
    ).set(authHeaders(testTokenA));
    expect(unapprovedReport.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        employee_id: guardAId, actual_hours: null, actual_status: 'pending',
        hours_variance: null, hours_variance_status: 'pending_approval'
      })
    ]));
    const approvedActual = await request(app)
      .post(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time/approve`)
      .set(authHeaders(planningApproverToken)).send({ employeeId: guardAId, expectedVersion: 2 });
    expect(approvedActual.status).toBe(200);
    expect(approvedActual.body.data).toMatchObject({
      revision_version: 2, approval_status: 'approved', approved_by: planningApproverId,
      approved_revision_version: 2
    });
    const approvedActualHistory = await request(app)
      .get(`/api/v1/planning/shifts/${actualShift.body.data.shift.id}/actual-time`)
      .query({ employeeId: guardAId }).set(authHeaders(testTokenA));
    expect(approvedActualHistory.body.data.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'shift.actual_time.approved' })
    ]));
    expect(approvedActualHistory.body.data.revisions).toHaveLength(2);
    const recordedUserNotifications = await request(app).get('/api/v1/planning/notifications')
      .set(authHeaders(testTokenA));
    expect(recordedUserNotifications.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity_id: actual.body.data.id, event_type: 'shift.actual_time.approved'
      })
    ]));
    const revisionSnapshots = await withTenantTransaction(testTenantA, tx => tx.query(
      `SELECT revision_version,previous_values->>'approval_status' AS approval_status
         FROM shift_actual_time_revisions WHERE tenant_id=$1 AND actual_time_id=$2
        ORDER BY revision_version`,
      [testTenantA, actual.body.data.id]
    ));
    expect(revisionSnapshots.rows).toEqual([
      { revision_version: 1, approval_status: 'pending' },
      { revision_version: 2, approval_status: 'pending' }
    ]);

    const coverEmployeeId = await withTenantTransaction(testTenantA, async tx => {
      const employee = await tx.query(
        `INSERT INTO employees
          (tenant_id,personnel_number,first_name,last_name,email,phone,role,date_of_joining)
         VALUES ($1,$2,'Cover','Employee',$3,'030','Wachdienstmitarbeiter','2025-01-01') RETURNING id`,
        [testTenantA, `MA-COVER-${Date.now()}`, `cover.${Date.now()}@secops.test`]
      );
      await tx.query('INSERT INTO employee_site_assignments (tenant_id,employee_id,site_id) VALUES ($1,$2,$3)',
        [testTenantA, employee.rows[0].id, siteAId]);
      await tx.query(
        `INSERT INTO employee_qualifications
          (tenant_id,employee_id,qualification_type,certificate_number,issue_date,expiry_date,verified,status)
         VALUES ($1,$2,'Sachkunde','Q-COVER','2025-01-01','2028-01-01',TRUE,'VALID')`,
        [testTenantA, employee.rows[0].id]
      );
      return employee.rows[0].id as string;
    });
    const coverShift = await request(app).post('/api/v1/planning/shifts').set(authHeaders(testTokenA)).send({
      siteId: siteAId,
      date: '2027-01-13',
      startTime: '08:00',
      endTime: '16:00',
      requiredQualification: 'Sachkunde',
      requiredStaffCount: 1,
      clientMutationId: `cover-shift-${Date.now()}`
    });
    expect(coverShift.status).toBe(201);
    const coverRequest = await request(app).post(`/api/v1/planning/shifts/${coverShift.body.data.shift.id}/cover-requests`)
      .set(authHeaders(testTokenA)).send({
        expectedShiftVersion: coverShift.body.data.shift.revision_version,
        clientMutationId: `cover-request-${Date.now()}`,
        reason: 'Abdeckung der offenen Besetzung'
      });
    expect(coverRequest.status).toBe(201);
    const coverApproverNotifications = await request(app).get('/api/v1/planning/notifications')
      .set(authHeaders(planningApproverToken));
    expect(coverApproverNotifications.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity_id: coverRequest.body.data.id, event_type: 'shift_cover.requested'
      })
    ]));
    const pendingCovers = await request(app).get('/api/v1/planning/cover-requests?status=pending')
      .set(authHeaders(testTokenA));
    expect(pendingCovers.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: coverRequest.body.data.id, status: 'pending' })
    ]));
    const decided = await request(app).post(`/api/v1/planning/cover-requests/${coverRequest.body.data.id}/decision`)
      .set(authHeaders(planningApproverToken)).send({
        decision: 'approved',
        employeeId: coverEmployeeId,
        expectedVersion: coverRequest.body.data.revision_version,
        clientMutationId: `cover-decision-${Date.now()}`
      });
    expect(decided.status).toBe(200);
    expect(decided.body.data.status).toBe('approved');
    const assignment = await withTenantTransaction(testTenantA, tx => tx.query(
      `SELECT employee_id,status FROM shift_staffing_assignments
        WHERE tenant_id=$1 AND shift_id=$2 AND employee_id=$3`,
      [testTenantA, coverShift.body.data.shift.id, coverEmployeeId]
    ));
    expect(assignment.rows).toEqual([{ employee_id: coverEmployeeId, status: 'assigned' }]);
    const requesterNotifications = await request(app).get('/api/v1/planning/notifications')
      .set(authHeaders(testTokenA));
    expect(requesterNotifications.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity_id: coverRequest.body.data.id, event_type: 'shift_cover.approved'
      })
    ]));

    await withTenantTransaction(testTenantA, tx => tx.query(
      `INSERT INTO employee_absences (tenant_id,employee_id,absence_type,date_from,date_to,status)
       VALUES ($1,$2,'VACATION','2027-01-20','2027-01-21','APPROVED')`,
      [testTenantA, guardAId]
    ));
    const workHours = await request(app).get('/api/v1/planning/reports/work-hours?from=2027-01-11&to=2027-01-11')
      .set(authHeaders(testTokenA));
    expect(workHours.status).toBe(200);
    expect(workHours.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        employee_id: guardAId, planned_hours: 8, actual_hours: 7.83, actual_status: 'complete',
        actual_approval_status: 'approved', hours_variance: -0.17, minus_hours: 0.17,
        hours_variance_status: 'available',
        overtime_hours: 6.83, overtime_status: 'available',
        planned_holiday_shifts: 1, actual_holiday_shifts: 1,
        planned_night_shifts: 1, actual_night_shifts: 1
      })
    ]));
    await withTenantTransaction(testTenantA, tx => tx.query(
      'UPDATE employees SET first_name=$1,last_name=$2 WHERE tenant_id=$3 AND id=$4',
      [' \t=1+1', '@SUM(1,1)', testTenantA, guardAId]
    ));
    const csv = await request(app)
      .get('/api/v1/planning/reports/work-hours?from=2027-01-11&to=2027-01-11&format=csv')
      .set(authHeaders(testTokenA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`"' \t=1+1"`);
    expect(csv.text).toContain(`"'@SUM(1,1)"`);
    expect(csv.text).toContain('"-0.17","0.17","available","approved_actual_hours_minus_planned_hours"');
    expect(workHours.body.data[0].calendar.night.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nightWindowStart: expect.objectContaining({ profileVersionId: versionId, ruleSource: 'fixture:night-window' })
      })
    ]));
    const coverage = await request(app).get('/api/v1/planning/reports/coverage?from=2027-01-13&to=2027-01-13')
      .set(authHeaders(testTokenA));
    expect(coverage.body.summary.byQualification).toEqual(expect.arrayContaining([
      expect.objectContaining({ qualificationType: 'Sachkunde', requiredCount: 1, assignedCount: 1, shortfall: 0 })
    ]));
    const qualifications = await request(app)
      .get('/api/v1/planning/reports/qualifications?from=2027-01-13&to=2027-01-13')
      .set(authHeaders(testTokenA));
    expect(qualifications.status).toBe(200);
    expect(qualifications.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ qualification_type: 'Sachkunde', required_slots: 1, assigned_qualified_slots: 1 })
    ]));
    const absences = await request(app).get('/api/v1/planning/reports/absences?from=2027-01-20&to=2027-01-21')
      .set(authHeaders(testTokenA));
    expect(absences.status).toBe(200);
    expect(absences.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ absence_type: 'VACATION', status: 'APPROVED', absence_records: 1, affected_employees: 1 })
    ]));
    const deactivated = await request(app).patch(`/api/v1/planning/rule-profiles/${profile.body.data.profile.id}`)
      .set(authHeaders(testTokenA)).send({ active: false });
    expect(deactivated.body.data.active).toBe(false);
    const reactivated = await request(app).patch(`/api/v1/planning/rule-profiles/${profile.body.data.profile.id}`)
      .set(authHeaders(testTokenA)).send({ active: true });
    expect(reactivated.body.data.active).toBe(true);
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
    expect(res.body.data[0].conflictData.serverSnapshot).toMatchObject({
      id: shiftId,
      siteId: siteAId,
      employeeId: guardAId,
      date: '2025-09-01',
      endDate: '2025-09-01',
      startTime: '06:00',
      endTime: '18:00',
      revisionVersion: 2,
      staffingRequirements: [{ qualificationType: 'Sachkunde', requiredCount: 1 }]
    });

    const resolutionConflict = await request(app).post('/api/v1/sync/conflicts/resolve')
      .set(authHeaders(testTokenA)).send({
        clientUuid: `sh-conf-resolve-${Date.now()}`,
        entityType: 'shift',
        strategy: 'USE_LOCAL',
        expectedVersion: 1,
        localPayload: { id: shiftId, status: 'Offen' }
      });
    expect(resolutionConflict.status).toBe(409);
    expect(resolutionConflict.body).toMatchObject({
      code: 'REVISION_CONFLICT',
      serverVersion: 2,
      serverState: expect.objectContaining({ id: shiftId, revisionVersion: 2 })
    });

    const foreignShiftId = await withTenantTransaction(testTenantB, async tx => {
      const client = await tx.query(
        `INSERT INTO clients
          (tenant_id,client_number,company_name,contact_person,email,phone,address,contract_start,contract_end)
         VALUES ($1,$2,'Foreign sync','Contact','foreign.sync@example.test','030','Address','2025-01-01','2028-01-01')
         RETURNING id`,
        [testTenantB, `FOREIGN-SYNC-${Date.now()}`]
      );
      const site = await tx.query(
        `INSERT INTO sites (tenant_id,client_id,site_code,name,address)
         VALUES ($1,$2,$3,'Foreign sync site','Address') RETURNING id`,
        [testTenantB, client.rows[0].id, `SITE-${Date.now()}`]
      );
      const foreign = await tx.query(
        `INSERT INTO shifts (tenant_id,site_id,shift_date,end_date,start_time,end_time,required_qualification)
         VALUES ($1,$2,'2025-09-01','2025-09-01','06:00','18:00','Sachkunde') RETURNING id`,
        [testTenantB, site.rows[0].id]
      );
      return foreign.rows[0].id as string;
    });
    const foreignConflict = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send({
      deviceId: 'dev-01',
      mutations: [{
        clientUuid: `sh-foreign-conf-${Date.now()}`,
        entityType: 'shift',
        action: 'UPDATE',
        clientTimestamp: new Date().toISOString(),
        baseVersion: 0,
        payload: { id: foreignShiftId, status: 'Konflikt' }
      }]
    });
    expect(foreignConflict.body.data[0]).toMatchObject({ status: 'REJECTED', serverId: foreignShiftId });
    expect(foreignConflict.body.data[0].conflictData).toBeUndefined();
  });

  test('Schicht-UPDATE im Offline-Sync akzeptiert die ID, validiert Felder und lehnt ungültige Daten ab', async () => {
    const shiftId = await withTenantTransaction(testTenantA, async (tx) => {
      const inserted = await tx.query(`
        INSERT INTO shifts (tenant_id, site_id, shift_date, start_time, end_time, required_qualification, revision_version)
        VALUES ($1, $2, '2027-02-03', '06:00', '14:00', 'Sachkunde', 1)
        RETURNING id;
      `, [testTenantA, siteAId]);
      return inserted.rows[0].id;
    });

    const valid = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send({
      deviceId: 'offline-device',
      mutations: [{
        clientUuid: `shift-update-${Date.now()}`,
        entityType: 'shift',
        action: 'UPDATE',
        clientTimestamp: new Date().toISOString(),
        baseVersion: 1,
        payload: { id: shiftId, shiftDate: '2027-02-04', startTime: '08:00', endTime: '16:00' }
      }]
    });
    expect(valid.status).toBe(200);
    expect(valid.body.data[0]).toMatchObject({ status: 'SYNCED', serverId: shiftId, serverVersion: 2 });
    const updated = await withTenantTransaction(testTenantA, tx =>
      tx.query('SELECT shift_date::text, start_time::text FROM shifts WHERE tenant_id=$1 AND id=$2', [testTenantA, shiftId])
    );
    expect(updated.rows[0]).toMatchObject({ shift_date: '2027-02-04', start_time: '08:00' });

    const malformed = await request(app).post('/api/v1/sync/push').set(authHeaders(testTokenA)).send({
      deviceId: 'offline-device',
      mutations: [{
        clientUuid: `shift-invalid-${Date.now()}`,
        entityType: 'shift',
        action: 'UPDATE',
        clientTimestamp: new Date().toISOString(),
        baseVersion: 2,
        payload: { id: shiftId, startTime: 'not-a-time' }
      }]
    });
    expect(malformed.status).toBe(200);
    expect(malformed.body.data[0]).toMatchObject({ status: 'REJECTED', serverId: shiftId });
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
    await insertTenantMembership(testTenantA, userId);
    await migrationPool.query('INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)', [userId, roleId, testTenantA]);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await migrationPool.query("INSERT INTO user_sessions (user_id,tenant_id,token_hash,expires_at,revoked) VALUES ($1,$2,$3,NOW()+interval '1 hour',false)", [userId,testTenantA,tokenHash]);

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
    await insertTenantMembership(testTenantB, testUserAId);
    await migrationPool.query('INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)', [testUserAId, testRoleEinsatzId, testTenantB]);
    await migrationPool.query(`
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
