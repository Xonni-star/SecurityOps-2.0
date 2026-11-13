import { NextFunction, Request, Response } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import {
  createHandover,
  createHandoverTask,
  handoverCreateSchema,
  handoverTaskCreateSchema,
  handoverTaskUpdateSchema,
  handoverUpdateSchema,
  HandoverConflictError,
  updateHandoverTask
} from '../services/handoverService';
import { computePayloadHash } from '../services/syncHash';

const uuid = z.string().uuid();
const confirmationSchema = z.object({
  clientMutationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  expectedRevisionVersion: z.number().int().positive(),
  capturedAt: z.string().datetime({ offset: true }).optional()
}).strict();
const noteSchema = z.object({
  text: z.string().trim().min(1).max(5000)
}).strict();
const documentLinkSchema = z.object({ documentId: uuid }).strict();
const listQuerySchema = z.object({
  siteId: uuid.optional(),
  employeeId: uuid.optional(),
  status: z.enum(['pending_handover_confirmation', 'pending_takeover_acknowledgement', 'completed']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().max(200).optional(),
  openTasks: z.enum(['true', 'false']).optional(),
  pendingConfirmation: z.enum(['true', 'false']).optional(),
  sort: z.enum(['occurred_at_desc', 'occurred_at_asc']).default('occurred_at_desc'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strict().superRefine((query, ctx) => {
  if (query.from && query.to && query.from > query.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Das Enddatum darf nicht vor dem Startdatum liegen.' });
  }
});

function statusError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function writeEvent(
  db: PoolClient, tenantId: string, handoverId: string, actorUserId: string,
  action: string, details: Record<string, unknown> = {}
): Promise<unknown> {
  return db.query(
    `INSERT INTO handover_events (tenant_id, handover_id, actor_user_id, action, details)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId, handoverId, actorUserId, action, JSON.stringify(details)]
  );
}

function handoverSelect(): string {
  return `SELECT h.id, h.tenant_id, h.site_id, s.name AS site_name, h.area, h.shift_id,
                 h.occurred_at, h.general_text, h.incidents, h.important_notes,
                 h.safety_information, h.status, h.revision_version, h.client_mutation_id,
                 h.client_captured_at, h.server_received_at, h.created_at, h.updated_at,
                 h.created_by_user_id, concat(creator.first_name, ' ', creator.last_name) AS created_by_name,
                 outgoing.employee_id AS outgoing_employee_id,
                 concat(outgoing_employee.first_name, ' ', outgoing_employee.last_name) AS outgoing_employee_name,
                 incoming.employee_id AS incoming_employee_id,
                 concat(incoming_employee.first_name, ' ', incoming_employee.last_name) AS incoming_employee_name,
                 (SELECT count(*)::int FROM handover_tasks t
                    WHERE t.tenant_id=h.tenant_id AND t.site_id=h.site_id
                      AND t.status IN ('open','in_progress')) AS open_tasks_count,
                 (SELECT count(*)::int FROM handover_tasks t
                    WHERE t.tenant_id=h.tenant_id AND t.origin_handover_id=h.id) AS created_tasks_count,
                 (SELECT count(*)::int FROM handover_documents d
                    WHERE d.tenant_id=h.tenant_id AND d.handover_id=h.id) AS document_count
          FROM handovers h
          JOIN sites s ON s.id=h.site_id AND s.tenant_id=h.tenant_id
          JOIN users creator ON creator.id=h.created_by_user_id
          LEFT JOIN handover_participants outgoing
            ON outgoing.tenant_id=h.tenant_id AND outgoing.handover_id=h.id AND outgoing.participant_role='handover'
          LEFT JOIN employees outgoing_employee
            ON outgoing_employee.id=outgoing.employee_id AND outgoing_employee.tenant_id=h.tenant_id
          LEFT JOIN handover_participants incoming
            ON incoming.tenant_id=h.tenant_id AND incoming.handover_id=h.id AND incoming.participant_role='takeover'
          LEFT JOIN employees incoming_employee
            ON incoming_employee.id=incoming.employee_id AND incoming_employee.tenant_id=h.tenant_id`;
}

function mapHandoverRow(row: Record<string, any>): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    siteName: row.site_name,
    area: row.area,
    shiftId: row.shift_id,
    occurredAt: row.occurred_at,
    generalText: row.general_text,
    incidents: row.incidents,
    importantNotes: row.important_notes,
    safetyInformation: row.safety_information,
    status: row.status,
    revisionVersion: Number(row.revision_version),
    clientMutationId: row.client_mutation_id,
    clientCapturedAt: row.client_captured_at,
    serverReceivedAt: row.server_received_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    outgoingEmployeeId: row.outgoing_employee_id,
    outgoingEmployeeName: row.outgoing_employee_name,
    incomingEmployeeId: row.incoming_employee_id,
    incomingEmployeeName: row.incoming_employee_name,
    openTasksCount: Number(row.open_tasks_count || 0),
    createdTasksCount: Number(row.created_tasks_count || 0),
    documentCount: Number(row.document_count || 0)
  };
}

export async function listHandovers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filter = listQuerySchema.parse(req.query);
    const { tenantId } = req.user!;
    const result = await withTenantTransaction(tenantId, async db => {
      const values: unknown[] = [tenantId];
      const conditions = ['h.tenant_id=$1'];
      const addCondition = (sql: string, value: unknown) => {
        values.push(value);
        conditions.push(sql.replace('?', `$${values.length}`));
      };
      if (filter.siteId) addCondition('h.site_id=?', filter.siteId);
      if (filter.status) addCondition('h.status=?', filter.status);
      if (filter.from) addCondition('h.occurred_at >= ?::date', filter.from);
      if (filter.to) addCondition("h.occurred_at < (?::date + INTERVAL '1 day')", filter.to);
      if (filter.employeeId) {
        addCondition(`EXISTS (SELECT 1 FROM handover_participants hp
          WHERE hp.tenant_id=h.tenant_id AND hp.handover_id=h.id AND hp.employee_id=?)`, filter.employeeId);
      }
      if (filter.search) {
        values.push(`%${filter.search}%`);
        conditions.push(`(s.name ILIKE $${values.length} OR COALESCE(h.area,'') ILIKE $${values.length}
          OR COALESCE(h.general_text,'') ILIKE $${values.length} OR COALESCE(h.incidents,'') ILIKE $${values.length}
          OR EXISTS (SELECT 1 FROM handover_participants hp JOIN employees e
            ON e.id=hp.employee_id AND e.tenant_id=hp.tenant_id
            WHERE hp.tenant_id=h.tenant_id AND hp.handover_id=h.id
              AND concat(e.first_name,' ',e.last_name) ILIKE $${values.length}))`);
      }
      if (filter.openTasks === 'true') {
        conditions.push(`EXISTS (SELECT 1 FROM handover_tasks t WHERE t.tenant_id=h.tenant_id
          AND t.site_id=h.site_id AND t.status IN ('open','in_progress'))`);
      } else if (filter.openTasks === 'false') {
        conditions.push(`NOT EXISTS (SELECT 1 FROM handover_tasks t WHERE t.tenant_id=h.tenant_id
          AND t.site_id=h.site_id AND t.status IN ('open','in_progress'))`);
      }
      if (filter.pendingConfirmation === 'true') {
        conditions.push("h.status IN ('pending_handover_confirmation','pending_takeover_acknowledgement')");
      } else if (filter.pendingConfirmation === 'false') {
        conditions.push("h.status='completed'");
      }
      const where = conditions.join(' AND ');
      const count = await db.query(`SELECT count(*)::int AS total FROM handovers h
        JOIN sites s ON s.id=h.site_id AND s.tenant_id=h.tenant_id WHERE ${where}`, values);
      const order = filter.sort === 'occurred_at_asc' ? 'ASC' : 'DESC';
      values.push(filter.limit, filter.offset);
      const items = await db.query(
        `${handoverSelect()} WHERE ${where} ORDER BY h.occurred_at ${order}, h.id ${order}
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );
      return { items: items.rows.map(mapHandoverRow), total: count.rows[0].total };
    });
    res.json({ success: true, data: { ...result, limit: filter.limit, offset: filter.offset } });
  } catch (error) {
    next(error);
  }
}

export async function getHandoverDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const siteId = req.query.siteId ? uuid.parse(req.query.siteId) : null;
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const values = [req.user!.tenantId, siteId];
      const result = await db.query(
        `SELECT
           count(*) FILTER (WHERE h.occurred_at >= date_trunc('day',CURRENT_TIMESTAMP)
             AND h.occurred_at < date_trunc('day',CURRENT_TIMESTAMP) + INTERVAL '1 day')::int AS today,
           count(*) FILTER (WHERE h.status='pending_handover_confirmation')::int AS waiting_handover_confirmation,
           count(*) FILTER (WHERE h.status='pending_takeover_acknowledgement')::int AS waiting_takeover_acknowledgement,
           count(*) FILTER (WHERE h.status IN ('pending_handover_confirmation','pending_takeover_acknowledgement'))::int AS open_handovers
         FROM handovers h
         WHERE h.tenant_id=$1 AND ($2::uuid IS NULL OR h.site_id=$2)`,
        values
      );
      const tasks = await db.query(
        `SELECT count(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open_tasks,
                count(*) FILTER (WHERE status IN ('open','in_progress') AND due_at < CURRENT_TIMESTAMP)::int AS overdue_tasks
         FROM handover_tasks WHERE tenant_id=$1 AND ($2::uuid IS NULL OR site_id=$2)`,
        values
      );
      return { ...result.rows[0], ...tasks.rows[0] };
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getHandover(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const result = await withTenantTransaction(req.user!.tenantId, async db => {
      const handover = await db.query(
        `${handoverSelect()} WHERE h.tenant_id=$1 AND h.id=$2`,
        [req.user!.tenantId, handoverId]
      );
      if (!handover.rows.length) throw statusError(404, 'Übergabe nicht gefunden.');
      const participants = await db.query(
        `SELECT hp.employee_id, concat(e.first_name,' ',e.last_name) AS employee_name,
                hp.participant_role, hp.created_at
         FROM handover_participants hp JOIN employees e
           ON e.id=hp.employee_id AND e.tenant_id=hp.tenant_id
         WHERE hp.tenant_id=$1 AND hp.handover_id=$2 ORDER BY hp.participant_role`,
        [req.user!.tenantId, handoverId]
      );
      return { ...mapHandoverRow(handover.rows[0]), participants: participants.rows };
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function createHandoverEndpoint(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = handoverCreateSchema.parse(req.body);
    const result = await withTenantTransaction(req.user!.tenantId, db =>
      createHandover(db, req.user!.tenantId, req.user!.userId, input)
    );
    res.status(result.created ? 201 : 200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function updateHandover(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const input = handoverUpdateSchema.parse(req.body);
    const { tenantId, userId } = req.user!;
    const result = await withTenantTransaction(tenantId, async db => {
      const current = await db.query(
        'SELECT * FROM handovers WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenantId, handoverId]
      );
      if (!current.rows.length) throw statusError(404, 'Übergabe nicht gefunden.');
      const row = current.rows[0];
      if (row.status !== 'pending_handover_confirmation') {
        throw statusError(409, 'Nach der ersten Bestätigung ist der Inhalt gesperrt. Erfassen Sie eine nachvollziehbare Korrektur.');
      }
      if (Number(row.revision_version) !== input.expectedVersion) {
        throw statusError(409, 'Die Übergabe wurde zwischenzeitlich geändert. Bitte aktualisieren und erneut versuchen.');
      }
      if (input.shiftId) {
        const shift = await db.query(
          'SELECT 1 FROM shifts WHERE tenant_id=$1 AND id=$2 AND site_id=$3',
          [tenantId, input.shiftId, row.site_id]
        );
        if (!shift.rows.length) throw statusError(400, 'Der ausgewählte Dienst gehört nicht zum Übergabeobjekt.');
      }
      const update = await db.query(
        `UPDATE handovers SET area=$1, shift_id=$2, occurred_at=$3, general_text=$4,
           incidents=$5, important_notes=$6, safety_information=$7,
           revision_version=revision_version+1, updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$8 AND id=$9 AND revision_version=$10
         RETURNING id, revision_version, updated_at`,
        [
          input.area === undefined ? row.area : input.area,
          input.shiftId === undefined ? row.shift_id : input.shiftId,
          input.occurredAt ?? row.occurred_at,
          input.generalText ?? row.general_text,
          input.incidents ?? row.incidents,
          input.importantNotes ?? row.important_notes,
          input.safetyInformation ?? row.safety_information,
          tenantId, handoverId, input.expectedVersion
        ]
      );
      if (!update.rows.length) throw statusError(409, 'Die Übergabe wurde zwischenzeitlich geändert.');
      await writeEvent(db, tenantId, handoverId, userId, 'updated', {
        revisionVersion: update.rows[0].revision_version,
        changedFields: Object.keys(input).filter(key => key !== 'expectedVersion')
      });
      return update.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

async function recordConfirmation(
  req: Request, res: Response, next: NextFunction, confirmationType: 'handover' | 'takeover'
): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const input = confirmationSchema.parse(req.body);
    const { tenantId, userId } = req.user!;
    const result = await withTenantTransaction(tenantId, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:handover-confirmation:${input.clientMutationId}`]);

      const handover = await db.query(
        'SELECT id, status, revision_version FROM handovers WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenantId, handoverId]
      );
      if (!handover.rows.length) throw statusError(404, 'Übergabe nicht gefunden.');
      const row = handover.rows[0];
      const participantRole = confirmationType === 'handover' ? 'handover' : 'takeover';
      const expectedStatus = confirmationType === 'handover'
        ? 'pending_handover_confirmation'
        : 'pending_takeover_acknowledgement';
      const participant = await db.query(
        `SELECT hp.employee_id FROM handover_participants hp
         JOIN employees e ON e.id=hp.employee_id AND e.tenant_id=hp.tenant_id
         WHERE hp.tenant_id=$1 AND hp.handover_id=$2 AND hp.participant_role=$3
           AND e.account_user_id=$4`,
        [tenantId, handoverId, participantRole, userId]
      );
      if (!participant.rows.length) {
        throw statusError(403, 'Nur die dem Teilnehmerkonto zugeordnete übergebende beziehungsweise übernehmende Person kann bestätigen.');
      }

      const revisionVersion = Number(row.revision_version);
      if (input.expectedRevisionVersion !== revisionVersion) {
        throw statusError(409, 'Die Übergabe wurde zwischenzeitlich geändert. Bitte aktualisieren und erneut bestätigen.');
      }
      const payloadHash = computePayloadHash({
        actorUserId: userId,
        action: confirmationType,
        handoverId,
        revisionVersion,
        expectedRevisionVersion: input.expectedRevisionVersion,
        capturedAt: input.capturedAt ?? null
      });
      const priorMutation = await db.query(
        `SELECT id, handover_id, employee_id, actor_user_id, confirmation_type,
                revision_version, payload_hash
         FROM handover_confirmations WHERE tenant_id=$1 AND client_mutation_id=$2`,
        [tenantId, input.clientMutationId]
      );
      if (priorMutation.rows.length) {
        const prior = priorMutation.rows[0];
        if (
          prior.handover_id !== handoverId ||
          prior.employee_id !== participant.rows[0].employee_id ||
          prior.actor_user_id !== userId ||
          prior.confirmation_type !== confirmationType ||
          Number(prior.revision_version) !== revisionVersion ||
          prior.payload_hash !== payloadHash
        ) {
          throw statusError(409, 'Die Bestätigungs-ID wurde mit einem anderen Konto, Vorgang, Revisionsstand oder Inhalt verwendet.');
        }
        return { id: prior.id, revisionVersion: prior.revision_version, repeated: true };
      }

      const existing = await db.query(
        `SELECT id FROM handover_confirmations
         WHERE tenant_id=$1 AND handover_id=$2 AND revision_version=$3 AND confirmation_type=$4`,
        [tenantId, handoverId, revisionVersion, confirmationType]
      );
      if (existing.rows.length) {
        throw statusError(409, 'Diese Bestätigung wurde bereits mit einer anderen Mutations-ID gespeichert.');
      }
      if (row.status !== expectedStatus) {
        throw statusError(409, 'Die Übergabe befindet sich nicht im erwarteten Bestätigungsstatus.');
      }

      const confirmation = await db.query(
        `INSERT INTO handover_confirmations
          (tenant_id,handover_id,employee_id,actor_user_id,confirmation_type,revision_version,
           client_mutation_id,captured_at,payload_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, revision_version, captured_at, server_received_at`,
        [
          tenantId, handoverId, participant.rows[0].employee_id, userId, confirmationType,
          revisionVersion, input.clientMutationId, input.capturedAt || new Date().toISOString(), payloadHash
        ]
      );
      const nextStatus = confirmationType === 'handover'
        ? 'pending_takeover_acknowledgement'
        : 'completed';
      await db.query(
        `UPDATE handovers SET status=$1, updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$2 AND id=$3`,
        [nextStatus, tenantId, handoverId]
      );
      await writeEvent(db, tenantId, handoverId, userId, confirmationType === 'handover' ? 'confirmed' : 'acknowledged', {
        confirmationId: confirmation.rows[0].id,
        revisionVersion: row.revision_version,
        capturedAt: confirmation.rows[0].captured_at,
        serverReceivedAt: confirmation.rows[0].server_received_at
      });
      return { ...confirmation.rows[0], status: nextStatus, repeated: false };
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export function confirmHandover(req: Request, res: Response, next: NextFunction): Promise<void> {
  return recordConfirmation(req, res, next, 'handover');
}

export function acknowledgeHandover(req: Request, res: Response, next: NextFunction): Promise<void> {
  return recordConfirmation(req, res, next, 'takeover');
}

async function addHandoverNote(
  req: Request, res: Response, next: NextFunction, action: 'question_added' | 'correction_added'
): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const { text } = noteSchema.parse(req.body);
    const result = await withTenantTransaction(req.user!.tenantId, async db => {
      const exists = await db.query('SELECT 1 FROM handovers WHERE tenant_id=$1 AND id=$2', [req.user!.tenantId, handoverId]);
      if (!exists.rows.length) throw statusError(404, 'Übergabe nicht gefunden.');
      await writeEvent(db, req.user!.tenantId, handoverId, req.user!.userId, action, { text });
      return { handoverId, action, recordedAt: new Date().toISOString() };
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export function addHandoverQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
  return addHandoverNote(req, res, next, 'question_added');
}

export function addHandoverCorrection(req: Request, res: Response, next: NextFunction): Promise<void> {
  return addHandoverNote(req, res, next, 'correction_added');
}

export async function listHandoverEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    const offset = z.coerce.number().int().min(0).default(0).parse(req.query.offset);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const exists = await db.query('SELECT 1 FROM handovers WHERE tenant_id=$1 AND id=$2', [req.user!.tenantId, handoverId]);
      if (!exists.rows.length) throw statusError(404, 'Übergabe nicht gefunden.');
      const result = await db.query(
        `SELECT ev.id, ev.action, ev.details, ev.occurred_at, ev.actor_user_id,
                concat(u.first_name,' ',u.last_name) AS actor_name
         FROM handover_events ev JOIN users u ON u.id=ev.actor_user_id
         WHERE ev.tenant_id=$1 AND ev.handover_id=$2
         ORDER BY ev.occurred_at DESC, ev.id DESC LIMIT $3 OFFSET $4`,
        [req.user!.tenantId, handoverId, limit, offset]
      );
      return result.rows;
    });
    res.json({ success: true, data: { items: data, limit, offset } });
  } catch (error) {
    next(error);
  }
}

export async function listHandoverTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const handover = await db.query(
        'SELECT site_id, occurred_at, created_at FROM handovers WHERE tenant_id=$1 AND id=$2',
        [req.user!.tenantId, handoverId]
      );
      if (!handover.rows.length) throw statusError(404, 'Übergabe nicht gefunden.');
      const result = await db.query(
        `SELECT t.*, concat(e.first_name,' ',e.last_name) AS assigned_employee_name,
                concat(creator.first_name,' ',creator.last_name) AS created_by_name,
                t.origin_handover_id <> $3 AS carried_forward
         FROM handover_tasks t
         JOIN employees e ON e.id=t.assigned_employee_id AND e.tenant_id=t.tenant_id
         JOIN users creator ON creator.id=t.created_by_user_id
         JOIN handovers origin ON origin.id=t.origin_handover_id AND origin.tenant_id=t.tenant_id
         WHERE t.tenant_id=$1 AND t.site_id=$2
           AND (t.origin_handover_id=$3 OR (
             t.status IN ('open','in_progress')
             AND (origin.occurred_at, origin.created_at, origin.id)
                 <= ($4::timestamptz, $5::timestamptz, $3::uuid)
           ))
         ORDER BY CASE WHEN t.status IN ('open','in_progress') THEN 0 ELSE 1 END,
                  t.due_at NULLS LAST, t.created_at DESC`,
        [req.user!.tenantId, handover.rows[0].site_id, handoverId,
          handover.rows[0].occurred_at, handover.rows[0].created_at]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function createHandoverTaskEndpoint(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const input = handoverTaskCreateSchema.parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, db =>
      createHandoverTask(db, req.user!.tenantId, req.user!.userId, handoverId, input)
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function updateHandoverTaskEndpoint(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const taskId = uuid.parse(req.params.id);
    const input = handoverTaskUpdateSchema.parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, db =>
      updateHandoverTask(db, req.user!.tenantId, req.user!.userId, taskId, input)
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function linkHandoverDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const { documentId } = documentLinkSchema.parse(req.body);
    const { tenantId, userId } = req.user!;
    const data = await withTenantTransaction(tenantId, async db => {
      const handover = await db.query(
        'SELECT id FROM handovers WHERE tenant_id=$1 AND id=$2',
        [tenantId, handoverId]
      );
      if (!handover.rows.length) throw statusError(404, 'Übergabe nicht gefunden.');
      const document = await db.query(
        'SELECT id,title FROM documents WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL',
        [tenantId, documentId]
      );
      if (!document.rows.length) throw statusError(404, 'DMS-Dokument nicht gefunden.');
      const linked = await db.query(
        `INSERT INTO handover_documents (tenant_id,handover_id,document_id,linked_by_user_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,handover_id,document_id) DO NOTHING
         RETURNING tenant_id`,
        [tenantId, handoverId, documentId, userId]
      );
      if (linked.rows.length) {
        await writeEvent(db, tenantId, handoverId, userId, 'document_linked', {
          documentId, title: document.rows[0].title
        });
      }
      return { documentId, title: document.rows[0].title, alreadyLinked: !linked.rows.length };
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function listHandoverDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const handoverId = uuid.parse(req.params.id);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT d.id,d.title,d.description,d.category_id,d.mime_type,d.size_bytes,
                hd.linked_by_user_id,hd.linked_at
         FROM handover_documents hd
         JOIN handovers h ON h.id=hd.handover_id AND h.tenant_id=hd.tenant_id
         JOIN documents d ON d.id=hd.document_id AND d.tenant_id=hd.tenant_id
         WHERE hd.tenant_id=$1 AND hd.handover_id=$2 AND d.archived_at IS NULL
         ORDER BY hd.linked_at DESC`,
        [req.user!.tenantId, handoverId]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export function isHandoverConflict(error: unknown): error is HandoverConflictError {
  return error instanceof HandoverConflictError;
}

