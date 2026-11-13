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
  if (!checkpointId && !routeId && !roundId && !siteId && !clientId && !employeeId && !userId) return;
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
    const entityIds = [checkpointId, routeId, roundId, ...scanIds, ...exceptionIds, ...versionIds].filter(Boolean);
    if (entityIds.length) {
      await db.query('DELETE FROM patrol_events WHERE tenant_id=$1 AND entity_id=ANY($2::uuid[])', [TENANT_ID, entityIds]);
    }
    if (checkpointId) {
      await db.query('DELETE FROM patrol_exceptions WHERE tenant_id=$1 AND checkpoint_id=$2', [TENANT_ID, checkpointId]);
      await db.query('DELETE FROM patrol_scans WHERE tenant_id=$1 AND checkpoint_uuid=$2', [TENANT_ID, checkpointId]);
    }
    if (roundId) await db.query('DELETE FROM patrol_rounds WHERE tenant_id=$1 AND id=$2', [TENANT_ID, roundId]);
    if (routeId) {
      await db.query('DELETE FROM patrol_route_version_checkpoints WHERE tenant_id=$1 AND route_version_id=ANY($2::uuid[])', [TENANT_ID, versionIds]);
      await db.query('DELETE FROM patrol_route_versions WHERE tenant_id=$1 AND route_id=$2', [TENANT_ID, routeId]);
      await db.query('DELETE FROM patrol_routes WHERE tenant_id=$1 AND id=$2', [TENANT_ID, routeId]);
    }
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
  const capturedAt = new Date().toISOString();

  const checkpointResponse = await request(app)
    .post('/api/v1/patrol/checkpoints')
    .set(authorizedHeaders())
    .send({
      siteId,
      code: `PT-${suffix}`,
      name: `Patrol checkpoint ${suffix}`,
      locationDetails: 'Integration test',
      requiredIntervalMinutes: 45
    });
  expect(checkpointResponse.status).toBe(201);
  checkpointId = checkpointResponse.body.data.id;
  const checkpoint = checkpointResponse.body.data;
  expect(checkpoint.scanPayload).toMatch(/^secops:patrol:v1:/);
  const token = checkpoint.scanPayload.split(':').at(-1) as string;
  expect(token).toHaveLength(43);
  const storedToken = await migrationPool.query(
    'SELECT token_hash FROM patrol_checkpoints WHERE tenant_id=$1 AND id=$2',
    [TENANT_ID, checkpointId]
  );
  expect(storedToken.rows[0].token_hash).not.toContain(token);
  expect(storedToken.rows[0].token_hash.trim()).toMatch(/^[a-f0-9]{64}$/);

  const routeResponse = await request(app)
    .post('/api/v1/patrol/routes')
    .set(authorizedHeaders())
    .send({
      siteId,
      code: `PR-${suffix}`,
      name: `Patrol route ${suffix}`,
      changeReason: 'Integration test initial route',
      checkpoints: [{ checkpointId, plannedOffsetMinutes: 0 }]
    });
  expect(routeResponse.status).toBe(201);
  routeId = routeResponse.body.data.id;

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

  const roundMutationId = mutationId();
  const startRound = () => request(app)
    .post('/api/v1/patrol/rounds')
    .set(authorizedHeaders())
    .send({ siteId, routeId, startedAt: capturedAt, clientMutationId: roundMutationId });
  const roundResponses = await Promise.all([startRound(), startRound()]);
  expect(roundResponses.map(response => response.status).sort()).toEqual([200, 201]);
  expect(roundResponses[0].body.data.id).toBe(roundResponses[1].body.data.id);
  roundId = roundResponses[0].body.data.id;
  const activeRounds = await request(app)
    .get(`/api/v1/patrol/rounds?siteId=${siteId}&status=in_progress`)
    .set(authorizedHeaders());
  expect(activeRounds.body.data.map((round: { id: string }) => round.id)).toContain(roundId);

  const pushScan = (clientUuid: string, checkpointToken: string, tokenVersion: number) => request(app)
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
          roundId,
          method: 'QR_CODE',
          checkpointToken,
          checkpointTokenVersion: tokenVersion,
          scannedAt: capturedAt
        }
      }]
    });

  const invalidToken = await pushScan(mutationId(), 'A'.repeat(43), 1);
  expect(invalidToken.status).toBe(200);
  expect(invalidToken.body.data[0].status).toBe('REJECTED');

  const scanMutationId = mutationId();
  const validScan = await pushScan(scanMutationId, token, 1);
  expect(validScan.body.data[0].status).toBe('SYNCED');
  const repeatedScan = await pushScan(scanMutationId, token, 1);
  expect(repeatedScan.body.data[0].serverId).toBe(validScan.body.data[0].serverId);

  const duplicateScan = await pushScan(mutationId(), token, 1);
  expect(duplicateScan.body.data[0].status).toBe('CONFLICT');

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

  const rotate = await request(app)
    .post(`/api/v1/patrol/checkpoints/${checkpointId}/rotate-token`)
    .set(authorizedHeaders())
    .send({});
  expect(rotate.status).toBe(200);
  const staleToken = await pushScan(mutationId(), token, 1);
  expect(staleToken.body.data[0].status).toBe('REJECTED');
});
