import { createHash, randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';

const uuid = z.string().guid();
const date = z.string().date();
const alarmStatuses = [
  'neu', 'bestätigt', 'in_bearbeitung', 'eskaliert', 'einsatzkraefte_verstaendigt',
  'massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen', 'archiviert'
] as const;
const severityValues = ['Niedrig', 'Normal', 'Dringend', 'Kritisch'] as const;
const contactSchema = z.object({
  contactType: z.enum(['site_manager', 'deputy', 'operations', 'customer', 'technical', 'fire', 'police', 'medical', 'other']).default('other'),
  role: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(255).nullable().optional(),
  notes: z.string().trim().max(1000).default('')
}).strict();
const planBaseSchema = z.object({
  siteId: uuid,
  customerId: uuid.optional(),
  alarmTypeId: uuid,
  ownerEmployeeId: uuid.nullable().optional(),
  effectiveFrom: date.nullable().optional(),
  effectiveUntil: date.nullable().optional(),
  chainOfAction: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
  contacts: z.array(contactSchema).max(30).optional()
}).strict();
const planSchema = planBaseSchema.refine(value =>
  !value.effectiveFrom || !value.effectiveUntil || value.effectiveUntil >= value.effectiveFrom,
  'Das Gültigkeitsende darf nicht vor dem Gültigkeitsbeginn liegen.'
);
const planUpdateSchema = planBaseSchema.partial().extend({
  revisionVersion: z.number().int().positive()
}).strict().refine(value => Object.keys(value).some(key => key !== 'revisionVersion'),
  'Mindestens ein Planfeld ist erforderlich.');
const alarmTypeSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,80}$/),
  label: z.string().trim().min(2).max(160)
}).strict();
const contactCreateSchema = contactSchema.extend({
  customerId: uuid.nullable().optional(),
  siteId: uuid.nullable().optional(),
  emergencyPlanId: uuid.nullable().optional()
}).strict().refine(value => Boolean(value.customerId || value.siteId || value.emergencyPlanId),
  'Ein Notfallkontakt muss einem Kunden, Objekt oder Notfallplan zugeordnet sein.');
const incidentReportSchema = z.object({
  siteId: uuid,
  emergencyPlanId: uuid.nullable().optional(),
  alarmTypeId: uuid.optional(),
  scenario: z.string().trim().min(1).max(80).optional(),
  severity: z.enum(severityValues),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(8000).default(''),
  assignedEmployeeId: uuid.nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  clientMutationId: z.string().trim().min(8).max(64).default(() => randomUUID())
}).strict().refine(value => Boolean(value.alarmTypeId || value.scenario),
  'Eine Alarmart ist erforderlich.');
const actionSchema = z.object({
  actionType: z.enum(['measure', 'note']),
  description: z.string().trim().min(1).max(4000),
  result: z.string().trim().max(4000).default(''),
  attachmentDocumentId: uuid.nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  clientMutationId: z.string().trim().min(8).max(64).default(() => randomUUID())
}).strict();
const transitionSchema = z.object({
  status: z.enum(alarmStatuses).optional(),
  action: z.enum(['acknowledge', 'escalate', 'resolve']).optional(),
  note: z.string().trim().min(1).max(4000),
  revisionVersion: z.number().int().positive(),
  clientMutationId: z.string().trim().min(8).max(64).default(() => randomUUID())
}).strict().refine(value => Boolean(value.status || value.action),
  'Ein Zielstatus ist erforderlich.');
const assignSchema = z.object({
  employeeId: uuid,
  assigned: z.boolean().default(true),
  note: z.string().trim().max(1000).default('')
}).strict();
const escalationRuleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  siteId: uuid.nullable().optional(),
  alarmTypeId: uuid.nullable().optional(),
  minimumSeverity: z.enum(severityValues).default('Niedrig'),
  isActive: z.boolean().default(true),
  steps: z.array(z.object({
    delayMinutes: z.number().int().min(0).max(10080),
    recipientRoleId: uuid.nullable().optional(),
    recipientEmployeeId: uuid.nullable().optional(),
    channel: z.enum(['in_app', 'email', 'push'])
  }).strict().refine(step => Boolean(step.recipientRoleId) !== Boolean(step.recipientEmployeeId),
    'Jeder Eskalationsschritt benötigt genau einen Empfänger.')).min(1).max(20)
}).strict();

type User = NonNullable<Request['user']>;
type SiteScope = string[] | null;
type MutationKind = 'incident_report' | 'action_create' | 'status_change';
type PageCursor = { timestamp: string; id: string };

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function can(user: User, permission: string): boolean {
  return user.permissions?.includes(permission) ?? false;
}

function validateCapturedAt(capturedAt?: string): void {
  if (!capturedAt) return;
  const timestamp = new Date(capturedAt).getTime();
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60_000 ||
      timestamp < Date.now() - 90 * 24 * 60 * 60_000) {
    throw httpError(400, 'Der Erfassungszeitpunkt darf höchstens fünf Minuten in der Zukunft und maximal 90 Tage zurückliegen.');
  }
}

function pageLimit(value: unknown, fallback = 50): number {
  return z.coerce.number().int().min(1).max(100).default(fallback).parse(value);
}

function decodePageCursor(value: unknown): PageCursor | null {
  if (value === undefined) return null;
  const encoded = z.string().min(1).max(512).parse(value);
  try {
    return z.object({
      timestamp: z.string().datetime({ offset: true }),
      id: uuid
    }).strict().parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    throw httpError(400, 'Der Seiten-Cursor ist ungültig.');
  }
}

function encodePageCursor(timestamp: string, id: string): string {
  return Buffer.from(JSON.stringify({ timestamp, id })).toString('base64url');
}

function pageResult<T extends { id: string; [key: string]: any }>(
  rows: T[],
  limit: number,
  timestampField: string
): { items: Omit<T, '_cursor_timestamp'>[]; page: { limit: number; hasMore: boolean; nextCursor: string | null } } {
  const hasMore = rows.length > limit;
  const rowsOnPage = rows.slice(0, limit);
  const last = rowsOnPage[rowsOnPage.length - 1];
  const cursorTimestamp = last?._cursor_timestamp;
  const timestamp = last
    ? typeof cursorTimestamp === 'string'
      ? cursorTimestamp
      : last[timestampField] instanceof Date
        ? last[timestampField].toISOString()
        : String(last[timestampField])
    : null;
  const items = rowsOnPage.map(({ _cursor_timestamp: _cursorTimestamp, ...row }) => row);
  return {
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last && timestamp
        ? encodePageCursor(timestamp, last.id)
        : null
    }
  };
}

async function siteScope(db: PoolClient, user: User): Promise<SiteScope> {
  if (['Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Qualitätsmanagement'].includes(user.role)) {
    return null;
  }
  const result = await db.query(
    `SELECT DISTINCT esa.site_id
     FROM employees e
     JOIN employee_site_assignments esa
       ON esa.tenant_id=e.tenant_id AND esa.employee_id=e.id
     WHERE e.tenant_id=$1 AND lower(e.email)=lower($2) AND e.archived_at IS NULL`,
    [user.tenantId, user.email]
  );
  return result.rows.map((row: { site_id: string }) => row.site_id);
}

async function assertSiteAccess(db: PoolClient, user: User, siteId: string): Promise<void> {
  const scope = await siteScope(db, user);
  if (scope && !scope.includes(siteId)) throw httpError(403, 'Kein Zugriff auf dieses Objekt.');
}

async function assertEmployeeAssigned(db: PoolClient, tenantId: string, employeeId: string, siteId: string): Promise<void> {
  const result = await db.query(
    `SELECT 1 FROM employee_site_assignments esa
     JOIN employees e ON e.id=esa.employee_id AND e.tenant_id=esa.tenant_id
     WHERE esa.tenant_id=$1 AND esa.employee_id=$2 AND esa.site_id=$3 AND e.archived_at IS NULL`,
    [tenantId, employeeId, siteId]
  );
  if (!result.rows.length) throw httpError(400, 'Die Einsatzkraft ist diesem Objekt nicht zugeordnet.');
}

async function writeAction(
  db: PoolClient,
  tenantId: string,
  incidentId: string,
  actorId: string,
  actionType: string,
  description: string,
  result = '',
  clientMutationId: string | null = null,
  capturedAt: string | null = null,
  attachmentDocumentId: string | null = null
): Promise<any> {
  const created = await db.query(
    `INSERT INTO alarm_event_actions
      (tenant_id,alarm_incident_id,actor_user_id,action_type,description,result,
       client_mutation_id,captured_at,attachment_document_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenantId, incidentId, actorId, actionType, description, result,
      clientMutationId, capturedAt, attachmentDocumentId]
  );
  return created.rows[0];
}

async function event(
  db: PoolClient,
  tenantId: string,
  incidentId: string | null,
  planId: string | null,
  actorId: string,
  action: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO emergency_management_events
       (tenant_id,emergency_plan_id,alarm_incident_id,actor_user_id,action,details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [tenantId, planId, incidentId, actorId, action, JSON.stringify(details)]
  );
}

async function createPlanVersion(db: PoolClient, user: User, planId: string): Promise<string> {
  const inserted = await db.query(
    `INSERT INTO emergency_plan_versions
      (tenant_id,emergency_plan_id,version_number,customer_id,site_id,alarm_type_id,
       owner_employee_id,action_steps,contact_snapshot,effective_from,effective_until,created_by)
     SELECT p.tenant_id,p.id,COALESCE(MAX(v.version_number),0)+1,p.customer_id,p.site_id,p.alarm_type_id,
       p.owner_employee_id,p.action_steps,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id',c.id,'role',c.role,'name',c.name,'phone',c.phone,'email',c.email,
           'contactType',c.contact_type,'notes',c.notes
         ) ORDER BY c.contact_type,c.role)
         FROM emergency_contacts c
         WHERE c.tenant_id=p.tenant_id AND c.archived_at IS NULL
           AND (c.emergency_plan_id=p.id OR c.site_id=p.site_id OR
             (c.customer_id=p.customer_id AND c.site_id IS NULL AND c.emergency_plan_id IS NULL))
       ),'[]'::jsonb),
       p.effective_from,p.effective_until,$3
     FROM emergency_plans p
     LEFT JOIN emergency_plan_versions v
       ON v.tenant_id=p.tenant_id AND v.emergency_plan_id=p.id
     WHERE p.tenant_id=$1 AND p.id=$2
     GROUP BY p.tenant_id,p.id
     RETURNING id,version_number`,
    [user.tenantId, planId, user.userId]
  );
  if (!inserted.rows.length) throw httpError(404, 'Notfallplan nicht gefunden.');
  await db.query(
    `UPDATE emergency_plans SET current_version_id=$1,publication_status='draft',
       is_active=false,revision_version=revision_version+1,updated_by=$2,updated_at=CURRENT_TIMESTAMP
     WHERE tenant_id=$3 AND id=$4`,
    [inserted.rows[0].id, user.userId, user.tenantId, planId]
  );
  return inserted.rows[0].id;
}

async function savePlanContacts(
  db: PoolClient,
  user: User,
  plan: { id: string; customer_id: string; site_id: string },
  contacts: z.infer<typeof contactSchema>[]
): Promise<void> {
  if (!can(user, 'emergency_contact:manage')) {
    throw httpError(403, 'Keine Berechtigung zum Verwalten von Notfallkontakten.');
  }
  await db.query(
    `UPDATE emergency_contacts SET archived_at=CURRENT_TIMESTAMP,updated_by=$1,
       revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
     WHERE tenant_id=$2 AND emergency_plan_id=$3 AND archived_at IS NULL`,
    [user.userId, user.tenantId, plan.id]
  );
  for (const contact of contacts) {
    await db.query(
      `INSERT INTO emergency_contacts
        (tenant_id,customer_id,site_id,emergency_plan_id,contact_type,role,name,phone,email,notes,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
      [user.tenantId, plan.customer_id, plan.site_id, plan.id, contact.contactType, contact.role,
        contact.name, contact.phone, contact.email ?? null, contact.notes, user.userId]
    );
  }
}

export async function listAlarmTypes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await withTenantTransaction(req.user!.tenantId, db => db.query(
      `SELECT id,tenant_id,code,label,is_system,is_active,created_at,updated_at
       FROM alarm_types WHERE tenant_id=$1 AND is_active=true ORDER BY label`,
      [req.user!.tenantId]
    ));
    res.json({ success: true, data: data.rows });
  } catch (error) { next(error); }
}

export async function listAlarmSites(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const scope = await siteScope(db, user);
      const result = await db.query(
        `SELECT s.id,s.client_id AS customer_id,s.name
         FROM sites s JOIN clients c ON c.id=s.client_id AND c.tenant_id=s.tenant_id
         WHERE s.tenant_id=$1 AND s.archived_at IS NULL AND c.archived_at IS NULL
           AND ($2::uuid[] IS NULL OR s.id=ANY($2))
         ORDER BY s.name`,
        [user.tenantId, scope]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function createAlarmType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = alarmTypeSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, db => db.query(
      `INSERT INTO alarm_types (tenant_id,code,label,created_by)
       VALUES ($1,$2,$3,$4) RETURNING id,tenant_id,code,label,is_system,is_active,created_at,updated_at`,
      [user.tenantId, body.code, body.label, user.userId]
    ));
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

export async function updateAlarmType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const typeId = uuid.parse(req.params.id);
    const body = z.object({
      label: z.string().trim().min(2).max(160).optional(),
      isActive: z.boolean().optional()
    }).strict().refine(value => value.label !== undefined || value.isActive !== undefined).parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, db => db.query(
      `UPDATE alarm_types SET label=COALESCE($1,label),is_active=COALESCE($2,is_active),updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=$3 AND id=$4 RETURNING id,tenant_id,code,label,is_system,is_active,updated_at`,
      [body.label ?? null, body.isActive ?? null, user.tenantId, typeId]
    ));
    if (!result.rows.length) throw httpError(404, 'Alarmart nicht gefunden.');
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

export async function listEmergencyPlansV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const scope = await siteScope(db, user);
      const plans = await db.query(
        `SELECT p.id,p.tenant_id,p.customer_id,c.company_name AS customer_name,p.site_id,s.name AS site_name,
                p.alarm_type_id,t.code AS scenario,t.label AS alarm_type_label,p.owner_employee_id,
                p.effective_from,p.effective_until,p.publication_status,p.current_version_id,
                p.published_version_id,p.action_steps AS chain_of_action,p.last_drill_date,p.is_active,
                p.revision_version,p.created_at,p.updated_at,
                (SELECT version_number FROM emergency_plan_versions v
                 WHERE v.id=p.current_version_id AND v.tenant_id=p.tenant_id) AS version_number
         FROM emergency_plans p
         JOIN sites s ON s.id=p.site_id AND s.tenant_id=p.tenant_id
         JOIN clients c ON c.id=p.customer_id AND c.tenant_id=p.tenant_id
         JOIN alarm_types t ON t.id=p.alarm_type_id AND t.tenant_id=p.tenant_id
         WHERE p.tenant_id=$1 AND p.archived_at IS NULL AND s.archived_at IS NULL AND c.archived_at IS NULL
           AND ($2::uuid[] IS NULL OR p.site_id=ANY($2))
         ORDER BY s.name,t.label,p.created_at DESC`,
        [user.tenantId, scope]
      );
      if (can(user, 'emergency_contact:read') && plans.rows.length) {
        const contacts = await db.query(
            `SELECT p.id AS plan_id,c.id,c.contact_type,c.role,c.name,c.phone,c.email,c.notes
             FROM emergency_plans p
             JOIN emergency_contacts c ON c.tenant_id=p.tenant_id AND c.archived_at IS NULL
               AND (c.emergency_plan_id=p.id OR c.site_id=p.site_id OR
                 (c.site_id IS NULL AND c.emergency_plan_id IS NULL AND c.customer_id=p.customer_id))
             WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[])
             ORDER BY p.id,c.contact_type,c.role`,
          [user.tenantId, plans.rows.map((plan: { id: string }) => plan.id)]
        );
        const grouped = new Map<string, any[]>();
        for (const contact of contacts.rows) {
            grouped.set(contact.plan_id, [...(grouped.get(contact.plan_id) ?? []), contact]);
        }
        return plans.rows.map((plan: any) => ({ ...plan, contacts: grouped.get(plan.id) ?? [] }));
      }
      return plans.rows.map((plan: any) => ({ ...plan, contacts: [] }));
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function createEmergencyPlanV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = planSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      await assertSiteAccess(db, user, body.siteId);
      const site = await db.query(
        `SELECT s.client_id FROM sites s JOIN clients c ON c.id=s.client_id AND c.tenant_id=s.tenant_id
         WHERE s.tenant_id=$1 AND s.id=$2 AND s.archived_at IS NULL AND c.archived_at IS NULL`,
        [user.tenantId, body.siteId]
      );
      if (!site.rows.length) throw httpError(404, 'Aktives Objekt nicht gefunden.');
      if (body.customerId && body.customerId !== site.rows[0].client_id) {
        throw httpError(400, 'Der ausgewählte Kunde ist dem Objekt nicht zugeordnet.');
      }
      const type = await db.query(
        'SELECT id,code FROM alarm_types WHERE tenant_id=$1 AND id=$2 AND is_active=true',
        [user.tenantId, body.alarmTypeId]
      );
      if (!type.rows.length) throw httpError(400, 'Die Alarmart ist nicht aktiv.');
      if (body.ownerEmployeeId) await assertEmployeeAssigned(db, user.tenantId, body.ownerEmployeeId, body.siteId);
      const created = await db.query(
        `INSERT INTO emergency_plans
          (tenant_id,site_id,customer_id,alarm_type_id,owner_employee_id,scenario,action_steps,contacts,
           effective_from,effective_until,last_drill_date,is_active,publication_status,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'[]'::jsonb,$8,$9,NULL,false,'draft',$10,$10)
         RETURNING id,tenant_id,customer_id,site_id,alarm_type_id,owner_employee_id,revision_version`,
        [user.tenantId, body.siteId, site.rows[0].client_id, body.alarmTypeId,
          body.ownerEmployeeId ?? null, type.rows[0].code, JSON.stringify(body.chainOfAction),
          body.effectiveFrom ?? null, body.effectiveUntil ?? null, user.userId]
      );
      const plan = created.rows[0];
      if (body.contacts) await savePlanContacts(db, user, plan, body.contacts);
      const versionId = await createPlanVersion(db, user, plan.id);
      await event(db, user.tenantId, null, plan.id, user.userId, 'plan_created', { versionId });
      return {
        ...plan, current_version_id: versionId, publication_status: 'draft', is_active: false,
        revision_version: plan.revision_version + 1
      };
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function updateEmergencyPlanV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const body = planUpdateSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const selected = await db.query(
        'SELECT * FROM emergency_plans WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
        [user.tenantId, planId]
      );
      if (!selected.rows.length) throw httpError(404, 'Notfallplan nicht gefunden.');
      const current = selected.rows[0];
      if (current.revision_version !== body.revisionVersion) throw httpError(409, 'Notfallplan wurde zwischenzeitlich geändert.');
      const siteId = body.siteId ?? current.site_id;
      await assertSiteAccess(db, user, siteId);
      const site = await db.query(
        `SELECT s.client_id FROM sites s JOIN clients c ON c.id=s.client_id AND c.tenant_id=s.tenant_id
         WHERE s.tenant_id=$1 AND s.id=$2 AND s.archived_at IS NULL AND c.archived_at IS NULL`,
        [user.tenantId, siteId]
      );
      if (!site.rows.length) throw httpError(404, 'Aktives Objekt nicht gefunden.');
      if (body.customerId && body.customerId !== site.rows[0].client_id) {
        throw httpError(400, 'Der ausgewählte Kunde ist dem Objekt nicht zugeordnet.');
      }
      const typeId = body.alarmTypeId ?? current.alarm_type_id;
      const type = await db.query(
        'SELECT id,code FROM alarm_types WHERE tenant_id=$1 AND id=$2 AND is_active=true',
        [user.tenantId, typeId]
      );
      if (!type.rows.length) throw httpError(400, 'Die Alarmart ist nicht aktiv.');
      const ownerId = body.ownerEmployeeId === undefined ? current.owner_employee_id : body.ownerEmployeeId;
      if (ownerId) await assertEmployeeAssigned(db, user.tenantId, ownerId, siteId);
      if (body.contacts) await savePlanContacts(db, user, { ...current, id: planId, customer_id: site.rows[0].client_id, site_id: siteId }, body.contacts);
      await db.query(
        `UPDATE emergency_plans SET site_id=$1,customer_id=$2,alarm_type_id=$3,owner_employee_id=$4,
           scenario=$5,action_steps=$6::jsonb,effective_from=$7,effective_until=$8,
           contacts='[]'::jsonb,updated_by=$9,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$10 AND id=$11`,
        [siteId, site.rows[0].client_id, typeId, ownerId, type.rows[0].code,
          JSON.stringify(body.chainOfAction ?? current.action_steps),
          body.effectiveFrom === undefined ? current.effective_from : body.effectiveFrom,
          body.effectiveUntil === undefined ? current.effective_until : body.effectiveUntil,
          user.userId, user.tenantId, planId]
      );
      const versionId = await createPlanVersion(db, user, planId);
      await event(db, user.tenantId, null, planId, user.userId, 'plan_updated', {
        versionId, previousPublicationStatus: current.publication_status
      });
      return { id: planId, currentVersionId: versionId, publicationStatus: 'draft' };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function publishEmergencyPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const revisionVersion = z.object({ revisionVersion: z.number().int().positive() }).strict().parse(req.body).revisionVersion;
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const selected = await db.query(
        `SELECT p.*,s.archived_at AS site_archived,c.archived_at AS customer_archived,t.is_active AS type_active
         FROM emergency_plans p
         JOIN sites s ON s.id=p.site_id AND s.tenant_id=p.tenant_id
         JOIN clients c ON c.id=p.customer_id AND c.tenant_id=p.tenant_id
         JOIN alarm_types t ON t.id=p.alarm_type_id AND t.tenant_id=p.tenant_id
         WHERE p.tenant_id=$1 AND p.id=$2 AND p.archived_at IS NULL FOR UPDATE OF p`,
        [user.tenantId, planId]
      );
      if (!selected.rows.length) throw httpError(404, 'Notfallplan nicht gefunden.');
      const plan = selected.rows[0];
      if (plan.revision_version !== revisionVersion) throw httpError(409, 'Notfallplan wurde zwischenzeitlich geändert.');
      await assertSiteAccess(db, user, plan.site_id);
      if (!plan.current_version_id || !plan.effective_from || plan.site_archived || plan.customer_archived || !plan.type_active) {
        throw httpError(400, 'Notfallplan benötigt eine gültige Version, einen Gültigkeitsbeginn sowie aktive Alarmart, Kunden und Objekt.');
      }
      const today = new Date().toISOString().slice(0, 10);
      if (plan.effective_until && plan.effective_until < today) throw httpError(400, 'Der Notfallplan ist bereits abgelaufen.');
      const updated = await db.query(
        `UPDATE emergency_plans SET published_version_id=current_version_id,publication_status='published',
           is_active=true,revision_version=revision_version+1,updated_by=$1,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$2 AND id=$3 AND revision_version=$4
         RETURNING id,published_version_id,revision_version,publication_status,effective_from,effective_until`,
        [user.userId, user.tenantId, planId, revisionVersion]
      );
      await event(db, user.tenantId, null, planId, user.userId, 'plan_published', {
        versionId: plan.current_version_id
      });
      return updated.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function listEmergencyPlanVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const plan = await db.query(
        'SELECT site_id FROM emergency_plans WHERE tenant_id=$1 AND id=$2',
        [user.tenantId, planId]
      );
      if (!plan.rows.length) throw httpError(404, 'Notfallplan nicht gefunden.');
      await assertSiteAccess(db, user, plan.rows[0].site_id);
      const versions = await db.query(
        `SELECT v.id,v.version_number,v.customer_id,v.site_id,v.alarm_type_id,v.owner_employee_id,
                v.action_steps,v.contact_snapshot,v.effective_from,v.effective_until,v.created_by,v.created_at,
                concat(u.first_name,' ',u.last_name) AS created_by_name
         FROM emergency_plan_versions v JOIN users u ON u.id=v.created_by
         WHERE v.tenant_id=$1 AND v.emergency_plan_id=$2 ORDER BY v.version_number DESC`,
        [user.tenantId, planId]
      );
      if (!can(user, 'emergency_contact:read')) {
        return versions.rows.map((version: any) => ({ ...version, contact_snapshot: [] }));
      }
      return versions.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function recordEmergencyDrillV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const body = z.object({ drillDate: date }).strict().parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const plan = await db.query(
        `SELECT site_id,last_drill_date FROM emergency_plans
         WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE`,
        [user.tenantId, planId]
      );
      if (!plan.rows.length) throw httpError(404, 'Notfallplan nicht gefunden.');
      await assertSiteAccess(db, user, plan.rows[0].site_id);
      const updated = await db.query(
        `UPDATE emergency_plans SET last_drill_date=GREATEST(COALESCE(last_drill_date,$1::date),$1::date),
           revision_version=revision_version+1,updated_by=$2,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$3 AND id=$4 RETURNING id,last_drill_date,revision_version`,
        [body.drillDate, user.userId, user.tenantId, planId]
      );
      await event(db, user.tenantId, null, planId, user.userId, 'drill_recorded', { drillDate: body.drillDate });
      return updated.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function listEmergencyPlanEventsV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const limit = pageLimit(req.query.limit);
    const cursor = decodePageCursor(req.query.cursor);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const plan = await db.query(
        'SELECT site_id FROM emergency_plans WHERE tenant_id=$1 AND id=$2',
        [user.tenantId, planId]
      );
      if (!plan.rows.length) throw httpError(404, 'Notfallplan nicht gefunden.');
      await assertSiteAccess(db, user, plan.rows[0].site_id);
      const result = await db.query(
        `SELECT e.id,e.action,e.details,e.occurred_at,
                to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_timestamp,
                concat(u.first_name,' ',u.last_name) AS actor_name
         FROM emergency_management_events e JOIN users u ON u.id=e.actor_user_id
         WHERE e.tenant_id=$1 AND e.emergency_plan_id=$2
           AND ($3::timestamptz IS NULL OR (e.occurred_at,e.id)<($3::timestamptz,$4::uuid))
         ORDER BY e.occurred_at DESC,e.id DESC LIMIT $5`,
        [user.tenantId, planId, cursor?.timestamp ?? null, cursor?.id ?? null, limit + 1]
      );
      return pageResult(result.rows, limit, 'occurred_at');
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listAlarmEventsV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const limit = pageLimit(req.query.limit);
    const cursor = decodePageCursor(req.query.cursor);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      await getIncidentForUser(db, user, incidentId);
      const result = await db.query(
        `SELECT e.id,e.action,e.details,e.occurred_at,
                to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_timestamp,
                concat(u.first_name,' ',u.last_name) AS actor_name
         FROM emergency_management_events e JOIN users u ON u.id=e.actor_user_id
         WHERE e.tenant_id=$1 AND e.alarm_incident_id=$2
           AND ($3::timestamptz IS NULL OR (e.occurred_at,e.id)<($3::timestamptz,$4::uuid))
         ORDER BY e.occurred_at DESC,e.id DESC LIMIT $5`,
        [user.tenantId, incidentId, cursor?.timestamp ?? null, cursor?.id ?? null, limit + 1]
      );
      return pageResult(result.rows, limit, 'occurred_at');
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function archiveEmergencyPlanV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const revisionVersion = z.object({ revisionVersion: z.number().int().positive() }).strict().parse(req.body).revisionVersion;
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const selected = await db.query(
        'SELECT site_id,revision_version FROM emergency_plans WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
        [user.tenantId, planId]
      );
      if (!selected.rows.length) throw httpError(404, 'Notfallplan nicht gefunden.');
      await assertSiteAccess(db, user, selected.rows[0].site_id);
      if (selected.rows[0].revision_version !== revisionVersion) throw httpError(409, 'Notfallplan wurde zwischenzeitlich geändert.');
      await db.query(
        `UPDATE emergency_plans SET is_active=false,publication_status='archived',archived_at=CURRENT_TIMESTAMP,
           updated_by=$1,revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$2 AND id=$3`,
        [user.userId, user.tenantId, planId]
      );
      await event(db, user.tenantId, null, planId, user.userId, 'plan_archived');
      return { id: planId, publicationStatus: 'archived' };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function listEmergencyContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const scope = await siteScope(db, user);
      const result = await db.query(
        `SELECT c.id,c.customer_id,c.site_id,c.emergency_plan_id,c.contact_type,c.role,c.name,c.phone,
                c.email,c.notes,c.revision_version,c.created_at,c.updated_at
         FROM emergency_contacts c
         WHERE c.tenant_id=$1 AND c.archived_at IS NULL
           AND ($2::uuid[] IS NULL OR c.site_id=ANY($2) OR
             (c.site_id IS NULL AND c.customer_id IN (
               SELECT s.client_id FROM sites s WHERE s.tenant_id=$1 AND s.id=ANY($2)
             )))
         ORDER BY c.contact_type,c.role,c.name`,
        [user.tenantId, scope]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function createEmergencyContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = contactCreateSchema.parse(req.body);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const scope = await siteScope(db, user);
      let customerId = body.customerId ?? null;
      let siteId = body.siteId ?? null;
      let planId = body.emergencyPlanId ?? null;
      if (planId) {
        const plan = await db.query(
          `SELECT p.site_id,p.customer_id FROM emergency_plans p
           JOIN sites s ON s.tenant_id=p.tenant_id AND s.id=p.site_id AND s.archived_at IS NULL
           JOIN clients c ON c.tenant_id=p.tenant_id AND c.id=p.customer_id AND c.archived_at IS NULL
           WHERE p.tenant_id=$1 AND p.id=$2 AND p.archived_at IS NULL`,
          [user.tenantId, planId]
        );
        if (!plan.rows.length) throw httpError(404, 'Notfallplan nicht gefunden.');
        await assertSiteAccess(db, user, plan.rows[0].site_id);
        siteId = plan.rows[0].site_id;
        customerId = plan.rows[0].customer_id;
      } else if (siteId) {
        await assertSiteAccess(db, user, siteId);
        const site = await db.query(
          `SELECT s.client_id FROM sites s JOIN clients c ON c.id=s.client_id AND c.tenant_id=s.tenant_id
           WHERE s.tenant_id=$1 AND s.id=$2 AND s.archived_at IS NULL AND c.archived_at IS NULL`,
          [user.tenantId, siteId]
        );
        if (!site.rows.length) throw httpError(404, 'Aktives Objekt nicht gefunden.');
        if (customerId && customerId !== site.rows[0].client_id) throw httpError(400, 'Kunde und Objekt passen nicht zusammen.');
        customerId = site.rows[0].client_id;
      } else {
        if (scope && !['Systemadministrator','Geschäftsführung','Einsatzleitung','Qualitätsmanagement'].includes(user.role)) {
          throw httpError(403, 'Objektbezogener Zugriff erfordert einen Objektbezug.');
        }
        if (!customerId) throw httpError(400, 'Ein Kunde oder Objekt ist erforderlich.');
        const customer = await db.query(
          'SELECT 1 FROM clients WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL',
          [user.tenantId, customerId]
        );
        if (!customer.rows.length) throw httpError(404, 'Aktiver Kunde nicht gefunden.');
      }
      const created = await db.query(
        `INSERT INTO emergency_contacts
          (tenant_id,customer_id,site_id,emergency_plan_id,contact_type,role,name,phone,email,notes,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
         RETURNING id,tenant_id,customer_id,site_id,emergency_plan_id,contact_type,role,name,phone,email,notes,revision_version`,
        [user.tenantId, customerId, siteId, planId, body.contactType, body.role, body.name, body.phone,
          body.email ?? null, body.notes, user.userId]
      );
      return created.rows[0];
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function updateEmergencyContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const contactId = uuid.parse(req.params.id);
    const body = contactSchema.partial().extend({ revisionVersion: z.number().int().positive() }).strict()
      .refine(value => Object.keys(value).some(key => key !== 'revisionVersion')).parse(req.body);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const contact = await db.query(
        'SELECT * FROM emergency_contacts WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
        [user.tenantId, contactId]
      );
      if (!contact.rows.length) throw httpError(404, 'Notfallkontakt nicht gefunden.');
      const current = contact.rows[0];
      if (current.site_id) await assertSiteAccess(db, user, current.site_id);
      else if (!['Systemadministrator','Geschäftsführung','Einsatzleitung','Qualitätsmanagement'].includes(user.role)) {
        throw httpError(403, 'Kein Zugriff auf diesen Notfallkontakt.');
      }
      if (current.revision_version !== body.revisionVersion) throw httpError(409, 'Notfallkontakt wurde zwischenzeitlich geändert.');
      const result = await db.query(
        `UPDATE emergency_contacts SET contact_type=$1,role=$2,name=$3,phone=$4,email=$5,notes=$6,
           revision_version=revision_version+1,updated_by=$7,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$8 AND id=$9 AND revision_version=$10
         RETURNING id,contact_type,role,name,phone,email,notes,revision_version,updated_at`,
        [body.contactType ?? current.contact_type, body.role ?? current.role, body.name ?? current.name,
          body.phone ?? current.phone, body.email === undefined ? current.email : body.email,
          body.notes ?? current.notes, user.userId, user.tenantId, contactId, body.revisionVersion]
      );
      return result.rows[0];
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function archiveEmergencyContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const contactId = uuid.parse(req.params.id);
    const revisionVersion = z.object({ revisionVersion: z.number().int().positive() }).strict().parse(req.body).revisionVersion;
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const contact = await db.query(
        'SELECT site_id,revision_version FROM emergency_contacts WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
        [user.tenantId, contactId]
      );
      if (!contact.rows.length) throw httpError(404, 'Notfallkontakt nicht gefunden.');
      if (contact.rows[0].site_id) await assertSiteAccess(db, user, contact.rows[0].site_id);
      else if (!['Systemadministrator','Geschäftsführung','Einsatzleitung','Qualitätsmanagement'].includes(user.role)) {
        throw httpError(403, 'Kein Zugriff auf diesen Notfallkontakt.');
      }
      if (contact.rows[0].revision_version !== revisionVersion) throw httpError(409, 'Notfallkontakt wurde zwischenzeitlich geändert.');
      await db.query(
        `UPDATE emergency_contacts SET archived_at=CURRENT_TIMESTAMP,revision_version=revision_version+1,
           updated_by=$1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$2 AND id=$3`,
        [user.userId, user.tenantId, contactId]
      );
      return { id: contactId };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

function legacyAlarmCode(scenario: string | undefined): string | undefined {
  if (!scenario) return undefined;
  const aliases: Record<string, string> = {
    'BMA - Brandmeldeanlage': 'bma',
    'EMA - Einbruchsalarm': 'ema',
    'EMA - Einbruchalarm': 'ema',
    'Bombendrohung': 'bombendrohung',
    'Medizinischer Notfall': 'medizinischer_notfall',
    'Hausfriedensbruch / Aggression': 'hausfriedensbruch_aggression'
  };
  return aliases[scenario] ?? scenario;
}

function severityRank(value: string): number {
  return severityValues.indexOf(value as typeof severityValues[number]) + 1;
}

async function scheduleEscalationJobs(
  db: PoolClient,
  tenantId: string,
  incident: { id: string; site_id: string; alarm_type_id: string; severity: string },
  capturedAt: string
): Promise<void> {
  const rules = await db.query(
    `SELECT r.id AS rule_id,s.id AS step_id,s.delay_minutes
     FROM alarm_escalation_rules r
     JOIN alarm_escalation_steps s ON s.rule_id=r.id AND s.tenant_id=r.tenant_id
     WHERE r.tenant_id=$1 AND r.is_active=true
       AND (r.site_id IS NULL OR r.site_id=$2)
       AND (r.alarm_type_id IS NULL OR r.alarm_type_id=$3)
       AND CASE r.minimum_severity
         WHEN 'Niedrig' THEN 1 WHEN 'Normal' THEN 2 WHEN 'Dringend' THEN 3 WHEN 'Kritisch' THEN 4
       END <= CASE $4::text
         WHEN 'Niedrig' THEN 1 WHEN 'Normal' THEN 2 WHEN 'Dringend' THEN 3 WHEN 'Kritisch' THEN 4
       END
     ORDER BY (r.site_id IS NOT NULL) DESC,(r.alarm_type_id IS NOT NULL) DESC,r.updated_at DESC,s.step_number`,
    [tenantId, incident.site_id, incident.alarm_type_id, incident.severity]
  );
  const selectedRule = rules.rows[0]?.rule_id;
  if (!selectedRule) return;
  for (const step of rules.rows.filter((row: any) => row.rule_id === selectedRule)) {
    await db.query(
      `INSERT INTO alarm_escalation_jobs
        (tenant_id,alarm_incident_id,rule_id,step_id,scheduled_at)
       VALUES ($1,$2,$3,$4,$5::timestamptz + ($6::int * interval '1 minute'))
       ON CONFLICT (tenant_id,alarm_incident_id,step_id) DO NOTHING`,
      [tenantId, incident.id, step.rule_id, step.step_id, capturedAt, step.delay_minutes]
    );
  }
}

async function notifyAssignedResponder(
  db: PoolClient,
  tenantId: string,
  incidentId: string,
  employeeId: string
): Promise<void> {
  const recipient = await db.query(
    `SELECT u.id FROM employees e
     LEFT JOIN users u ON lower(u.email)=lower(e.email) AND u.is_active=true
     WHERE e.tenant_id=$1 AND e.id=$2 AND e.archived_at IS NULL
     ORDER BY u.id NULLS LAST LIMIT 1`,
    [tenantId, employeeId]
  );
  const recipientId = recipient.rows[0]?.id ?? null;
  await db.query(
    `INSERT INTO alarm_notifications
      (tenant_id,alarm_incident_id,recipient_user_id,channel,notification_type,delivery_status,
       attempt_count,delivered_at,last_error)
     VALUES ($1,$2,$3,'in_app','incident_assignment',$4,$5,$6,$7)`,
    [tenantId, incidentId, recipientId, recipientId ? 'delivered' : 'not_configured',
      recipientId ? 1 : 0, recipientId ? new Date() : null,
      recipientId ? null : 'Der zugewiesenen Einsatzkraft ist kein aktives Benutzerkonto zugeordnet.']
  );
}

async function findAlarmType(db: PoolClient, tenantId: string, typeId?: string, scenario?: string): Promise<any> {
  const code = legacyAlarmCode(scenario);
  const found = await db.query(
    `SELECT id,code,label FROM alarm_types
     WHERE tenant_id=$1 AND is_active=true
       AND (($2::uuid IS NOT NULL AND id=$2)
         OR ($3::text IS NOT NULL AND (code=$3 OR label=$4)))
     LIMIT 1`,
    [tenantId, typeId ?? null, code ?? null, scenario ?? null]
  );
  if (!found.rows.length) throw httpError(400, 'Die Alarmart ist nicht aktiv oder wurde nicht gefunden.');
  return found.rows[0];
}

async function storeReceipt(
  db: PoolClient,
  user: User,
  kind: MutationKind,
  clientMutationId: string,
  payload: unknown,
  handler: () => Promise<any>
): Promise<any> {
  const payloadHash = createHash('sha256').update(JSON.stringify({ kind, payload })).digest('hex');
  const prior = await db.query(
    `SELECT actor_user_id,payload_hash,response_json FROM alarm_mutation_receipts
     WHERE tenant_id=$1 AND client_mutation_id=$2`,
    [user.tenantId, clientMutationId]
  );
  if (prior.rows.length) {
    const receipt = prior.rows[0];
    if (receipt.actor_user_id !== user.userId || receipt.payload_hash !== payloadHash) {
      throw httpError(409, 'Diese Client-Mutations-ID wurde bereits für einen anderen Inhalt verwendet.');
    }
    return receipt.response_json;
  }
  const response = await handler();
  await db.query(
    `INSERT INTO alarm_mutation_receipts
      (tenant_id,client_mutation_id,actor_user_id,mutation_type,payload_hash,response_json)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [user.tenantId, clientMutationId, user.userId, kind, payloadHash, JSON.stringify(response)]
  );
  return response;
}

async function createIncident(
  db: PoolClient,
  user: User,
  body: z.infer<typeof incidentReportSchema>
): Promise<any> {
  await assertSiteAccess(db, user, body.siteId);
  const site = await db.query(
    `SELECT s.client_id FROM sites s JOIN clients c ON c.id=s.client_id AND c.tenant_id=s.tenant_id
     WHERE s.tenant_id=$1 AND s.id=$2 AND s.archived_at IS NULL AND c.archived_at IS NULL`,
    [user.tenantId, body.siteId]
  );
  if (!site.rows.length) throw httpError(404, 'Aktives Objekt nicht gefunden.');
  const type = await findAlarmType(db, user.tenantId, body.alarmTypeId, body.scenario);
  if (body.assignedEmployeeId) await assertEmployeeAssigned(db, user.tenantId, body.assignedEmployeeId, body.siteId);
  const capturedAt = body.capturedAt ?? new Date().toISOString();
  validateCapturedAt(capturedAt);
  let versionId: string | null = null;
  if (body.emergencyPlanId) {
    const plan = await db.query(
      `SELECT p.id,p.published_version_id,p.effective_from,p.effective_until,v.alarm_type_id
       FROM emergency_plans p
       JOIN emergency_plan_versions v
         ON v.id=p.published_version_id AND v.tenant_id=p.tenant_id
       WHERE p.tenant_id=$1 AND p.id=$2 AND p.site_id=$3 AND p.customer_id=$4
         AND p.alarm_type_id=$5 AND p.publication_status='published' AND p.is_active=true
         AND p.archived_at IS NULL AND (p.effective_from IS NULL OR p.effective_from<=$6::date)
         AND (p.effective_until IS NULL OR p.effective_until>=$6::date)`,
      [user.tenantId, body.emergencyPlanId, body.siteId, site.rows[0].client_id, type.id, capturedAt]
    );
    if (!plan.rows.length) throw httpError(400, 'Der ausgewählte veröffentlichte Notfallplan ist ungültig oder außerhalb seiner Gültigkeit.');
    versionId = plan.rows[0].published_version_id;
  }
  const created = await db.query(
    `INSERT INTO alarm_incidents
      (tenant_id,site_id,customer_id,alarm_type_id,emergency_plan_id,emergency_plan_version_id,
       scenario,severity,status,title,description,reported_by,assigned_employee_id,captured_at,client_mutation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'neu',$9,$10,$11,$12,$13,$14)
     RETURNING id,tenant_id,incident_number,site_id,customer_id,alarm_type_id,emergency_plan_id,
       emergency_plan_version_id,scenario,severity,status,title,description,reported_at,captured_at,
       server_received_at,assigned_employee_id,revision_version,client_mutation_id`,
    [user.tenantId, body.siteId, site.rows[0].client_id, type.id, body.emergencyPlanId ?? null,
      versionId, type.code, body.severity, body.title, body.description, user.userId,
      body.assignedEmployeeId ?? null, capturedAt, body.clientMutationId]
  );
  const incident = created.rows[0];
  if (body.assignedEmployeeId) {
    await db.query(
      `INSERT INTO alarm_event_assignments
        (tenant_id,alarm_incident_id,employee_id,assigned_by) VALUES ($1,$2,$3,$4)`,
      [user.tenantId, incident.id, body.assignedEmployeeId, user.userId]
    );
    await notifyAssignedResponder(db, user.tenantId, incident.id, body.assignedEmployeeId);
  }
  await db.query(
    `INSERT INTO alarm_event_status_history
      (tenant_id,alarm_incident_id,from_status,to_status,actor_user_id,reason)
     VALUES ($1,$2,NULL,'neu',$3,'Alarmvorfall erfasst')`,
    [user.tenantId, incident.id, user.userId]
  );
  await writeAction(db, user.tenantId, incident.id, user.userId, 'note',
    'Alarmvorfall erfasst', body.description, body.clientMutationId, capturedAt);
  await event(db, user.tenantId, incident.id, null, user.userId, 'incident_reported', {
    alarmTypeId: type.id, severity: body.severity, capturedAt
  });
  await scheduleEscalationJobs(db, user.tenantId, incident, capturedAt);
  return { state: 'confirmed', incident };
}

export async function listAlarmIncidentsV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = z.object({
      customerId: uuid.optional(),
      siteId: uuid.optional(),
      alarmTypeId: uuid.optional(),
      status: z.enum(alarmStatuses).optional(),
      severity: z.enum(severityValues).optional(),
      assignedEmployeeId: uuid.optional(),
      dateFrom: date.optional(),
      dateUntil: date.optional(),
      overdue: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: z.string().min(1).max(512).optional()
    }).strict().parse(req.query);
    const cursor = decodePageCursor(filters.cursor);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const scope = await siteScope(db, user);
      if (filters.siteId) await assertSiteAccess(db, user, filters.siteId);
      const values: unknown[] = [user.tenantId];
      const clauses = ['a.tenant_id=$1'];
      const add = (value: unknown, expression: (index: number) => string) => {
        values.push(value);
        clauses.push(expression(values.length));
      };
      if (scope) add(scope, index => `a.site_id=ANY($${index}::uuid[])`);
      if (filters.customerId) add(filters.customerId, index => `a.customer_id=$${index}`);
      if (filters.siteId) add(filters.siteId, index => `a.site_id=$${index}`);
      if (filters.alarmTypeId) add(filters.alarmTypeId, index => `a.alarm_type_id=$${index}`);
      if (filters.status) add(filters.status, index => `a.status=$${index}`);
      if (filters.severity) add(filters.severity, index => `a.severity=$${index}`);
      if (filters.assignedEmployeeId) add(filters.assignedEmployeeId, index => `a.assigned_employee_id=$${index}`);
      if (filters.dateFrom) add(filters.dateFrom, index => `a.reported_at >= $${index}::date`);
      if (filters.dateUntil) add(filters.dateUntil, index => `a.reported_at < ($${index}::date + interval '1 day')`);
      if (filters.overdue === 'true') {
        clauses.push(`EXISTS (SELECT 1 FROM alarm_escalation_jobs j
          WHERE j.tenant_id=a.tenant_id AND j.alarm_incident_id=a.id AND j.status='pending'
            AND COALESCE(j.retry_at,j.scheduled_at)<=CURRENT_TIMESTAMP)`);
      }
      values.push(cursor?.timestamp ?? null, cursor?.id ?? null);
      clauses.push(`($${values.length - 1}::timestamptz IS NULL OR
        (a.reported_at,a.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid))`);
      values.push(filters.limit + 1);
      const result = await db.query(
        `SELECT a.id,a.tenant_id,a.incident_number,a.customer_id,c.company_name AS customer_name,
                a.site_id,s.name AS site_name,a.emergency_plan_id,a.emergency_plan_version_id,
                to_char(a.reported_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_timestamp,
                a.alarm_type_id,t.code AS scenario,t.label AS alarm_type_label,a.severity,a.status,
                a.title,a.description,a.reported_at,a.captured_at,a.server_received_at,
                a.acknowledged_at,a.escalated_at,a.resolved_at,a.reported_by,a.resolved_by,
                a.assigned_employee_id,a.resolution_note,a.revision_version,a.client_mutation_id,
                concat(ru.first_name,' ',ru.last_name) AS reporter_name,
                concat(e.first_name,' ',e.last_name) AS assigned_employee_name,
                EXISTS (SELECT 1 FROM alarm_escalation_jobs j
                  WHERE j.tenant_id=a.tenant_id AND j.alarm_incident_id=a.id AND j.status='pending'
                    AND COALESCE(j.retry_at,j.scheduled_at)<=CURRENT_TIMESTAMP) AS is_overdue
         FROM alarm_incidents a
         JOIN sites s ON s.id=a.site_id AND s.tenant_id=a.tenant_id
         JOIN clients c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
         JOIN alarm_types t ON t.id=a.alarm_type_id AND t.tenant_id=a.tenant_id
         JOIN users ru ON ru.id=a.reported_by
         LEFT JOIN employees e ON e.id=a.assigned_employee_id AND e.tenant_id=a.tenant_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY a.reported_at DESC,a.id DESC LIMIT $${values.length}`,
        values
      );
      return pageResult(result.rows, filters.limit, 'reported_at');
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listRecentAlarmEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(25).parse(req.query.limit);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const scope = await siteScope(db, user);
      const result = await db.query(
        `SELECT e.id,e.action,e.details,e.occurred_at,e.alarm_incident_id,e.emergency_plan_id,
                a.incident_number,a.title,COALESCE(a.site_id,p.site_id) AS site_id,s.name AS site_name,
                concat(u.first_name,' ',u.last_name) AS actor_name
         FROM emergency_management_events e
         LEFT JOIN alarm_incidents a ON a.id=e.alarm_incident_id AND a.tenant_id=e.tenant_id
         LEFT JOIN emergency_plans p ON p.id=e.emergency_plan_id AND p.tenant_id=e.tenant_id
         JOIN sites s ON s.id=COALESCE(a.site_id,p.site_id) AND s.tenant_id=e.tenant_id
         JOIN users u ON u.id=e.actor_user_id
         WHERE e.tenant_id=$1 AND ($2::uuid[] IS NULL OR s.id=ANY($2))
         ORDER BY e.occurred_at DESC,e.id DESC LIMIT $3`,
        [user.tenantId, scope, limit]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function reportAlarmIncidentV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = incidentReportSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, db => storeReceipt(
      db, user, 'incident_report', body.clientMutationId, body, () => createIncident(db, user, body)
    ));
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

async function getIncidentForUser(db: PoolClient, user: User, incidentId: string, lock = false): Promise<any> {
  const result = await db.query(
    `SELECT * FROM alarm_incidents WHERE tenant_id=$1 AND id=$2 ${lock ? 'FOR UPDATE' : ''}`,
    [user.tenantId, incidentId]
  );
  if (!result.rows.length) throw httpError(404, 'Alarmvorfall nicht gefunden.');
  await assertSiteAccess(db, user, result.rows[0].site_id);
  return result.rows[0];
}

async function resolveSyncedIncidentId(db: PoolClient, tenantId: string, value: unknown): Promise<string> {
  if (typeof value !== 'string') throw httpError(400, 'Alarmereignis-ID ist ungültig.');
  if (value.startsWith('local:')) {
    const mutationId = value.slice('local:'.length);
    const result = await db.query(
      'SELECT id FROM alarm_incidents WHERE tenant_id=$1 AND client_mutation_id=$2',
      [tenantId, mutationId]
    );
    if (!result.rows.length) throw httpError(409, 'Das lokal erfasste Alarmereignis wurde noch nicht synchronisiert.');
    return result.rows[0].id;
  }
  return uuid.parse(value);
}

export async function createAlarmAction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const body = actionSchema.parse(req.body);
    validateCapturedAt(body.capturedAt);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, db => storeReceipt(
      db, user, 'action_create', body.clientMutationId, { incidentId, ...body }, async () => {
        const incident = await getIncidentForUser(db, user, incidentId, true);
        if (incident.status === 'archiviert') throw httpError(409, 'Archivierte Alarmvorfälle können nicht geändert werden.');
        const action = await writeAction(db, user.tenantId, incidentId, user.userId, body.actionType,
          body.description, body.result, body.clientMutationId, body.capturedAt ?? null,
          body.attachmentDocumentId ?? null);
        await event(db, user.tenantId, incidentId, null, user.userId, 'incident_action_recorded', {
          actionId: action.id, actionType: body.actionType
        });
        return { state: 'confirmed', action };
      }
    ));
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

function requestedStatus(body: z.infer<typeof transitionSchema>): typeof alarmStatuses[number] {
  if (body.status) return body.status;
  if (body.action === 'acknowledge') return 'bestätigt';
  if (body.action === 'escalate') return 'eskaliert';
  return 'abgeschlossen';
}

const allowedTransitions: Record<string, string[]> = {
  neu: ['bestätigt', 'in_bearbeitung', 'eskaliert', 'abgeschlossen'],
  bestätigt: ['in_bearbeitung', 'eskaliert', 'einsatzkraefte_verstaendigt', 'massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen'],
  in_bearbeitung: ['eskaliert', 'einsatzkraefte_verstaendigt', 'massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen'],
  eskaliert: ['in_bearbeitung', 'einsatzkraefte_verstaendigt', 'massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen'],
  einsatzkraefte_verstaendigt: ['massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen'],
  massnahmen_eingeleitet: ['entwarnung', 'abgeschlossen'],
  entwarnung: ['abgeschlossen'],
  abgeschlossen: ['archiviert'],
  archiviert: []
};

async function applyIncidentTransition(
  db: PoolClient,
  user: User,
  incidentId: string,
  body: z.infer<typeof transitionSchema>,
  allowConflict: boolean
): Promise<any> {
  const incident = await getIncidentForUser(db, user, incidentId, true);
  if (incident.revision_version !== body.revisionVersion) {
    if (allowConflict) return { state: 'conflict', currentVersion: incident.revision_version, currentStatus: incident.status };
    throw httpError(409, 'Alarmvorfall wurde zwischenzeitlich geändert.',);
  }
  const status = requestedStatus(body);
  if (!allowedTransitions[incident.status]?.includes(status)) {
    throw httpError(409, 'Diese Statusänderung ist für den aktuellen Alarmvorfall nicht zulässig.');
  }
  if (status === 'archiviert' && !user.permissions.includes('alarm:archive')) {
    throw httpError(403, 'Für das Archivieren eines Alarmvorfalls fehlt die Berechtigung alarm:archive.');
  }
  const updated = await db.query(
    `UPDATE alarm_incidents
     SET status=$1::varchar,
       acknowledged_at=CASE WHEN $1::varchar='neu' THEN NULL ELSE COALESCE(acknowledged_at,CURRENT_TIMESTAMP) END,
       escalated_at=CASE WHEN $1::varchar='eskaliert' THEN COALESCE(escalated_at,CURRENT_TIMESTAMP) ELSE escalated_at END,
       resolved_at=CASE WHEN $1::varchar IN ('abgeschlossen','archiviert') THEN COALESCE(resolved_at,CURRENT_TIMESTAMP) ELSE NULL END,
       resolved_by=CASE WHEN $1::varchar IN ('abgeschlossen','archiviert') THEN COALESCE(resolved_by,$2::uuid) ELSE NULL END,
       resolution_note=CASE WHEN $1::varchar IN ('abgeschlossen','archiviert') THEN COALESCE(resolution_note,$3) ELSE NULL END,
       revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
     WHERE tenant_id=$4 AND id=$5 AND revision_version=$6
     RETURNING id,status,acknowledged_at,escalated_at,resolved_at,resolved_by,resolution_note,revision_version`,
    [status, user.userId, body.note, user.tenantId, incidentId, body.revisionVersion]
  );
  if (!updated.rows.length) {
    if (allowConflict) {
      const latest = await getIncidentForUser(db, user, incidentId);
      return { state: 'conflict', currentVersion: latest.revision_version, currentStatus: latest.status };
    }
    throw httpError(409, 'Alarmvorfall wurde zwischenzeitlich geändert.');
  }
  await db.query(
    `INSERT INTO alarm_event_status_history
      (tenant_id,alarm_incident_id,from_status,to_status,actor_user_id,reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [user.tenantId, incidentId, incident.status, status, user.userId, body.note]
  );
  const actionType = status === 'eskaliert' ? 'escalation' : 'status_change';
  const action = await writeAction(db, user.tenantId, incidentId, user.userId, actionType, body.note, status,
    body.clientMutationId);
  await event(db, user.tenantId, incidentId, null, user.userId, 'incident_status_changed', {
    fromStatus: incident.status, toStatus: status, note: body.note
  });
  return { state: 'confirmed', incident: updated.rows[0], action };
}

export async function transitionAlarmIncidentV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const body = transitionSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, db => storeReceipt(
      db, user, 'status_change', body.clientMutationId, { incidentId, ...body },
      () => applyIncidentTransition(db, user, incidentId, body, false)
    ));
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function syncAlarmMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = z.object({
      mutations: z.array(z.object({
        clientMutationId: z.string().trim().min(8).max(64),
        type: z.enum(['incident_report', 'action_create', 'status_change']),
        payload: z.record(z.string(), z.unknown())
      }).strict()).min(1).max(100)
    }).strict().parse(req.body);
    const user = req.user!;
    const results = [];
    for (const mutation of body.mutations) {
      try {
        const requiredPermission = mutation.type === 'incident_report'
          ? 'alarm:report'
          : mutation.type === 'action_create'
            ? 'alarm:action:create'
            : 'alarm:respond';
        if (!can(user, requiredPermission)) {
          throw httpError(403, `Zugriff verweigert: Fehlende Berechtigung '${requiredPermission}'`);
        }
        const response = await withTenantTransaction(user.tenantId, async db => {
          const payload: Record<string, unknown> = {
            ...mutation.payload,
            clientMutationId: mutation.clientMutationId
          };
          if (mutation.type === 'incident_report') {
            const parsed = incidentReportSchema.parse(payload);
            return storeReceipt(db, user, mutation.type, mutation.clientMutationId, parsed,
              () => createIncident(db, user, parsed));
          }
          if (mutation.type === 'action_create') {
            const { incidentId: rawIncidentId, ...actionPayload } = payload;
            const parsed = actionSchema.parse(actionPayload);
            validateCapturedAt(parsed.capturedAt);
            const incidentId = await resolveSyncedIncidentId(db, user.tenantId, rawIncidentId);
            return storeReceipt(db, user, mutation.type, mutation.clientMutationId,
              { incidentId, ...parsed }, async () => {
                const incident = await getIncidentForUser(db, user, incidentId, true);
                if (incident.status === 'archiviert') throw httpError(409, 'Archivierte Alarmvorfälle können nicht geändert werden.');
                const action = await writeAction(db, user.tenantId, incidentId, user.userId, parsed.actionType,
                  parsed.description, parsed.result, mutation.clientMutationId, parsed.capturedAt ?? null,
                  parsed.attachmentDocumentId ?? null);
                await event(db, user.tenantId, incidentId, null, user.userId, 'incident_action_recorded', {
                  actionId: action.id, actionType: parsed.actionType
                });
                return { state: 'confirmed', action };
              });
          }
          const { incidentId: rawIncidentId, ...transitionPayload } = payload;
          const parsed = transitionSchema.parse(transitionPayload);
          const incidentId = await resolveSyncedIncidentId(db, user.tenantId, rawIncidentId);
          return storeReceipt(db, user, mutation.type, mutation.clientMutationId,
            { incidentId, ...parsed }, () => applyIncidentTransition(db, user, incidentId, parsed, true));
        });
        results.push({ clientMutationId: mutation.clientMutationId, ...response });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
        results.push({
          clientMutationId: mutation.clientMutationId,
          state: statusCode >= 500 ? 'retry' : 'conflict',
          error: statusCode >= 500 ? 'Synchronisierung vorübergehend fehlgeschlagen.' : (error as Error).message
        });
      }
    }
    res.json({ success: true, data: results });
  } catch (error) { next(error); }
}

export async function listAlarmActions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const limit = pageLimit(req.query.limit);
    const cursor = decodePageCursor(req.query.cursor);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      await getIncidentForUser(db, user, incidentId);
      const result = await db.query(
        `SELECT a.id,a.action_type,a.description,a.result,a.captured_at,a.occurred_at,a.server_received_at,
                to_char(a.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_timestamp,
                concat(u.first_name,' ',u.last_name) AS actor_name
         FROM alarm_event_actions a JOIN users u ON u.id=a.actor_user_id
         WHERE a.tenant_id=$1 AND a.alarm_incident_id=$2
           AND ($3::timestamptz IS NULL OR (a.occurred_at,a.id)>($3::timestamptz,$4::uuid))
         ORDER BY a.occurred_at,a.id LIMIT $5`,
        [user.tenantId, incidentId, cursor?.timestamp ?? null, cursor?.id ?? null, limit + 1]
      );
      return pageResult(result.rows, limit, 'occurred_at');
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listAlarmStatusHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const limit = pageLimit(req.query.limit);
    const cursor = decodePageCursor(req.query.cursor);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      await getIncidentForUser(db, user, incidentId);
      const result = await db.query(
        `SELECT h.id,h.from_status,h.to_status,h.reason,h.occurred_at,
                to_char(h.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_timestamp,
                concat(u.first_name,' ',u.last_name) AS actor_name
         FROM alarm_event_status_history h JOIN users u ON u.id=h.actor_user_id
         WHERE h.tenant_id=$1 AND h.alarm_incident_id=$2
           AND ($3::timestamptz IS NULL OR (h.occurred_at,h.id)>($3::timestamptz,$4::uuid))
         ORDER BY h.occurred_at,h.id LIMIT $5`,
        [user.tenantId, incidentId, cursor?.timestamp ?? null, cursor?.id ?? null, limit + 1]
      );
      return pageResult(result.rows, limit, 'occurred_at');
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function assignAlarmResponder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const body = assignSchema.parse(req.body);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const incident = await getIncidentForUser(db, user, incidentId, true);
      await assertEmployeeAssigned(db, user.tenantId, body.employeeId, incident.site_id);
      const active = await db.query(
        `SELECT id FROM alarm_event_assignments
         WHERE tenant_id=$1 AND alarm_incident_id=$2 AND employee_id=$3 AND unassigned_at IS NULL`,
        [user.tenantId, incidentId, body.employeeId]
      );
      if (body.assigned && !active.rows.length) {
        await db.query(
          `INSERT INTO alarm_event_assignments
            (tenant_id,alarm_incident_id,employee_id,assigned_by) VALUES ($1,$2,$3,$4)`,
          [user.tenantId, incidentId, body.employeeId, user.userId]
        );
        await writeAction(db, user.tenantId, incidentId, user.userId, 'assignment',
          'Einsatzkraft zugewiesen', body.note);
      } else if (!body.assigned && active.rows.length) {
        await db.query(
          `UPDATE alarm_event_assignments SET unassigned_at=CURRENT_TIMESTAMP,unassigned_by=$1
           WHERE tenant_id=$2 AND id=$3`,
          [user.userId, user.tenantId, active.rows[0].id]
        );
        await writeAction(db, user.tenantId, incidentId, user.userId, 'assignment',
          'Einsatzkraft entfernt', body.note);
      }
      const primary = body.assigned ? body.employeeId : null;
      const updated = await db.query(
        `UPDATE alarm_incidents SET assigned_employee_id=COALESCE($1,
           (SELECT employee_id FROM alarm_event_assignments
            WHERE tenant_id=$2 AND alarm_incident_id=$3 AND unassigned_at IS NULL
            ORDER BY assigned_at DESC LIMIT 1)),
           revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$2 AND id=$3 RETURNING id,assigned_employee_id,revision_version`,
        [primary, user.tenantId, incidentId]
      );
      await event(db, user.tenantId, incidentId, null, user.userId,
        body.assigned ? 'incident_responder_assigned' : 'incident_responder_unassigned',
        { employeeId: body.employeeId });
      return updated.rows[0];
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listAlarmAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      await getIncidentForUser(db, user, incidentId);
      const result = await db.query(
        `SELECT a.id,a.employee_id,concat(e.first_name,' ',e.last_name) AS employee_name,
                a.assigned_at,a.unassigned_at,concat(u.first_name,' ',u.last_name) AS assigned_by_name
         FROM alarm_event_assignments a
         JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
         JOIN users u ON u.id=a.assigned_by
         WHERE a.tenant_id=$1 AND a.alarm_incident_id=$2
         ORDER BY a.assigned_at DESC`,
        [user.tenantId, incidentId]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

async function validateEscalationRule(db: PoolClient, tenantId: string, body: z.infer<typeof escalationRuleSchema>): Promise<void> {
  if (body.siteId) {
    const site = await db.query(
      `SELECT 1 FROM sites s JOIN clients c ON c.id=s.client_id AND c.tenant_id=s.tenant_id
       WHERE s.tenant_id=$1 AND s.id=$2 AND s.archived_at IS NULL AND c.archived_at IS NULL`,
      [tenantId, body.siteId]
    );
    if (!site.rows.length) throw httpError(400, 'Objekt für Eskalationsregel nicht gefunden.');
  }
  if (body.alarmTypeId) {
    const type = await db.query('SELECT 1 FROM alarm_types WHERE tenant_id=$1 AND id=$2', [tenantId, body.alarmTypeId]);
    if (!type.rows.length) throw httpError(400, 'Alarmart für Eskalationsregel nicht gefunden.');
  }
  for (const step of body.steps) {
    if (step.recipientRoleId) {
      const role = await db.query('SELECT 1 FROM roles WHERE tenant_id=$1 AND id=$2', [tenantId, step.recipientRoleId]);
      if (!role.rows.length) throw httpError(400, 'Empfängerrolle für Eskalationsregel nicht gefunden.');
    }
    if (step.recipientEmployeeId) {
      const employee = await db.query('SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL', [tenantId, step.recipientEmployeeId]);
      if (!employee.rows.length) throw httpError(400, 'Empfänger für Eskalationsregel nicht gefunden.');
    }
  }
}

async function insertEscalationRule(
  db: PoolClient,
  user: User,
  body: z.infer<typeof escalationRuleSchema>
): Promise<any> {
  await validateEscalationRule(db, user.tenantId, body);
  const rule = await db.query(
    `INSERT INTO alarm_escalation_rules
      (tenant_id,name,site_id,alarm_type_id,minimum_severity,is_active,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id,revision_version`,
    [user.tenantId, body.name, body.siteId ?? null, body.alarmTypeId ?? null,
      body.minimumSeverity, body.isActive, user.userId]
  );
  for (const [index, step] of body.steps.entries()) {
    await db.query(
      `INSERT INTO alarm_escalation_steps
        (tenant_id,rule_id,step_number,delay_minutes,recipient_role_id,recipient_employee_id,channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [user.tenantId, rule.rows[0].id, index + 1, step.delayMinutes,
        step.recipientRoleId ?? null, step.recipientEmployeeId ?? null, step.channel]
    );
  }
  return { ...rule.rows[0], name: body.name };
}

export async function listEscalationRules(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const result = await db.query(
        `SELECT r.id,r.name,r.site_id,r.alarm_type_id,r.minimum_severity,r.is_active,r.revision_version,
                r.created_at,r.updated_at,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'id',s.id,'stepNumber',s.step_number,'delayMinutes',s.delay_minutes,
                  'recipientRoleId',s.recipient_role_id,'recipientEmployeeId',s.recipient_employee_id,
                  'channel',s.channel
                ) ORDER BY s.step_number) FILTER (WHERE s.id IS NOT NULL),'[]'::jsonb) AS steps
         FROM alarm_escalation_rules r
         LEFT JOIN alarm_escalation_steps s ON s.rule_id=r.id AND s.tenant_id=r.tenant_id
         WHERE r.tenant_id=$1 GROUP BY r.tenant_id,r.id ORDER BY r.name`,
        [user.tenantId]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function createEscalationRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = escalationRuleSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, db => insertEscalationRule(db, user, body));
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function reviseEscalationRule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ruleId = uuid.parse(req.params.id);
    const body = escalationRuleSchema.extend({ revisionVersion: z.number().int().positive() }).strict().parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const current = await db.query(
        'SELECT revision_version FROM alarm_escalation_rules WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [user.tenantId, ruleId]
      );
      if (!current.rows.length) throw httpError(404, 'Eskalationsregel nicht gefunden.');
      if (current.rows[0].revision_version !== body.revisionVersion) throw httpError(409, 'Eskalationsregel wurde geändert.');
      await db.query(
        `UPDATE alarm_escalation_rules SET is_active=false,revision_version=revision_version+1,
           updated_by=$1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$2 AND id=$3`,
        [user.userId, user.tenantId, ruleId]
      );
      const { revisionVersion: _revisionVersion, ...newRule } = body;
      return insertEscalationRule(db, user, newRule);
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function listAlarmNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const manager = ['Systemadministrator','Geschäftsführung','Einsatzleitung','Qualitätsmanagement'].includes(user.role);
      const result = await db.query(
        `SELECT n.id,n.alarm_incident_id,n.channel,n.notification_type,n.delivery_status,n.attempt_count,n.retry_at,
                n.delivered_at,n.last_error,n.created_at,a.incident_number,a.title,a.status,
                concat(u.first_name,' ',u.last_name) AS recipient_name
         FROM alarm_notifications n
         JOIN alarm_incidents a ON a.id=n.alarm_incident_id AND a.tenant_id=n.tenant_id
         LEFT JOIN users u ON u.id=n.recipient_user_id
         WHERE n.tenant_id=$1 AND ($2::boolean OR n.recipient_user_id=$3)
         ORDER BY n.created_at DESC LIMIT 500`,
        [user.tenantId, manager, user.userId]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function listAlarmEscalationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const manager = ['Systemadministrator','Geschäftsführung','Einsatzleitung','Qualitätsmanagement'].includes(user.role);
      const scope = await siteScope(db, user);
      const result = await db.query(
        `SELECT j.id AS job_id,j.alarm_incident_id,j.status AS job_status,j.attempt_count,
                j.scheduled_at,j.retry_at,j.last_error,j.updated_at,
                a.incident_number,a.title,a.status AS incident_status,s.channel,
                COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                  'status',n.delivery_status,'deliveredAt',n.delivered_at,'lastError',n.last_error
                )) FILTER (WHERE n.id IS NOT NULL),'[]'::jsonb) AS deliveries
         FROM alarm_escalation_jobs j
         JOIN alarm_incidents a ON a.id=j.alarm_incident_id AND a.tenant_id=j.tenant_id
         JOIN alarm_escalation_steps s ON s.id=j.step_id AND s.tenant_id=j.tenant_id
         LEFT JOIN alarm_notifications n ON n.escalation_job_id=j.id AND n.tenant_id=j.tenant_id
         WHERE j.tenant_id=$1 AND ($2::boolean OR n.recipient_user_id=$3)
           AND ($4::uuid[] IS NULL OR a.site_id=ANY($4))
         GROUP BY j.tenant_id,j.id,a.incident_number,a.title,a.status,s.channel
         ORDER BY j.scheduled_at DESC LIMIT 500`,
        [user.tenantId, manager, user.userId, scope]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function retryAlarmNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const notificationId = uuid.parse(req.params.id);
    const user = req.user!;
    const data = await withTenantTransaction(user.tenantId, async db => {
      const notification = await db.query(
        `SELECT n.delivery_status,n.escalation_job_id,a.site_id
         FROM alarm_notifications n JOIN alarm_incidents a
           ON a.id=n.alarm_incident_id AND a.tenant_id=n.tenant_id
         WHERE n.tenant_id=$1 AND n.id=$2 FOR UPDATE OF n`,
        [user.tenantId, notificationId]
      );
      if (!notification.rows.length) throw httpError(404, 'Benachrichtigung nicht gefunden.');
      await assertSiteAccess(db, user, notification.rows[0].site_id);
      if (notification.rows[0].delivery_status === 'not_configured') {
        throw httpError(409, 'Für diesen Kanal ist kein Zustellprovider konfiguriert; ein erneuter Versuch ist nicht möglich.');
      }
      if (notification.rows[0].delivery_status !== 'failed') throw httpError(409, 'Nur fehlgeschlagene Zustellungen können erneut versucht werden.');
      if (!notification.rows[0].escalation_job_id) throw httpError(409, 'Für diese Benachrichtigung ist kein wiederholbarer Eskalationsauftrag vorhanden.');
      await db.query(
        `UPDATE alarm_notifications SET delivery_status='queued',retry_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$1 AND id=$2`,
        [user.tenantId, notificationId]
      );
      await db.query(
        `UPDATE alarm_escalation_jobs SET status='pending',retry_at=CURRENT_TIMESTAMP,lease_until=NULL,
           last_error=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$1 AND id=$2`,
        [user.tenantId, notification.rows[0].escalation_job_id]
      );
      return { id: notificationId, deliveryStatus: 'queued' };
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
