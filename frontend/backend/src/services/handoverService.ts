import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { computePayloadHash } from './syncHash';

const uuid = z.string().uuid();
const taskSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(8000).default(''),
  assignedEmployeeId: uuid,
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  clientMutationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional()
}).strict();

export const handoverCreateSchema = z.object({
  siteId: uuid,
  area: z.string().trim().max(150).nullable().optional(),
  shiftId: uuid.nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
  outgoingEmployeeId: uuid,
  incomingEmployeeId: uuid,
  generalText: z.string().max(10000).default(''),
  incidents: z.string().max(10000).default(''),
  importantNotes: z.string().max(10000).default(''),
  safetyInformation: z.string().max(10000).default(''),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  clientMutationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  tasks: z.array(taskSchema).max(30).default([])
}).strict().superRefine((value, ctx) => {
  if (value.outgoingEmployeeId === value.incomingEmployeeId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['incomingEmployeeId'], message: 'Übergebende und übernehmende Person müssen verschieden sein.' });
  }
});

export const handoverUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  area: z.string().trim().max(150).nullable().optional(),
  shiftId: uuid.nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  generalText: z.string().max(10000).optional(),
  incidents: z.string().max(10000).optional(),
  importantNotes: z.string().max(10000).optional(),
  safetyInformation: z.string().max(10000).optional()
}).strict().refine(value => Object.keys(value).some(key => key !== 'expectedVersion'), {
  message: 'Mindestens ein Übergabefeld muss geändert werden.'
});

export const handoverTaskCreateSchema = taskSchema.omit({ clientMutationId: true }).strict();
export const handoverTaskUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(8000).optional(),
  assignedEmployeeId: uuid.optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional()
}).strict().refine(value => Object.keys(value).some(key => key !== 'expectedVersion'), {
  message: 'Mindestens ein Aufgabenfeld muss geändert werden.'
});

export type HandoverCreateInput = z.infer<typeof handoverCreateSchema>;
export type HandoverTaskCreateInput = z.infer<typeof handoverTaskCreateSchema>;

export class HandoverConflictError extends Error {
  statusCode = 409;
  serverVersion: number;
  serverPayload: Record<string, unknown>;

  constructor(serverVersion: number, serverPayload: Record<string, unknown>) {
    super('Diese Client-ID wurde bereits für einen anderen Übergabeinhalt verwendet.');
    this.name = 'HandoverConflictError';
    this.serverVersion = serverVersion;
    this.serverPayload = serverPayload;
  }
}

function statusError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function normalizedPayload(input: HandoverCreateInput): Record<string, unknown> {
  const { clientMutationId: _clientMutationId, capturedAt: _capturedAt, ...payload } = input;
  return payload;
}

async function writeHandoverEvent(
  db: PoolClient, tenantId: string, handoverId: string, actorUserId: string,
  action: string, details: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO handover_events (tenant_id, handover_id, actor_user_id, action, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, handoverId, actorUserId, action, JSON.stringify(details)]
  );
}

export async function createHandover(
  db: PoolClient,
  tenantId: string,
  actorUserId: string,
  input: HandoverCreateInput
): Promise<{ id: string; created: boolean; revisionVersion: number }> {
  const payload = normalizedPayload(input);
  const payloadHash = computePayloadHash(payload);
  const capturedAt = input.capturedAt || input.occurredAt;

  const refs = await db.query(
    `SELECT s.id,
            EXISTS (SELECT 1 FROM employees e WHERE e.id=$3 AND e.tenant_id=$1) AS outgoing_exists,
            EXISTS (SELECT 1 FROM employees e WHERE e.id=$4 AND e.tenant_id=$1) AS incoming_exists,
            ($5::uuid IS NULL OR EXISTS (
              SELECT 1 FROM shifts sh WHERE sh.id=$5 AND sh.tenant_id=$1 AND sh.site_id=s.id
            )) AS shift_matches_site
     FROM sites s WHERE s.tenant_id=$1 AND s.id=$2`,
    [tenantId, input.siteId, input.outgoingEmployeeId, input.incomingEmployeeId, input.shiftId || null]
  );
  if (!refs.rows.length) throw statusError(404, 'Objekt nicht gefunden.');
  if (!refs.rows[0].outgoing_exists || !refs.rows[0].incoming_exists) {
    throw statusError(404, 'Eine beteiligte Person wurde im aktuellen Mandanten nicht gefunden.');
  }
  if (!refs.rows[0].shift_matches_site) throw statusError(400, 'Der ausgewählte Dienst gehört nicht zum gewählten Objekt.');

  const inserted = await db.query(
    `INSERT INTO handovers
       (tenant_id, site_id, area, shift_id, occurred_at, general_text, incidents,
        important_notes, safety_information, client_mutation_id, payload_hash,
        client_captured_at, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
     RETURNING id, revision_version`,
    [
      tenantId, input.siteId, input.area || null, input.shiftId || null, input.occurredAt,
      input.generalText, input.incidents, input.importantNotes, input.safetyInformation,
      input.clientMutationId, payloadHash, capturedAt, actorUserId
    ]
  );
  if (!inserted.rows.length) {
    const existing = await db.query(
      `SELECT id, revision_version, payload_hash, site_id, area, shift_id, occurred_at,
              general_text, incidents, important_notes, safety_information, status
       FROM handovers WHERE tenant_id=$1 AND client_mutation_id=$2`,
      [tenantId, input.clientMutationId]
    );
    const row = existing.rows[0];
    if (!row) throw statusError(409, 'Die Übergabe konnte nach einem Idempotenzkonflikt nicht geladen werden.');
    if (row.payload_hash !== payloadHash) {
      throw new HandoverConflictError(Number(row.revision_version), {
        id: row.id, siteId: row.site_id, area: row.area, shiftId: row.shift_id,
        occurredAt: row.occurred_at, generalText: row.general_text, incidents: row.incidents,
        importantNotes: row.important_notes, safetyInformation: row.safety_information, status: row.status
      });
    }
    return { id: row.id, created: false, revisionVersion: Number(row.revision_version) };
  }

  const handoverId = inserted.rows[0].id;
  for (const [employeeId, participantRole] of [
    [input.outgoingEmployeeId, 'handover'],
    [input.incomingEmployeeId, 'takeover']
  ]) {
    await db.query(
      `INSERT INTO handover_participants (tenant_id, handover_id, employee_id, participant_role)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, handoverId, employeeId, participantRole]
    );
  }
  await writeHandoverEvent(db, tenantId, handoverId, actorUserId, 'created', {
    revisionVersion: 1,
    clientCapturedAt: capturedAt,
    taskCount: input.tasks.length
  });

  for (const task of input.tasks) {
    await createTask(db, tenantId, actorUserId, handoverId, input.siteId, task, task.clientMutationId || cryptoId());
  }

  return { id: handoverId, created: true, revisionVersion: 1 };
}

function cryptoId(): string {
  return randomUUID();
}

async function createTask(
  db: PoolClient, tenantId: string, actorUserId: string, handoverId: string, siteId: string,
  input: HandoverTaskCreateInput, clientMutationId: string
): Promise<any> {
  const assigned = await db.query(
    'SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2',
    [tenantId, input.assignedEmployeeId]
  );
  if (!assigned.rows.length) throw statusError(404, 'Zuständige Person wurde im aktuellen Mandanten nicht gefunden.');

  const result = await db.query(
    `INSERT INTO handover_tasks
       (tenant_id, site_id, origin_handover_id, title, description, assigned_employee_id,
        priority, due_at, client_mutation_id, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      tenantId, siteId, handoverId, input.title, input.description,
      input.assignedEmployeeId, input.priority, input.dueAt || null,
      clientMutationId, actorUserId
    ]
  );
  const task = result.rows[0];
  await db.query(
    `INSERT INTO handover_task_events (tenant_id, task_id, actor_user_id, action, details)
     VALUES ($1,$2,$3,'created',$4::jsonb)`,
    [tenantId, task.id, actorUserId, JSON.stringify({ status: task.status, priority: task.priority })]
  );
  await writeHandoverEvent(db, tenantId, handoverId, actorUserId, 'task_created', { taskId: task.id, title: task.title });
  return task;
}

export async function createHandoverTask(
  db: PoolClient, tenantId: string, actorUserId: string, handoverId: string,
  input: HandoverTaskCreateInput
): Promise<any> {
  const handover = await db.query(
    'SELECT id, site_id FROM handovers WHERE tenant_id=$1 AND id=$2',
    [tenantId, handoverId]
  );
  if (!handover.rows.length) throw statusError(404, 'Übergabe nicht gefunden.');
  return createTask(db, tenantId, actorUserId, handoverId, handover.rows[0].site_id, input, cryptoId());
}

export async function updateHandoverTask(
  db: PoolClient, tenantId: string, actorUserId: string, taskId: string,
  input: z.infer<typeof handoverTaskUpdateSchema>
): Promise<any> {
  const current = await db.query(
    'SELECT * FROM handover_tasks WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
    [tenantId, taskId]
  );
  if (!current.rows.length) throw statusError(404, 'Übergabeaufgabe nicht gefunden.');
  const task = current.rows[0];
  if (Number(task.revision_version) !== input.expectedVersion) {
    throw statusError(409, 'Die Aufgabe wurde zwischenzeitlich geändert. Bitte aktualisieren und erneut versuchen.');
  }

  const nextStatus = input.status ?? task.status;
  const completedAt = ['done', 'cancelled'].includes(nextStatus)
    ? (task.completed_at || new Date())
    : null;
  const updated = await db.query(
    `UPDATE handover_tasks SET title=$1, description=$2, assigned_employee_id=$3,
       priority=$4, due_at=$5, status=$6, revision_version=revision_version+1,
       updated_at=CURRENT_TIMESTAMP, completed_at=$7
     WHERE tenant_id=$8 AND id=$9 AND revision_version=$10
     RETURNING *`,
    [
      input.title ?? task.title, input.description ?? task.description,
      input.assignedEmployeeId ?? task.assigned_employee_id, input.priority ?? task.priority,
      input.dueAt === undefined ? task.due_at : input.dueAt,
      nextStatus, completedAt, tenantId, taskId, input.expectedVersion
    ]
  );
  if (!updated.rows.length) throw statusError(409, 'Die Aufgabe wurde zwischenzeitlich geändert.');
  const saved = updated.rows[0];
  await db.query(
    `INSERT INTO handover_task_events (tenant_id, task_id, actor_user_id, action, details)
     VALUES ($1,$2,$3,'updated',$4::jsonb)`,
    [tenantId, taskId, actorUserId, JSON.stringify({
      fromStatus: task.status, toStatus: saved.status, revisionVersion: saved.revision_version
    })]
  );
  await writeHandoverEvent(db, tenantId, task.origin_handover_id, actorUserId, 'task_updated', {
    taskId, status: saved.status, revisionVersion: saved.revision_version
  });
  return saved;
}
