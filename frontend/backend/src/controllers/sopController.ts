import { NextFunction, Request, Response } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';

const uuid = z.string().guid();
const contentSchema = z.union([z.record(z.string(), z.unknown()), z.string().max(50000)]);
const optionalEntityId = uuid.or(z.literal('')).nullable().optional();
const metadataSchema = {
  sopNumber: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(8000).optional(),
  siteId: optionalEntityId,
  customerId: optionalEntityId,
  mandatoryAcknowledgment: z.boolean().optional(),
  effectiveFrom: z.string().date().nullable().optional(),
  effectiveUntil: z.string().date().nullable().optional()
};
const effectiveDatesSchema = (value: { effectiveFrom?: string | null; effectiveUntil?: string | null }, ctx: z.RefinementCtx) => {
  if (value.effectiveFrom && value.effectiveUntil && value.effectiveUntil < value.effectiveFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effectiveUntil'],
      message: 'Das Gültigkeitsende darf nicht vor dem Gültigkeitsbeginn liegen.'
    });
  }
};
const createSchema = z.object({
  title: z.string().trim().min(1).max(255),
  content: contentSchema,
  dmsDocumentId: uuid.nullable().optional(),
  ...metadataSchema
}).strict().superRefine(effectiveDatesSchema);
const updateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: contentSchema.optional(),
  dmsDocumentId: uuid.nullable().optional(),
  ...metadataSchema
}).strict().superRefine(effectiveDatesSchema)
  .refine(value => Object.keys(value).length > 0, 'Mindestens ein Entwurfsfeld ist erforderlich.');
const versionSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: contentSchema.optional(),
  dmsDocumentId: uuid.nullable().optional(),
  ...metadataSchema,
  changeReason: z.string().trim().min(3).max(2000)
}).strict().superRefine(effectiveDatesSchema);
const reviewSchema = z.object({
  decision: z.enum(['changes_requested', 'reviewed']),
  comment: z.string().trim().min(1).max(4000)
}).strict();
const assignmentSchema = z.object({
  targets: z.array(z.object({
    type: z.enum(['employee', 'site', 'customer', 'tenant']),
    id: uuid.optional()
  }).strict()).min(1),
  dueAt: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((value, ctx) => {
  value.targets.forEach((target, index) => {
    if ((target.type === 'tenant') === (target.id !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targets', index, 'id'], message: 'Nur tenant-Ziele dürfen keine ID enthalten.' });
    }
  });
});
const acknowledgeSchema = z.object({
  confirmed: z.literal(true),
  clientMutationId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  capturedAt: z.string().datetime({ offset: true }).optional()
}).strict();

function statusError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function structuredContent(value: Record<string, unknown> | string): Record<string, unknown> {
  return typeof value === 'string' ? { text: value } : value;
}

function entityId(value: string | null | undefined): string | null | undefined {
  return value === '' ? null : value;
}

function validateEffectiveDates(from: string | null | undefined, until: string | null | undefined): void {
  if (from && until && until < from) {
    throw statusError(400, 'Das Gültigkeitsende darf nicht vor dem Gültigkeitsbeginn liegen.');
  }
}

function contentText(column: string): string {
  return `CASE WHEN jsonb_typeof(${column})='string' THEN ${column} #>> '{}'
          WHEN jsonb_typeof(${column})='object' AND ${column} ? 'text' THEN ${column}->>'text'
          ELSE ${column}::text END`;
}

async function assertSopReferences(
  db: PoolClient, tenantId: string,
  siteId: string | null | undefined, customerId: string | null | undefined
): Promise<void> {
  if (siteId && customerId) {
    const coherent = await db.query(
      'SELECT 1 FROM sites WHERE tenant_id=$1 AND id=$2 AND client_id=$3',
      [tenantId,siteId,customerId]
    );
    if (!coherent.rows.length) throw statusError(400, 'Das Objekt gehört nicht zum ausgewählten Kunden.');
    return;
  }
  if (siteId) {
    const site = await db.query('SELECT 1 FROM sites WHERE tenant_id=$1 AND id=$2', [tenantId, siteId]);
    if (!site.rows.length) throw statusError(404, 'Objekt nicht gefunden.');
  }
  if (customerId) {
    const customer = await db.query('SELECT 1 FROM clients WHERE tenant_id=$1 AND id=$2', [tenantId, customerId]);
    if (!customer.rows.length) throw statusError(404, 'Kunde nicht gefunden.');
  }
}

function managerView(req: Request): boolean {
  return ['sop:create', 'sop:update', 'sop:submit', 'sop:review', 'sop:approve',
    'sop:publish', 'sop:archive', 'sop:manage'].some(code => req.user!.permissions.includes(code));
}

async function writeEvent(
  db: PoolClient, tenantId: string, sopId: string, actorId: string, action: string,
  versionId: string | null = null, details: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO sop_events (tenant_id, sop_id, version_id, actor_user_id, action, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [tenantId, sopId, versionId, actorId, action, JSON.stringify(details)]
  );
}

async function assertDmsDocument(db: PoolClient, tenantId: string, documentId: string | null | undefined): Promise<void> {
  if (!documentId) return;
  const result = await db.query(
    `SELECT 1 FROM documents WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL`,
    [tenantId, documentId]
  );
  if (!result.rows.length) throw statusError(404, 'DMS-Dokument nicht gefunden.');
}

async function getSopForUpdate(db: PoolClient, tenantId: string, sopId: string): Promise<any> {
  const result = await db.query(
    `SELECT * FROM sop_instructions WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, sopId]
  );
  if (!result.rows.length) throw statusError(404, 'Dienstanweisung nicht gefunden.');
  return result.rows[0];
}

export async function listSops(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      if (managerView(req)) {
        return db.query(
          `SELECT s.id,s.tenant_id,COALESCE(dv.sop_number,v.sop_number,s.sop_number) AS sop_number,s.title,
                  COALESCE(dv.category,v.category,s.category) AS category,
                  COALESCE(dv.site_id,v.site_id,s.site_id) AS site_id,
                  COALESCE(dv.customer_id,v.customer_id,s.customer_id) AS customer_id,
                  COALESCE(dv.mandatory_acknowledgment,v.mandatory_acknowledgment,s.mandatory_acknowledgment) AS mandatory_acknowledgment,
                  s.status,s.created_by,s.current_version_id,s.draft_version_id,
                  s.description,s.effective_from,s.effective_until,
                  s.submitted_by_user_id,s.submitted_at,s.reviewed_by_user_id,s.reviewed_at,
                  s.approved_by_user_id,s.approved_at,s.published_by_user_id,s.published_at,
                  s.withdrawn_by_user_id,s.withdrawn_at,s.archived_by_user_id,s.archived_at,
                  ${contentText('COALESCE(s.draft_content,v.content)')} AS content,
                  COALESCE(s.draft_content,v.content) AS structured_content,
                  COALESCE(dv.version_number,v.version_number,1) AS version,
                  COALESCE(dv.submitted_at,v.submitted_at,s.created_at) AS effective_date,
                  concat(u.first_name,' ',u.last_name) AS author_name,s.draft_content,s.draft_dms_document_id,
                  v.dms_document_id,s.created_at,s.updated_at,
                  own.id AS assignment_id,
                  own.due_at,own.acknowledged_at,
                  CASE WHEN own.acknowledged_at IS NOT NULL THEN 'confirmed'
                       WHEN own.id IS NOT NULL THEN 'unacknowledged' ELSE 'unassigned' END AS current_user_acknowledgment,
                  COALESCE(counts.signed_count,0)::int AS signed_count,
                  COALESCE(counts.total_required,0)::int AS total_required
           FROM sop_instructions s
           LEFT JOIN sop_versions v ON v.id=s.current_version_id AND v.tenant_id=s.tenant_id
           LEFT JOIN sop_versions dv ON dv.id=s.draft_version_id AND dv.tenant_id=s.tenant_id
           LEFT JOIN users u ON u.id=s.created_by
           LEFT JOIN LATERAL (
             SELECT a.id,a.due_at,a.acknowledged_at
             FROM sop_assignments a JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
             WHERE a.tenant_id=s.tenant_id AND a.sop_id=s.id AND a.version_id=COALESCE(dv.id,v.id)
               AND lower(e.email)=lower($2) ORDER BY a.assigned_at DESC LIMIT 1
           ) own ON true
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS total_required,
                    COUNT(*) FILTER (WHERE a.acknowledged_at IS NOT NULL) AS signed_count
             FROM sop_assignments a
             WHERE a.tenant_id=s.tenant_id AND a.sop_id=s.id AND a.version_id=COALESCE(dv.id,v.id)
           ) counts ON true
           WHERE s.tenant_id=$1 ORDER BY s.updated_at DESC`,
          [user.tenantId,user.email]
        );
      }
      return db.query(
        `SELECT s.id,s.tenant_id,s.sop_number,v.title,v.description,v.category,v.site_id,v.customer_id,
                v.mandatory_acknowledgment,'published' AS status,
                v.effective_from,v.effective_until,
                v.version_number AS version,v.submitted_at AS effective_date,
                ${contentText('v.content')} AS content,v.content AS structured_content,
                concat(u.first_name,' ',u.last_name) AS author_name,a.id AS assignment_id,a.due_at,a.acknowledged_at,
                CASE WHEN a.acknowledged_at IS NOT NULL THEN 'confirmed' ELSE 'unacknowledged' END AS current_user_acknowledgment,
                v.dms_document_id,
                (SELECT COUNT(*)::int FROM sop_assignments x WHERE x.tenant_id=s.tenant_id
                  AND x.sop_id=s.id AND x.version_id=v.id AND x.acknowledged_at IS NOT NULL) AS signed_count,
                (SELECT COUNT(*)::int FROM sop_assignments x WHERE x.tenant_id=s.tenant_id
                  AND x.sop_id=s.id AND x.version_id=v.id) AS total_required
         FROM sop_instructions s
         JOIN sop_versions v ON v.id=s.current_version_id AND v.tenant_id=s.tenant_id
         JOIN sop_assignments a ON a.sop_id=s.id AND a.tenant_id=s.tenant_id
             AND a.version_id=v.id AND a.employee_id IN (
               SELECT id FROM employees WHERE tenant_id=$1 AND lower(email)=lower($2) AND archived_at IS NULL
             )
         LEFT JOIN users u ON u.id=s.created_by
         WHERE s.tenant_id=$1 AND s.current_version_id IS NOT NULL
           AND (v.effective_from IS NULL OR v.effective_from <= CURRENT_DATE)
           AND (v.effective_until IS NULL OR v.effective_until >= CURRENT_DATE)
         ORDER BY v.title`,
        [user.tenantId, user.email]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function createSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      await assertDmsDocument(db, user.tenantId, body.dmsDocumentId);
      await assertSopReferences(
        db,user.tenantId,entityId(body.siteId),entityId(body.customerId)
      );
      const created = await db.query(
        `INSERT INTO sop_instructions
          (tenant_id,sop_number,title,description,category,site_id,customer_id,mandatory_acknowledgment,
           effective_from,effective_until,created_by,draft_content,draft_dms_document_id)
         VALUES ($1,COALESCE($2,'SOP-' || substr(uuid_generate_v4()::text,1,8)),$3,COALESCE($4,''),
           COALESCE($5,'Allgemeine Dienstanweisung'),$6,$7,COALESCE($8,true),$9,$10,$11,$12::jsonb,$13)
         RETURNING id,tenant_id,sop_number,title,category,site_id,customer_id,mandatory_acknowledgment,
           description,effective_from,effective_until,status,draft_content AS structured_content,
           ${contentText('draft_content')} AS content,draft_dms_document_id,created_at`,
        [user.tenantId,body.sopNumber ?? null,body.title,body.description ?? null,body.category ?? null,
          entityId(body.siteId) ?? null,entityId(body.customerId) ?? null,body.mandatoryAcknowledgment ?? null,
          body.effectiveFrom ?? null,body.effectiveUntil ?? null,user.userId,
          JSON.stringify(structuredContent(body.content)),body.dmsDocumentId ?? null]
      );
      await writeEvent(db, user.tenantId, created.rows[0].id, user.userId, 'created');
      return created.rows[0];
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function updateSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updateSchema.parse(req.body);
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (sop.status !== 'draft' || sop.draft_version_id) throw statusError(409, 'Nur ein nicht eingereichter Entwurf kann bearbeitet werden.');
      await assertDmsDocument(db, user.tenantId, body.dmsDocumentId);
      await assertSopReferences(
        db,user.tenantId,
        body.siteId === undefined ? sop.site_id : entityId(body.siteId),
        body.customerId === undefined ? sop.customer_id : entityId(body.customerId)
      );
      validateEffectiveDates(
        body.effectiveFrom === undefined ? sop.effective_from : body.effectiveFrom,
        body.effectiveUntil === undefined ? sop.effective_until : body.effectiveUntil
      );
      const updated = await db.query(
        `UPDATE sop_instructions
         SET title=COALESCE($1,title), draft_content=COALESCE($2::jsonb,draft_content),
             draft_dms_document_id=CASE WHEN $3 THEN $4::uuid ELSE draft_dms_document_id END,
             sop_number=COALESCE($5,sop_number),category=COALESCE($6,category),
             description=COALESCE($7,description),
             site_id=CASE WHEN $8 THEN $9::uuid ELSE site_id END,
             customer_id=CASE WHEN $10 THEN $11::uuid ELSE customer_id END,
             mandatory_acknowledgment=COALESCE($12,mandatory_acknowledgment),
             effective_from=CASE WHEN $13 THEN $14::date ELSE effective_from END,
             effective_until=CASE WHEN $15 THEN $16::date ELSE effective_until END,
             updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$17 AND id=$18
         RETURNING id,tenant_id,sop_number,title,category,site_id,customer_id,mandatory_acknowledgment,
           description,effective_from,effective_until,status,draft_content AS structured_content,
           ${contentText('draft_content')} AS content,draft_dms_document_id,updated_at`,
        [body.title ?? null,body.content === undefined ? null : JSON.stringify(structuredContent(body.content)),
          body.dmsDocumentId !== undefined,body.dmsDocumentId ?? null,body.sopNumber ?? null,body.category ?? null,
          body.description ?? null,body.siteId !== undefined,entityId(body.siteId) ?? null,
          body.customerId !== undefined,entityId(body.customerId) ?? null,body.mandatoryAcknowledgment ?? null,
          body.effectiveFrom !== undefined,body.effectiveFrom ?? null,body.effectiveUntil !== undefined,
          body.effectiveUntil ?? null,user.tenantId,sopId]
      );
      await writeEvent(db, user.tenantId, sopId, user.userId, 'updated');
      return updated.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function listVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      if (managerView(req)) {
        const sop = await db.query('SELECT id FROM sop_instructions WHERE tenant_id=$1 AND id=$2', [user.tenantId, sopId]);
        if (!sop.rows.length) throw statusError(404, 'Dienstanweisung nicht gefunden.');
        return db.query(
          `SELECT v.id,v.version_number AS version,v.sop_number,v.title,v.description,v.category,
                  v.site_id,v.customer_id,v.mandatory_acknowledgment,v.effective_from,v.effective_until,
                  ${contentText('v.content')} AS content,v.content AS structured_content,v.dms_document_id,
                  v.change_reason AS "changeReason",
                  v.author_user_id AS created_by,concat(u.first_name,' ',u.last_name) AS created_by_name,
                  concat(u.first_name,' ',u.last_name) AS "createdBy",
                  v.submitted_by_user_id,concat(su.first_name,' ',su.last_name) AS submitted_by_name,
                  v.submitted_at AS "createdAt",
                  reviewer.actor_user_id AS reviewed_by_user_id,reviewer.occurred_at AS reviewed_at,
                  concat(ru.first_name,' ',ru.last_name) AS reviewer_name,reviewer.action AS review_decision,
                  approver.actor_user_id AS approved_by_user_id,approver.occurred_at AS approved_at,
                  concat(au.first_name,' ',au.last_name) AS approver_name,
                  publisher.actor_user_id AS published_by_user_id,publisher.occurred_at AS published_at,
                  concat(pu.first_name,' ',pu.last_name) AS publisher_name
           FROM sop_versions v LEFT JOIN users u ON u.id=v.author_user_id
           LEFT JOIN users su ON su.id=v.submitted_by_user_id
           LEFT JOIN LATERAL (
             SELECT actor_user_id,occurred_at,action FROM sop_events
             WHERE tenant_id=v.tenant_id AND sop_id=v.sop_id AND version_id=v.id
               AND action IN ('reviewed','changes_requested')
             ORDER BY occurred_at DESC LIMIT 1
           ) reviewer ON true
           LEFT JOIN users ru ON ru.id=reviewer.actor_user_id
           LEFT JOIN LATERAL (
             SELECT actor_user_id,occurred_at FROM sop_events
             WHERE tenant_id=v.tenant_id AND sop_id=v.sop_id AND version_id=v.id AND action='approved'
             ORDER BY occurred_at DESC LIMIT 1
           ) approver ON true
           LEFT JOIN users au ON au.id=approver.actor_user_id
           LEFT JOIN LATERAL (
             SELECT actor_user_id,occurred_at FROM sop_events
             WHERE tenant_id=v.tenant_id AND sop_id=v.sop_id AND version_id=v.id AND action='published'
             ORDER BY occurred_at DESC LIMIT 1
           ) publisher ON true
           LEFT JOIN users pu ON pu.id=publisher.actor_user_id
           WHERE v.tenant_id=$1 AND v.sop_id=$2 ORDER BY v.version_number DESC`,
          [user.tenantId, sopId]
        );
      }
      return db.query(
        `SELECT v.id,v.version_number AS version,v.title,v.description,v.effective_from,v.effective_until,
                ${contentText('v.content')} AS content,v.content AS structured_content,
                v.dms_document_id,v.submitted_at AS "createdAt"
         FROM sop_instructions s JOIN sop_versions v ON v.id=s.current_version_id AND v.tenant_id=s.tenant_id
         JOIN sop_assignments a ON a.sop_id=s.id AND a.tenant_id=s.tenant_id AND a.version_id=v.id
         JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
         WHERE s.tenant_id=$1 AND s.id=$2 AND lower(e.email)=lower($3)
           AND (v.effective_from IS NULL OR v.effective_from <= CURRENT_DATE)
           AND (v.effective_until IS NULL OR v.effective_until >= CURRENT_DATE)
         ORDER BY v.version_number DESC`,
        [user.tenantId, sopId, user.email]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function createVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = versionSchema.parse(req.body);
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (!['published', 'withdrawn'].includes(sop.status) || sop.draft_version_id) {
        throw statusError(409, 'Eine neue Version kann nur aus einer veröffentlichten oder zurückgezogenen Anweisung erstellt werden.');
      }
      const latest = await db.query(
        `SELECT sop_number,title,description,category,site_id,customer_id,mandatory_acknowledgment,
                effective_from,effective_until,content,dms_document_id FROM sop_versions
         WHERE tenant_id=$1 AND sop_id=$2 ORDER BY version_number DESC LIMIT 1`,
        [user.tenantId, sopId]
      );
      if (!latest.rows.length) throw statusError(409, 'Es gibt keine veröffentlichte Version als Grundlage.');
      await assertDmsDocument(db, user.tenantId, body.dmsDocumentId);
      const siteId = body.siteId === undefined ? sop.site_id : entityId(body.siteId);
      const customerId = body.customerId === undefined ? sop.customer_id : entityId(body.customerId);
      const effectiveFrom = body.effectiveFrom === undefined ? latest.rows[0].effective_from : body.effectiveFrom;
      const effectiveUntil = body.effectiveUntil === undefined ? latest.rows[0].effective_until : body.effectiveUntil;
      await assertSopReferences(db,user.tenantId,siteId,customerId);
      validateEffectiveDates(effectiveFrom,effectiveUntil);
      const updated = await db.query(
        `UPDATE sop_instructions SET status='draft',
           sop_number=COALESCE($8,sop_number),category=COALESCE($9,category),
           site_id=CASE WHEN $10 THEN $11::uuid ELSE $12::uuid END,
           customer_id=CASE WHEN $13 THEN $14::uuid ELSE $15::uuid END,
           mandatory_acknowledgment=COALESCE($16,mandatory_acknowledgment),
           description=COALESCE($17,description),
           effective_from=CASE WHEN $18 THEN $19::date ELSE effective_from END,
           effective_until=CASE WHEN $20 THEN $21::date ELSE effective_until END,
           submitted_by_user_id=NULL,submitted_at=NULL,reviewed_by_user_id=NULL,reviewed_at=NULL,
           approved_by_user_id=NULL,approved_at=NULL,published_by_user_id=NULL,published_at=NULL,
           title=COALESCE($1,title),
           draft_content=COALESCE($2::jsonb,$3::jsonb),
           draft_dms_document_id=CASE WHEN $4 THEN $5::uuid ELSE $6::uuid END,
           draft_change_reason=$7, updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$22 AND id=$23
         RETURNING id,tenant_id,sop_number,title,category,site_id,customer_id,mandatory_acknowledgment,
           description,effective_from,effective_until,status,draft_content AS structured_content,
           ${contentText('draft_content')} AS content,draft_dms_document_id,draft_change_reason`,
        [body.title ?? null, body.content === undefined ? null : JSON.stringify(structuredContent(body.content)),
          JSON.stringify(latest.rows[0].content), body.dmsDocumentId !== undefined,
          body.dmsDocumentId ?? null, latest.rows[0].dms_document_id, body.changeReason,
          body.sopNumber ?? null,body.category ?? null,body.siteId !== undefined,siteId ?? null,
          sop.site_id,body.customerId !== undefined,customerId ?? null,sop.customer_id,
          body.mandatoryAcknowledgment ?? null,body.description ?? null,
          body.effectiveFrom !== undefined,effectiveFrom ?? null,body.effectiveUntil !== undefined,
          effectiveUntil ?? null,user.tenantId,sopId]
      );
      await writeEvent(db, user.tenantId, sopId, user.userId, 'version_draft_created', null, { changeReason: body.changeReason });
      return updated.rows[0];
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function submitSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (sop.status !== 'draft' || sop.draft_version_id) throw statusError(409, 'Nur ein Entwurf kann eingereicht werden.');
      const inserted = await db.query(
        `INSERT INTO sop_versions
         (tenant_id,sop_id,version_number,sop_number,title,description,category,site_id,customer_id,
          mandatory_acknowledgment,effective_from,effective_until,content,dms_document_id,change_reason,
          author_user_id,submitted_by_user_id)
        SELECT $1,$2,COALESCE(MAX(version_number),0)+1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16
         FROM sop_versions WHERE tenant_id=$1 AND sop_id=$2
        RETURNING id,version_number AS version,sop_number,title,description,category,site_id,customer_id,
          mandatory_acknowledgment,effective_from,effective_until,content,dms_document_id,change_reason,
          author_user_id,submitted_by_user_id,submitted_at`,
        [user.tenantId,sopId,sop.sop_number,sop.title,sop.description,sop.category,sop.site_id,sop.customer_id,
         sop.mandatory_acknowledgment,sop.effective_from,sop.effective_until,JSON.stringify(sop.draft_content),
         sop.draft_dms_document_id,sop.draft_change_reason,sop.created_by,user.userId]
      );
      const version = inserted.rows[0];
      await db.query(
        `UPDATE sop_instructions SET status='in_review',draft_version_id=$1,submitted_by_user_id=$2,
           submitted_at=CURRENT_TIMESTAMP,reviewed_by_user_id=NULL,reviewed_at=NULL,
           approved_by_user_id=NULL,approved_at=NULL,published_by_user_id=NULL,published_at=NULL,
           updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$3 AND id=$4`,
        [version.id,user.userId,user.tenantId,sopId]
      );
      await writeEvent(db, user.tenantId, sopId, user.userId, 'submitted', version.id, { versionNumber: version.version_number });
      return version;
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function reviewSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = reviewSchema.parse(req.body);
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (sop.status !== 'in_review' || !sop.draft_version_id) throw statusError(409, 'Nur eingereichte Dienstanweisungen können geprüft werden.');
      if (sop.created_by === user.userId || sop.submitted_by_user_id === user.userId) {
        throw statusError(403, 'Autor und Einreicher dürfen die eigene Dienstanweisungsversion nicht prüfen.');
      }
      const status = body.decision === 'reviewed' ? 'reviewed' : 'draft';
      await db.query(
        `UPDATE sop_instructions SET status=$1,reviewed_by_user_id=$2,reviewed_at=CURRENT_TIMESTAMP,
           updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$3 AND id=$4`,
        [status,user.userId,user.tenantId,sopId]
      );
      await writeEvent(db, user.tenantId, sopId, user.userId,
        body.decision === 'reviewed' ? 'reviewed' : 'changes_requested', sop.draft_version_id, { comment: body.comment });
      if (body.decision === 'changes_requested') {
        await db.query(
          `UPDATE sop_instructions SET draft_version_id=NULL WHERE tenant_id=$1 AND id=$2`,
          [user.tenantId, sopId]
        );
      }
      return { id: sopId, status, versionId: sop.draft_version_id };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function approveSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (sop.status !== 'reviewed' || !sop.draft_version_id) throw statusError(409, 'Die Dienstanweisung muss zuvor geprüft worden sein.');
      if (sop.created_by === user.userId || sop.submitted_by_user_id === user.userId) {
        throw statusError(403, 'Autor und Einreicher dürfen die eigene Dienstanweisungsversion nicht freigeben.');
      }
      if (sop.reviewed_by_user_id === user.userId) throw statusError(403, 'Der Prüfer darf dieselbe Dienstanweisung nicht freigeben.');
      await db.query(
        `UPDATE sop_instructions SET status='approved',approved_by_user_id=$1,approved_at=CURRENT_TIMESTAMP,
           updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$2 AND id=$3`,
        [user.userId,user.tenantId,sopId]
      );
      await writeEvent(db, user.tenantId, sopId, user.userId, 'approved', sop.draft_version_id);
      return { id: sopId, status: 'approved', versionId: sop.draft_version_id };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

async function materializeAssignments(db: PoolClient, tenantId: string, sopId: string, versionId: string): Promise<void> {
  await db.query(
    `WITH recipients AS (
       SELECT t.employee_id,t.due_at
       FROM sop_assignment_targets t
       JOIN employees e ON e.id=t.employee_id AND e.tenant_id=t.tenant_id
       WHERE t.tenant_id=$1 AND t.sop_id=$2 AND t.target_type='employee'
         AND e.status='Aktiv' AND e.archived_at IS NULL
       UNION
       SELECT esa.employee_id,t.due_at
       FROM sop_assignment_targets t
       JOIN employee_site_assignments esa ON esa.site_id=t.site_id AND esa.tenant_id=t.tenant_id
       JOIN employees e ON e.id=esa.employee_id AND e.tenant_id=esa.tenant_id
       WHERE t.tenant_id=$1 AND t.sop_id=$2 AND t.target_type='site'
         AND e.status='Aktiv' AND e.archived_at IS NULL
       UNION
       SELECT esa.employee_id,t.due_at
       FROM sop_assignment_targets t
       JOIN sites st ON st.client_id=t.customer_id AND st.tenant_id=t.tenant_id
       JOIN employee_site_assignments esa ON esa.site_id=st.id AND esa.tenant_id=st.tenant_id
       JOIN employees e ON e.id=esa.employee_id AND e.tenant_id=esa.tenant_id
       WHERE t.tenant_id=$1 AND t.sop_id=$2 AND t.target_type='customer'
         AND e.status='Aktiv' AND e.archived_at IS NULL
       UNION
       SELECT e.id,t.due_at
       FROM sop_assignment_targets t
       JOIN employees e ON e.tenant_id=t.tenant_id
       WHERE t.tenant_id=$1 AND t.sop_id=$2 AND t.target_type='tenant'
         AND e.status='Aktiv' AND e.archived_at IS NULL
     )
     INSERT INTO sop_assignments (tenant_id,sop_id,version_id,employee_id,due_at)
     SELECT $1,$2,$3,employee_id,MIN(due_at) FROM recipients
     GROUP BY employee_id
     ON CONFLICT (tenant_id,version_id,employee_id)
     DO UPDATE SET due_at=EXCLUDED.due_at
       WHERE sop_assignments.acknowledged_at IS NULL`,
    [tenantId, sopId, versionId]
  );
}

export async function publishSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (sop.status !== 'approved' || !sop.draft_version_id) throw statusError(409, 'Nur eine freigegebene Dienstanweisung kann veröffentlicht werden.');
      await db.query(
        `UPDATE sop_instructions SET status='published',current_version_id=draft_version_id,
           draft_version_id=NULL,published_by_user_id=$1,published_at=CURRENT_TIMESTAMP,
           withdrawn_by_user_id=NULL,withdrawn_at=NULL,archived_by_user_id=NULL,archived_at=NULL,
           updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$2 AND id=$3`,
        [user.userId,user.tenantId,sopId]
      );
      await materializeAssignments(db, user.tenantId, sopId, sop.draft_version_id);
      await writeEvent(db, user.tenantId, sopId, user.userId, 'published', sop.draft_version_id);
      return { id: sopId, status: 'published', versionId: sop.draft_version_id };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function withdrawSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (!sop.current_version_id || sop.status === 'archived' || sop.status === 'withdrawn') {
        throw statusError(409, 'Es gibt keine aktive veröffentlichte Dienstanweisung zum Zurückziehen.');
      }
      await db.query(
        `UPDATE sop_instructions SET status='withdrawn',current_version_id=NULL,draft_version_id=NULL,
           withdrawn_by_user_id=$1,withdrawn_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$2 AND id=$3`,
        [user.userId,user.tenantId,sopId]
      );
      await writeEvent(db, user.tenantId, sopId, user.userId, 'withdrawn', sop.current_version_id);
      return { id: sopId, status: 'withdrawn' };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function archiveSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (sop.status === 'archived') throw statusError(409, 'Dienstanweisung ist bereits archiviert.');
      await db.query(
        `UPDATE sop_instructions SET status='archived',current_version_id=NULL,draft_version_id=NULL,
         archived_by_user_id=$1,archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$2 AND id=$3`,
        [user.userId,user.tenantId,sopId]
      );
      await writeEvent(db, user.tenantId, sopId, user.userId, 'archived', sop.current_version_id ?? sop.draft_version_id);
      return { id: sopId, status: 'archived' };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function listAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      if (managerView(req)) {
        const sop = await db.query('SELECT id,current_version_id FROM sop_instructions WHERE tenant_id=$1 AND id=$2', [user.tenantId, sopId]);
        if (!sop.rows.length) throw statusError(404, 'Dienstanweisung nicht gefunden.');
        return db.query(
          `SELECT t.id,t.target_type AS type,
                  COALESCE(t.employee_id,t.site_id,t.customer_id) AS target_id,
                  CASE WHEN t.target_type='employee' THEN concat(te.first_name,' ',te.last_name)
                       WHEN t.target_type='site' THEN st.name
                       WHEN t.target_type='customer' THEN c.company_name
                       ELSE 'Ganzer Mandant' END AS target_name,
                  t.due_at,
                  CASE WHEN t.target_type='employee' THEN t.employee_id END AS employee_id,
                  CASE WHEN t.target_type='employee' THEN concat(te.first_name,' ',te.last_name) END AS employee_name,
                  counts.total_required,counts.signed_count,
                  CASE WHEN counts.total_required=0 THEN 'Noch keine Zuweisung veröffentlicht'
                       ELSE counts.signed_count::text || '/' || counts.total_required::text || ' bestätigt' END AS status
           FROM sop_assignment_targets t
           JOIN sop_instructions s ON s.id=t.sop_id AND s.tenant_id=t.tenant_id
           LEFT JOIN employees te ON t.target_type='employee' AND te.id=t.employee_id AND te.tenant_id=t.tenant_id
           LEFT JOIN sites st ON t.target_type='site' AND st.id=t.site_id AND st.tenant_id=t.tenant_id
           LEFT JOIN clients c ON t.target_type='customer' AND c.id=t.customer_id AND c.tenant_id=t.tenant_id
           LEFT JOIN LATERAL (
             SELECT COUNT(DISTINCT a.id)::int AS total_required,
                    COUNT(DISTINCT a.id) FILTER (WHERE a.acknowledged_at IS NOT NULL)::int AS signed_count
             FROM sop_assignments a
             JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
             WHERE a.tenant_id=t.tenant_id AND a.sop_id=t.sop_id AND a.version_id=s.current_version_id
               AND (t.target_type='tenant'
                 OR (t.target_type='employee' AND a.employee_id=t.employee_id)
                 OR (t.target_type='site' AND EXISTS (
                   SELECT 1 FROM employee_site_assignments esa
                   WHERE esa.tenant_id=a.tenant_id AND esa.employee_id=a.employee_id AND esa.site_id=t.site_id
                 ))
                 OR (t.target_type='customer' AND EXISTS (
                   SELECT 1 FROM employee_site_assignments esa
                   JOIN sites assigned_site ON assigned_site.id=esa.site_id AND assigned_site.tenant_id=esa.tenant_id
                   WHERE esa.tenant_id=a.tenant_id AND esa.employee_id=a.employee_id
                     AND assigned_site.client_id=t.customer_id
                 )))
           ) counts ON true
           WHERE t.tenant_id=$1 AND t.sop_id=$2 ORDER BY t.created_at DESC`,
          [user.tenantId,sopId]
        );
      }
      return db.query(
        `SELECT a.id,a.sop_id,a.version_id,v.version_number,a.employee_id,
                'employee' AS type,a.employee_id AS target_id,
                concat(e.first_name,' ',e.last_name) AS target_name,
                concat(e.first_name,' ',e.last_name) AS employee_name,
                CASE WHEN a.acknowledged_at IS NOT NULL THEN 'confirmed'
                     WHEN a.due_at < CURRENT_TIMESTAMP THEN 'overdue' ELSE 'pending' END AS status,
                a.due_at,a.assigned_at,a.acknowledged_at,a.captured_at,a.server_received_at
         FROM sop_assignments a JOIN sop_versions v ON v.id=a.version_id AND v.tenant_id=a.tenant_id
         JOIN sop_instructions s ON s.id=a.sop_id AND s.tenant_id=a.tenant_id AND s.current_version_id=v.id
         JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
         WHERE a.tenant_id=$1 AND a.sop_id=$2 AND lower(e.email)=lower($3)
           AND (v.effective_from IS NULL OR v.effective_from <= CURRENT_DATE)
           AND (v.effective_until IS NULL OR v.effective_until >= CURRENT_DATE)
         ORDER BY a.due_at NULLS LAST`,
        [user.tenantId, sopId, user.email]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function assignSop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = assignmentSchema.parse(req.body);
    const sopId = uuid.parse(req.params.id);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const sop = await getSopForUpdate(db, user.tenantId, sopId);
      if (['withdrawn', 'archived'].includes(sop.status)) throw statusError(409, 'Zurückgezogene oder archivierte Anweisungen können nicht zugewiesen werden.');
      if (body.dueAt && Number.isNaN(Date.parse(body.dueAt))) throw statusError(400, 'dueAt ist ungültig.');
      for (const target of body.targets) {
        if (target.type === 'tenant') continue;
        const table = target.type === 'customer' ? 'clients' : target.type === 'site' ? 'sites' : 'employees';
        const activeEmployee = target.type === 'employee' ? ` AND status='Aktiv' AND archived_at IS NULL` : '';
        const existing = await db.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1 AND id=$2${activeEmployee}`, [user.tenantId, target.id]);
        if (!existing.rows.length) throw statusError(404, 'Ein Zuweisungsziel wurde in diesem Mandanten nicht gefunden.');
      }
      const inserted: any[] = [];
      for (const target of body.targets) {
        const result = await db.query(
          `INSERT INTO sop_assignment_targets
            (tenant_id,sop_id,target_type,employee_id,site_id,customer_id,due_at,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT DO NOTHING
           RETURNING id,target_type,employee_id,site_id,customer_id,due_at`,
          [user.tenantId,sopId,target.type,
            target.type==='employee' ? target.id : null,
            target.type==='site' ? target.id : null,
            target.type==='customer' ? target.id : null,
            body.dueAt ?? null,user.userId]
        );
        if (result.rows.length) inserted.push(result.rows[0]);
      }
      if (sop.current_version_id) {
        await materializeAssignments(db, user.tenantId, sopId, sop.current_version_id);
      }
      await writeEvent(db, user.tenantId, sopId, user.userId, 'assigned', sop.current_version_id,
        { targetCount: body.targets.length, dueAt: body.dueAt ?? null });
      return { targets: inserted, versionId: sop.current_version_id };
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function acknowledgeAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = acknowledgeSchema.parse(req.body);
    const assignmentId = uuid.parse(req.params.assignmentId);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const employees = await db.query(
        `SELECT id FROM employees WHERE tenant_id=$1 AND lower(email)=lower($2) AND archived_at IS NULL`,
        [user.tenantId, user.email]
      );
      if (employees.rows.length !== 1) throw statusError(403, 'Das authentifizierte Konto ist keinem eindeutigen aktiven Mitarbeiter zugeordnet.');
      const employeeId = employees.rows[0].id;
      const assignment = await db.query(
        `SELECT a.id,a.sop_id,a.version_id,a.employee_id,a.acknowledged_at,a.acknowledged_by_user_id,
                a.captured_at,a.server_received_at,a.client_mutation_id
         FROM sop_assignments a
         JOIN sop_instructions s ON s.id=a.sop_id AND s.tenant_id=a.tenant_id
           AND s.current_version_id=a.version_id
         JOIN sop_versions v ON v.id=a.version_id AND v.tenant_id=a.tenant_id
           AND (v.effective_from IS NULL OR v.effective_from <= CURRENT_DATE)
           AND (v.effective_until IS NULL OR v.effective_until >= CURRENT_DATE)
         WHERE a.tenant_id=$1 AND a.id=$2`,
        [user.tenantId, assignmentId]
      );
      if (!assignment.rows.length || assignment.rows[0].employee_id !== employeeId) {
        throw statusError(404, 'Aktive Zuweisung nicht gefunden.');
      }
      const current = assignment.rows[0];
      if (body.clientMutationId) {
        const previous = await db.query(
          `SELECT id FROM sop_assignments WHERE tenant_id=$1 AND client_mutation_id=$2`,
          [user.tenantId, body.clientMutationId]
        );
        if (previous.rows.length && previous.rows[0].id !== assignmentId) {
          throw statusError(409, 'clientMutationId wurde bereits für eine andere Kenntnisnahme verwendet.');
        }
      }
      if (current.acknowledged_at) {
        return { ...current, alreadyAcknowledged: true };
      }
      const updated = await db.query(
        `UPDATE sop_assignments
         SET acknowledged_at=CURRENT_TIMESTAMP, acknowledged_by_user_id=$1,
             captured_at=$2,server_received_at=CURRENT_TIMESTAMP,client_mutation_id=$3
         WHERE tenant_id=$4 AND id=$5 AND employee_id=$6 AND acknowledged_at IS NULL
         RETURNING id,sop_id,version_id,employee_id,acknowledged_at,acknowledged_by_user_id,
                   captured_at,server_received_at,client_mutation_id`,
        [user.userId, body.capturedAt ?? null, body.clientMutationId ?? null, user.tenantId, assignmentId, employeeId]
      );
      if (!updated.rows.length) throw statusError(409, 'Die Kenntnisnahme wurde bereits gespeichert.');
      await writeEvent(db, user.tenantId, current.sop_id, user.userId, 'acknowledged', current.version_id, {
        assignmentId, capturedAt: body.capturedAt ?? null
      });
      return updated.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function listSopReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user!.permissions.includes('sop:manage')) throw statusError(403, 'Berichte sind nur für SOP-Verantwortliche verfügbar.');
    const customerId = req.query.customerId ? uuid.parse(req.query.customerId) : undefined;
    const siteId = req.query.siteId ? uuid.parse(req.query.siteId) : undefined;
    const employeeId = req.query.employeeId ? uuid.parse(req.query.employeeId) : undefined;
    const dateBound = z.union([z.string().date(), z.string().datetime({ offset: true })]);
    const from = req.query.from ? dateBound.parse(req.query.from) : undefined;
    const to = req.query.to ? dateBound.parse(req.query.to) : undefined;
    const status = req.query.status ? z.enum(['pending', 'acknowledged', 'overdue', 'superseded']).parse(req.query.status) : undefined;
    if (from && to && Date.parse(from) > Date.parse(to)) throw statusError(400, 'from darf nicht nach to liegen.');
    const fromValue = from?.length === 10 ? `${from}T00:00:00.000Z` : from;
    const toValue = to?.length === 10 ? `${to}T23:59:59.999Z` : to;
    const filters: string[] = ['a.tenant_id=$1'];
    const values: any[] = [req.user!.tenantId];
    const addFilter = (sql: string, value: any) => { values.push(value); filters.push(sql.replace('?', `$${values.length}`)); };
    if (customerId) addFilter('EXISTS (SELECT 1 FROM sop_assignment_targets t WHERE t.tenant_id=a.tenant_id AND t.sop_id=a.sop_id AND t.target_type=\'customer\' AND t.customer_id=?)', customerId);
    if (siteId) addFilter('EXISTS (SELECT 1 FROM sop_assignment_targets t WHERE t.tenant_id=a.tenant_id AND t.sop_id=a.sop_id AND t.target_type=\'site\' AND t.site_id=?)', siteId);
    if (employeeId) addFilter('a.employee_id=?', employeeId);
    if (fromValue) addFilter('a.due_at >= ?', fromValue);
    if (toValue) addFilter('a.due_at <= ?', toValue);
    if (status === 'acknowledged') filters.push('s.current_version_id=a.version_id AND a.acknowledged_at IS NOT NULL');
    if (status === 'pending') filters.push('s.current_version_id=a.version_id AND a.acknowledged_at IS NULL AND (a.due_at IS NULL OR a.due_at >= CURRENT_TIMESTAMP)');
    if (status === 'overdue') filters.push('s.current_version_id=a.version_id AND a.acknowledged_at IS NULL AND a.due_at < CURRENT_TIMESTAMP');
    if (status === 'superseded') filters.push('s.current_version_id IS DISTINCT FROM a.version_id');
    const result = await withTenantTransaction(req.user!.tenantId, db => db.query(
      `SELECT a.id AS assignment_id,a.sop_id,v.title AS sop_title,v.version_number,a.employee_id,
              concat(e.first_name,' ',e.last_name) AS employee_name,e.email,
              target_info.site_name,target_info.customer_name,
              a.assigned_at,a.due_at,a.acknowledged_at,a.captured_at,a.server_received_at,
              CASE WHEN s.current_version_id IS DISTINCT FROM a.version_id THEN 'superseded'
                   WHEN a.acknowledged_at IS NOT NULL THEN 'acknowledged'
                   WHEN a.due_at < CURRENT_TIMESTAMP THEN 'overdue' ELSE 'pending' END AS status
       FROM sop_assignments a
       JOIN sop_versions v ON v.id=a.version_id AND v.tenant_id=a.tenant_id
       JOIN sop_instructions s ON s.id=a.sop_id AND s.tenant_id=a.tenant_id
       JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
       LEFT JOIN LATERAL (
         SELECT MAX(st.name) AS site_name,MAX(c.company_name) AS customer_name
         FROM sop_assignment_targets t
         LEFT JOIN sites st ON t.target_type='site' AND st.id=t.site_id AND st.tenant_id=t.tenant_id
         LEFT JOIN clients c ON t.target_type='customer' AND c.id=t.customer_id AND c.tenant_id=t.tenant_id
         WHERE t.tenant_id=a.tenant_id AND t.sop_id=a.sop_id
       ) target_info ON true
       WHERE ${filters.join(' AND ')} ORDER BY a.due_at NULLS LAST,e.last_name,e.first_name`,
      values
    ));
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function listSopReminders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const manager = user.permissions.includes('sop:manage');
    const result = await withTenantTransaction(user.tenantId, async db => {
      if (manager) {
        return db.query(
          `SELECT a.employee_id,concat(e.first_name,' ',e.last_name) AS employee_name,e.email,
                  COUNT(*) FILTER (WHERE a.due_at IS NOT NULL AND a.due_at < CURRENT_TIMESTAMP)::int AS overdue_count,
                  COUNT(*) FILTER (WHERE a.due_at >= CURRENT_TIMESTAMP
                    AND a.due_at <= CURRENT_TIMESTAMP + INTERVAL '30 days')::int AS due_count,
                  MIN(a.due_at) FILTER (WHERE a.due_at >= CURRENT_TIMESTAMP
                    AND a.due_at <= CURRENT_TIMESTAMP + INTERVAL '30 days') AS due_at,
                  (COUNT(*) FILTER (WHERE a.due_at IS NOT NULL AND a.due_at < CURRENT_TIMESTAMP)::text
                    || ' überfällig · ' ||
                    COUNT(*) FILTER (WHERE a.due_at >= CURRENT_TIMESTAMP
                      AND a.due_at <= CURRENT_TIMESTAMP + INTERVAL '30 days')::text || ' fällig') AS status
           FROM sop_assignments a JOIN sop_instructions s ON s.id=a.sop_id AND s.tenant_id=a.tenant_id
             AND s.current_version_id=a.version_id
           JOIN sop_versions v ON v.id=a.version_id AND v.tenant_id=a.tenant_id
             AND (v.effective_from IS NULL OR v.effective_from <= CURRENT_DATE)
             AND (v.effective_until IS NULL OR v.effective_until >= CURRENT_DATE)
           JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
           WHERE a.tenant_id=$1 AND a.acknowledged_at IS NULL
           GROUP BY a.employee_id,e.first_name,e.last_name,e.email
           HAVING COUNT(*) FILTER (WHERE a.due_at IS NOT NULL AND a.due_at < CURRENT_TIMESTAMP)>0
               OR COUNT(*) FILTER (WHERE a.due_at >= CURRENT_TIMESTAMP
                 AND a.due_at <= CURRENT_TIMESTAMP + INTERVAL '30 days')>0
           ORDER BY MIN(a.due_at) NULLS LAST`,
          [user.tenantId]
        );
      }
      return db.query(
        `SELECT a.id AS assignment_id,a.sop_id,v.title,v.version_number,a.due_at,a.assigned_at,
                CASE WHEN a.due_at < CURRENT_TIMESTAMP THEN 'overdue' ELSE 'due' END AS status
         FROM employees e JOIN sop_assignments a ON a.employee_id=e.id AND a.tenant_id=e.tenant_id
         JOIN sop_instructions s ON s.id=a.sop_id AND s.tenant_id=a.tenant_id
           AND s.current_version_id=a.version_id
         JOIN sop_versions v ON v.id=a.version_id AND v.tenant_id=a.tenant_id
         WHERE e.tenant_id=$1 AND lower(e.email)=lower($2) AND e.archived_at IS NULL
           AND a.acknowledged_at IS NULL AND a.due_at IS NOT NULL AND a.due_at <= CURRENT_TIMESTAMP + INTERVAL '30 days'
           AND (v.effective_from IS NULL OR v.effective_from <= CURRENT_DATE)
           AND (v.effective_until IS NULL OR v.effective_until >= CURRENT_DATE)
         ORDER BY a.due_at`,
        [user.tenantId, user.email]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}
