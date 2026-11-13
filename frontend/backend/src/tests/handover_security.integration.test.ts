import request from 'supertest';
import argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { app } from '../app';
import { pool, migrationPool } from '../config/database';
import { computePayloadHash } from '../services/syncHash';
import { authHeaders } from './testUtils';

jest.setTimeout(60000);

const tenantId = '11111111-1111-1111-1111-111111111111';
const password = 'HandoverSecurityTest2026!';
const suffix = randomUUID();
const email = (name: string) => `handover-${name}-${suffix}@example.test`;
const roleName = `HIT-${suffix}`;

const emails = {
  identityAdmin: email('identity-admin'),
  outgoing: email('outgoing'),
  incoming: email('incoming'),
  outsider: email('outsider'),
  otherOutgoing: email('other-outgoing'),
  incidentLead: email('incident-lead'),
  hybridConfirmer: email('hybrid-confirmer')
};

const userIds: Record<keyof typeof emails, string> = {} as Record<keyof typeof emails, string>;
const employeeIds: string[] = [];
const handoverIds: string[] = [];
let siteId: string | undefined;
let clientId: string | undefined;
let hybridRoleId: string | undefined;
let tokens: Record<keyof typeof emails, string>;

async function login(userEmail: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email: userEmail, password, requestedTenantId: tenantId });
  expect(response.status).toBe(200);
  const setCookies = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies || ''])
    .find((value) => value.startsWith('secops_session='));
  const sessionId = cookie?.match(/^secops_session=([^;]+)/)?.[1];
  return `${sessionId}|${response.body.data.csrfToken}`;
}

async function createEmployee(label: string, linkedUserId?: string): Promise<string> {
  const result = await migrationPool.query(
    `INSERT INTO employees
       (tenant_id,personnel_number,first_name,last_name,email,phone,role,status,date_of_joining,account_user_id)
     VALUES ($1,$2,$3,'Handover Test',$4,'+49 30 100','Wachdienstmitarbeiter','Aktiv',CURRENT_DATE,$5)
     RETURNING id`,
    [tenantId, `HS-${label.slice(0, 15)}-${suffix.slice(0, 8)}`, label, email(label.toLowerCase().replace(/ /g, '-')), linkedUserId || null]
  );
  const id = result.rows[0].id as string;
  employeeIds.push(id);
  return id;
}

async function createHandover(
  revisionVersion = 1,
  occurredAt = new Date().toISOString(),
  status = 'pending_handover_confirmation'
): Promise<string> {
  const inserted = await migrationPool.query(
    `INSERT INTO handovers
       (tenant_id,site_id,occurred_at,status,revision_version,client_mutation_id,payload_hash,
        client_captured_at,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP,$8)
     RETURNING id`,
    [tenantId, siteId, occurredAt, status, revisionVersion, `handover-${randomUUID()}`, 'a'.repeat(64), userIds.identityAdmin]
  );
  const id = inserted.rows[0].id as string;
  handoverIds.push(id);
  await migrationPool.query(
    `INSERT INTO handover_participants (tenant_id,handover_id,employee_id,participant_role)
     VALUES ($1,$2,$3,'handover'),($1,$2,$4,'takeover')`,
    [tenantId, id, employeeIds[0], employeeIds[1]]
  );
  await migrationPool.query(
    `INSERT INTO handover_events (tenant_id,handover_id,actor_user_id,action,details)
     VALUES ($1,$2,$3,'created',$4::jsonb)`,
    [tenantId, id, userIds.identityAdmin, JSON.stringify({ revisionVersion })]
  );
  return id;
}

async function historyCounts(handoverId: string): Promise<{ confirmations: number; events: number; confirmed: number; acknowledged: number }> {
  const result = await migrationPool.query(
    `SELECT
       (SELECT count(*)::int FROM handover_confirmations WHERE tenant_id=$1 AND handover_id=$2) AS confirmations,
       (SELECT count(*)::int FROM handover_events WHERE tenant_id=$1 AND handover_id=$2) AS events,
       (SELECT count(*)::int FROM handover_events WHERE tenant_id=$1 AND handover_id=$2 AND action='confirmed') AS confirmed,
       (SELECT count(*)::int FROM handover_events WHERE tenant_id=$1 AND handover_id=$2 AND action='acknowledged') AS acknowledged`,
    [tenantId, handoverId]
  );
  return result.rows[0];
}

beforeAll(async () => {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const roleNames: Record<keyof typeof emails, string> = {
    identityAdmin: 'Personalverwaltung',
    outgoing: 'Wachdienstmitarbeiter',
    incoming: 'Wachdienstmitarbeiter',
    outsider: 'Wachdienstmitarbeiter',
    otherOutgoing: 'Wachdienstmitarbeiter',
    incidentLead: 'Einsatzleitung',
    hybridConfirmer: roleName
  };

  const roleResult = await migrationPool.query(
    `INSERT INTO roles (name,description) VALUES ($1,'Test-only confirmer with account-link permission')
     RETURNING id`,
    [roleName]
  );
  hybridRoleId = roleResult.rows[0].id;
  await migrationPool.query(
    `INSERT INTO role_permissions (role_id,permission_id)
     SELECT $1,id FROM permissions WHERE code IN ('employees:account:link','handovers:confirm')`,
    [hybridRoleId]
  );

  for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
    const user = await migrationPool.query(
      `INSERT INTO users (email,password_hash,first_name,last_name,phone)
       VALUES ($1,$2,'Handover','Security Test','+49 30 100')
       RETURNING id`,
      [emails[key], passwordHash]
    );
    userIds[key] = user.rows[0].id;
    const role = roleNames[key] === roleName
      ? { rows: [{ id: hybridRoleId }] }
      : await migrationPool.query('SELECT id FROM roles WHERE name=$1', [roleNames[key]]);
    if (!role.rows.length) throw new Error(`Missing integration-test role: ${roleNames[key]}`);
    await migrationPool.query(
      'INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3)',
      [userIds[key], role.rows[0].id, tenantId]
    );
  }

  const client = await migrationPool.query(
    `INSERT INTO clients
       (tenant_id,client_number,company_name,contact_person,email,phone,address,contract_start,contract_end)
     VALUES ($1,$2,'Handover Security Test','Test Contact',$3,'+49 30 100','Test address',CURRENT_DATE,CURRENT_DATE + 365)
     RETURNING id`,
    [tenantId, `HS-CLIENT-${suffix}`, email('client')]
  );
  clientId = client.rows[0].id;
  const site = await migrationPool.query(
    `INSERT INTO sites (tenant_id,client_id,site_code,name,address)
     VALUES ($1,$2,$3,'Handover Security Test Site','Test address')
     RETURNING id`,
    [tenantId, clientId, `HS-SITE-${suffix}`]
  );
  siteId = site.rows[0].id;

  await createEmployee('Outgoing', userIds.outgoing);
  await createEmployee('Incoming', userIds.incoming);
  await createEmployee('Mapping Target');
  await createEmployee('Duplicate Target');
  await createEmployee('Self-link Target');
  await createEmployee('Other outgoing', userIds.otherOutgoing);

  tokens = {
    identityAdmin: await login(emails.identityAdmin),
    outgoing: await login(emails.outgoing),
    incoming: await login(emails.incoming),
    outsider: await login(emails.outsider),
    otherOutgoing: await login(emails.otherOutgoing),
    incidentLead: await login(emails.incidentLead),
    hybridConfirmer: await login(emails.hybridConfirmer)
  };
});

afterAll(async () => {
  const cleanup = await migrationPool.connect();
  try {
    await cleanup.query('SET session_replication_role = replica');
    if (handoverIds.length) {
      await cleanup.query(
        `DELETE FROM handover_task_events
         WHERE tenant_id=$1 AND task_id IN (
           SELECT id FROM handover_tasks WHERE tenant_id=$1 AND origin_handover_id=ANY($2::uuid[])
         )`,
        [tenantId, handoverIds]
      );
      await cleanup.query('DELETE FROM handover_tasks WHERE tenant_id=$1 AND origin_handover_id=ANY($2::uuid[])', [tenantId, handoverIds]);
      await cleanup.query('DELETE FROM handover_confirmations WHERE tenant_id=$1 AND handover_id=ANY($2::uuid[])', [tenantId, handoverIds]);
      await cleanup.query('DELETE FROM handover_events WHERE tenant_id=$1 AND handover_id=ANY($2::uuid[])', [tenantId, handoverIds]);
      await cleanup.query('DELETE FROM handover_participants WHERE tenant_id=$1 AND handover_id=ANY($2::uuid[])', [tenantId, handoverIds]);
      await cleanup.query('DELETE FROM handovers WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, handoverIds]);
    }
    if (employeeIds.length) {
      await cleanup.query(
        'DELETE FROM audit_logs WHERE tenant_id=$1 AND target_entity=ANY($2::text[])',
        [tenantId, employeeIds]
      );
      await cleanup.query('DELETE FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, employeeIds]);
    }
    if (siteId) await cleanup.query('DELETE FROM sites WHERE tenant_id=$1 AND id=$2', [tenantId, siteId]);
    if (clientId) await cleanup.query('DELETE FROM clients WHERE tenant_id=$1 AND id=$2', [tenantId, clientId]);
    const ids = Object.values(userIds).filter(Boolean);
    if (ids.length) {
      await cleanup.query('DELETE FROM user_sessions WHERE user_id=ANY($1::uuid[])', [ids]);
      await cleanup.query('DELETE FROM user_roles WHERE user_id=ANY($1::uuid[])', [ids]);
      await cleanup.query('DELETE FROM audit_logs WHERE tenant_id=$1 AND user_email=ANY($2::text[])', [tenantId, Object.values(emails)]);
      await cleanup.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    }
    if (hybridRoleId) {
      await cleanup.query('DELETE FROM role_permissions WHERE role_id=$1', [hybridRoleId]);
      await cleanup.query('DELETE FROM roles WHERE id=$1', [hybridRoleId]);
    }
  } finally {
    await cleanup.query('SET session_replication_role = origin');
    cleanup.release();
  }
  await pool.end();
  await migrationPool.end();
});

describe('Handover authorization and persistence regressions (PostgreSQL/API)', () => {
  test('account linking requires its dedicated permission and rejects confirmer self-linking', async () => {
    const grantedRoles = await migrationPool.query(
      `SELECT r.name FROM role_permissions rp
       JOIN roles r ON r.id=rp.role_id
       JOIN permissions p ON p.id=rp.permission_id
       WHERE p.code='employees:account:link' AND r.name IN ('Personalverwaltung','Einsatzleitung','Wachdienstmitarbeiter')
       ORDER BY r.name`
    );
    expect(grantedRoles.rows).toEqual([{ name: 'Personalverwaltung' }]);

    const mappingTargetId = employeeIds[2];
    const duplicateTargetId = employeeIds[3];
    const selfLinkTargetId = employeeIds[4];
    const beforeAudit = await migrationPool.query(
      `SELECT count(*)::int AS count FROM audit_logs
       WHERE tenant_id=$1 AND action_type='employee.account_linked'`,
      [tenantId]
    );

    const incidentLead = await request(app)
      .patch(`/api/v1/employees/${mappingTargetId}/account`)
      .set(authHeaders(tokens.incidentLead))
      .send({ userId: userIds.outsider, revisionVersion: 1 });
    expect(incidentLead.status).toBe(403);

    const selfLink = await request(app)
      .patch(`/api/v1/employees/${selfLinkTargetId}/account`)
      .set(authHeaders(tokens.hybridConfirmer))
      .send({ userId: userIds.hybridConfirmer, revisionVersion: 1 });
    expect(selfLink.status).toBe(403);

    const afterRejectedAudit = await migrationPool.query(
      `SELECT count(*)::int AS count FROM audit_logs
       WHERE tenant_id=$1 AND action_type='employee.account_linked'`,
      [tenantId]
    );
    expect(afterRejectedAudit.rows[0].count).toBe(beforeAudit.rows[0].count);

    const authorized = await request(app)
      .patch(`/api/v1/employees/${mappingTargetId}/account`)
      .set(authHeaders(tokens.identityAdmin))
      .send({ userId: userIds.outsider, revisionVersion: 1 });
    expect(authorized.status).toBe(200);
    expect(authorized.body.data.account_user_id).toBe(userIds.outsider);

    const duplicate = await request(app)
      .patch(`/api/v1/employees/${duplicateTargetId}/account`)
      .set(authHeaders(tokens.identityAdmin))
      .send({ userId: userIds.outsider, revisionVersion: 1 });
    expect(duplicate.status).toBe(409);
    const current = await migrationPool.query(
      'SELECT account_user_id FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
      [tenantId, [mappingTargetId, duplicateTargetId]]
    );
    expect(current.rows.filter(row => row.account_user_id === userIds.outsider)).toHaveLength(1);
    const afterAuthorizedAudit = await migrationPool.query(
      `SELECT count(*)::int AS count FROM audit_logs
       WHERE tenant_id=$1 AND action_type='employee.account_linked'`,
      [tenantId]
    );
    expect(afterAuthorizedAudit.rows[0].count).toBe(beforeAudit.rows[0].count + 1);
  });

  test('a different authorized actor cannot reuse another participant’s confirmation mutation ID', async () => {
    const handoverId = await createHandover();
    await migrationPool.query(
      `INSERT INTO handover_participants (tenant_id,handover_id,employee_id,participant_role)
       VALUES ($1,$2,$3,'handover')`,
      [tenantId, handoverId, employeeIds[5]]
    );
    const clientMutationId = `foreign-${randomUUID()}`;
    const capturedAt = new Date().toISOString();
    const first = await request(app)
      .post(`/api/v1/handovers/${handoverId}/confirm`)
      .set(authHeaders(tokens.outgoing))
      .send({ clientMutationId, expectedRevisionVersion: 1, capturedAt });
    expect(first.status).toBe(200);

    const foreignReplay = await request(app)
      .post(`/api/v1/handovers/${handoverId}/confirm`)
      .set(authHeaders(tokens.otherOutgoing))
      .send({ clientMutationId, expectedRevisionVersion: 1, capturedAt });
    expect(foreignReplay.status).toBe(409);
    expect(await historyCounts(handoverId)).toEqual({
      confirmations: 1, events: 2, confirmed: 1, acknowledged: 0
    });
  });

  test('a stale handover revision is rejected without appending history', async () => {
    const handoverId = await createHandover(2);
    const stale = await request(app)
      .patch(`/api/v1/handovers/${handoverId}`)
      .set(authHeaders(tokens.incidentLead))
      .send({ expectedVersion: 1, generalText: 'Stale content must not be stored.' });
    expect(stale.status).toBe(409);
    expect(await historyCounts(handoverId)).toEqual({
      confirmations: 0, events: 1, confirmed: 0, acknowledged: 0
    });
    const current = await migrationPool.query(
      'SELECT general_text,revision_version FROM handovers WHERE tenant_id=$1 AND id=$2',
      [tenantId, handoverId]
    );
    expect(current.rows[0]).toMatchObject({ general_text: '', revision_version: 2 });
  });

  test('a stale new confirmation is rejected before recording a receipt or event', async () => {
    const handoverId = await createHandover(2);
    const stale = await request(app)
      .post(`/api/v1/handovers/${handoverId}/confirm`)
      .set(authHeaders(tokens.outgoing))
      .send({
        clientMutationId: `stale-new-${randomUUID()}`,
        expectedRevisionVersion: 1,
        capturedAt: new Date().toISOString()
      });

    expect(stale.status).toBe(409);
    expect(await historyCounts(handoverId)).toEqual({
      confirmations: 0, events: 1, confirmed: 0, acknowledged: 0
    });
  });

  test('a stale confirmation replay is rejected before returning the prior receipt', async () => {
    const handoverId = await createHandover(2, new Date().toISOString(), 'pending_takeover_acknowledgement');
    const clientMutationId = `stale-replay-${randomUUID()}`;
    const capturedAt = new Date().toISOString();
    const payloadHash = computePayloadHash({
      actorUserId: userIds.outgoing,
      action: 'handover',
      handoverId,
      revisionVersion: 2,
      expectedRevisionVersion: 1,
      capturedAt
    });
    const confirmation = await migrationPool.query(
      `INSERT INTO handover_confirmations
         (tenant_id,handover_id,employee_id,actor_user_id,confirmation_type,revision_version,
          client_mutation_id,captured_at,payload_hash)
      VALUES ($1,$2,$3,$4,'handover',2,$5,$6,$7)
       RETURNING id`,
      [tenantId, handoverId, employeeIds[0], userIds.outgoing, clientMutationId, capturedAt, payloadHash]
    );
    await migrationPool.query(
      `INSERT INTO handover_events (tenant_id,handover_id,actor_user_id,action,details)
       VALUES ($1,$2,$3,'confirmed',$4::jsonb)`,
      [tenantId, handoverId, userIds.outgoing, JSON.stringify({ confirmationId: confirmation.rows[0].id, revisionVersion: 2 })]
    );

    const staleReplay = await request(app)
      .post(`/api/v1/handovers/${handoverId}/confirm`)
      .set(authHeaders(tokens.outgoing))
      .send({ clientMutationId, expectedRevisionVersion: 1, capturedAt });

    expect(staleReplay.status).toBe(409);
    expect(await historyCounts(handoverId)).toEqual({
      confirmations: 1, events: 2, confirmed: 1, acknowledged: 0
    });
  });

  test('concurrent authorized retries persist one confirmation and unauthorized attempts append no history', async () => {
    const handoverId = await createHandover();
    const body = {
      clientMutationId: `parallel-${randomUUID()}`,
      expectedRevisionVersion: 1,
      capturedAt: new Date().toISOString()
    };
    const [first, retry, unauthorized] = await Promise.all([
      request(app).post(`/api/v1/handovers/${handoverId}/confirm`).set(authHeaders(tokens.outgoing)).send(body),
      request(app).post(`/api/v1/handovers/${handoverId}/confirm`).set(authHeaders(tokens.outgoing)).send(body),
      request(app).post(`/api/v1/handovers/${handoverId}/confirm`).set(authHeaders(tokens.hybridConfirmer)).send(body)
    ]);

    expect([first.status, retry.status, unauthorized.status]).toEqual([200, 200, 403]);
    expect([first.body.data.repeated, retry.body.data.repeated].sort()).toEqual([false, true]);
    expect(unauthorized.body.success).toBe(false);
    expect(await historyCounts(handoverId)).toEqual({
      confirmations: 1, events: 2, confirmed: 1, acknowledged: 0
    });
  });

  test('earlier open tasks carry forward, but tasks from a later handover do not appear on an earlier one', async () => {
    const previousHandover = await createHandover(1, '2026-01-01T08:00:00.000Z');
    const selectedHandover = await createHandover(1, '2026-01-01T09:00:00.000Z');
    const laterHandover = await createHandover(1, '2026-01-01T10:00:00.000Z');
    const previousTask = await migrationPool.query(
      `INSERT INTO handover_tasks
         (tenant_id,site_id,origin_handover_id,title,assigned_employee_id,created_by_user_id)
       VALUES ($1,$2,$3,'Earlier carried task',$4,$5) RETURNING id`,
      [tenantId, siteId, previousHandover, employeeIds[0], userIds.identityAdmin]
    );
    const laterTask = await migrationPool.query(
      `INSERT INTO handover_tasks
         (tenant_id,site_id,origin_handover_id,title,assigned_employee_id,created_by_user_id)
       VALUES ($1,$2,$3,'Later-origin task',$4,$5) RETURNING id`,
      [tenantId, siteId, laterHandover, employeeIds[0], userIds.identityAdmin]
    );

    const response = await request(app)
      .get(`/api/v1/handovers/${selectedHandover}/tasks`)
      .set(authHeaders(tokens.outgoing));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ id: previousTask.rows[0].id, carried_forward: true })
    ]);
    expect(response.body.data.some((task: { id: string }) => task.id === laterTask.rows[0].id)).toBe(false);
  });
});
