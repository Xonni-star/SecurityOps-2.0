import { NextFunction, Request, Response } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';

const uuid = z.string().guid();
const scenario = z.enum([
  'BMA - Brandmeldeanlage',
  'EMA - Einbruchsalarm',
  'Bombendrohung',
  'Medizinischer Notfall',
  'Hausfriedensbruch / Aggression'
]);
const contactSchema = z.object({
  role: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(80)
}).strict();
const planFields = {
  siteId: uuid,
  scenario,
  chainOfAction: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
  contacts: z.array(contactSchema).max(30),
  lastDrillDate: z.string().date().nullable().optional(),
  isActive: z.boolean()
};
const createPlanSchema = z.object(planFields).strict();
const updatePlanSchema = z.object({
  siteId: uuid.optional(),
  scenario: scenario.optional(),
  chainOfAction: planFields.chainOfAction.optional(),
  contacts: planFields.contacts.optional(),
  lastDrillDate: planFields.lastDrillDate,
  isActive: z.boolean().optional(),
  revisionVersion: z.number().int().positive()
}).strict().refine(value => Object.keys(value).some(key => key !== 'revisionVersion'), 'Mindestens ein Planfeld ist erforderlich.');
const reportSchema = z.object({
  siteId: uuid,
  emergencyPlanId: uuid.nullable().optional(),
  scenario,
  severity: z.enum(['Niedrig', 'Normal', 'Dringend', 'Kritisch']),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(8000).default('')
}).strict();
const transitionSchema = z.object({
  action: z.enum(['acknowledge', 'escalate', 'resolve']),
  note: z.string().trim().min(1).max(4000),
  revisionVersion: z.number().int().positive()
}).strict();
const drillSchema = z.object({
  drillDate: z.string().date()
}).strict();

type PlanUpdate = z.infer<typeof updatePlanSchema>;

function statusError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function writeEvent(
  db: PoolClient,
  tenantId: string,
  actorId: string,
  action: string,
  target: { planId?: string; incidentId?: string },
  details: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO emergency_management_events
       (tenant_id, emergency_plan_id, alarm_incident_id, actor_user_id, action, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [tenantId, target.planId ?? null, target.incidentId ?? null, actorId, action, JSON.stringify(details)]
  );
}

async function getPlanForUpdate(
  db: PoolClient,
  tenantId: string,
  planId: string
): Promise<any> {
  const result = await db.query(
    'SELECT * FROM emergency_plans WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
    [tenantId, planId]
  );
  if (!result.rows.length) throw statusError(404, 'Notfallplan nicht gefunden.');
  return result.rows[0];
}

export async function listEmergencyPlans(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await withTenantTransaction(req.user!.tenantId, db => db.query(
      `SELECT p.id,p.tenant_id,p.site_id,s.name AS site_name,p.scenario,
              p.action_steps AS chain_of_action,p.contacts,p.last_drill_date,
              p.is_active,p.revision_version,p.created_at,p.updated_at
       FROM emergency_plans p
       JOIN sites s ON s.id=p.site_id AND s.tenant_id=p.tenant_id
       WHERE p.tenant_id=$1 AND p.archived_at IS NULL
       ORDER BY s.name,p.scenario,p.created_at DESC`,
      [req.user!.tenantId]
    ));
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function createEmergencyPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createPlanSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const created = await db.query(
        `INSERT INTO emergency_plans
           (tenant_id,site_id,scenario,action_steps,contacts,last_drill_date,is_active,created_by,updated_by)
         SELECT $1,s.id,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$8
         FROM sites s WHERE s.id=$2 AND s.tenant_id=$1 AND s.archived_at IS NULL
         RETURNING id,tenant_id,site_id,scenario,action_steps AS chain_of_action,contacts,last_drill_date,
                   is_active,revision_version,created_at,updated_at`,
        [user.tenantId,body.siteId,body.scenario,JSON.stringify(body.chainOfAction),JSON.stringify(body.contacts),
          body.lastDrillDate ?? null,body.isActive,user.userId]
      );
      if (!created.rows.length) throw statusError(404, 'Aktives Objekt nicht gefunden.');
      await writeEvent(db,user.tenantId,user.userId,'plan_created',{planId:created.rows[0].id});
      return created.rows[0];
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function updateEmergencyPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const body = updatePlanSchema.parse(req.body) as PlanUpdate;
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const current = await getPlanForUpdate(db,user.tenantId,planId);
      if (current.revision_version !== body.revisionVersion) throw statusError(409,'Notfallplan wurde zwischenzeitlich geändert. Bitte neu laden.');
      const siteId = body.siteId ?? current.site_id;
      const site = await db.query(
        'SELECT id FROM sites WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL',
        [siteId,user.tenantId]
      );
      if (!site.rows.length) throw statusError(404,'Aktives Objekt nicht gefunden.');
      const updated = await db.query(
        `UPDATE emergency_plans
         SET site_id=$1,scenario=$2,action_steps=$3::jsonb,contacts=$4::jsonb,
             last_drill_date=$5,is_active=$6,updated_by=$7,revision_version=revision_version+1,
             updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$8 AND id=$9 AND revision_version=$10
         RETURNING id,tenant_id,site_id,scenario,action_steps AS chain_of_action,contacts,last_drill_date,
                   is_active,revision_version,created_at,updated_at`,
        [siteId,body.scenario ?? current.scenario,
          JSON.stringify(body.chainOfAction ?? current.action_steps),
          JSON.stringify(body.contacts ?? current.contacts),
          body.lastDrillDate === undefined ? current.last_drill_date : body.lastDrillDate,
          body.isActive ?? current.is_active,user.userId,user.tenantId,planId,body.revisionVersion]
      );
      if (!updated.rows.length) throw statusError(409,'Notfallplan wurde zwischenzeitlich geändert. Bitte neu laden.');
      await writeEvent(db,user.tenantId,user.userId,'plan_updated',{planId},{revisionVersion:updated.rows[0].revision_version});
      return updated.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function archiveEmergencyPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const revisionVersion = z.object({ revisionVersion: z.number().int().positive() }).strict().parse(req.body).revisionVersion;
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const current = await getPlanForUpdate(db,user.tenantId,planId);
      if (current.revision_version !== revisionVersion) throw statusError(409,'Notfallplan wurde zwischenzeitlich geändert. Bitte neu laden.');
      const archived = await db.query(
        `UPDATE emergency_plans SET is_active=false,archived_at=CURRENT_TIMESTAMP,updated_by=$1,
           revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$2 AND id=$3 AND revision_version=$4 RETURNING id`,
        [user.userId,user.tenantId,planId,revisionVersion]
      );
      if (!archived.rows.length) throw statusError(409,'Notfallplan wurde zwischenzeitlich geändert. Bitte neu laden.');
      await writeEvent(db,user.tenantId,user.userId,'plan_archived',{planId});
      return { id: planId };
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function recordEmergencyDrill(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const { drillDate } = drillSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const current = await getPlanForUpdate(db,user.tenantId,planId);
      const updated = await db.query(
        `UPDATE emergency_plans
         SET last_drill_date=GREATEST(COALESCE(last_drill_date,$1::date),$1::date),
             revision_version=revision_version+1,updated_by=$2,updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$3 AND id=$4 AND revision_version=$5
         RETURNING id,last_drill_date,revision_version`,
        [drillDate,user.userId,user.tenantId,planId,current.revision_version]
      );
      await writeEvent(db,user.tenantId,user.userId,'drill_recorded',{planId},{drillDate});
      return updated.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function listAlarmIncidents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await withTenantTransaction(req.user!.tenantId, db => db.query(
      `SELECT a.id,a.tenant_id,a.site_id,s.name AS site_name,a.emergency_plan_id,a.scenario,
              a.severity,a.status,a.title,a.description,a.reported_at,a.acknowledged_at,a.escalated_at,
              a.resolved_at,a.reported_by,a.resolved_by,a.resolution_note,a.revision_version,
              concat(ru.first_name,' ',ru.last_name) AS reporter_name,
              concat(xu.first_name,' ',xu.last_name) AS resolver_name
       FROM alarm_incidents a
       JOIN sites s ON s.id=a.site_id AND s.tenant_id=a.tenant_id
       JOIN users ru ON ru.id=a.reported_by
       LEFT JOIN users xu ON xu.id=a.resolved_by
       WHERE a.tenant_id=$1
       ORDER BY CASE WHEN a.status='abgeschlossen' THEN 1 ELSE 0 END,a.reported_at DESC
       LIMIT 500`,
      [req.user!.tenantId]
    ));
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function listEmergencyPlanEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = uuid.parse(req.params.id);
    const result = await withTenantTransaction(req.user!.tenantId, async db => {
      const plan = await db.query(
        'SELECT id FROM emergency_plans WHERE id=$1 AND tenant_id=$2',
        [planId,req.user!.tenantId]
      );
      if (!plan.rows.length) throw statusError(404,'Notfallplan nicht gefunden.');
      return db.query(
        `SELECT e.id,e.action,e.details,e.occurred_at,concat(u.first_name,' ',u.last_name) AS actor_name
         FROM emergency_management_events e JOIN users u ON u.id=e.actor_user_id
         WHERE e.tenant_id=$1 AND e.emergency_plan_id=$2
         ORDER BY e.occurred_at DESC,e.id DESC LIMIT 200`,
        [req.user!.tenantId,planId]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function listAlarmIncidentEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const result = await withTenantTransaction(req.user!.tenantId, async db => {
      const incident = await db.query(
        'SELECT id FROM alarm_incidents WHERE id=$1 AND tenant_id=$2',
        [incidentId,req.user!.tenantId]
      );
      if (!incident.rows.length) throw statusError(404,'Alarmvorfall nicht gefunden.');
      return db.query(
        `SELECT e.id,e.action,e.details,e.occurred_at,concat(u.first_name,' ',u.last_name) AS actor_name
         FROM emergency_management_events e JOIN users u ON u.id=e.actor_user_id
         WHERE e.tenant_id=$1 AND e.alarm_incident_id=$2
         ORDER BY e.occurred_at DESC,e.id DESC LIMIT 200`,
        [req.user!.tenantId,incidentId]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function reportAlarmIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = reportSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      if (body.emergencyPlanId) {
        const plan = await db.query(
          `SELECT id FROM emergency_plans
           WHERE id=$1 AND tenant_id=$2 AND site_id=$3 AND scenario=$4
             AND is_active=true AND archived_at IS NULL`,
          [body.emergencyPlanId,user.tenantId,body.siteId,body.scenario]
        );
        if (!plan.rows.length) throw statusError(400,'Der ausgewählte Notfallplan ist nicht aktiv oder passt nicht zum Objekt und Szenario.');
      }
      const created = await db.query(
        `INSERT INTO alarm_incidents
           (tenant_id,site_id,emergency_plan_id,scenario,severity,title,description,reported_by)
         SELECT $1,s.id,$3,$4,$5,$6,$7,$8
         FROM sites s WHERE s.id=$2 AND s.tenant_id=$1 AND s.archived_at IS NULL
         RETURNING id,tenant_id,site_id,emergency_plan_id,scenario,severity,status,title,description,
                   reported_at,revision_version`,
        [user.tenantId,body.siteId,body.emergencyPlanId ?? null,body.scenario,body.severity,body.title,body.description,user.userId]
      );
      if (!created.rows.length) throw statusError(404,'Aktives Objekt nicht gefunden.');
      await writeEvent(db,user.tenantId,user.userId,'incident_reported',{incidentId:created.rows[0].id},
        {scenario:body.scenario,severity:body.severity});
      return created.rows[0];
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
}

export async function transitionAlarmIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = uuid.parse(req.params.id);
    const body = transitionSchema.parse(req.body);
    const user = req.user!;
    const result = await withTenantTransaction(user.tenantId, async db => {
      const selected = await db.query(
        'SELECT * FROM alarm_incidents WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [incidentId,user.tenantId]
      );
      if (!selected.rows.length) throw statusError(404,'Alarmvorfall nicht gefunden.');
      const current = selected.rows[0];
      if (current.revision_version !== body.revisionVersion) throw statusError(409,'Alarmvorfall wurde zwischenzeitlich geändert. Bitte neu laden.');

      let status: string;
      let action: string;
      if (body.action === 'acknowledge' && current.status === 'gemeldet') {
        status = 'bestätigt';
        action = 'incident_acknowledged';
      } else if (body.action === 'escalate' && ['gemeldet','bestätigt'].includes(current.status)) {
        status = 'eskaliert';
        action = 'incident_escalated';
      } else if (body.action === 'resolve' && current.status !== 'abgeschlossen') {
        status = 'abgeschlossen';
        action = 'incident_resolved';
      } else {
        throw statusError(409,'Diese Statusänderung ist für den aktuellen Alarmvorfall nicht zulässig.');
      }

      const updated = await db.query(
        `UPDATE alarm_incidents
         SET status=$1,
             acknowledged_at=CASE WHEN $1::varchar IN ('bestätigt','eskaliert','abgeschlossen')
               THEN COALESCE(acknowledged_at,CURRENT_TIMESTAMP) ELSE acknowledged_at END,
             escalated_at=CASE WHEN $1::varchar='eskaliert' THEN CURRENT_TIMESTAMP ELSE NULL END,
             resolved_at=CASE WHEN $1::varchar='abgeschlossen' THEN CURRENT_TIMESTAMP ELSE NULL END,
             resolved_by=CASE WHEN $1::varchar='abgeschlossen' THEN $2::uuid ELSE NULL END,
             resolution_note=CASE WHEN $1::varchar='abgeschlossen' THEN $3 ELSE NULL END,
             revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
         WHERE id=$4 AND tenant_id=$5 AND revision_version=$6
         RETURNING id,status,acknowledged_at,escalated_at,resolved_at,resolved_by,resolution_note,revision_version`,
        [status,user.userId,body.note,incidentId,user.tenantId,body.revisionVersion]
      );
      if (!updated.rows.length) throw statusError(409,'Alarmvorfall wurde zwischenzeitlich geändert. Bitte neu laden.');
      await writeEvent(db,user.tenantId,user.userId,action,{incidentId},{note:body.note,fromStatus:current.status,toStatus:status});
      return updated.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}
