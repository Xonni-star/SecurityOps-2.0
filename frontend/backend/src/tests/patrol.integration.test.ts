import argon2 from 'argon2';
import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { migrationPool } from '../config/database';
import { authHeaders } from './testUtils';

const SEED_PASSWORD = 'SecOpsVault2025SecurePassword!';
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

let credential = '';
let userEmail = '';
let userId = '';
let siteId = '';
let clientId = '';
let employeeId = '';
let checkpointId = '';
let routeId = '';
let roundId = '';
let recoveryRoundId = '';

beforeAll(async () => {
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
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email: userEmail, password: SEED_PASSWORD });
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
    const scanIds = checkpointId
      ? (await db.query('SELECT id FROM patrol_scans WHERE tenant_id=$1 AND checkpoint_uuid=$2', [TENANT_ID, checkpointId]))
        .rows.map(row => row.id)
      : [];
    const exceptionIds = checkpointId
      ? (await db.query('SELECT id FROM patrol_exceptions WHERE tenant_id=$1 AND checkpoint_id=$2', [TENANT_ID, checkpointId]))
        .rows.map(row => row.id)
      : [];
    const versionIds = routeId
      ? (await db.query('SELECT id FROM patrol_route_versions WHERE tenant_id=$1 AND route_id=$2', [TENANT_ID, routeId]))
        .rows.map(row => row.id)
      : [];
    const roundIds = [roundId, recoveryRoundId].filter(Boolean);
    const entityIds = [checkpointId, routeId, ...roundIds, ...scanIds, ...exceptionIds, ...versionIds].filter(Boolean);
    if (entityIds.length) {
      await db.query('DELETE FROM patrol_events WHERE tenant_id=$1 AND entity_id=ANY($2::uuid[])', [TENANT_ID, entityIds]);
    }
    if (checkpointId) {
      await db.query('DELETE FROM patrol_exceptions WHERE tenant_id=$1 AND checkpoint_id=$2', [TENANT_ID, checkpointId]);
      await db.query('DELETE FROM patrol_scans WHERE tenant_id=$1 AND checkpoint_uuid=$2', [TENANT_ID, checkpointId]);
    }
    if (roundIds.length) await db.query('DELETE FROM patrol_rounds WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [TENANT_ID, roundIds]);
    if (routeId) {
      await db.query('DELETE FROM patrol_route_version_checkpoints WHERE tenant_id=$1 AND route_version_id=ANY($2::uuid[])', [TENANT_ID, versionIds]);
      await db.query('DELETE FROM patrol_route_versions WHERE tenant_id=$1 AND route_id=$2', [TENANT_ID, routeId]);
      await db.query('DELETE FROM patrol_routes WHERE tenant_id=$1 AND id=$2', [TENANT_ID, routeId]);
    }
    if (siteId) await db.query('DELETE FROM patrol_scan_attempts WHERE tenant_id=$1 AND site_id=$2', [TENANT_ID, siteId]);
    if (checkpointId) await db.query('DELETE FROM patrol_checkpoints WHERE tenant_id=$1 AND id=$2', [TENANT_ID, checkpointId]);
    if (employeeId) {
      await db.query('DELETE FROM employee_site_assignments WHERE tenant_id=$1 AND employee_id=$2', [TENANT_ID, employeeId]);
      await db.query('DELETE FROM employees WHERE tenant_id=$1 AND id=$2', [TENANT_ID, employeeId]);
    }
    if (siteId) await db.query('DELETE FROM sites WHERE tenant_id=$1 AND id=$2', [TENANT_ID, siteId]);
    if (clientId) await db.query('DELETE FROM clients WHERE tenant_id=$1 AND id=$2', [TENANT_ID, clientId]);
    if (userId) {
      await db.query('DELETE FROM user_sessions WHERE user_id=$1', [userId]);
      await db.query('DELETE FROM user_roles WHERE user_id=$1', [userId]);
      await db.query('DELETE FROM audit_logs WHERE tenant_id=$1 AND user_email=$2', [TENANT_ID, userEmail]);
      await db.query('DELETE FROM users WHERE id=$1', [userId]);
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
      timeWindowStart: '21:00',
      timeWindowEnd: '05:00',
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 2,
      recurrenceDays: [1, 3],
      employeeIds: [employeeId],
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
      time_window_start: '21:00:00',
      time_window_end: '05:00:00',
      recurrence_frequency: 'weekly',
      recurrence_interval: 2,
      recurrence_days: [1, 3],
      assigned_employees: [{ id: employeeId, name: 'Patrol Integration' }]
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
    'SELECT latitude,longitude FROM patrol_scans WHERE tenant_id=$1 AND id=$2',
    [TENANT_ID, validScan.body.data[0].serverId]
  );
  expect(storedScan.rows[0]).toMatchObject({ latitude: '52.520000', longitude: '13.405000' });
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
  const duplicateScan = await pushScan(duplicateScanMutationId, token, 1);
  expect(duplicateScan.body.data[0].status).toBe('CONFLICT');
  const duplicateAudit = await migrationPool.query(
    'SELECT outcome,reason_code FROM patrol_scan_attempts WHERE tenant_id=$1 AND client_mutation_id=$2',
    [TENANT_ID, duplicateScanMutationId]
  );
  expect(duplicateAudit.rows).toEqual([{ outcome: 'duplicate', reason_code: 'duplicate_scan' }]);
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
  expect(attemptDashboard.body.data.scanAttempts).toMatchObject({ total: 3, rejected: 2, duplicate: 1 });

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
