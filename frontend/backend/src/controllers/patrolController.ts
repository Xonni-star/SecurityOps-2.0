import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import { computePayloadHash } from '../services/syncHash';

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });

const listQueryBaseSchema = z.object({
  siteId: uuid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  status: z.enum(['in_progress', 'completed', 'abandoned']).optional(),
  category: z.enum(['missed_checkpoint', 'late_checkpoint', 'access_blocked', 'hazard', 'damage', 'other']).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
}).strict();

const listQuerySchema = listQueryBaseSchema.superRefine((query, ctx) => {
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
  checkpoints: z.array(z.object({
    checkpointId: uuid,
    plannedOffsetMinutes: z.number().int().min(0).max(10080).default(0)
  }).strict()).min(1).max(100)
}).strict();

function validateUniqueRouteCheckpoints(
  route: { checkpoints: Array<{ checkpointId: string }> },
  ctx: z.RefinementCtx
): void {
  if (new Set(route.checkpoints.map(item => item.checkpointId)).size !== route.checkpoints.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkpoints'], message: 'Ein Kontrollpunkt darf pro Routenversion nur einmal vorkommen.' });
  }
}

const routeSchema = routeBaseSchema.superRefine(validateUniqueRouteCheckpoints);
const routeVersionSchema = routeBaseSchema.omit({ siteId: true, code: true }).superRefine(validateUniqueRouteCheckpoints);

const exceptionSchema = z.object({
  siteId: uuid,
  roundId: uuid.optional(),
  scanId: uuid.optional(),
  checkpointId: uuid.optional(),
  category: z.enum(['missed_checkpoint', 'late_checkpoint', 'access_blocked', 'hazard', 'damage', 'other']),
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
  completedAt: dateTime
}).strict();

function statusError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
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
    scannedAt: dateTime.optional()
  }).strict().safeParse(payload);
  if (!parsed.success) throw statusError(400, 'Kontrollgangs-Scan ist unvollständig oder ungültig.');

  const input = parsed.data;
  const capturedAt = input.scannedAt || clientTimestamp;
  if (!dateTime.safeParse(capturedAt).success) throw statusError(400, 'Erfassungszeitpunkt ist ungültig.');
  const capturedTime = Date.parse(capturedAt);
  if (capturedTime > Date.now() + 5 * 60 * 1000) throw statusError(400, 'Erfassungszeitpunkt liegt unzulässig in der Zukunft.');

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
    throw statusError(403, 'Für dieses Konto ist keine aktive Mitarbeiterzuordnung zu diesem Objekt hinterlegt.');
  }
  const guardId = employee.rows[0].id as string;

  if (input.roundId) {
    const round = await db.query(
      `SELECT id FROM patrol_rounds
        WHERE id=$1 AND tenant_id=$2 AND site_id=$3 AND guard_user_id=$4 AND status='in_progress'`,
      [input.roundId, tenantId, input.siteId, userId]
    );
    if (!round.rows.length) throw statusError(409, 'Kontrollgang ist nicht aktiv oder gehört nicht zu diesem Objekt/Konto.');
  }

  const checkpoint = await db.query(
    `SELECT id, code, name, token_hash, token_version
       FROM patrol_checkpoints
      WHERE id=$1 AND tenant_id=$2 AND site_id=$3 AND active=true AND archived_at IS NULL`,
    [input.checkpointId, tenantId, input.siteId]
  );
  if (!checkpoint.rows.length) throw statusError(404, 'Kontrollpunkt ist nicht aktiv oder nicht diesem Objekt zugeordnet.');
  const point = checkpoint.rows[0];
  const isManual = input.method === 'MANUELL';
  if (!isManual) {
    if (!input.checkpointToken || hashToken(input.checkpointToken) !== String(point.token_hash).trim()) {
      throw statusError(403, 'Kontrollpunkt-Token ist ungültig oder wurde rotiert.');
    }
    if (input.checkpointTokenVersion !== undefined && input.checkpointTokenVersion !== Number(point.token_version)) {
      throw statusError(409, 'Kontrollpunkt-Token-Version ist veraltet. Bitte den aktuellen Code verwenden.');
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
  if (duplicate.rows.length) throw statusError(409, 'Dieser Kontrollpunkt wurde von Ihnen innerhalb des Zwei-Minuten-Fensters bereits erfasst.');

  const inserted = await db.query(
    `INSERT INTO patrol_scans (
        tenant_id, site_id, checkpoint_id, checkpoint_uuid, checkpoint_code, checkpoint_name,
        guard_id, scanned_at, method, verified_tag, notes, client_mutation_id, round_id,
        checkpoint_token_version, client_captured_at, payload_hash, verification_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$8,$15,$16)
     RETURNING id`,
    [
      tenantId, input.siteId, input.checkpointId, input.checkpointId, point.code, point.name,
      guardId, capturedAt, input.method, isManual ? 'manual' : hashToken(input.checkpointToken!).slice(0, 24),
      input.notes || null, clientMutationId, input.roundId || null,
      isManual ? null : Number(point.token_version), payloadHash, isManual ? 'manual' : 'verified'
    ]
  );
  const scanId = inserted.rows[0].id as string;
  await writeEvent(db, tenantId, input.siteId, userId, 'scan', scanId, 'recorded', {
    checkpointId: input.checkpointId,
    method: input.method,
    verificationStatus: isManual ? 'manual' : 'verified',
    clientMutationId
  });
  return { id: scanId, verificationStatus: isManual ? 'manual' : 'verified' };
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
  checkpoints: Array<{ checkpointId: string; plannedOffsetMinutes: number }>
): Promise<string> {
  const inserted = await db.query(
    `INSERT INTO patrol_route_versions (tenant_id,route_id,version,name,change_reason,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tenantId, routeId, version, name, changeReason, actorUserId]
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
  await writeEvent(db, tenantId, siteId, actorUserId, 'route_version', versionId, 'created', {
    routeId, version, changeReason, checkpointCount: checkpoints.length
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
                COALESCE(jsonb_agg(jsonb_build_object(
                  'checkpointId',c.id,'code',c.code,'name',c.name,'sequence',vc.sequence_no,
                  'plannedOffsetMinutes',vc.planned_offset_minutes
                ) ORDER BY vc.sequence_no) FILTER (WHERE c.id IS NOT NULL),'[]'::jsonb) AS checkpoints
           FROM patrol_routes r JOIN sites s ON s.id=r.site_id AND s.tenant_id=r.tenant_id
           JOIN patrol_route_versions v ON v.tenant_id=r.tenant_id AND v.route_id=r.id AND v.version=r.current_version
           LEFT JOIN patrol_route_version_checkpoints vc ON vc.tenant_id=v.tenant_id AND vc.route_version_id=v.id
           LEFT JOIN patrol_checkpoints c ON c.tenant_id=vc.tenant_id AND c.id=vc.checkpoint_id
          WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR r.site_id=$2)
          GROUP BY r.id,s.name,v.id ORDER BY s.name,r.route_code`,
        [req.user!.tenantId, siteId || null]
      );
      return result.rows;
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
        db, req.user!.tenantId, req.user!.userId, routeId, input.siteId, 1, input.name, input.changeReason, input.checkpoints
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
        input.name, input.changeReason, input.checkpoints
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
          WHERE p.tenant_id=$1
            AND ($2::uuid IS NULL OR p.site_id=$2)
            AND ($3::date IS NULL OR p.scanned_at >= $3::date)
            AND ($4::date IS NULL OR p.scanned_at < $4::date + interval '1 day')
          ORDER BY p.scanned_at DESC,p.id DESC LIMIT $5 OFFSET $6`,
        [req.user!.tenantId, filters.siteId || null, filters.from || null, filters.to || null, filters.limit, filters.offset]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listRounds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = listQuerySchema.parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const result = await db.query(
        `SELECT r.id,r.site_id,s.name AS site_name,r.route_id,r.route_version,r.status,
                r.started_at,r.completed_at,r.client_captured_at,r.server_received_at
           FROM patrol_rounds r JOIN sites s ON s.id=r.site_id AND s.tenant_id=r.tenant_id
          WHERE r.tenant_id=$1 AND r.guard_user_id=$2
            AND ($3::uuid IS NULL OR r.site_id=$3)
            AND ($4::text IS NULL OR r.status=$4)
            AND ($5::date IS NULL OR r.started_at >= $5::date)
            AND ($6::date IS NULL OR r.started_at < $6::date + interval '1 day')
          ORDER BY r.started_at DESC,r.id DESC LIMIT $7 OFFSET $8`,
        [req.user!.tenantId, req.user!.userId, filters.siteId || null, filters.status || null,
          filters.from || null, filters.to || null, filters.limit, filters.offset]
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
                e.created_by_user_id,e.created_at
           FROM patrol_exceptions e JOIN sites s ON s.id=e.site_id AND s.tenant_id=e.tenant_id
          WHERE e.tenant_id=$1
            AND ($2::uuid IS NULL OR e.site_id=$2)
            AND ($3::date IS NULL OR e.created_at >= $3::date)
            AND ($4::date IS NULL OR e.created_at < $4::date + interval '1 day')
            AND ($5::text IS NULL OR e.category=$5)
          ORDER BY e.created_at DESC,e.id DESC LIMIT $6 OFFSET $7`,
        [req.user!.tenantId, filters.siteId || null, filters.from || null, filters.to || null,
          filters.category || null, filters.limit, filters.offset]
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
  } else if (input.routeVersion !== undefined) {
    throw statusError(400, 'Eine Routenversion erfordert eine Routen-ID.');
  }

  const roundId = input.roundId || crypto.randomUUID();
  const collision = await db.query('SELECT 1 FROM patrol_rounds WHERE tenant_id=$1 AND id=$2', [tenantId, roundId]);
  if (collision.rows.length) throw statusError(409, 'Kontrollgangs-ID ist bereits vergeben.');
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
  return { ...round, idempotent: false };
}

export async function completeRound(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const roundId = uuid.parse(req.params.id);
    const body = z.object({
      clientMutationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
      completedAt: dateTime.optional()
    }).strict().parse(req.body);
    const completedAt = body.completedAt || new Date().toISOString();
    const clientMutationId = body.clientMutationId || crypto.randomUUID();
    const payload = { roundId, completedAt };
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
    `SELECT id,site_id,status,guard_user_id FROM patrol_rounds
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
            completion_payload_hash=$3
      WHERE id=$4 AND tenant_id=$5 AND guard_user_id=$6 AND status='in_progress'
      RETURNING id,site_id,completed_at`,
    [input.completedAt, clientMutationId, payloadHash, input.roundId, tenantId, userId]
  );
  if (!result.rows.length) throw statusError(409, 'Kontrollgang wurde parallel abgeschlossen.');
  await writeEvent(db, tenantId, round.rows[0].site_id, userId, 'round', input.roundId, 'completed', {
    clientCapturedAt: input.completedAt,
    clientMutationId
  });
  return { ...result.rows[0], status: 'completed', idempotent: false };
}

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = listQuerySchema.parse(req.query);
    const data = await withTenantTransaction(req.user!.tenantId, async db => {
      const [scans, exceptions, rounds] = await Promise.all([
        db.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE verification_status='verified')::int AS verified,
                  count(*) FILTER (WHERE verification_status='manual')::int AS manual
             FROM patrol_scans
            WHERE tenant_id=$1 AND ($2::uuid IS NULL OR site_id=$2)
              AND ($3::date IS NULL OR scanned_at >= $3::date)
              AND ($4::date IS NULL OR scanned_at < $4::date + interval '1 day')`,
          [req.user!.tenantId, filters.siteId || null, filters.from || null, filters.to || null]
        ),
        db.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE severity IN ('high','critical'))::int AS urgent
             FROM patrol_exceptions
            WHERE tenant_id=$1 AND ($2::uuid IS NULL OR site_id=$2)
              AND ($3::date IS NULL OR created_at >= $3::date)
              AND ($4::date IS NULL OR created_at < $4::date + interval '1 day')`,
          [req.user!.tenantId, filters.siteId || null, filters.from || null, filters.to || null]
        ),
        db.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE status='in_progress')::int AS in_progress,
                  count(*) FILTER (WHERE status='completed')::int AS completed
             FROM patrol_rounds
            WHERE tenant_id=$1 AND ($2::uuid IS NULL OR site_id=$2)
              AND ($3::date IS NULL OR started_at >= $3::date)
              AND ($4::date IS NULL OR started_at < $4::date + interval '1 day')`,
          [req.user!.tenantId, filters.siteId || null, filters.from || null, filters.to || null]
        )
      ]);
      return {
        scans: scans.rows[0],
        exceptions: exceptions.rows[0],
        rounds: rounds.rows[0]
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
