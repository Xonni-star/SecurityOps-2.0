import argon2 from 'argon2';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { migrationPool, withTenantTransaction } from '../config/database';
import { materializePatrolOccurrences, processTenantPatrolSchedules } from '../services/patrolScheduleWorker';
import { removeDocumentBlob } from '../services/documentFiles';
import { authHeaders } from './testUtils';

const SEED_PASSWORD = 'SecOpsVault2025SecurePassword!';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

let credential = '';
let userEmail = '';
let userId = '';
let siteId = '';
let clientId = '';
let employeeId = '';
let employeeGroupId = '';
let documentId = '';
let checkpointId = '';
let routeId = '';
let roundId = '';
let recoveryRoundId = '';
let abandonedRoundId = '';
let scopeSiteId = '';
let scopeCheckpointId = '';
let scopeEmployeeId = '';
let scopeUserId = '';
let scopeRoundId = '';
let graceCheckpointId = '';
let graceRoundId = '';

beforeAll(async () => {
  const orphanedOccurrences = await migrationPool.query(
    `SELECT o.id FROM patrol_schedule_occurrences o
      WHERE o.tenant_id=$1
        AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.tenant_id=o.tenant_id AND s.id=o.site_id)`,
    [TENANT_ID]
  );
  if (orphanedOccurrences.rows.length) {
    const orphanIds = orphanedOccurrences.rows.map(row => row.id);
    const cleanup = await migrationPool.connect();
    try {
      await cleanup.query('SET session_replication_role = replica');
      await cleanup.query(
        'DELETE FROM patrol_schedule_occurrence_events WHERE tenant_id=$1 AND occurrence_id=ANY($2::uuid[])',
        [TENANT_ID, orphanIds]
      );
      await cleanup.query(
        'DELETE FROM patrol_schedule_occurrences WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
        [TENANT_ID, orphanIds]
      );
    } finally {
      await cleanup.query('SET session_replication_role = origin');
      cleanup.release();
    }
  }
  const suffix = crypto.randomBytes(6).toString('hex');
  userEmail = `patrol-${suffix}@example.test`;
  const passwordHash = await argon2.hash(SEED_PASSWORD);
  const user = await migrationPool.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,phone)
     VALUES ($1,$2,'Patrol','Integration','+49 30 001') RETURNING id`,
    [userEmail, passwordHash]
  );
  userId = user.rows[0].id;
  const role = await migrationPool.query("SELECT id FROM roles WHERE name='Einsatzleitung'");
  if (!role.rows.length) throw new Error('Patrol integration test role is missing.');
  await migrationPool.query(
    'INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)',
    [userId, role.rows[0].id, TENANT_ID]
  );
  const client = await migrationPool.query(
    `INSERT INTO clients
       (tenant_id,client_number,company_name,contact_person,email,phone,address,contract_start,contract_end)
     VALUES ($1,$2,'Patrol integration client','Test Contact','patrol-test@example.test','+49 30 001',
       'Test address',CURRENT_DATE,CURRENT_DATE + 365) RETURNING id`,
    [TENANT_ID, `PATROL-TEST-${suffix}`]
  );
  clientId = client.rows[0].id;
  const site = await migrationPool.query(
    `INSERT INTO sites (tenant_id,client_id,site_code,name,address)
     VALUES ($1,$2,$3,'Patrol integration site','Test address') RETURNING id`,
    [TENANT_ID, clientId, `PATROL-TEST-${suffix}`]
  );
  siteId = site.rows[0].id;
  const employee = await migrationPool.query(
    `INSERT INTO employees
       (tenant_id,personnel_number,first_name,last_name,email,phone,role,status,date_of_joining,account_user_id)
     VALUES ($1,$2,'Patrol','Integration',$3,'+49 30 001','Einsatzleitung','Aktiv',CURRENT_DATE,$4)
     RETURNING id`,
    [TENANT_ID, `PATROL-TEST-${suffix}`, userEmail, userId]
  );
  employeeId = employee.rows[0].id;
  await migrationPool.query(
    'INSERT INTO employee_site_assignments (tenant_id,employee_id,site_id) VALUES ($1,$2,$3)',
    [TENANT_ID, employeeId, siteId]
  );
});

async function login(): Promise<string> {
  return loginAs(userEmail, SEED_PASSWORD);
}

async function loginAs(email: string, password: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email, password });
  expect(response.status).toBe(200);
  const cookies = response.headers['set-cookie'];
  const sessionCookie = (Array.isArray(cookies) ? cookies : [cookies || ''])
    .find(value => value.startsWith('secops_session='));
  const sessionId = sessionCookie?.match(/^secops_session=([^;]+)/)?.[1];
  return `${sessionId}|${response.body.data.csrfToken}`;
}

function authorizedHeaders(): Record<string, string> {
  return authHeaders(credential);
}

afterAll(async () => {
  if (!checkpointId && !routeId && !roundId && !recoveryRoundId && !siteId && !clientId && !employeeId && !userId) return;
  const db = await migrationPool.connect();
  try {
    await db.query('SET session_replication_role = replica');
    const checkpointIds = [checkpointId, scopeCheckpointId, graceCheckpointId].filter(Boolean);
    const scanIds = checkpointIds.length
      ? (await db.query('SELECT id FROM patrol_scans WHERE tenant_id=$1 AND checkpoint_uuid=ANY($2::uuid[])', [TENANT_ID, checkpointIds]))
        .rows.map(row => row.id)
      : [];
    const exceptionIds = checkpointIds.length
      ? (await db.query('SELECT id FROM patrol_exceptions WHERE tenant_id=$1 AND checkpoint_id=ANY($2::uuid[])', [TENANT_ID, checkpointIds]))
        .rows.map(row => row.id)
      : [];
    const versionIds = routeId
      ? (await db.query('SELECT id FROM patrol_route_versions WHERE tenant_id=$1 AND route_id=$2', [TENANT_ID, routeId]))
        .rows.map(row => row.id)
      : [];
    const roundIds = [roundId, recoveryRoundId, abandonedRoundId, scopeRoundId, graceRoundId].filter(Boolean);
    const entityIds = [checkpointId, scopeCheckpointId, graceCheckpointId, routeId, ...roundIds, ...scanIds, ...exceptionIds, ...versionIds].filter(Boolean);
    if (entityIds.length) {
      await db.query('DELETE FROM patrol_events WHERE tenant_id=$1 AND entity_id=ANY($2::uuid[])', [TENANT_ID, entityIds]);
    }
    const cleanupSiteIds = [siteId, scopeSiteId].filter(Boolean);
    if (cleanupSiteIds.length) {
      await db.query('DELETE FROM patrol_events WHERE tenant_id=$1 AND site_id=ANY($2::uuid[])', [TENANT_ID, cleanupSiteIds]);
    }
    for (const cleanupSiteId of [siteId, scopeSiteId].filter(Boolean)) {
      const occurrenceIds = (await db.query(
        'SELECT id FROM patrol_schedule_occurrences WHERE tenant_id=$1 AND site_id=$2',
        [TENANT_ID, cleanupSiteId]
      )).rows.map(row => row.id);
      if (occurrenceIds.length) {
        await db.query(
          'DELETE FROM patrol_schedule_occurrence_events WHERE tenant_id=$1 AND occurrence_id=ANY($2::uuid[])',
          [TENANT_ID, occurrenceIds]
        );
        await db.query(
          'DELETE FROM patrol_schedule_occurrences WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
          [TENANT_ID, occurrenceIds]
        );
      }
      await db.query('DELETE FROM patrol_exceptions WHERE tenant_id=$1 AND site_id=$2', [TENANT_ID, cleanupSiteId]);
    }
    if (checkpointIds.length) {
      await db.query('DELETE FROM patrol_exceptions WHERE tenant_id=$1 AND checkpoint_id=ANY($2::uuid[])', [TENANT_ID, checkpointIds]);
      await db.query('DELETE FROM patrol_scans WHERE tenant_id=$1 AND checkpoint_uuid=ANY($2::uuid[])', [TENANT_ID, checkpointIds]);
    }
    if (roundIds.length) await db.query('DELETE FROM patrol_attachments WHERE tenant_id=$1 AND round_id=ANY($2::uuid[])', [TENANT_ID, roundIds]);
    if (roundIds.length) await db.query('DELETE FROM patrol_rounds WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [TENANT_ID, roundIds]);
    if (routeId) {
      await db.query('DELETE FROM patrol_route_version_group_assignments WHERE tenant_id=$1 AND employee_group_id=$2', [TENANT_ID, employeeGroupId]);
      await db.query('DELETE FROM patrol_route_version_checkpoints WHERE tenant_id=$1 AND route_version_id=ANY($2::uuid[])', [TENANT_ID, versionIds]);
      await db.query('DELETE FROM patrol_route_versions WHERE tenant_id=$1 AND route_id=$2', [TENANT_ID, routeId]);
      await db.query('DELETE FROM patrol_routes WHERE tenant_id=$1 AND id=$2', [TENANT_ID, routeId]);
    }
    if (documentId) {
      const versions = await db.query(
        'SELECT storage_key FROM document_versions WHERE tenant_id=$1 AND document_id=$2',
        [TENANT_ID, documentId]
      );
      await db.query('DELETE FROM document_audit_events WHERE tenant_id=$1 AND document_id=$2', [TENANT_ID, documentId]);
      await db.query('DELETE FROM document_relationships WHERE tenant_id=$1 AND document_id=$2', [TENANT_ID, documentId]);
      await db.query('DELETE FROM document_versions WHERE tenant_id=$1 AND document_id=$2', [TENANT_ID, documentId]);
      await db.query('DELETE FROM documents WHERE tenant_id=$1 AND id=$2', [TENANT_ID, documentId]);
      for (const version of versions.rows) await removeDocumentBlob(version.storage_key);
    }
    if (employeeGroupId) {
      await db.query('DELETE FROM patrol_employee_group_members WHERE tenant_id=$1 AND employee_group_id=$2', [TENANT_ID, employeeGroupId]);
      await db.query('DELETE FROM patrol_employee_groups WHERE tenant_id=$1 AND id=$2', [TENANT_ID, employeeGroupId]);
    }
    if (siteId) await db.query('DELETE FROM patrol_scan_attempts WHERE tenant_id=$1 AND site_id=$2', [TENANT_ID, siteId]);
    if (checkpointIds.length) await db.query('DELETE FROM patrol_checkpoints WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [TENANT_ID, checkpointIds]);
    if (scopeEmployeeId) {
      await db.query('DELETE FROM employee_site_assignments WHERE tenant_id=$1 AND employee_id=$2', [TENANT_ID, scopeEmployeeId]);
      await db.query('DELETE FROM employees WHERE tenant_id=$1 AND id=$2', [TENANT_ID, scopeEmployeeId]);
    }
    if (employeeId) {
      await db.query('DELETE FROM employee_site_assignments WHERE tenant_id=$1 AND employee_id=$2', [TENANT_ID, employeeId]);
      await db.query('DELETE FROM employees WHERE tenant_id=$1 AND id=$2', [TENANT_ID, employeeId]);
    }
    if (scopeSiteId) {
      await db.query('DELETE FROM employee_site_assignments WHERE tenant_id=$1 AND site_id=$2', [TENANT_ID, scopeSiteId]);
      await db.query('DELETE FROM sites WHERE tenant_id=$1 AND id=$2', [TENANT_ID, scopeSiteId]);
    }
    if (siteId) await db.query('DELETE FROM sites WHERE tenant_id=$1 AND id=$2', [TENANT_ID, siteId]);
    if (clientId) await db.query('DELETE FROM clients WHERE tenant_id=$1 AND id=$2', [TENANT_ID, clientId]);
    if (userId) {
      await db.query('DELETE FROM user_sessions WHERE user_id=$1', [userId]);
      await db.query('DELETE FROM user_roles WHERE user_id=$1', [userId]);
      await db.query('DELETE FROM audit_logs WHERE tenant_id=$1 AND user_email=$2', [TENANT_ID, userEmail]);
      await db.query('DELETE FROM users WHERE id=$1', [userId]);
    }
    if (scopeUserId) {
      await db.query('DELETE FROM user_sessions WHERE user_id=$1', [scopeUserId]);
      await db.query('DELETE FROM user_roles WHERE user_id=$1', [scopeUserId]);
      await db.query('DELETE FROM users WHERE id=$1', [scopeUserId]);
    }
  } finally {
    await db.query('SET session_replication_role = origin');
    db.release();
  }
});

test('patrol API verifies tokens, serializes routes, and makes round/exception retries idempotent', async () => {
  credential = await login();
  const suffix = crypto.randomBytes(6).toString('hex');
  const mutationId = () => crypto.randomUUID();
  const capturedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  const scanCapturedAt = new Date(Date.parse(capturedAt) + 10 * 60_000).toISOString();

  const invalidCoordinates = await request(app)
    .post('/api/v1/patrol/checkpoints')
    .set(authorizedHeaders())
    .send({ siteId, code: `BAD-${suffix}`, name: 'Invalid coordinates', latitude: 52.52 });
  expect(invalidCoordinates.status).toBe(400);

  const checkpointResponse = await request(app)
    .post('/api/v1/patrol/checkpoints')
    .set(authorizedHeaders())
    .send({
      siteId,
      code: `PT-${suffix}`,
      name: `Patrol checkpoint ${suffix}`,
      locationDetails: 'Integration test',
      buildingName: 'Tower A',
      areaName: 'North entrance',
      latitude: 52.52,
      longitude: 13.405,
      requiredIntervalMinutes: 45
    });
  expect(checkpointResponse.status).toBe(201);
  checkpointId = checkpointResponse.body.data.id;
  const checkpoint = checkpointResponse.body.data;
  expect(checkpoint).toMatchObject({
    building_name: 'Tower A',
    area_name: 'North entrance',
    latitude: '52.520000',
    longitude: '13.405000'
  });
  expect(checkpoint.scanPayload).toMatch(/^secops:patrol:v1:/);
  const token = checkpoint.scanPayload.split(':').at(-1) as string;
  expect(token).toHaveLength(43);
  const storedToken = await migrationPool.query(
    'SELECT token_hash FROM patrol_checkpoints WHERE tenant_id=$1 AND id=$2',
    [TENANT_ID, checkpointId]
  );
  expect(storedToken.rows[0].token_hash).not.toContain(token);
  expect(storedToken.rows[0].token_hash.trim()).toMatch(/^[a-f0-9]{64}$/);

  const updatedCheckpoint = await request(app)
    .patch(`/api/v1/patrol/checkpoints/${checkpointId}`)
    .set(authorizedHeaders())
    .send({
      code: checkpoint.code,
      name: `${checkpoint.name} updated`,
      locationDetails: 'Updated integration details',
      buildingName: 'Tower B',
      areaName: 'Service corridor',
      latitude: 52.521,
      longitude: 13.406,
      requiredIntervalMinutes: 30
    });
  expect(updatedCheckpoint.status).toBe(200);
  expect(updatedCheckpoint.body.data.name).toBe(`${checkpoint.name} updated`);

  const employeeGroup = await request(app)
    .post('/api/v1/patrol/employee-groups')
    .set(authorizedHeaders())
    .send({ siteId, name: `Patrol team ${suffix}`, employeeIds: [employeeId] });
  expect(employeeGroup.status).toBe(201);
  employeeGroupId = employeeGroup.body.data.id;
  const listedGroups = await request(app)
    .get(`/api/v1/patrol/employee-groups?siteId=${siteId}`)
    .set(authorizedHeaders());
  expect(listedGroups.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: employeeGroupId, employees: [{ id: employeeId, name: 'Patrol Integration' }] })
  ]));

  const routeResponse = await request(app)
    .post('/api/v1/patrol/routes')
    .set(authorizedHeaders())
    .send({
      siteId,
      code: `PR-${suffix}`,
      name: `Patrol route ${suffix}`,
      changeReason: 'Integration test initial route',
      flexibleOrder: false,
      targetDurationMinutes: 1,
      lateToleranceMinutes: 7,
      timeWindowStart: new Date(Date.parse(capturedAt) - 60_000).toISOString().slice(11, 16),
      timeWindowEnd: new Date(Date.parse(capturedAt) + 30 * 60_000).toISOString().slice(11, 16),
      recurrenceFrequency: 'daily',
      recurrenceInterval: 1,
      recurrenceDays: [],
      scheduleTimezone: 'UTC',
      employeeIds: [],
      employeeGroupIds: [employeeGroupId],
      checkpoints: [{ checkpointId, plannedOffsetMinutes: 0 }]
    });
  expect(routeResponse.status).toBe(201);
  routeId = routeResponse.body.data.id;
  const listedRoutes = await request(app)
    .get(`/api/v1/patrol/routes?siteId=${siteId}`)
    .set(authorizedHeaders());
  expect(listedRoutes.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: routeId,
      flexible_order: false,
      target_duration_minutes: 1,
      late_tolerance_minutes: 7,
      time_window_start: expect.any(String),
      time_window_end: expect.any(String),
      recurrence_frequency: 'daily',
      recurrence_interval: 1,
      recurrence_days: [],
      schedule_timezone: 'UTC',
      assigned_employees: [{ id: employeeId, name: 'Patrol Integration' }],
      assigned_employee_groups: [{ id: employeeGroupId, name: `Patrol team ${suffix}` }]
    })
  ]));

  const invalidVersion = await request(app)
    .post(`/api/v1/patrol/routes/${routeId}/versions`)
    .set(authorizedHeaders())
    .send({
      name: 'Invalid duplicate checkpoint route',
      changeReason: 'The same checkpoint must not appear twice',
      checkpoints: [
        { checkpointId, plannedOffsetMinutes: 0 },
        { checkpointId, plannedOffsetMinutes: 10 }
      ]
    });
  expect(invalidVersion.status).toBe(400);

  const deviceId = `patrol-test-${suffix}`;
  const pushMutation = (clientUuid: string, action: 'CREATE' | 'UPDATE', payload: Record<string, unknown>) => request(app)
    .post('/api/v1/sync/push')
    .set(authorizedHeaders())
    .send({
      deviceId,
      mutations: [{
        clientUuid,
        entityType: 'patrol',
        action,
        clientTimestamp: capturedAt,
        baseVersion: 1,
        payload
      }]
    });

  const roundMutationId = mutationId();
  const roundIdFromClient = mutationId();
  const roundStartPayload = {
    recordType: 'round_start',
    roundId: roundIdFromClient,
    siteId,
    routeId,
    routeVersion: 1,
    startedAt: capturedAt
  };
  const startRound = () => pushMutation(roundMutationId, 'CREATE', roundStartPayload);
  const roundResponses = await Promise.all([startRound(), startRound()]);
  expect(roundResponses.map(response => response.status)).toEqual([200, 200]);
  expect(roundResponses[0].body.data[0].status).toBe('SYNCED');
  expect(roundResponses[0].body.data[0].serverId).toBe(roundResponses[1].body.data[0].serverId);
  roundId = roundResponses[0].body.data[0].serverId;
  expect(roundId).toBe(roundIdFromClient);
  const scheduledOccurrences = await request(app)
    .get(`/api/v1/patrol/scheduled-occurrences?siteId=${siteId}&routeId=${routeId}&status=in_progress`)
    .set(authorizedHeaders());
  expect(scheduledOccurrences.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ route_id: routeId, round_id: roundId, status: 'in_progress' })
  ]));
  const categories = await request(app).get('/api/v1/documents/categories').set(authorizedHeaders());
  const patrolCategory = categories.body.data.find((item: { name: string }) => item.name === 'Objektunterlagen');
  expect(patrolCategory).toBeDefined();
  const upload = await request(app)
    .post('/api/v1/documents')
    .query({
      title: 'Patrol integration attachment',
      categoryId: patrolCategory.id,
      relationshipType: 'site',
      relationshipId: siteId
    })
    .set(authorizedHeaders())
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', encodeURIComponent(`patrol-${suffix}.txt`))
    .send(Buffer.from('Patrol attachment integration test'));
  expect(upload.status).toBe(201);
  documentId = upload.body.data.id;
  const attached = await request(app)
    .post(`/api/v1/patrol/rounds/${roundId}/attachments`)
    .set(authorizedHeaders())
    .send({ documentId });
  expect(attached.status).toBe(201);
  const repeatedAttachment = await request(app)
    .post(`/api/v1/patrol/rounds/${roundId}/attachments`)
    .set(authorizedHeaders())
    .send({ documentId });
  expect(repeatedAttachment.status).toBe(200);
  expect(repeatedAttachment.body.data.idempotent).toBe(true);
  const attachments = await request(app)
    .get(`/api/v1/patrol/rounds/${roundId}/attachments`)
    .set(authorizedHeaders());
  expect(attachments.body.data).toEqual([
    expect.objectContaining({ document_id: documentId, title: 'Patrol integration attachment' })
  ]);
  const activeRounds = await request(app)
    .get(`/api/v1/patrol/rounds?siteId=${siteId}&status=in_progress`)
    .set(authorizedHeaders());
  expect(activeRounds.body.data.map((round: { id: string }) => round.id)).toContain(roundId);
  const employeeRounds = await request(app)
    .get(`/api/v1/patrol/rounds?clientId=${clientId}&employeeId=${employeeId}&routeId=${routeId}&status=in_progress`)
    .set(authorizedHeaders());
  expect(employeeRounds.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: roundId, guard_id: employeeId, guard_name: 'Patrol Integration' })
  ]));
  const scopedDashboard = await request(app)
    .get(`/api/v1/patrol/dashboard?clientId=${clientId}&employeeId=${employeeId}&routeId=${routeId}&status=in_progress`)
    .set(authorizedHeaders());
  expect(scopedDashboard.body.data.rounds).toMatchObject({ total: 1, in_progress: 1, completed: 0 });

  const pushScan = (
    clientUuid: string,
    checkpointToken: string,
    tokenVersion: number,
    scanRoundId: string | null = roundId,
    extraPayload: Record<string, unknown> = {}
  ) => request(app)
    .post('/api/v1/patrol/sync')
    .set(authorizedHeaders())
    .send({
      deviceId: `patrol-test-${suffix}`,
      mutations: [{
        clientUuid,
        entityType: 'patrol',
        action: 'CREATE',
        clientTimestamp: capturedAt,
        baseVersion: 1,
        payload: {
          siteId,
          checkpointId,
          roundId: scanRoundId || undefined,
          method: 'QR_CODE',
          checkpointToken,
          checkpointTokenVersion: tokenVersion,
          scannedAt: scanCapturedAt,
          ...extraPayload
        }
      }]
    });

  const invalidTokenMutationId = mutationId();
  const invalidToken = await pushScan(invalidTokenMutationId, 'A'.repeat(43), 1);
  expect(invalidToken.status).toBe(200);
  expect(invalidToken.body.data[0].status).toBe('REJECTED');
  const invalidTokenAudit = await migrationPool.query(
    'SELECT outcome,reason_code,method FROM patrol_scan_attempts WHERE tenant_id=$1 AND client_mutation_id=$2',
    [TENANT_ID, invalidTokenMutationId]
  );
  expect(invalidTokenAudit.rows).toEqual([{ outcome: 'rejected', reason_code: 'invalid_token', method: 'QR_CODE' }]);
  const invalidScanCoordinates = await pushScan(mutationId(), token, 1, roundId, { latitude: 52.52 });
  expect(invalidScanCoordinates.body.data[0].status).toBe('REJECTED');

  const scanMutationId = mutationId();
  const validScan = await pushScan(scanMutationId, token, 1, roundId, { latitude: 52.52, longitude: 13.405 });
  expect(validScan.body.data[0].status).toBe('SYNCED');
  const filteredScans = await request(app)
    .get(`/api/v1/patrol/scans?clientId=${clientId}&employeeId=${employeeId}&routeId=${routeId}&status=in_progress`)
    .set(authorizedHeaders());
  expect(filteredScans.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: validScan.body.data[0].serverId, guard_id: employeeId })
  ]));
  const storedScan = await migrationPool.query(
    `SELECT latitude,longitude,scanned_at,client_captured_at,server_received_at
       FROM patrol_scans WHERE tenant_id=$1 AND id=$2`,
    [TENANT_ID, validScan.body.data[0].serverId]
  );
  expect(storedScan.rows[0]).toMatchObject({ latitude: '52.520000', longitude: '13.405000' });
  expect(new Date(storedScan.rows[0].client_captured_at).toISOString()).toBe(scanCapturedAt);
  expect(new Date(storedScan.rows[0].scanned_at).toISOString()).toBe(scanCapturedAt);
  expect(storedScan.rows[0].server_received_at).toEqual(expect.any(Date));
  const lateScanException = await migrationPool.query(
    `SELECT category,description FROM patrol_exceptions
      WHERE tenant_id=$1 AND round_id=$2 AND checkpoint_id=$3 AND category='late_checkpoint'`,
    [TENANT_ID, roundId, checkpointId]
  );
  expect(lateScanException.rows).toHaveLength(1);
  expect(lateScanException.rows[0].description).toContain('außerhalb der konfigurierten Routentoleranz');
  const repeatedScan = await pushScan(scanMutationId, token, 1);
  expect(repeatedScan.body.data[0].serverId).toBe(validScan.body.data[0].serverId);

  const duplicateScanMutationId = mutationId();
  const duplicateScan = await pushScan(duplicateScanMutationId, token, 1, roundId, { scannedAt: capturedAt });
  expect(duplicateScan.body.data[0].status).toBe('CONFLICT');
  const duplicateAudit = await migrationPool.query(
    'SELECT outcome,reason_code FROM patrol_scan_attempts WHERE tenant_id=$1 AND client_mutation_id=$2',
    [TENANT_ID, duplicateScanMutationId]
  );
  expect(duplicateAudit.rows).toEqual([{ outcome: 'duplicate', reason_code: 'duplicate_scan' }]);
  const conflictResolutionPayload = {
    clientUuid: duplicateScanMutationId,
    entityType: 'patrol',
    strategy: 'RECORD_AS_EXCEPTION',
    expectedVersion: duplicateScan.body.data[0].serverVersion,
    localPayload: {
      recordType: 'scan',
      siteId,
      checkpointId,
      roundId,
      notes: 'Offline-Scan zur manuellen Prüfung',
      scannedAt: scanCapturedAt,
      checkpointToken: token
    }
  };
  const unsafeLocalOverwrite = await request(app)
    .post('/api/v1/sync/conflicts/resolve')
    .set(authorizedHeaders())
    .send({ ...conflictResolutionPayload, strategy: 'USE_LOCAL' });
  expect(unsafeLocalOverwrite.status).toBe(400);
  const conflictResolution = await request(app)
    .post('/api/v1/sync/conflicts/resolve')
    .set(authorizedHeaders())
    .send(conflictResolutionPayload);
  expect(conflictResolution.status).toBe(200);
  expect(conflictResolution.body.data).toMatchObject({
    applied: true,
    entityType: 'patrol',
    strategy: 'RECORD_AS_EXCEPTION'
  });
  const resolvedException = await migrationPool.query(
    `SELECT category,description FROM patrol_exceptions
      WHERE tenant_id=$1 AND site_id=$2 AND round_id=$3 AND category='other'
        AND description LIKE $4`,
    [TENANT_ID, siteId, roundId, `%${duplicateScanMutationId}%`]
  );
  expect(resolvedException.rows).toHaveLength(1);
  expect(resolvedException.rows[0].description).toContain('Offline-Scan zur manuellen Prüfung');
  expect(resolvedException.rows[0].description).not.toContain(token);
  const replayedResolution = await request(app)
    .post('/api/v1/sync/conflicts/resolve')
    .set(authorizedHeaders())
    .send(conflictResolutionPayload);
  expect(replayedResolution.status).toBe(200);
  expect(replayedResolution.body.data).toEqual(conflictResolution.body.data);

  const serverChoiceMutationId = mutationId();
  const serverChoiceConflict = await pushScan(serverChoiceMutationId, token, 1);
  expect(serverChoiceConflict.body.data[0].status).toBe('CONFLICT');
  const serverChoiceResolution = await request(app)
    .post('/api/v1/sync/conflicts/resolve')
    .set(authorizedHeaders())
    .send({
      clientUuid: serverChoiceMutationId,
      entityType: 'patrol',
      strategy: 'USE_SERVER',
      expectedVersion: serverChoiceConflict.body.data[0].serverVersion,
      localPayload: { recordType: 'scan', roundId }
    });
  expect(serverChoiceResolution.status).toBe(200);
  expect(serverChoiceResolution.body.data.serverState).toMatchObject({ id: roundId, status: 'in_progress' });
  const attempts = await request(app)
    .get(`/api/v1/patrol/scan-attempts?siteId=${siteId}&employeeId=${employeeId}&routeId=${routeId}&status=in_progress`)
    .set(authorizedHeaders());
  expect(attempts.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ client_mutation_id: invalidTokenMutationId, reason_code: 'invalid_token' }),
    expect.objectContaining({ client_mutation_id: duplicateScanMutationId, outcome: 'duplicate' })
  ]));
  const attemptDashboard = await request(app)
    .get(`/api/v1/patrol/dashboard?siteId=${siteId}&employeeId=${employeeId}&routeId=${routeId}&status=in_progress`)
    .set(authorizedHeaders());
  expect(attemptDashboard.body.data.scanAttempts).toMatchObject({ total: 4, rejected: 2, duplicate: 2 });

  const staleScan = await pushScan(mutationId(), token, 1, roundId, {
    scannedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString()
  });
  expect(staleScan.body.data[0].status).toBe('REJECTED');
  expect(staleScan.body.data[0].message).toContain('zulässigen Offline-');
  const futureScan = await pushScan(mutationId(), token, 1, roundId, {
    scannedAt: new Date(Date.now() + 6 * 60_000).toISOString()
  });
  expect(futureScan.body.data[0].status).toBe('REJECTED');
  const outOfRoundScan = await pushScan(mutationId(), token, 1, roundId, {
    scannedAt: new Date(Date.parse(capturedAt) - 6 * 60_000).toISOString()
  });
  expect(outOfRoundScan.body.data[0].status).toBe('REJECTED');

  const scopeSite = await migrationPool.query(
    `INSERT INTO sites (tenant_id,client_id,site_code,name,address)
     VALUES ($1,$2,$3,'Patrol private scope site','Private test address') RETURNING id`,
    [TENANT_ID, clientId, `PATROL-SCOPE-${suffix}`]
  );
  scopeSiteId = scopeSite.rows[0].id;
  await migrationPool.query(
    'INSERT INTO employee_site_assignments (tenant_id,employee_id,site_id) VALUES ($1,$2,$3)',
    [TENANT_ID, employeeId, scopeSiteId]
  );
  const guardEmail = `patrol-guard-${suffix}@example.test`;
  const guardPasswordHash = await argon2.hash(SEED_PASSWORD);
  const guardUser = await migrationPool.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,phone)
     VALUES ($1,$2,'Patrol','Guard Scope','+49 30 002') RETURNING id`,
    [guardEmail, guardPasswordHash]
  );
  scopeUserId = guardUser.rows[0].id;
  const guardRole = await migrationPool.query("SELECT id FROM roles WHERE name='Wachdienstmitarbeiter'");
  if (!guardRole.rows.length) throw new Error('Patrol guard integration role is missing.');
  await migrationPool.query(
    'INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)',
    [scopeUserId, guardRole.rows[0].id, TENANT_ID]
  );
  const guardEmployee = await migrationPool.query(
    `INSERT INTO employees
       (tenant_id,personnel_number,first_name,last_name,email,phone,role,status,date_of_joining,account_user_id)
     VALUES ($1,$2,'Patrol','Guard Scope',$3,'+49 30 002','Wachdienstmitarbeiter','Aktiv',CURRENT_DATE,$4)
     RETURNING id`,
    [TENANT_ID, `PATROL-GUARD-${suffix}`, guardEmail, scopeUserId]
  );
  scopeEmployeeId = guardEmployee.rows[0].id;
  await migrationPool.query(
    'INSERT INTO employee_site_assignments (tenant_id,employee_id,site_id) VALUES ($1,$2,$3)',
    [TENANT_ID, scopeEmployeeId, siteId]
  );
  const scopeCheckpoint = await request(app)
    .post('/api/v1/patrol/checkpoints')
    .set(authorizedHeaders())
    .send({ siteId: scopeSiteId, code: `SC-${suffix}`, name: 'Private scope checkpoint' });
  expect(scopeCheckpoint.status).toBe(201);
  scopeCheckpointId = scopeCheckpoint.body.data.id;
  const privateToken = scopeCheckpoint.body.data.scanPayload.split(':').at(-1) as string;
  const guardCredential = await loginAs(guardEmail, SEED_PASSWORD);
  const guardHeaders = authHeaders(guardCredential);
  const guardStartedAt = new Date(Date.now() - 60_000).toISOString();
  const guardRound = await request(app)
    .post('/api/v1/patrol/rounds')
    .set(guardHeaders)
    .send({
      siteId,
      startedAt: guardStartedAt,
      clientMutationId: mutationId()
    });
  expect(guardRound.status).toBe(201);
  scopeRoundId = guardRound.body.data.id;
  const guardScanMutationId = mutationId();
  const guardScanAt = new Date().toISOString();
  const guardScan = await request(app)
    .post('/api/v1/sync/push')
    .set(guardHeaders)
    .send({
      deviceId: `patrol-guard-${suffix}`,
      mutations: [{
        clientUuid: guardScanMutationId,
        entityType: 'patrol',
        action: 'CREATE',
        clientTimestamp: guardScanAt,
        baseVersion: 1,
        payload: {
          siteId,
          checkpointId,
          roundId: scopeRoundId,
          method: 'QR_CODE',
          checkpointToken: token,
          checkpointTokenVersion: 1,
          scannedAt: guardScanAt
        }
      }]
    });
  expect(guardScan.body.data[0].status).toBe('SYNCED');
  const guardException = await request(app)
    .post('/api/v1/patrol/exceptions')
    .set(guardHeaders)
    .send({
      siteId,
      roundId: scopeRoundId,
      category: 'hazard',
      description: 'Guard-owned scoped exception',
      clientMutationId: mutationId(),
      capturedAt: guardScanAt
    });
  expect(guardException.status).toBe(201);

  const privateScan = await pushMutation(mutationId(), 'CREATE', {
    siteId: scopeSiteId,
    checkpointId: scopeCheckpointId,
    method: 'QR_CODE',
    checkpointToken: privateToken,
    checkpointTokenVersion: 1,
    scannedAt: new Date().toISOString()
  });
  expect(privateScan.body.data[0].status).toBe('SYNCED');
  const privateException = await request(app)
    .post('/api/v1/patrol/exceptions')
    .set(authorizedHeaders())
    .send({
      siteId: scopeSiteId,
      category: 'hazard',
      description: 'Manager-only private site exception',
      clientMutationId: mutationId(),
      capturedAt: new Date().toISOString()
    });
  expect(privateException.status).toBe(201);
  const unrelatedSiteHistory = await request(app)
    .get(`/api/v1/patrol/events?siteId=${scopeSiteId}`)
    .set(authorizedHeaders());
  expect(unrelatedSiteHistory.body.data).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ entity_type: 'schedule_occurrence' })
  ]));
  await migrationPool.query(
    'DELETE FROM employee_site_assignments WHERE tenant_id=$1 AND employee_id=$2 AND site_id=$3',
    [TENANT_ID, scopeEmployeeId, siteId]
  );

  const guardVisibleScans = await request(app).get('/api/v1/patrol/scans').set(guardHeaders);
  expect(guardVisibleScans.body.data.map((scan: { id: string }) => scan.id)).toEqual([
    guardScan.body.data[0].serverId
  ]);
  const guardVisibleExceptions = await request(app).get('/api/v1/patrol/exceptions').set(guardHeaders);
  expect(guardVisibleExceptions.body.data.map((exception: { id: string }) => exception.id)).toEqual([
    guardException.body.data.id
  ]);
  const filteredForeignScans = await request(app)
    .get(`/api/v1/patrol/scans?siteId=${scopeSiteId}&employeeId=${employeeId}`)
    .set(guardHeaders);
  expect(filteredForeignScans.body.data).toEqual([]);
  const filteredForeignExceptions = await request(app)
    .get(`/api/v1/patrol/exceptions?siteId=${scopeSiteId}&employeeId=${employeeId}`)
    .set(guardHeaders);
  expect(filteredForeignExceptions.body.data).toEqual([]);
  const narrowedOwnScans = await request(app)
    .get(`/api/v1/patrol/scans?siteId=${siteId}&employeeId=${employeeId}`)
    .set(guardHeaders);
  expect(narrowedOwnScans.body.data).toEqual([]);
  const managerPrivateScans = await request(app)
    .get(`/api/v1/patrol/scans?siteId=${scopeSiteId}`)
    .set(authorizedHeaders());
  expect(managerPrivateScans.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: privateScan.body.data[0].serverId })
  ]));
  const managerPrivateExceptions = await request(app)
    .get(`/api/v1/patrol/exceptions?siteId=${scopeSiteId}&category=hazard`)
    .set(authorizedHeaders());
  expect(managerPrivateExceptions.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: privateException.body.data.id })
  ]));

  const exceptionMutationId = mutationId();
  const exceptionPayload = {
    siteId,
    roundId,
    checkpointId,
    category: 'hazard',
    severity: 'high',
    description: 'Integration-test hazard',
    clientMutationId: exceptionMutationId,
    capturedAt
  };
  const createException = () => request(app)
    .post('/api/v1/patrol/exceptions')
    .set(authorizedHeaders())
    .send(exceptionPayload);
  const exceptionResponses = await Promise.all([createException(), createException()]);
  expect(exceptionResponses.map(response => response.status).sort()).toEqual([200, 201]);
  expect(exceptionResponses[0].body.data.id).toBe(exceptionResponses[1].body.data.id);
  const filteredExceptions = await request(app)
    .get(`/api/v1/patrol/exceptions?clientId=${clientId}&employeeId=${employeeId}&routeId=${routeId}&status=in_progress&category=hazard`)
    .set(authorizedHeaders());
  expect(filteredExceptions.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: exceptionResponses[0].body.data.id,
      guard_id: employeeId,
      category: 'hazard'
    })
  ]));

  const rotate = await request(app)
    .post(`/api/v1/patrol/checkpoints/${checkpointId}/rotate-token`)
    .set(authorizedHeaders())
    .send({});
  expect(rotate.status).toBe(200);
  const rotatedToken = rotate.body.data.scanPayload.split(':').at(-1) as string;
  const staleToken = await pushScan(mutationId(), token, 1);
  expect(staleToken.body.data[0].status).toBe('REJECTED');

  const completedAt = new Date(Date.parse(capturedAt) + 11 * 60_000).toISOString();
  const completionMutationId = mutationId();
  const completionPayload = { recordType: 'round_complete', roundId, completedAt };
  const completeRound = () => pushMutation(completionMutationId, 'UPDATE', completionPayload);
  const completion = await completeRound();
  expect(completion.body.data[0].status).toBe('SYNCED');
  const repeatedCompletion = await completeRound();
  expect(repeatedCompletion.body.data[0].serverId).toBe(completion.body.data[0].serverId);
  const changedCompletionReplay = await pushMutation(completionMutationId, 'UPDATE', {
    ...completionPayload,
    completedAt: new Date(Date.parse(completedAt) + 1_000).toISOString()
  });
  expect(changedCompletionReplay.body.data[0].status).toBe('REJECTED');

  const completionTimes = await migrationPool.query(
    `SELECT completion_client_captured_at,completion_server_received_at,completed_at,status
       FROM patrol_rounds WHERE tenant_id=$1 AND id=$2`,
    [TENANT_ID, roundId]
  );
  expect(completionTimes.rows[0]).toMatchObject({
    completion_client_captured_at: expect.any(Date),
    completion_server_received_at: expect.any(Date),
    status: 'completed'
  });
  expect(new Date(completionTimes.rows[0].completed_at).toISOString()).toBe(completedAt);
  const completedOccurrence = await migrationPool.query(
    `SELECT id,status,resolved_at FROM patrol_schedule_occurrences
      WHERE tenant_id=$1 AND round_id=$2`,
    [TENANT_ID, roundId]
  );
  expect(completedOccurrence.rows).toHaveLength(1);
  expect(completedOccurrence.rows[0].status).toBe('completed');
  const occurrenceHistory = await request(app)
    .get(`/api/v1/patrol/events?siteId=${siteId}&from=${new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10)}`)
    .set(authorizedHeaders());
  expect(occurrenceHistory.body.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ entity_type: 'schedule_occurrence', action: 'round_started' }),
    expect.objectContaining({ entity_type: 'schedule_occurrence', action: 'round_completed' })
  ]));
  const durationException = await migrationPool.query(
    `SELECT description FROM patrol_exceptions
      WHERE tenant_id=$1 AND round_id=$2 AND checkpoint_id=$3 AND category='late_checkpoint'`,
    [TENANT_ID, roundId, checkpointId]
  );
  expect(durationException.rows.map((row: { description: string }) => row.description)).toEqual(expect.arrayContaining([
    expect.stringContaining('außerhalb der konfigurierten Routentoleranz'),
    expect.stringContaining('Soll-Dauer')
  ]));

  const recoveryMutationId = mutationId();
  recoveryRoundId = mutationId();
  const recoveryStartPayload = {
    roundId: recoveryRoundId,
    siteId,
    routeId,
    routeVersion: 1,
    startedAt: capturedAt
  };
  const directStart = await request(app)
    .post('/api/v1/patrol/rounds')
    .set(authorizedHeaders())
    .send({ ...recoveryStartPayload, clientMutationId: recoveryMutationId });
  expect(directStart.status).toBe(201);
  const recoveredStart = await pushMutation(recoveryMutationId, 'CREATE', {
    recordType: 'round_start',
    ...recoveryStartPayload
  });
  expect(recoveredStart.body.data[0]).toMatchObject({
    status: 'SYNCED',
    serverId: recoveryRoundId
  });

  const recoveryCompletionMutationId = mutationId();
  const recoveryCompletedAt = new Date(Date.parse(capturedAt) + 12 * 60_000).toISOString();
  const completionNote = 'Integration completion note';
  const staleCompletion = await pushMutation(mutationId(), 'UPDATE', {
    recordType: 'round_complete',
    roundId: recoveryRoundId,
    completedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString()
  });
  expect(staleCompletion.body.data[0].status).toBe('REJECTED');
  const futureCompletion = await pushMutation(mutationId(), 'UPDATE', {
    recordType: 'round_complete',
    roundId: recoveryRoundId,
    completedAt: new Date(Date.now() + 6 * 60_000).toISOString()
  });
  expect(futureCompletion.body.data[0].status).toBe('REJECTED');
  const outOfRoundCompletion = await pushMutation(mutationId(), 'UPDATE', {
    recordType: 'round_complete',
    roundId: recoveryRoundId,
    completedAt: new Date(Date.parse(capturedAt) - 6 * 60_000).toISOString()
  });
  expect(outOfRoundCompletion.body.data[0].status).toBe('REJECTED');
  const directCompletion = await request(app)
    .post(`/api/v1/patrol/rounds/${recoveryRoundId}/complete`)
    .set(authorizedHeaders())
    .send({ clientMutationId: recoveryCompletionMutationId, completedAt: recoveryCompletedAt, notes: completionNote });
  expect(directCompletion.status).toBe(200);
  const recoveredCompletion = await pushMutation(recoveryCompletionMutationId, 'UPDATE', {
    recordType: 'round_complete',
    roundId: recoveryRoundId,
    completedAt: recoveryCompletedAt,
    notes: completionNote
  });
  expect(recoveredCompletion.body.data[0]).toMatchObject({
    status: 'SYNCED',
    serverId: recoveryRoundId
  });
  const autoDetectedMiss = await migrationPool.query(
    `SELECT category,description FROM patrol_exceptions
      WHERE tenant_id=$1 AND round_id=$2 AND checkpoint_id=$3 AND category='missed_checkpoint'`,
    [TENANT_ID, recoveryRoundId, checkpointId]
  );
  expect(autoDetectedMiss.rows).toHaveLength(1);
  expect(autoDetectedMiss.rows[0]).toMatchObject({
    category: 'missed_checkpoint',
    description: expect.stringContaining(checkpoint.code)
  });
  const storedCompletionNote = await migrationPool.query(
    'SELECT completion_notes FROM patrol_rounds WHERE tenant_id=$1 AND id=$2',
    [TENANT_ID, recoveryRoundId]
  );
  expect(storedCompletionNote.rows[0].completion_notes).toBe(completionNote);

  const scheduledVersion = await request(app)
    .post(`/api/v1/patrol/routes/${routeId}/versions`)
    .set(authorizedHeaders())
    .send({
      name: `Patrol route ${suffix} scheduled version`,
      changeReason: 'Exercise automatic missed and abandoned occurrence handling',
      flexibleOrder: false,
      targetDurationMinutes: 1,
      lateToleranceMinutes: 7,
      timeWindowStart: new Date(Date.parse(capturedAt) - 60_000).toISOString().slice(11, 16),
      timeWindowEnd: new Date(Date.parse(capturedAt) + 30 * 60_000).toISOString().slice(11, 16),
      recurrenceFrequency: 'daily',
      recurrenceInterval: 1,
      recurrenceDays: [],
      employeeIds: [],
      employeeGroupIds: [employeeGroupId],
      checkpoints: [{ checkpointId, plannedOffsetMinutes: 0 }]
    });
  expect(scheduledVersion.status).toBe(201);
  const occurrenceProbeTime = new Date(Date.parse(capturedAt) + 5 * 24 * 60 * 60_000);
  const materializedInParallel = await Promise.all([
    withTenantTransaction(TENANT_ID, db =>
      materializePatrolOccurrences(db, TENANT_ID, occurrenceProbeTime, 0, 0)
    ),
    withTenantTransaction(TENANT_ID, db =>
      materializePatrolOccurrences(db, TENANT_ID, occurrenceProbeTime, 0, 0)
    )
  ]);
  const occurrenceRows = await migrationPool.query(
    `SELECT scheduled_at FROM patrol_schedule_occurrences
      WHERE tenant_id=$1 AND route_id=$2 AND route_version=2
        AND scheduled_at >= $3::date AND scheduled_at < $3::date + interval '1 day'`,
    [TENANT_ID, routeId, occurrenceProbeTime.toISOString()]
  );
  expect(occurrenceRows.rows).toHaveLength(1);
  expect(materializedInParallel.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(1);
  abandonedRoundId = mutationId();
  const abandonedStart = await request(app)
    .post('/api/v1/patrol/rounds')
    .set(authorizedHeaders())
    .send({
      roundId: abandonedRoundId,
      siteId,
      routeId,
      routeVersion: 2,
      startedAt: capturedAt,
      clientMutationId: mutationId()
    });
  expect(abandonedStart.status).toBe(201);
  const scheduleRunAt = new Date(Date.parse(capturedAt) + 3 * 24 * 60 * 60_000);
  const scheduleRuns = await Promise.all([
    withTenantTransaction(TENANT_ID, db => processTenantPatrolSchedules(db, TENANT_ID, scheduleRunAt)),
    withTenantTransaction(TENANT_ID, db => processTenantPatrolSchedules(db, TENANT_ID, scheduleRunAt))
  ]);
  expect(scheduleRuns.reduce((sum, run) => sum + run.abandoned, 0)).toBeGreaterThanOrEqual(1);
  expect(scheduleRuns.reduce((sum, run) => sum + run.missed, 0)).toBeGreaterThanOrEqual(1);
  const abandonedRound = await migrationPool.query(
    'SELECT status FROM patrol_rounds WHERE tenant_id=$1 AND id=$2',
    [TENANT_ID, abandonedRoundId]
  );
  expect(abandonedRound.rows).toEqual([{ status: 'abandoned' }]);
  const scheduledDeviations = await migrationPool.query(
    `SELECT category FROM patrol_exceptions
      WHERE tenant_id=$1 AND round_id=$2 AND category='abandoned_round'`,
    [TENANT_ID, abandonedRoundId]
  );
  expect(scheduledDeviations.rows).toHaveLength(1);
  const abandonedEvents = await migrationPool.query(
    `SELECT count(*)::int AS total FROM patrol_schedule_occurrence_events
      WHERE tenant_id=$1 AND action='round_abandoned'
        AND details->>'roundId'=$2`,
    [TENANT_ID, abandonedRoundId]
  );
  expect(abandonedEvents.rows[0].total).toBe(1);
  const missedOccurrences = await migrationPool.query(
    `SELECT count(*)::int AS total FROM patrol_exceptions
      WHERE tenant_id=$1 AND site_id=$2 AND category='missed_round'`,
    [TENANT_ID, siteId]
  );
  expect(missedOccurrences.rows[0].total).toBeGreaterThanOrEqual(1);
  const missedOccurrenceList = await request(app)
    .get(`/api/v1/patrol/scheduled-occurrences?siteId=${siteId}&routeId=${routeId}&status=missed`)
    .set(authorizedHeaders());
  expect(missedOccurrenceList.body.data.length).toBeGreaterThan(0);
  expect(missedOccurrenceList.body.data.every((occurrence: { status: string }) => occurrence.status === 'missed')).toBe(true);
  const scheduledOccurrenceList = await request(app)
    .get(`/api/v1/patrol/scheduled-occurrences?siteId=${siteId}&routeId=${routeId}&status=scheduled`)
    .set(authorizedHeaders());
  expect(scheduledOccurrenceList.body.data.every((occurrence: { status: string }) => occurrence.status === 'scheduled')).toBe(true);

  const graceScheduledAt = new Date(Date.now() - 23 * 60 * 60_000);
  const graceWindowEndsAt = new Date(graceScheduledAt.getTime() + 10 * 60_000);
  const graceDeadlineAt = new Date(graceScheduledAt.getTime() + 30 * 60_000);
  const graceOccurrence = await migrationPool.query(
    `INSERT INTO patrol_schedule_occurrences
       (tenant_id,site_id,route_id,route_version,scheduled_at,window_ends_at,deadline_at)
     VALUES ($1,$2,$3,2,$4,$5,$6) RETURNING id`,
    [TENANT_ID, siteId, routeId, graceScheduledAt, graceWindowEndsAt, graceDeadlineAt]
  );
  await withTenantTransaction(TENANT_ID, db =>
    processTenantPatrolSchedules(db, TENANT_ID, new Date(graceDeadlineAt.getTime() + 23 * 60 * 60_000))
  );
  const occurrenceDuringGrace = await migrationPool.query(
    'SELECT status FROM patrol_schedule_occurrences WHERE tenant_id=$1 AND id=$2',
    [TENANT_ID, graceOccurrence.rows[0].id]
  );
  expect(occurrenceDuringGrace.rows[0].status).toBe('scheduled');
  graceRoundId = mutationId();
  const graceStart = await request(app)
    .post('/api/v1/patrol/rounds')
    .set(authorizedHeaders())
    .send({
      roundId: graceRoundId,
      siteId,
      routeId,
      routeVersion: 2,
      startedAt: graceScheduledAt.toISOString(),
      clientMutationId: mutationId()
    });
  expect(graceStart.status).toBe(201);
  const occurrenceAfterDelayedStart = await migrationPool.query(
    'SELECT status,round_id FROM patrol_schedule_occurrences WHERE tenant_id=$1 AND id=$2',
    [TENANT_ID, graceOccurrence.rows[0].id]
  );
  expect(occurrenceAfterDelayedStart.rows[0]).toMatchObject({ status: 'in_progress', round_id: graceRoundId });
  const graceCheckpoint = await request(app)
    .post('/api/v1/patrol/checkpoints')
    .set(authorizedHeaders())
    .send({ siteId, code: `GR-${suffix}`, name: 'Offline grace checkpoint' });
  expect(graceCheckpoint.status).toBe(201);
  graceCheckpointId = graceCheckpoint.body.data.id;
  const graceToken = graceCheckpoint.body.data.scanPayload.split(':').at(-1) as string;
  const delayedScanAt = new Date(graceScheduledAt.getTime() + 5 * 60_000).toISOString();
  const delayedScan = await pushMutation(mutationId(), 'CREATE', {
    siteId,
    checkpointId: graceCheckpointId,
    roundId: graceRoundId,
    method: 'QR_CODE',
    checkpointToken: graceToken,
    checkpointTokenVersion: 1,
    scannedAt: delayedScanAt
  });
  expect(delayedScan.body.data[0].status).toBe('SYNCED');
  const graceCompletion = await pushMutation(mutationId(), 'UPDATE', {
    recordType: 'round_complete',
    roundId: graceRoundId,
    completedAt: new Date(graceScheduledAt.getTime() + 20 * 60_000).toISOString()
  });
  expect(graceCompletion.body.data[0].status).toBe('SYNCED');
  const graceProcessedOccurrence = await migrationPool.query(
    'SELECT status FROM patrol_schedule_occurrences WHERE tenant_id=$1 AND id=$2',
    [TENANT_ID, graceOccurrence.rows[0].id]
  );
  expect(graceProcessedOccurrence.rows[0].status).toBe('completed');

  const disabled = await request(app)
    .patch(`/api/v1/patrol/checkpoints/${checkpointId}/status`)
    .set(authorizedHeaders())
    .send({ active: false });
  expect(disabled.status).toBe(200);
  const inactiveCheckpointScan = await pushScan(mutationId(), rotatedToken, rotate.body.data.token_version, null);
  expect(inactiveCheckpointScan.body.data[0].status).toBe('REJECTED');
  const enabled = await request(app)
    .patch(`/api/v1/patrol/checkpoints/${checkpointId}/status`)
    .set(authorizedHeaders())
    .send({ active: true });
  expect(enabled.status).toBe(200);

  const archivedRoute = await request(app)
    .post(`/api/v1/patrol/routes/${routeId}/archive`)
    .set(authorizedHeaders())
    .send({});
  expect(archivedRoute.body.data).toMatchObject({ id: routeId, archived: true });
  const archivedCheckpoint = await request(app)
    .post(`/api/v1/patrol/checkpoints/${checkpointId}/archive`)
    .set(authorizedHeaders())
    .send({});
  expect(archivedCheckpoint.body.data).toMatchObject({ id: checkpointId, archived: true });
});
