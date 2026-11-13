import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import { computePayloadHash } from '../services/syncHash';
import { materializePatrolOccurrences } from '../services/patrolScheduleWorker';

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
type PatrolScanAttemptReason =
  | 'invalid_payload'
  | 'unassigned_employee'
  | 'round_unavailable'
  | 'unknown_checkpoint'
  | 'invalid_token'
  | 'stale_token'
  | 'duplicate_scan'
  | 'invalid_capture_time';

const listQueryBaseSchema = z.object({
  siteId: uuid.optional(),
  clientId: uuid.optional(),
  employeeId: uuid.optional(),
  routeId: uuid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  status: z.enum(['in_progress', 'completed', 'abandoned']).optional(),
  category: z.enum([
    'missed_checkpoint', 'late_checkpoint', 'missed_round', 'abandoned_round',
    'access_blocked', 'hazard', 'damage', 'other'
  ]).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

const listQuerySchema = listQueryBaseSchema.superRefine((query, ctx) => {
  if (query.from && query.to && query.from > query.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Das Enddatum darf nicht vor dem Startdatum liegen.' });
  }
});
const occurrenceQuerySchema = listQueryBaseSchema.extend({
  status: z.enum(['scheduled', 'in_progress', 'completed', 'missed', 'abandoned']).optional()
}).superRefine((query, ctx) => {
  if (query.from && query.to && query.from > query.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Das Enddatum darf nicht vor dem Startdatum liegen.' });
  }
});

const checkpointBaseSchema = z.object({
  siteId: uuid,
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(150),
  locationDetails: z.string().trim().max(2000).default(''),
  buildingName: z.string().trim().max(150).nullable().optional(),
  areaName: z.string().trim().max(150).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  requiredIntervalMinutes: z.number().int().min(1).max(1440).default(60)
}).strict();
const checkpointCoordinatesSchema = <T extends z.ZodTypeAny>(schema: T) => schema.superRefine((checkpoint: {
  latitude?: number | null;
  longitude?: number | null;
}, ctx: z.RefinementCtx) => {
  if ((checkpoint.latitude == null) !== (checkpoint.longitude == null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['latitude'], message: 'Breiten- und Längengrad müssen gemeinsam angegeben werden.' });
  }
});
const checkpointSchema = checkpointCoordinatesSchema(checkpointBaseSchema);
const checkpointUpdateSchema = checkpointCoordinatesSchema(checkpointBaseSchema.omit({ siteId: true }));

const routeBaseSchema = z.object({
  siteId: uuid,
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(150),
  changeReason: z.string().trim().min(1).max(500),
  flexibleOrder: z.boolean().default(false),
  targetDurationMinutes: z.number().int().min(1).max(10080).nullable().default(null),
  lateToleranceMinutes: z.number().int().min(0).max(1440).default(5),
  timeWindowStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  timeWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  scheduleTimezone: z.string().trim().min(1).max(64).default('UTC').refine(value => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Ungültige IANA-Zeitzone.'),
  recurrenceFrequency: z.enum(['none', 'daily', 'weekly']).default('none'),
  recurrenceInterval: z.number().int().min(1).max(365).default(1),
  recurrenceDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  employeeIds: z.array(uuid).max(200).default([]),
  employeeGroupIds: z.array(uuid).max(100).default([]),
  checkpoints: z.array(z.object({
    checkpointId: uuid,
    plannedOffsetMinutes: z.number().int().min(0).max(10080).default(0)
  }).strict()).min(1).max(100)
}).strict();

function validateUniqueRouteCheckpoints(
  route: {
    checkpoints: Array<{ checkpointId: string }>;
    timeWindowStart: string | null;
    timeWindowEnd: string | null;
    recurrenceFrequency: 'none' | 'daily' | 'weekly';
    recurrenceDays: number[];
    employeeIds: string[];
    employeeGroupIds: string[];
  },
  ctx: z.RefinementCtx
): void {
  if (new Set(route.checkpoints.map(item => item.checkpointId)).size !== route.checkpoints.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkpoints'], message: 'Ein Kontrollpunkt darf pro Routenversion nur einmal vorkommen.' });
  }
  if ((route.timeWindowStart === null) !== (route.timeWindowEnd === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timeWindowStart'], message: 'Start- und Endzeitfenster müssen gemeinsam angegeben werden.' });
  }
  if (new Set(route.recurrenceDays).size !== route.recurrenceDays.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recurrenceDays'], message: 'Wochentage dürfen nicht doppelt vorkommen.' });
  }
  if (route.recurrenceFrequency === 'weekly' && route.recurrenceDays.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recurrenceDays'], message: 'Wöchentliche Wiederholung benötigt mindestens einen Wochentag.' });
  }
  if (route.recurrenceFrequency !== 'weekly' && route.recurrenceDays.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recurrenceDays'], message: 'Wochentage sind nur bei wöchentlicher Wiederholung zulässig.' });
  }
  if (new Set(route.employeeIds).size !== route.employeeIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['employeeIds'], message: 'Mitarbeiter dürfen nicht doppelt zugeordnet werden.' });
  }
  if (new Set(route.employeeGroupIds).size !== route.employeeGroupIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['employeeGroupIds'], message: 'Mitarbeitergruppen dürfen nicht doppelt zugeordnet werden.' });
  }
}

const routeSchema = routeBaseSchema.superRefine(validateUniqueRouteCheckpoints);
const routeVersionSchema = routeBaseSchema.omit({ siteId: true, code: true }).superRefine(validateUniqueRouteCheckpoints);

const exceptionSchema = z.object({
  siteId: uuid,
  roundId: uuid.optional(),
  scanId: uuid.optional(),
  checkpointId: uuid.optional(),
  category: z.enum([
    'missed_checkpoint', 'late_checkpoint', 'missed_round', 'abandoned_round',
    'access_blocked', 'hazard', 'damage', 'other'
  ]),
  severity: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  description: z.string().trim().min(1).max(5000),
  clientMutationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  capturedAt: dateTime
}).strict();

const roundSchema = z.object({
  roundId: uuid.optional(),
  siteId: uuid,
  routeId: uuid.optional(),
  routeVersion: z.number().int().positive().optional(),
  startedAt: dateTime,
  clientMutationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/)
}).strict();
const roundCompletionSchema = z.object({
  roundId: uuid,
  completedAt: dateTime,
  notes: z.string().trim().max(2000).default('')
}).strict();

function automaticExceptionMutationId(roundId: string, checkpointId: string, category: string, description: string): string {
  const digest = crypto.createHash('sha256')
    .update(`${roundId}:${checkpointId}:${category}:${description}`, 'utf8')
    .digest('hex');
  return `auto_${digest.slice(0, 55)}`;
}

async function recordAutomaticPatrolException(
  db: PoolClient,
  tenantId: string,
  userId: string,
  input: {
    siteId: string;
    roundId: string;
    checkpointId: string;
    category: 'missed_checkpoint' | 'late_checkpoint';
    capturedAt: string;
    description: string;
  }
): Promise<void> {
  const payload = {
    siteId: input.siteId,
    roundId: input.roundId,
    checkpointId: input.checkpointId,
    category: input.category,
    severity: 'normal',
    description: input.description,
    capturedAt: input.capturedAt
  };
  await recordPatrolException(
    db,
    tenantId,
    userId,
    automaticExceptionMutationId(input.roundId, input.checkpointId, input.category, input.description),
    payload,
    input.capturedAt,
    computePayloadHash(payload)
  );
}

function statusError(
  statusCode: number,
  message: string,
  patrolScanAttemptCode?: PatrolScanAttemptReason
): Error & { statusCode: number; patrolScanAttemptCode?: string } {
  return Object.assign(new Error(message), { statusCode, patrolScanAttemptCode });
}

function createToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

async function writeEvent(
  db: PoolClient,
  tenantId: string,
  siteId: string | null,
  actorUserId: string,
  entityType: string,
  entityId: string,
  action: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO patrol_events (tenant_id, site_id, actor_user_id, entity_type, entity_id, action, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [tenantId, siteId, actorUserId, entityType, entityId, action, JSON.stringify(details)]
  );
}

export async function recordPatrolScan(
  db: PoolClient,
  tenantId: string,
  userId: string,
  clientMutationId: string,
  payload: Record<string, any>,
  clientTimestamp: string,
  payloadHash = computePayloadHash(payload)
): Promise<{ id: string; verificationStatus: 'verified' | 'manual' }> {
  const parsed = z.object({
    siteId: uuid,
    checkpointId: uuid,
    roundId: uuid.optional(),
    method: z.enum(['QR_CODE', 'NFC_TAG', 'MANUELL']),
    checkpointToken: z.string().min(32).max(128).optional(),
    checkpointTokenVersion: z.number().int().positive().optional(),
    notes: z.string().max(2000).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    scannedAt: dateTime.optional()
  }).strict().superRefine((scan, ctx) => {
    if ((scan.latitude == null) !== (scan.longitude == null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['latitude'], message: 'Breiten- und Längengrad müssen gemeinsam angegeben werden.' });
    }
  }).safeParse(payload);
  if (!parsed.success) throw statusError(400, 'Kontrollgangs-Scan ist unvollständig oder ungültig.', 'invalid_payload');

  const input = parsed.data;
  const capturedAt = input.scannedAt || clientTimestamp;
  if (!dateTime.safeParse(capturedAt).success) throw statusError(400, 'Erfassungszeitpunkt ist ungültig.', 'invalid_capture_time');
  const capturedTime = Date.parse(capturedAt);
  if (capturedTime > Date.now() + 5 * 60 * 1000) {
    throw statusError(400, 'Erfassungszeitpunkt liegt unzulässig in der Zukunft.', 'invalid_capture_time');
  }

  const employee = await db.query(
    `SELECT e.id
       FROM employees e
      WHERE e.tenant_id=$1 AND e.account_user_id=$2 AND e.archived_at IS NULL
        AND EXISTS (
          SELECT 1 FROM employee_site_assignments esa
           WHERE esa.tenant_id=e.tenant_id AND esa.employee_id=e.id AND esa.site_id=$3
        )
      LIMIT 1`,
    [tenantId, userId, input.siteId]
  );
  if (!employee.rows.length) {
    throw statusError(403, 'Für dieses Konto ist keine aktive Mitarbeiterzuordnung zu diesem Objekt hinterlegt.', 'unassigned_employee');
  }
  const guardId = employee.rows[0].id as string;

  let roundContext: { id: string; started_at: Date | string; route_id: string | null; route_version: number | null } | null = null;
  if (input.roundId) {
    const round = await db.query(
      `SELECT id,started_at,route_id,route_version FROM patrol_rounds
        WHERE id=$1 AND tenant_id=$2 AND site_id=$3 AND guard_user_id=$4 AND status='in_progress'`,
      [input.roundId, tenantId, input.siteId, userId]
    );
    if (!round.rows.length) throw statusError(409, 'Kontrollgang ist nicht aktiv oder gehört nicht zu diesem Objekt/Konto.', 'round_unavailable');
    roundContext = round.rows[0];
  }

  const checkpoint = await db.query(
    `SELECT id, code, name, token_hash, token_version
       FROM patrol_checkpoints
      WHERE id=$1 AND tenant_id=$2 AND site_id=$3 AND active=true AND archived_at IS NULL`,
    [input.checkpointId, tenantId, input.siteId]
  );
  if (!checkpoint.rows.length) throw statusError(404, 'Kontrollpunkt ist nicht aktiv oder nicht diesem Objekt zugeordnet.', 'unknown_checkpoint');
  const point = checkpoint.rows[0];
  const isManual = input.method === 'MANUELL';
  if (!isManual) {
    if (!input.checkpointToken || hashToken(input.checkpointToken) !== String(point.token_hash).trim()) {
      throw statusError(403, 'Kontrollpunkt-Token ist ungültig oder wurde rotiert.', 'invalid_token');
    }
    if (input.checkpointTokenVersion !== undefined && input.checkpointTokenVersion !== Number(point.token_version)) {
      throw statusError(409, 'Kontrollpunkt-Token-Version ist veraltet. Bitte den aktuellen Code verwenden.', 'stale_token');
    }
  }

  const lockKey = `${tenantId}:patrol:${guardId}:${input.checkpointId}`;
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
  const duplicate = await db.query(
    `SELECT id FROM patrol_scans
      WHERE tenant_id=$1 AND checkpoint_uuid=$2 AND guard_id=$3
        AND scanned_at >= $4::timestamptz - interval '2 minutes'
        AND scanned_at <= $4::timestamptz + interval '2 minutes'
      LIMIT 1`,
    [tenantId, input.checkpointId, guardId, capturedAt]
  );
  if (duplicate.rows.length) {
    throw statusError(409, 'Dieser Kontrollpunkt wurde von Ihnen innerhalb des Zwei-Minuten-Fensters bereits erfasst.', 'duplicate_scan');
  }

  const inserted = await db.query(
    `INSERT INTO patrol_scans (
        tenant_id, site_id, checkpoint_id, checkpoint_uuid, checkpoint_code, checkpoint_name,
        guard_id, scanned_at, method, verified_tag, notes, client_mutation_id, round_id,
        checkpoint_token_version, client_captured_at, payload_hash, verification_status,
        latitude,longitude
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$8,$15,$16,$17,$18)
     RETURNING id`,
    [
      tenantId, input.siteId, input.checkpointId, input.checkpointId, point.code, point.name,
      guardId, capturedAt, input.method, isManual ? 'manual' : hashToken(input.checkpointToken!).slice(0, 24),
      input.notes || null, clientMutationId, input.roundId || null,
      isManual ? null : Number(point.token_version), payloadHash, isManual ? 'manual' : 'verified',
      input.latitude ?? null, input.longitude ?? null
    ]
  );
  const scanId = inserted.rows[0].id as string;
  await writeEvent(db, tenantId, input.siteId, userId, 'scan', scanId, 'recorded', {
    checkpointId: input.checkpointId,
    method: input.method,
    verificationStatus: isManual ? 'manual' : 'verified',
    clientMutationId
  });
  if (roundContext?.route_id && roundContext.route_version !== null) {
    const version = await db.query(
      `SELECT flexible_order,late_tolerance_minutes
         FROM patrol_route_versions
        WHERE tenant_id=$1 AND route_id=$2 AND version=$3`,
      [tenantId, roundContext.route_id, roundContext.route_version]
    );
    const plannedCheckpoint = await db.query(
      `SELECT checkpoint_id,sequence_no,planned_offset_minutes
         FROM patrol_route_version_checkpoints
        WHERE tenant_id=$1 AND route_version_id=(
          SELECT id FROM patrol_route_versions
           WHERE tenant_id=$1 AND route_id=$2 AND version=$3
        ) AND checkpoint_id=$4`,
      [tenantId, roundContext.route_id, roundContext.route_version, input.checkpointId]
    );
    if (version.rows.length && plannedCheckpoint.rows.length) {
      const routeSettings = version.rows[0];
      const step = plannedCheckpoint.rows[0];
      const elapsedMinutes = Math.max(0, (capturedTime - Date.parse(String(roundContext.started_at))) / 60_000);
      const capturedIso = new Date(capturedTime).toISOString();
      if (elapsedMinutes > Number(step.planned_offset_minutes) + Number(routeSettings.late_tolerance_minutes)) {
        await recordAutomaticPatrolException(db, tenantId, userId, {
          siteId: input.siteId,
          roundId: input.roundId!,
          checkpointId: input.checkpointId,
          category: 'late_checkpoint',
          capturedAt: capturedIso,
          description: `Kontrollpunkt ${point.code} wurde außerhalb der konfigurierten Routentoleranz erfasst.`
        });
      }
      if (!routeSettings.flexible_order) {
        const skipped = await db.query(
          `SELECT vc.checkpoint_id,c.code
             FROM patrol_route_version_checkpoints vc
             JOIN patrol_checkpoints c ON c.tenant_id=vc.tenant_id AND c.id=vc.checkpoint_id
            WHERE vc.tenant_id=$1 AND vc.route_version_id=(
              SELECT id FROM patrol_route_versions
               WHERE tenant_id=$1 AND route_id=$2 AND version=$3
            ) AND vc.sequence_no < $4
              AND vc.planned_offset_minutes <= $5
              AND NOT EXISTS (
                SELECT 1 FROM patrol_scans ps
                 WHERE ps.tenant_id=$1 AND ps.round_id=$6 AND ps.checkpoint_uuid=vc.checkpoint_id
              )`,
          [tenantId, roundContext.route_id, roundContext.route_version, step.sequence_no, Math.floor(elapsedMinutes), input.roundId]
        );
        for (const missed of skipped.rows) {
          await recordAutomaticPatrolException(db, tenantId, userId, {
            siteId: input.siteId,
            roundId: input.roundId!,
            checkpointId: missed.checkpoint_id,
            category: 'missed_checkpoint',
            capturedAt: capturedIso,
            description: `Kontrollpunkt ${missed.code} wurde vor einem späteren Routenschritt ausgelassen.`
          });
        }
      }
    }
  }
  return { id: scanId, verificationStatus: isManual ? 'manual' : 'verified' };
}

export async function recordPatrolScanAttempt(
  db: PoolClient,
  tenantId: string,
  userId: string,
  clientMutationId: string,
  payload: Record<string, unknown>,
  clientTimestamp: string,
  payloadHash: string,
  reasonCode: PatrolScanAttemptReason
): Promise<void> {
  const siteId = uuid.safeParse(payload.siteId);
  const checkpointId = uuid.safeParse(payload.checkpointId);
  const roundId = uuid.safeParse(payload.roundId);
  const method = z.enum(['QR_CODE', 'NFC_TAG', 'MANUELL']).safeParse(payload.method);
  const capturedAt = payload.scannedAt ?? clientTimestamp;
  const validCapturedAt = dateTime.safeParse(capturedAt);
  const knownSite = siteId.success
    ? await db.query('SELECT id FROM sites WHERE tenant_id=$1 AND id=$2', [tenantId, siteId.data])
    : null;
  await db.query(
    `INSERT INTO patrol_scan_attempts
      (tenant_id,actor_user_id,site_id,checkpoint_id,round_id,client_mutation_id,payload_hash,
       method,outcome,reason_code,client_captured_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id,client_mutation_id) DO NOTHING`,
    [tenantId, userId, knownSite?.rows[0]?.id ?? null, checkpointId.success ? checkpointId.data : null,
      roundId.success ? roundId.data : null, clientMutationId, payloadHash, method.success ? method.data : null,
      reasonCode === 'duplicate_scan' ? 'duplicate' : 'rejected', reasonCode,
      validCapturedAt.success ? validCapturedAt.data : null]
  );
}

export async function recordPatrolException(
  db: PoolClient,
  tenantId: string,
  userId: string,
  clientMutationId: string,
  payload: Record<string, any>,
  clientTimestamp: string,
  payloadHash = computePayloadHash(payload)
): Promise<{ id: string; createdAt: string; idempotent: boolean }> {
  const parsed = exceptionSchema.omit({ clientMutationId: true, capturedAt: true })
    .extend({ capturedAt: dateTime.optional() })
    .strict().safeParse(payload);
  if (!parsed.success) throw statusError(400, 'Kontrollgangsabweichung ist unvollständig oder ungültig.');
  const input = parsed.data;
  const capturedAt = input.capturedAt || clientTimestamp;
  if (!dateTime.safeParse(capturedAt).success) throw statusError(400, 'Erfassungszeitpunkt der Abweichung ist ungültig.');

  const assignment = await db.query(
    `SELECT e.id FROM employees e
      WHERE e.tenant_id=$1 AND e.account_user_id=$2 AND e.archived_at IS NULL
        AND EXISTS (
          SELECT 1 FROM employee_site_assignments esa
           WHERE esa.tenant_id=e.tenant_id AND esa.employee_id=e.id AND esa.site_id=$3
        )
      LIMIT 1`,
    [tenantId, userId, input.siteId]
  );
  if (!assignment.rows.length) {
    throw statusError(403, 'Für dieses Konto ist keine aktive Mitarbeiterzuordnung zu diesem Objekt hinterlegt.');
  }
  if (input.roundId) {
    const round = await db.query(
      'SELECT id FROM patrol_rounds WHERE id=$1 AND tenant_id=$2 AND site_id=$3',
      [input.roundId, tenantId, input.siteId]
    );
    if (!round.rows.length) throw statusError(404, 'Kontrollgang nicht gefunden.');
  }
  if (input.scanId) {
    const scan = await db.query(
      'SELECT id FROM patrol_scans WHERE id=$1 AND tenant_id=$2 AND site_id=$3',
      [input.scanId, tenantId, input.siteId]
    );
    if (!scan.rows.length) throw statusError(404, 'Scan nicht gefunden.');
  }
  if (input.checkpointId) {
    const checkpoint = await db.query(
      'SELECT id FROM patrol_checkpoints WHERE id=$1 AND tenant_id=$2 AND site_id=$3',
      [input.checkpointId, tenantId, input.siteId]
    );
    if (!checkpoint.rows.length) throw statusError(404, 'Kontrollpunkt nicht gefunden.');
  }

  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `${tenantId}:patrol:exception:${clientMutationId}`
  ]);
  const prior = await db.query(
    `SELECT id,payload_hash,created_at,created_by_user_id FROM patrol_exceptions
      WHERE tenant_id=$1 AND client_mutation_id=$2`,
    [tenantId, clientMutationId]
  );
  if (prior.rows.length) {
    if (prior.rows[0].created_by_user_id !== userId) {
      throw statusError(409, 'Mutations-ID ist bereits einem anderen Benutzer zugeordnet.');
    }
    if (prior.rows[0].payload_hash !== payloadHash) {
      throw statusError(409, 'Mutations-ID wurde mit abweichendem Inhalt wiederverwendet.');
    }
    return { id: prior.rows[0].id, createdAt: prior.rows[0].created_at, idempotent: true };
  }

  const inserted = await db.query(
    `INSERT INTO patrol_exceptions
      (tenant_id,site_id,round_id,scan_id,checkpoint_id,category,severity,description,
       client_mutation_id,payload_hash,client_captured_at,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id,created_at`,
    [tenantId, input.siteId, input.roundId || null, input.scanId || null, input.checkpointId || null,
      input.category, input.severity, input.description, clientMutationId, payloadHash,
      capturedAt, userId]
  );
  await writeEvent(db, tenantId, input.siteId, userId, 'exception', inserted.rows[0].id, 'reported', {
    category: input.category, severity: input.severity, clientMutationId
  });
  return { id: inserted.rows[0].id, createdAt: inserted.rows[0].created_at, idempotent: false };
}

export async function listCheckpoints(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { siteId } = listQueryBaseSchema.pick({ siteId: true }).parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT c.id,c.site_id,s.name AS site_name,c.code,c.name,c.location_details,
                c.building_name,c.area_name,c.latitude,c.longitude,
                c.token_version,c.required_interval_minutes,c.active,c.created_at,c.updated_at,c.archived_at
           FROM patrol_checkpoints c JOIN sites s ON s.id=c.site_id AND s.tenant_id=c.tenant_id
          WHERE c.tenant_id=$1 AND ($2::uuid IS NULL OR c.site_id=$2)
          ORDER BY s.name,c.code`,
        [req.user!.tenantId, siteId || null]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function createCheckpoint(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = checkpointSchema.parse(req.body);
    const token = createToken();
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `INSERT INTO patrol_checkpoints
          (tenant_id,site_id,code,name,location_details,building_name,area_name,latitude,longitude,
           token_hash,required_interval_minutes,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id,site_id,code,name,location_details,building_name,area_name,latitude,longitude,
                   token_version,required_interval_minutes,active,created_at`,
        [req.user!.tenantId, input.siteId, input.code, input.name, input.locationDetails,
          input.buildingName ?? null, input.areaName ?? null, input.latitude ?? null, input.longitude ?? null,
          hashToken(token), input.requiredIntervalMinutes, req.user!.userId]
      );
      const point = result.rows[0];
      await writeEvent(db, req.user!.tenantId, input.siteId, req.user!.userId, 'checkpoint', point.id, 'created', {
        code: point.code, tokenVersion: point.token_version
      });
      return { ...point, scanPayload: `secops:patrol:v1:${point.site_id}:${point.id}:${token}` };
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updateCheckpoint(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const checkpointId = uuid.parse(req.params.id);
    const input = checkpointUpdateSchema.parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `UPDATE patrol_checkpoints
            SET code=$1,name=$2,location_details=$3,building_name=$4,area_name=$5,
                latitude=$6,longitude=$7,required_interval_minutes=$8,updated_at=CURRENT_TIMESTAMP
          WHERE id=$9 AND tenant_id=$10 AND archived_at IS NULL
          RETURNING id,site_id,code,name,location_details,building_name,area_name,latitude,longitude,
                    token_version,required_interval_minutes,active`,
        [input.code, input.name, input.locationDetails, input.buildingName ?? null, input.areaName ?? null,
          input.latitude ?? null, input.longitude ?? null, input.requiredIntervalMinutes,
          checkpointId, req.user!.tenantId]
      );
      if (!result.rows.length) throw statusError(404, 'Nicht archivierter Kontrollpunkt nicht gefunden.');
      await writeEvent(db, req.user!.tenantId, result.rows[0].site_id, req.user!.userId, 'checkpoint', checkpointId, 'updated', {
        code: input.code, buildingName: input.buildingName ?? null, areaName: input.areaName ?? null
      });
      return result.rows[0];
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function setCheckpointActive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const checkpointId = uuid.parse(req.params.id);
    const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `UPDATE patrol_checkpoints SET active=$1,updated_at=CURRENT_TIMESTAMP
          WHERE id=$2 AND tenant_id=$3 AND archived_at IS NULL
          RETURNING id,site_id,active`,
        [active, checkpointId, req.user!.tenantId]
      );
      if (!result.rows.length) throw statusError(404, 'Nicht archivierter Kontrollpunkt nicht gefunden.');
      await writeEvent(db, req.user!.tenantId, result.rows[0].site_id, req.user!.userId, 'checkpoint', checkpointId,
        active ? 'activated' : 'deactivated');
      return { id: checkpointId, active };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function rotateCheckpointToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const checkpointId = uuid.parse(req.params.id);
    const token = createToken();
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `UPDATE patrol_checkpoints
            SET token_hash=$1,token_version=token_version+1,updated_at=CURRENT_TIMESTAMP
          WHERE id=$2 AND tenant_id=$3 AND active=true AND archived_at IS NULL
          RETURNING id,site_id,code,token_version`,
        [hashToken(token), checkpointId, req.user!.tenantId]
      );
      if (!result.rows.length) throw statusError(404, 'Aktiver Kontrollpunkt nicht gefunden.');
      const point = result.rows[0];
      await writeEvent(db, req.user!.tenantId, point.site_id, req.user!.userId, 'checkpoint', point.id, 'token_rotated', {
        tokenVersion: point.token_version
      });
      return { ...point, scanPayload: `secops:patrol:v1:${point.site_id}:${point.id}:${token}` };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function archiveCheckpoint(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const checkpointId = uuid.parse(req.params.id);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `UPDATE patrol_checkpoints SET active=false,archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
          WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL RETURNING id,site_id`,
        [checkpointId, req.user!.tenantId]
      );
      if (!result.rows.length) throw statusError(404, 'Aktiver Kontrollpunkt nicht gefunden.');
      await writeEvent(db, req.user!.tenantId, result.rows[0].site_id, req.user!.userId, 'checkpoint', checkpointId, 'archived');
      return { id: checkpointId, archived: true };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

async function insertRouteVersion(
  db: PoolClient,
  tenantId: string,
  actorUserId: string,
  routeId: string,
  siteId: string,
  version: number,
  name: string,
  changeReason: string,
  settings: {
    flexibleOrder: boolean;
    targetDurationMinutes: number | null;
    lateToleranceMinutes: number;
    timeWindowStart: string | null;
    timeWindowEnd: string | null;
    scheduleTimezone: string;
    recurrenceFrequency: 'none' | 'daily' | 'weekly';
    recurrenceInterval: number;
    recurrenceDays: number[];
    employeeIds: string[];
    employeeGroupIds: string[];
  },
  checkpoints: Array<{ checkpointId: string; plannedOffsetMinutes: number }>
): Promise<string> {
  const inserted = await db.query(
    `INSERT INTO patrol_route_versions
       (tenant_id,route_id,version,name,change_reason,created_by_user_id,flexible_order,
        target_duration_minutes,late_tolerance_minutes,time_window_start,time_window_end,
        recurrence_frequency,recurrence_interval,recurrence_days,schedule_timezone,schedule_anchor_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
       (CURRENT_TIMESTAMP AT TIME ZONE $16::text)::date) RETURNING id`,
    [tenantId, routeId, version, name, changeReason, actorUserId, settings.flexibleOrder,
      settings.targetDurationMinutes, settings.lateToleranceMinutes, settings.timeWindowStart,
      settings.timeWindowEnd, settings.recurrenceFrequency, settings.recurrenceInterval,
      settings.recurrenceDays, settings.scheduleTimezone, settings.scheduleTimezone]
  );
  const versionId = inserted.rows[0].id as string;
  for (const [index, item] of checkpoints.entries()) {
    await db.query(
      `INSERT INTO patrol_route_version_checkpoints
        (tenant_id,route_version_id,checkpoint_id,site_id,sequence_no,planned_offset_minutes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, versionId, item.checkpointId, siteId, index + 1, item.plannedOffsetMinutes]
    );
  }
  const groupMembers = settings.employeeGroupIds.length
    ? await db.query(
      `SELECT g.id AS group_id,m.employee_id
         FROM patrol_employee_groups g
         JOIN patrol_employee_group_members m
           ON m.tenant_id=g.tenant_id AND m.employee_group_id=g.id AND m.site_id=g.site_id
        WHERE g.tenant_id=$1 AND g.site_id=$2 AND g.id=ANY($3::uuid[]) AND g.archived_at IS NULL`,
      [tenantId, siteId, settings.employeeGroupIds]
    )
    : { rows: [] as Array<{ group_id: string; employee_id: string }> };
  if (new Set(groupMembers.rows.map(member => member.group_id)).size !== settings.employeeGroupIds.length) {
    throw statusError(400, 'Alle Routengruppen müssen aktiv, objektbezogen und mindestens einem Mitarbeiter zugeordnet sein.');
  }
  if (settings.employeeGroupIds.length) {
    await db.query(
      `INSERT INTO patrol_route_version_group_assignments
         (tenant_id,route_version_id,route_id,site_id,employee_group_id,created_by_user_id)
       SELECT $1,$2,$3,$4,selected.group_id,$5
         FROM unnest($6::uuid[]) AS selected(group_id)`,
      [tenantId, versionId, routeId, siteId, actorUserId, settings.employeeGroupIds]
    );
  }
  const resolvedEmployeeIds = [...new Set([
    ...settings.employeeIds,
    ...groupMembers.rows.map(member => member.employee_id)
  ])];
  if (resolvedEmployeeIds.length) {
    const assignedEmployees = await db.query(
      `SELECT e.id FROM employees e
        JOIN employee_site_assignments esa
          ON esa.tenant_id=e.tenant_id AND esa.employee_id=e.id AND esa.site_id=$3
       WHERE e.tenant_id=$1 AND e.id=ANY($2::uuid[]) AND e.archived_at IS NULL`,
      [tenantId, resolvedEmployeeIds, siteId]
    );
    if (assignedEmployees.rows.length !== resolvedEmployeeIds.length) {
      throw statusError(400, 'Alle Routenzuweisungen müssen aktive Mitarbeiter mit Objektzuordnung enthalten.');
    }
    await db.query(
      `INSERT INTO patrol_route_version_assignments
        (tenant_id,route_version_id,route_id,site_id,employee_id,created_by_user_id)
       SELECT $1,$2,$3,$4,employee_id,$5
         FROM unnest($6::uuid[]) AS selected(employee_id)`,
      [tenantId, versionId, routeId, siteId, actorUserId, resolvedEmployeeIds]
    );
  }
  await writeEvent(db, tenantId, siteId, actorUserId, 'route_version', versionId, 'created', {
    routeId, version, changeReason, checkpointCount: checkpoints.length,
    assignedEmployeeCount: resolvedEmployeeIds.length,
    assignedGroupCount: settings.employeeGroupIds.length
  });
  return versionId;
}

export async function listRoutes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { siteId } = listQueryBaseSchema.pick({ siteId: true }).parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT r.id,r.site_id,s.name AS site_name,r.route_code,r.name,r.current_version,r.active,r.created_at,r.updated_at,
                v.id AS version_id,v.change_reason,v.created_at AS version_created_at,
                v.flexible_order,v.target_duration_minutes,v.late_tolerance_minutes,
                v.time_window_start,v.time_window_end,v.recurrence_frequency,v.recurrence_interval,v.recurrence_days,
                v.schedule_timezone,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',concat_ws(' ',e.first_name,e.last_name))
                                   ORDER BY e.last_name,e.first_name)
                    FROM patrol_route_version_assignments a
                    JOIN employees e ON e.tenant_id=a.tenant_id AND e.id=a.employee_id
                   WHERE a.tenant_id=r.tenant_id AND a.route_version_id=v.id
                ),'[]'::jsonb) AS assigned_employees,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) ORDER BY lower(g.name))
                    FROM patrol_route_version_group_assignments a
                    JOIN patrol_employee_groups g
                      ON g.tenant_id=a.tenant_id AND g.id=a.employee_group_id
                   WHERE a.tenant_id=r.tenant_id AND a.route_version_id=v.id
                ),'[]'::jsonb) AS assigned_employee_groups,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'checkpointId',c.id,'code',c.code,'name',c.name,'sequence',vc.sequence_no,
                  'plannedOffsetMinutes',vc.planned_offset_minutes
                ) ORDER BY vc.sequence_no) FILTER (WHERE c.id IS NOT NULL),'[]'::jsonb) AS checkpoints
           FROM patrol_routes r JOIN sites s ON s.id=r.site_id AND s.tenant_id=r.tenant_id
           JOIN patrol_route_versions v ON v.tenant_id=r.tenant_id AND v.route_id=r.id AND v.version=r.current_version
           LEFT JOIN patrol_route_version_checkpoints vc ON vc.tenant_id=v.tenant_id AND vc.route_version_id=v.id
           LEFT JOIN patrol_checkpoints c ON c.tenant_id=vc.tenant_id AND c.id=vc.checkpoint_id
          WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.site_id=$2)
          GROUP BY r.id,r.tenant_id,r.site_id,s.name,r.route_code,r.name,r.current_version,r.active,r.created_at,r.updated_at,
                   v.id,v.change_reason,v.created_at,v.flexible_order,v.target_duration_minutes,v.late_tolerance_minutes,
                   v.time_window_start,v.time_window_end,v.recurrence_frequency,v.recurrence_interval,v.recurrence_days,
                   v.schedule_timezone
          ORDER BY s.name,r.route_code`,
        [req.user!.tenantId, siteId || null]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listPatrolEmployeeGroups(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { siteId } = listQueryBaseSchema.pick({ siteId: true }).parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT g.id,g.site_id,g.name,g.archived_at,g.created_at,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'id',e.id,'name',concat_ws(' ',e.first_name,e.last_name)
                ) ORDER BY e.last_name,e.first_name) FILTER (WHERE e.id IS NOT NULL),'[]'::jsonb) AS employees
           FROM patrol_employee_groups g
           LEFT JOIN patrol_employee_group_members m
             ON m.tenant_id=g.tenant_id AND m.employee_group_id=g.id
           LEFT JOIN employees e
             ON e.tenant_id=m.tenant_id AND e.id=m.employee_id AND e.archived_at IS NULL
          WHERE g.tenant_id=$1 AND ($2::uuid IS NULL OR g.site_id=$2)
          GROUP BY g.id,g.tenant_id,g.site_id,g.name,g.archived_at,g.created_at
          ORDER BY g.archived_at NULLS FIRST,lower(g.name),g.id`,
        [req.user!.tenantId, siteId || null]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function createPatrolEmployeeGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = z.object({
      siteId: uuid,
      name: z.string().trim().min(1).max(120),
      employeeIds: z.array(uuid).min(1).max(200)
    }).strict().superRefine((value, ctx) => {
      if (new Set(value.employeeIds).size !== value.employeeIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['employeeIds'], message: 'Mitarbeiter dürfen nicht doppelt vorkommen.' });
      }
    }).parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const valid = await db.query(
        `SELECT e.id FROM employees e
          JOIN employee_site_assignments a
            ON a.tenant_id=e.tenant_id AND a.employee_id=e.id AND a.site_id=$3
         WHERE e.tenant_id=$1 AND e.id=ANY($2::uuid[]) AND e.archived_at IS NULL`,
        [req.user!.tenantId, input.employeeIds, input.siteId]
      );
      if (valid.rows.length !== input.employeeIds.length) {
        throw statusError(400, 'Alle Gruppenmitglieder müssen aktive Mitarbeiter mit Objektzuordnung sein.');
      }
      const group = await db.query(
        `INSERT INTO patrol_employee_groups (tenant_id,site_id,name,created_by_user_id)
         VALUES ($1,$2,$3,$4) RETURNING id,site_id,name,archived_at,created_at`,
        [req.user!.tenantId, input.siteId, input.name, req.user!.userId]
      );
      await db.query(
        `INSERT INTO patrol_employee_group_members
          (tenant_id,employee_group_id,site_id,employee_id,created_by_user_id)
         SELECT $1,$2,$3,employee_id,$4
           FROM unnest($5::uuid[]) AS selected(employee_id)`,
        [req.user!.tenantId, group.rows[0].id, input.siteId, req.user!.userId, input.employeeIds]
      );
      await writeEvent(db, req.user!.tenantId, input.siteId, req.user!.userId,
        'employee_group', group.rows[0].id, 'created', {
          name: input.name,
          employeeIds: input.employeeIds
        });
      return { ...group.rows[0], employee_ids: input.employeeIds };
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updatePatrolEmployeeGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const groupId = uuid.parse(req.params.id);
    const input = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      employeeIds: z.array(uuid).min(1).max(200).optional()
    }).strict().refine(value => Object.keys(value).length > 0).superRefine((value, ctx) => {
      if (value.employeeIds && new Set(value.employeeIds).size !== value.employeeIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['employeeIds'], message: 'Mitarbeiter dürfen nicht doppelt vorkommen.' });
      }
    }).parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const group = await db.query(
        `SELECT id,site_id,name FROM patrol_employee_groups
          WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE`,
        [req.user!.tenantId, groupId]
      );
      if (!group.rows.length) throw statusError(404, 'Aktive Mitarbeitergruppe nicht gefunden.');
      if (input.employeeIds) {
        const valid = await db.query(
          `SELECT e.id FROM employees e
            JOIN employee_site_assignments a
              ON a.tenant_id=e.tenant_id AND a.employee_id=e.id AND a.site_id=$3
           WHERE e.tenant_id=$1 AND e.id=ANY($2::uuid[]) AND e.archived_at IS NULL`,
          [req.user!.tenantId, input.employeeIds, group.rows[0].site_id]
        );
        if (valid.rows.length !== input.employeeIds.length) {
          throw statusError(400, 'Alle Gruppenmitglieder müssen aktive Mitarbeiter mit Objektzuordnung sein.');
        }
        await db.query(
          'DELETE FROM patrol_employee_group_members WHERE tenant_id=$1 AND employee_group_id=$2',
          [req.user!.tenantId, groupId]
        );
        await db.query(
          `INSERT INTO patrol_employee_group_members
            (tenant_id,employee_group_id,site_id,employee_id,created_by_user_id)
           SELECT $1,$2,$3,employee_id,$4
             FROM unnest($5::uuid[]) AS selected(employee_id)`,
          [req.user!.tenantId, groupId, group.rows[0].site_id, req.user!.userId, input.employeeIds]
        );
      }
      const updated = await db.query(
        `UPDATE patrol_employee_groups
            SET name=COALESCE($1,name),updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$2 AND id=$3
          RETURNING id,site_id,name,archived_at,created_at`,
        [input.name ?? null, req.user!.tenantId, groupId]
      );
      await writeEvent(db, req.user!.tenantId, group.rows[0].site_id, req.user!.userId,
        'employee_group', groupId, 'updated', {
          ...(input.name ? { name: input.name } : {}),
          ...(input.employeeIds ? { employeeIds: input.employeeIds } : {})
        });
      return { ...updated.rows[0], employee_ids: input.employeeIds };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function archivePatrolEmployeeGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const groupId = uuid.parse(req.params.id);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `UPDATE patrol_employee_groups SET archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL
          RETURNING id,site_id`,
        [req.user!.tenantId, groupId]
      );
      if (!result.rows.length) throw statusError(404, 'Aktive Mitarbeitergruppe nicht gefunden.');
      await writeEvent(db, req.user!.tenantId, result.rows[0].site_id, req.user!.userId,
        'employee_group', groupId, 'archived');
      return { id: groupId, archived: true };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function createRoute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = routeSchema.parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const inserted = await db.query(
        `INSERT INTO patrol_routes (tenant_id,site_id,route_code,name,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.user!.tenantId, input.siteId, input.code, input.name, req.user!.userId]
      );
      const routeId = inserted.rows[0].id as string;
      const versionId = await insertRouteVersion(
        db, req.user!.tenantId, req.user!.userId, routeId, input.siteId, 1, input.name, input.changeReason,
        input, input.checkpoints
      );
      await writeEvent(db, req.user!.tenantId, input.siteId, req.user!.userId, 'route', routeId, 'created', {
        version: 1, versionId
      });
      return { id: routeId, siteId: input.siteId, code: input.code, name: input.name, version: 1, checkpoints: input.checkpoints };
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function createRouteVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const routeId = uuid.parse(req.params.id);
    const input = routeVersionSchema.parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const route = await db.query(
        'SELECT id,site_id,route_code,current_version FROM patrol_routes WHERE id=$1 AND tenant_id=$2 AND active=true FOR UPDATE',
        [routeId, req.user!.tenantId]
      );
      if (!route.rows.length) throw statusError(404, 'Aktive Route nicht gefunden.');
      const currentVersion = Number(route.rows[0].current_version);
      const version = currentVersion + 1;
      const versionId = await insertRouteVersion(
        db, req.user!.tenantId, req.user!.userId, routeId, route.rows[0].site_id, version,
        input.name, input.changeReason, input, input.checkpoints
      );
      await db.query(
        `UPDATE patrol_routes SET name=$1,current_version=$2,updated_at=CURRENT_TIMESTAMP
          WHERE id=$3 AND tenant_id=$4`,
        [input.name, version, routeId, req.user!.tenantId]
      );
      await writeEvent(db, req.user!.tenantId, route.rows[0].site_id, req.user!.userId, 'route', routeId, 'version_published', {
        version, versionId, changeReason: input.changeReason
      });
      return { id: routeId, versionId, version, name: input.name, checkpoints: input.checkpoints };
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function archiveRoute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const routeId = uuid.parse(req.params.id);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `UPDATE patrol_routes SET active=false,archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
          WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL
          RETURNING id,site_id`,
        [routeId, req.user!.tenantId]
      );
      if (!result.rows.length) throw statusError(404, 'Nicht archivierte Route nicht gefunden.');
      await writeEvent(db, req.user!.tenantId, result.rows[0].site_id, req.user!.userId, 'route', routeId, 'archived');
      return { id: routeId, archived: true };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listScans(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = listQuerySchema.parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT p.id,p.site_id,s.name AS site_name,p.checkpoint_uuid AS checkpoint_id,
                p.checkpoint_code,p.checkpoint_name,p.guard_id,p.scanned_at,p.client_captured_at,
                p.server_received_at,p.method,p.verification_status,p.notes,p.round_id
           FROM patrol_scans p JOIN sites s ON s.id=p.site_id AND s.tenant_id=p.tenant_id
           LEFT JOIN patrol_rounds r ON r.id=p.round_id AND r.tenant_id=p.tenant_id
          WHERE p.tenant_id=$1
            AND ($2::uuid IS NULL OR p.site_id=$2)
            AND ($3::uuid IS NULL OR s.client_id=$3)
            AND ($4::uuid IS NULL OR p.guard_id=$4)
            AND ($5::uuid IS NULL OR r.route_id=$5)
            AND ($6::text IS NULL OR r.status=$6)
            AND ($7::date IS NULL OR p.scanned_at >= $7::date)
            AND ($8::date IS NULL OR p.scanned_at < $8::date + interval '1 day')
          ORDER BY p.scanned_at DESC,p.id DESC LIMIT $9 OFFSET $10`,
        [req.user!.tenantId, filters.siteId || null, filters.clientId || null, filters.employeeId || null,
          filters.routeId || null, filters.status || null, filters.from || null, filters.to || null,
          filters.limit, filters.offset]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listRounds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = listQuerySchema.parse(req.query);
    const includeAllRounds = req.user!.permissions.includes('patrol:manage') ||
      req.user!.permissions.includes('patrol:audit') ||
      req.user!.permissions.includes('patrol:analytics:read');
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT r.id,r.site_id,s.name AS site_name,r.route_id,r.route_version,r.status,
                r.guard_user_id,e.id AS guard_id,concat_ws(' ',e.first_name,e.last_name) AS guard_name,
                r.started_at,r.completed_at,r.client_captured_at,r.server_received_at
           FROM patrol_rounds r JOIN sites s ON s.id=r.site_id AND s.tenant_id=r.tenant_id
           LEFT JOIN employees e ON e.tenant_id=r.tenant_id AND e.account_user_id=r.guard_user_id
          WHERE r.tenant_id=$1 AND ($2::boolean OR r.guard_user_id=$3)
            AND ($4::uuid IS NULL OR r.site_id=$4)
            AND ($5::uuid IS NULL OR s.client_id=$5)
            AND ($6::uuid IS NULL OR e.id=$6)
            AND ($7::uuid IS NULL OR r.route_id=$7)
            AND ($8::text IS NULL OR r.status=$8)
            AND ($9::date IS NULL OR r.started_at >= $9::date)
            AND ($10::date IS NULL OR r.started_at < $10::date + interval '1 day')
          ORDER BY r.started_at DESC,r.id DESC LIMIT $11 OFFSET $12`,
        [req.user!.tenantId, includeAllRounds, req.user!.userId, filters.siteId || null,
          filters.clientId || null, filters.employeeId || null, filters.routeId || null, filters.status || null,
          filters.from || null, filters.to || null, filters.limit, filters.offset]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listRoundAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const roundId = uuid.parse(req.params.id);
    const includeAll = req.user!.permissions.includes('patrol:round:read') ||
      req.user!.permissions.includes('patrol:manage') ||
      req.user!.permissions.includes('patrol:audit');
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const round = await db.query(
        'SELECT id,site_id,guard_user_id FROM patrol_rounds WHERE tenant_id=$1 AND id=$2',
        [req.user!.tenantId, roundId]
      );
      if (!round.rows.length || (!includeAll && round.rows[0].guard_user_id !== req.user!.userId)) {
        throw statusError(404, 'Kontrollgang nicht gefunden.');
      }
      const attachments = await db.query(
        `SELECT a.id,a.document_id,d.title,v.original_filename,v.content_type,v.size_bytes::int AS size_bytes,
                v.scan_status,a.linked_by_user_id,a.created_at
           FROM patrol_attachments a
           JOIN documents d ON d.tenant_id=a.tenant_id AND d.id=a.document_id
           JOIN document_versions v
             ON v.tenant_id=d.tenant_id AND v.document_id=d.id AND v.version_number=d.current_version
          WHERE a.tenant_id=$1 AND a.round_id=$2
          ORDER BY a.created_at,a.id`,
        [req.user!.tenantId, roundId]
      );
      return attachments.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function addRoundAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const roundId = uuid.parse(req.params.id);
    const { documentId } = z.object({ documentId: uuid }).strict().parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const round = await db.query(
        `SELECT id,site_id,guard_user_id,status FROM patrol_rounds
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [req.user!.tenantId, roundId]
      );
      if (!round.rows.length) throw statusError(404, 'Kontrollgang nicht gefunden.');
      const canManage = req.user!.permissions.includes('patrol:manage');
      if (!canManage && round.rows[0].guard_user_id !== req.user!.userId) {
        throw statusError(404, 'Kontrollgang nicht gefunden.');
      }
      if (round.rows[0].status === 'abandoned') {
        throw statusError(409, 'An abgebrochene Kontrollgänge können keine Anlagen angefügt werden.');
      }
      const document = await db.query(
        `SELECT d.id,d.title,v.scan_status,rel.site_id AS linked_site_id
           FROM documents d
           JOIN document_versions v
             ON v.tenant_id=d.tenant_id AND v.document_id=d.id AND v.version_number=d.current_version
           JOIN document_relationships rel
             ON rel.tenant_id=d.tenant_id AND rel.document_id=d.id AND rel.relationship_type='site'
          WHERE d.tenant_id=$1 AND d.id=$2 AND d.archived_at IS NULL`,
        [req.user!.tenantId, documentId]
      );
      if (!document.rows.length || document.rows[0].linked_site_id !== round.rows[0].site_id) {
        throw statusError(404, 'Aktives, dem Objekt zugeordnetes Dokument nicht gefunden.');
      }
      if (document.rows[0].scan_status === 'infected') {
        throw statusError(422, 'Als infiziert erkannte Dokumente dürfen nicht angefügt werden.');
      }
      const inserted = await db.query(
        `INSERT INTO patrol_attachments
          (tenant_id,site_id,round_id,document_id,linked_by_user_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id,round_id,document_id) DO NOTHING
         RETURNING id`,
        [req.user!.tenantId, round.rows[0].site_id, roundId, documentId, req.user!.userId]
      );
      if (inserted.rows.length) {
        await writeEvent(db, req.user!.tenantId, round.rows[0].site_id, req.user!.userId,
          'round', roundId, 'attachment_linked', { documentId });
      }
      return {
        id: inserted.rows[0]?.id ?? null,
        roundId,
        documentId,
        title: document.rows[0].title,
        idempotent: inserted.rows.length === 0
      };
    });
    res.status(data.idempotent ? 200 : 201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listScheduledOccurrences(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = occurrenceQuerySchema.parse(req.query);
    const includeAll = req.user!.permissions.includes('patrol:manage') ||
      req.user!.permissions.includes('patrol:audit') ||
      req.user!.permissions.includes('patrol:analytics:read');
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT o.id,o.site_id,s.name AS site_name,s.client_id,o.route_id,r.route_code,r.name AS route_name,
                o.route_version,o.scheduled_at,o.window_ends_at,o.deadline_at,o.status,o.round_id,
                o.resolved_at,o.created_at,
                round.guard_user_id,employee.id AS employee_id,
                concat_ws(' ',employee.first_name,employee.last_name) AS employee_name
           FROM patrol_schedule_occurrences o
           JOIN sites s ON s.id=o.site_id AND s.tenant_id=o.tenant_id
           JOIN patrol_routes r ON r.tenant_id=o.tenant_id AND r.id=o.route_id
           LEFT JOIN patrol_rounds round ON round.tenant_id=o.tenant_id AND round.id=o.round_id
           LEFT JOIN employees employee ON employee.tenant_id=o.tenant_id
             AND employee.account_user_id=round.guard_user_id
          WHERE o.tenant_id=$1
            AND ($2::boolean OR EXISTS (
              SELECT 1 FROM employees e
              JOIN employee_site_assignments esa
                ON esa.tenant_id=e.tenant_id AND esa.employee_id=e.id AND esa.site_id=o.site_id
              WHERE e.tenant_id=o.tenant_id AND e.account_user_id=$3 AND e.archived_at IS NULL
                AND (
                  NOT EXISTS (SELECT 1 FROM patrol_route_version_assignments a
                               WHERE a.tenant_id=o.tenant_id AND a.route_id=o.route_id
                                 AND a.route_version_id=(SELECT v.id FROM patrol_route_versions v
                                   WHERE v.tenant_id=o.tenant_id AND v.route_id=o.route_id
                                     AND v.version=o.route_version))
                  OR EXISTS (SELECT 1 FROM patrol_route_version_assignments a
                              WHERE a.tenant_id=o.tenant_id AND a.route_id=o.route_id
                                AND a.route_version_id=(SELECT v.id FROM patrol_route_versions v
                                  WHERE v.tenant_id=o.tenant_id AND v.route_id=o.route_id
                                    AND v.version=o.route_version)
                                AND a.employee_id=e.id)
                )
            ))
            AND ($4::uuid IS NULL OR o.site_id=$4)
            AND ($5::uuid IS NULL OR s.client_id=$5)
            AND ($6::uuid IS NULL OR o.route_id=$6)
            AND ($7::uuid IS NULL OR employee.id=$7 OR EXISTS (
              SELECT 1 FROM patrol_route_version_assignments a
               JOIN employees e ON e.tenant_id=a.tenant_id AND e.id=a.employee_id
              WHERE a.tenant_id=o.tenant_id AND a.route_id=o.route_id AND e.id=$7
                AND a.route_version_id=(SELECT v.id FROM patrol_route_versions v
                  WHERE v.tenant_id=o.tenant_id AND v.route_id=o.route_id AND v.version=o.route_version)
            ))
            AND ($8::text IS NULL OR o.status=$8)
            AND ($9::date IS NULL OR o.scheduled_at >= $9::date)
            AND ($10::date IS NULL OR o.scheduled_at < $10::date + interval '1 day')
          ORDER BY o.scheduled_at DESC,o.id DESC LIMIT $11 OFFSET $12`,
        [req.user!.tenantId, includeAll, req.user!.userId, filters.siteId || null, filters.clientId || null,
          filters.routeId || null, filters.employeeId || null, filters.status || null, filters.from || null,
          filters.to || null, filters.limit, filters.offset]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listExceptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = listQuerySchema.parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT e.id,e.site_id,s.name AS site_name,e.round_id,e.scan_id,e.checkpoint_id,
                e.category,e.severity,e.description,e.client_captured_at,e.server_received_at,
                e.created_by_user_id,e.created_at,round.guard_user_id,employee.id AS guard_id,
                concat_ws(' ',employee.first_name,employee.last_name) AS guard_name,round.route_id,round.status AS round_status
           FROM patrol_exceptions e JOIN sites s ON s.id=e.site_id AND s.tenant_id=e.tenant_id
           LEFT JOIN patrol_rounds round ON round.tenant_id=e.tenant_id AND round.id=e.round_id
           LEFT JOIN employees employee ON employee.tenant_id=e.tenant_id
              AND employee.account_user_id=COALESCE(round.guard_user_id,e.created_by_user_id)
          WHERE e.tenant_id=$1
            AND ($2::uuid IS NULL OR e.site_id=$2)
            AND ($3::uuid IS NULL OR s.client_id=$3)
            AND ($4::uuid IS NULL OR employee.id=$4)
            AND ($5::uuid IS NULL OR round.route_id=$5)
            AND ($6::text IS NULL OR round.status=$6)
            AND ($7::date IS NULL OR e.created_at >= $7::date)
            AND ($8::date IS NULL OR e.created_at < $8::date + interval '1 day')
            AND ($9::text IS NULL OR e.category=$9)
          ORDER BY e.created_at DESC,e.id DESC LIMIT $10 OFFSET $11`,
        [req.user!.tenantId, filters.siteId || null, filters.clientId || null, filters.employeeId || null,
          filters.routeId || null, filters.status || null, filters.from || null, filters.to || null,
          filters.category || null, filters.limit, filters.offset]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listScanAttempts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = listQuerySchema.parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT a.id,a.site_id,s.name AS site_name,a.checkpoint_id,c.code AS checkpoint_code,
                a.round_id,r.route_id,r.status AS round_status,a.actor_user_id,
                employee.id AS employee_id,concat_ws(' ',employee.first_name,employee.last_name) AS employee_name,
                a.client_mutation_id,a.method,a.outcome,a.reason_code,a.client_captured_at,a.server_received_at
           FROM patrol_scan_attempts a
           LEFT JOIN sites s ON s.id=a.site_id AND s.tenant_id=a.tenant_id
           LEFT JOIN patrol_checkpoints c ON c.id=a.checkpoint_id AND c.tenant_id=a.tenant_id
           LEFT JOIN patrol_rounds r ON r.id=a.round_id AND r.tenant_id=a.tenant_id
           LEFT JOIN employees employee ON employee.tenant_id=a.tenant_id
             AND employee.account_user_id=a.actor_user_id
          WHERE a.tenant_id=$1
            AND ($2::uuid IS NULL OR a.site_id=$2)
            AND ($3::uuid IS NULL OR s.client_id=$3)
            AND ($4::uuid IS NULL OR employee.id=$4)
            AND ($5::uuid IS NULL OR r.route_id=$5)
            AND ($6::text IS NULL OR r.status=$6)
            AND ($7::date IS NULL OR a.server_received_at >= $7::date)
            AND ($8::date IS NULL OR a.server_received_at < $8::date + interval '1 day')
          ORDER BY a.server_received_at DESC,a.id DESC LIMIT $9 OFFSET $10`,
        [req.user!.tenantId, filters.siteId || null, filters.clientId || null, filters.employeeId || null,
          filters.routeId || null, filters.status || null, filters.from || null, filters.to || null,
          filters.limit, filters.offset]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function createException(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = exceptionSchema.parse(req.body);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const { clientMutationId, ...exceptionPayload } = input;
      return recordPatrolException(db, req.user!.tenantId, req.user!.userId,
        clientMutationId, exceptionPayload, input.capturedAt, computePayloadHash(input));
    });
    res.status(data.idempotent ? 200 : 201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function startRound(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = roundSchema.parse(req.body);
    const { clientMutationId, ...roundPayload } = input;
    const data = await withTenantTransaction(req.user!.tenantId, db =>
      recordPatrolRoundStart(
        db, req.user!.tenantId, req.user!.userId, clientMutationId, roundPayload,
        computePayloadHash({ recordType: 'round_start', ...roundPayload })
      )
    );
    res.status(data.idempotent ? 200 : 201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function recordPatrolRoundStart(
  db: PoolClient,
  tenantId: string,
  userId: string,
  clientMutationId: string,
  payload: Record<string, unknown>,
  payloadHash = computePayloadHash(payload)
): Promise<{
  id: string;
  site_id: string;
  route_id: string | null;
  route_version: number | null;
  status: string;
  started_at: string;
  idempotent: boolean;
}> {
  const parsed = roundSchema.omit({ clientMutationId: true }).safeParse(payload);
  if (!parsed.success) throw statusError(400, 'Kontrollgangsstart ist unvollständig oder ungültig.');
  const input = parsed.data;
  const startedAt = Date.parse(input.startedAt);
  if (startedAt > Date.now() + 5 * 60 * 1000) throw statusError(400, 'Startzeit liegt unzulässig in der Zukunft.');

  const assignment = await db.query(
    `SELECT e.id FROM employees e
      WHERE e.tenant_id=$1 AND e.account_user_id=$2 AND e.archived_at IS NULL
        AND EXISTS (
          SELECT 1 FROM employee_site_assignments esa
           WHERE esa.tenant_id=e.tenant_id AND esa.employee_id=e.id AND esa.site_id=$3
        )
      LIMIT 1`,
    [tenantId, userId, input.siteId]
  );
  if (!assignment.rows.length) {
    throw statusError(403, 'Für dieses Konto ist keine aktive Mitarbeiterzuordnung zu diesem Objekt hinterlegt.');
  }

  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `${tenantId}:patrol:round:${clientMutationId}`
  ]);
  const prior = await db.query(
    `SELECT id,route_id,route_version,site_id,started_at,payload_hash,guard_user_id,status
       FROM patrol_rounds WHERE tenant_id=$1 AND client_mutation_id=$2`,
    [tenantId, clientMutationId]
  );
  if (prior.rows.length) {
    if (prior.rows[0].guard_user_id !== userId) {
      throw statusError(409, 'Mutations-ID ist bereits einem anderen Benutzer zugeordnet.');
    }
    if (prior.rows[0].payload_hash !== payloadHash) {
      throw statusError(409, 'Mutations-ID wurde mit abweichendem Kontrollgang wiederverwendet.');
    }
    return {
      id: prior.rows[0].id,
      site_id: prior.rows[0].site_id,
      route_id: prior.rows[0].route_id,
      route_version: prior.rows[0].route_version,
      started_at: prior.rows[0].started_at,
      status: prior.rows[0].status,
      idempotent: true
    };
  }

  let routeId: string | null = null;
  let routeVersion: number | null = null;
  if (input.routeId) {
    const route = await db.query(
      `SELECT id,site_id,current_version FROM patrol_routes
        WHERE id=$1 AND tenant_id=$2 AND active=true AND archived_at IS NULL`,
      [input.routeId, tenantId]
    );
    if (!route.rows.length || route.rows[0].site_id !== input.siteId) {
      throw statusError(404, 'Aktive Route nicht gefunden oder Objekt stimmt nicht überein.');
    }
    routeId = route.rows[0].id;
    routeVersion = input.routeVersion ?? Number(route.rows[0].current_version);
    const versionExists = await db.query(
      'SELECT 1 FROM patrol_route_versions WHERE tenant_id=$1 AND route_id=$2 AND version=$3',
      [tenantId, routeId, routeVersion]
    );
    if (!versionExists.rows.length) throw statusError(409, 'Die zwischengespeicherte Routenversion ist nicht mehr verfügbar.');
    const routeAssignments = await db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE employee_id=$4)::int AS assigned
         FROM patrol_route_version_assignments
        WHERE tenant_id=$1 AND route_id=$2
          AND route_version_id=(SELECT id FROM patrol_route_versions WHERE tenant_id=$1 AND route_id=$2 AND version=$3)`,
      [tenantId, routeId, routeVersion, assignment.rows[0].id]
    );
    if (routeAssignments.rows[0].total > 0 && routeAssignments.rows[0].assigned === 0) {
      throw statusError(403, 'Mitarbeiter ist dieser Routenversion nicht zugeordnet.');
    }
  } else if (input.routeVersion !== undefined) {
    throw statusError(400, 'Eine Routenversion erfordert eine Routen-ID.');
  }

  const roundId = input.roundId || crypto.randomUUID();
  const collision = await db.query('SELECT 1 FROM patrol_rounds WHERE tenant_id=$1 AND id=$2', [tenantId, roundId]);
  if (collision.rows.length) throw statusError(409, 'Kontrollgangs-ID ist bereits vergeben.');
  if (routeId && routeVersion !== null) {
    await materializePatrolOccurrences(db, tenantId, new Date(input.startedAt), 0, 0);
  }
  const inserted = await db.query(
    `INSERT INTO patrol_rounds
      (id,tenant_id,site_id,route_id,route_version,guard_user_id,client_mutation_id,payload_hash,client_captured_at,started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     RETURNING id,site_id,route_id,route_version,status,started_at`,
    [roundId, tenantId, input.siteId, routeId, routeVersion, userId, clientMutationId, payloadHash, input.startedAt]
  );
  const round = inserted.rows[0];
  await writeEvent(db, tenantId, input.siteId, userId, 'round', round.id, 'started', {
    routeId, routeVersion, clientCapturedAt: input.startedAt
  });
  if (routeId && routeVersion !== null) {
    const occurrence = await db.query(
      `SELECT o.id
         FROM patrol_schedule_occurrences o
         JOIN patrol_route_versions v
           ON v.tenant_id=o.tenant_id AND v.route_id=o.route_id AND v.version=o.route_version
        WHERE o.tenant_id=$1 AND o.route_id=$2 AND o.route_version=$3
          AND o.status='scheduled' AND o.round_id IS NULL
          AND o.scheduled_at - make_interval(mins => v.late_tolerance_minutes) <= $4::timestamptz
          AND o.deadline_at >= $4::timestamptz
        ORDER BY abs(EXTRACT(EPOCH FROM (o.scheduled_at - $4::timestamptz)))
        LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,
      [tenantId, routeId, routeVersion, input.startedAt]
    );
    if (occurrence.rows.length) {
      await db.query(
        `UPDATE patrol_schedule_occurrences
            SET status='in_progress',round_id=$1,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$2 AND id=$3 AND status='scheduled'`,
        [round.id, tenantId, occurrence.rows[0].id]
      );
      await db.query(
        `INSERT INTO patrol_schedule_occurrence_events
           (tenant_id,occurrence_id,actor_user_id,actor_type,action,details)
         VALUES ($1,$2,$3,'user','round_started',jsonb_build_object('roundId',$4::uuid))`,
        [tenantId, occurrence.rows[0].id, userId, round.id]
      );
    }
  }
  return { ...round, idempotent: false };
}

export async function completeRound(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const roundId = uuid.parse(req.params.id);
    const body = z.object({
      clientMutationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
      completedAt: dateTime.optional(),
      notes: z.string().trim().max(2000).optional()
    }).strict().parse(req.body);
    const completedAt = body.completedAt || new Date().toISOString();
    const clientMutationId = body.clientMutationId || crypto.randomUUID();
    const payload = { roundId, completedAt, ...(body.notes !== undefined ? { notes: body.notes } : {}) };
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      return recordPatrolRoundCompletion(
        db, req.user!.tenantId, req.user!.userId, clientMutationId, payload,
        computePayloadHash({ recordType: 'round_complete', ...payload })
      );
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function recordPatrolRoundCompletion(
  db: PoolClient,
  tenantId: string,
  userId: string,
  clientMutationId: string,
  payload: Record<string, unknown>,
  payloadHash = computePayloadHash(payload)
): Promise<{ id: string; site_id: string; completed_at: string; status: 'completed'; idempotent: boolean }> {
  const parsed = roundCompletionSchema.safeParse(payload);
  if (!parsed.success) throw statusError(400, 'Kontrollgangsabschluss ist unvollständig oder ungültig.');
  const input = parsed.data;
  const completedTime = Date.parse(input.completedAt);
  if (completedTime > Date.now() + 5 * 60 * 1000) throw statusError(400, 'Abschlusszeit liegt unzulässig in der Zukunft.');

  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `${tenantId}:patrol:round-complete:${clientMutationId}`
  ]);
  const prior = await db.query(
    `SELECT id,site_id,guard_user_id,completion_payload_hash,completed_at
       FROM patrol_rounds
      WHERE tenant_id=$1 AND completion_client_mutation_id=$2`,
    [tenantId, clientMutationId]
  );
  if (prior.rows.length) {
    if (prior.rows[0].guard_user_id !== userId) {
      throw statusError(409, 'Abschlussmutation ist bereits einem anderen Benutzer zugeordnet.');
    }
    if (prior.rows[0].id !== input.roundId || prior.rows[0].completion_payload_hash !== payloadHash) {
      throw statusError(409, 'Abschlussmutations-ID wurde mit abweichendem Inhalt wiederverwendet.');
    }
    return {
      id: prior.rows[0].id,
      site_id: prior.rows[0].site_id,
      completed_at: prior.rows[0].completed_at,
      status: 'completed',
      idempotent: true
    };
  }

  const round = await db.query(
    `SELECT id,site_id,status,guard_user_id,route_id,route_version,started_at FROM patrol_rounds
      WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
    [input.roundId, tenantId]
  );
  if (!round.rows.length || round.rows[0].guard_user_id !== userId) {
    throw statusError(404, 'Kontrollgang nicht gefunden oder gehört nicht zu diesem Konto.');
  }
  if (round.rows[0].status !== 'in_progress') {
    throw statusError(409, 'Kontrollgang ist nicht mehr aktiv.');
  }
  const result = await db.query(
    `UPDATE patrol_rounds
        SET status='completed',completed_at=$1,completion_client_captured_at=$1,
            completion_server_received_at=CURRENT_TIMESTAMP,completion_client_mutation_id=$2,
              completion_payload_hash=$3,completion_notes=$4
      WHERE id=$5 AND tenant_id=$6 AND guard_user_id=$7 AND status='in_progress'
      RETURNING id,site_id,completed_at`,
    [input.completedAt, clientMutationId, payloadHash, input.notes, input.roundId, tenantId, userId]
  );
  if (!result.rows.length) throw statusError(409, 'Kontrollgang wurde parallel abgeschlossen.');
  await writeEvent(db, tenantId, round.rows[0].site_id, userId, 'round', input.roundId, 'completed', {
    clientCapturedAt: input.completedAt,
    clientMutationId,
    notes: input.notes
  });
  const scheduledOccurrence = await db.query(
    `UPDATE patrol_schedule_occurrences
        SET status='completed',resolved_at=$1,updated_at=$1
      WHERE tenant_id=$2 AND round_id=$3 AND status='in_progress'
      RETURNING id`,
    [input.completedAt, tenantId, input.roundId]
  );
  if (scheduledOccurrence.rows.length) {
    await db.query(
      `INSERT INTO patrol_schedule_occurrence_events
         (tenant_id,occurrence_id,actor_user_id,actor_type,action,details,occurred_at)
       VALUES ($1,$2,$3,'user','round_completed',jsonb_build_object('roundId',$4::uuid),$5)`,
      [tenantId, scheduledOccurrence.rows[0].id, userId, input.roundId, input.completedAt]
    );
  }
  if (round.rows[0].route_id && round.rows[0].route_version !== null) {
    const routeSettings = await db.query(
      `SELECT target_duration_minutes,late_tolerance_minutes
         FROM patrol_route_versions
        WHERE tenant_id=$1 AND route_id=$2 AND version=$3`,
      [tenantId, round.rows[0].route_id, round.rows[0].route_version]
    );
    const missing = await db.query(
      `SELECT vc.checkpoint_id,c.code,vc.sequence_no
         FROM patrol_route_version_checkpoints vc
         JOIN patrol_route_versions rv
           ON rv.id=vc.route_version_id AND rv.tenant_id=vc.tenant_id
         JOIN patrol_checkpoints c ON c.tenant_id=vc.tenant_id AND c.id=vc.checkpoint_id
        WHERE vc.tenant_id=$1 AND rv.route_id=$2 AND rv.version=$3
          AND NOT EXISTS (
            SELECT 1 FROM patrol_scans ps
             WHERE ps.tenant_id=$1 AND ps.round_id=$4 AND ps.checkpoint_uuid=vc.checkpoint_id
          )`,
      [tenantId, round.rows[0].route_id, round.rows[0].route_version, input.roundId]
    );
    for (const checkpoint of missing.rows) {
      await recordAutomaticPatrolException(db, tenantId, userId, {
        siteId: round.rows[0].site_id,
        roundId: input.roundId,
        checkpointId: checkpoint.checkpoint_id,
        category: 'missed_checkpoint',
        capturedAt: input.completedAt,
        description: `Kontrollgang abgeschlossen, ohne Kontrollpunkt ${checkpoint.code} zu erfassen.`
      });
    }
    const targetDuration = routeSettings.rows.length ? routeSettings.rows[0].target_duration_minutes : null;
    const elapsedMinutes = (Date.parse(input.completedAt) - Date.parse(String(round.rows[0].started_at))) / 60_000;
    if (targetDuration !== null && targetDuration !== undefined &&
        elapsedMinutes > Number(targetDuration) + Number(routeSettings.rows[0].late_tolerance_minutes)) {
      const firstCheckpoint = await db.query(
        `SELECT checkpoint_id FROM patrol_route_version_checkpoints vc
          JOIN patrol_route_versions rv ON rv.id=vc.route_version_id AND rv.tenant_id=vc.tenant_id
         WHERE vc.tenant_id=$1 AND rv.route_id=$2 AND rv.version=$3
         ORDER BY vc.sequence_no LIMIT 1`,
        [tenantId, round.rows[0].route_id, round.rows[0].route_version]
      );
      if (firstCheckpoint.rows.length) {
        await recordAutomaticPatrolException(db, tenantId, userId, {
          siteId: round.rows[0].site_id,
          roundId: input.roundId,
          checkpointId: firstCheckpoint.rows[0].checkpoint_id,
          category: 'late_checkpoint',
          capturedAt: input.completedAt,
          description: `Kontrollgang überschritt die Soll-Dauer von ${targetDuration} Minuten zuzüglich Toleranz.`
        });
      }
    }
  }
  return { ...result.rows[0], status: 'completed', idempotent: false };
}

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = listQuerySchema.parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const [scans, exceptions, rounds, scheduledOccurrences] = await Promise.all([
        db.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE p.verification_status='verified')::int AS verified,
                  count(*) FILTER (WHERE p.verification_status='manual')::int AS manual
             FROM patrol_scans p
             JOIN sites s ON s.id=p.site_id AND s.tenant_id=p.tenant_id
             LEFT JOIN patrol_rounds r ON r.id=p.round_id AND r.tenant_id=p.tenant_id
            WHERE p.tenant_id=$1 AND ($2::uuid IS NULL OR p.site_id=$2)
              AND ($3::uuid IS NULL OR s.client_id=$3)
              AND ($4::uuid IS NULL OR p.guard_id=$4)
              AND ($5::uuid IS NULL OR r.route_id=$5)
              AND ($6::text IS NULL OR r.status=$6)
              AND ($7::date IS NULL OR p.scanned_at >= $7::date)
              AND ($8::date IS NULL OR p.scanned_at < $8::date + interval '1 day')`,
          [req.user!.tenantId, filters.siteId || null, filters.clientId || null, filters.employeeId || null,
            filters.routeId || null, filters.status || null, filters.from || null, filters.to || null]
        ),
        db.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE severity IN ('high','critical'))::int AS urgent
             FROM patrol_exceptions e
             JOIN sites s ON s.id=e.site_id AND s.tenant_id=e.tenant_id
             LEFT JOIN patrol_rounds r ON r.id=e.round_id AND r.tenant_id=e.tenant_id
             LEFT JOIN employees employee ON employee.tenant_id=e.tenant_id
               AND employee.account_user_id=COALESCE(r.guard_user_id,e.created_by_user_id)
            WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.site_id=$2)
              AND ($3::uuid IS NULL OR s.client_id=$3)
              AND ($4::uuid IS NULL OR employee.id=$4)
              AND ($5::uuid IS NULL OR r.route_id=$5)
              AND ($6::text IS NULL OR r.status=$6)
              AND ($7::text IS NULL OR e.category=$7)
              AND ($8::date IS NULL OR e.created_at >= $8::date)
              AND ($9::date IS NULL OR e.created_at < $9::date + interval '1 day')`,
          [req.user!.tenantId, filters.siteId || null, filters.clientId || null, filters.employeeId || null,
            filters.routeId || null, filters.status || null, filters.category || null,
            filters.from || null, filters.to || null]
        ),
        db.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE r.status='in_progress')::int AS in_progress,
                  count(*) FILTER (WHERE r.status='completed')::int AS completed
             FROM patrol_rounds r
             JOIN sites s ON s.id=r.site_id AND s.tenant_id=r.tenant_id
             LEFT JOIN employees e ON e.tenant_id=r.tenant_id AND e.account_user_id=r.guard_user_id
            WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.site_id=$2)
              AND ($3::uuid IS NULL OR s.client_id=$3)
              AND ($4::uuid IS NULL OR e.id=$4)
              AND ($5::uuid IS NULL OR r.route_id=$5)
              AND ($6::text IS NULL OR r.status=$6)
              AND ($7::date IS NULL OR r.started_at >= $7::date)
              AND ($8::date IS NULL OR r.started_at < $8::date + interval '1 day')`,
          [req.user!.tenantId, filters.siteId || null, filters.clientId || null, filters.employeeId || null,
            filters.routeId || null, filters.status || null, filters.from || null, filters.to || null]
        ),
        db.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE o.status='scheduled')::int AS scheduled,
                  count(*) FILTER (WHERE o.status='missed')::int AS missed,
                  count(*) FILTER (WHERE o.status='abandoned')::int AS abandoned
             FROM patrol_schedule_occurrences o
             JOIN sites s ON s.id=o.site_id AND s.tenant_id=o.tenant_id
             LEFT JOIN patrol_rounds r ON r.tenant_id=o.tenant_id AND r.id=o.round_id
             LEFT JOIN employees e ON e.tenant_id=r.tenant_id AND e.account_user_id=r.guard_user_id
            WHERE o.tenant_id=$1 AND ($2::uuid IS NULL OR o.site_id=$2)
              AND ($3::uuid IS NULL OR s.client_id=$3)
              AND ($4::uuid IS NULL OR e.id=$4)
              AND ($5::uuid IS NULL OR o.route_id=$5)
              AND ($6::text IS NULL OR o.status=$6)
              AND ($7::date IS NULL OR o.scheduled_at >= $7::date)
              AND ($8::date IS NULL OR o.scheduled_at < $8::date + interval '1 day')`,
          [req.user!.tenantId, filters.siteId || null, filters.clientId || null, filters.employeeId || null,
            filters.routeId || null, filters.status || null, filters.from || null, filters.to || null]
        )
      ]);
      const canReadAttempts = req.user!.permissions.includes('patrol:scan-attempt:read') ||
        req.user!.permissions.includes('patrol:history:read') || req.user!.permissions.includes('patrol:audit');
      const attempts = canReadAttempts ? await db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE a.outcome='rejected')::int AS rejected,
                count(*) FILTER (WHERE a.outcome='duplicate')::int AS duplicate
           FROM patrol_scan_attempts a
           LEFT JOIN sites s ON s.id=a.site_id AND s.tenant_id=a.tenant_id
           LEFT JOIN patrol_rounds r ON r.id=a.round_id AND r.tenant_id=a.tenant_id
           LEFT JOIN employees e ON e.tenant_id=a.tenant_id AND e.account_user_id=a.actor_user_id
          WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR a.site_id=$2)
            AND ($3::uuid IS NULL OR s.client_id=$3)
            AND ($4::uuid IS NULL OR e.id=$4)
            AND ($5::uuid IS NULL OR r.route_id=$5)
            AND ($6::text IS NULL OR r.status=$6)
            AND ($7::date IS NULL OR a.server_received_at >= $7::date)
            AND ($8::date IS NULL OR a.server_received_at < $8::date + interval '1 day')`,
        [req.user!.tenantId, filters.siteId || null, filters.clientId || null, filters.employeeId || null,
          filters.routeId || null, filters.status || null, filters.from || null, filters.to || null]
      ) : null;
      return {
        scans: scans.rows[0],
        exceptions: exceptions.rows[0],
        rounds: rounds.rows[0],
        scheduledOccurrences: scheduledOccurrences.rows[0],
        scanAttempts: attempts?.rows[0] ?? null
      };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = listQuerySchema.parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT id,site_id,actor_user_id,entity_type,entity_id,action,details,occurred_at
           FROM patrol_events
          WHERE tenant_id=$1 AND ($2::uuid IS NULL OR site_id=$2)
            AND ($3::date IS NULL OR occurred_at >= $3::date)
            AND ($4::date IS NULL OR occurred_at < $4::date + interval '1 day')
          ORDER BY occurred_at DESC,id DESC LIMIT $5 OFFSET $6`,
        [req.user!.tenantId, filters.siteId || null, filters.from || null, filters.to || null, filters.limit, filters.offset]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
