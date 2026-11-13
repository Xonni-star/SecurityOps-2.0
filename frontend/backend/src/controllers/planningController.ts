import { NextFunction, Request, Response } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import {
  PlanningFinding,
  ShiftCandidate,
  resolveShiftTime,
  storePlanningFindings,
  validateShiftCandidate
} from '../services/planningService';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuidSchema = z.string().guid();
const timeZoneSchema = z.string().min(1).max(100).refine(value => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'timeZone muss eine gültige IANA-Zeitzone sein.');

const shiftInputSchema = z.object({
  siteId: uuidSchema,
  schedulePeriodId: uuidSchema.optional(),
  employeeId: uuidSchema.nullable().optional(),
  clientMutationId: z.string().min(1).max(64).optional(),
  date: dateSchema,
  endDate: dateSchema.optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  startOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  endOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  breakMinutes: z.number().int().min(0).max(1440).default(0),
  type: z.enum(['Tagdienst', 'Nachtdienst', 'Revierdienst', 'Sonderposten']).default('Tagdienst'),
  requiredQualification: z.string().min(2).max(100),
  requiredStaffCount: z.number().int().min(1).max(500).default(1)
});

const periodSchema = z.object({
  name: z.string().min(2).max(160),
  dateFrom: dateSchema,
  dateTo: dateSchema,
  timeZone: timeZoneSchema
}).refine(value => value.dateTo >= value.dateFrom, {
  path: ['dateTo'], message: 'dateTo darf nicht vor dateFrom liegen.'
});

const ruleSchema = z.object({
  code: z.enum([
    'minimum_rest_minutes',
    'maximum_shift_minutes',
    'maximum_weekly_minutes',
    'minimum_break_minutes',
    'break_after_minutes',
    'disallowed_weekdays',
    'sunday_work_allowed',
    'holiday_dates',
    'night_window_start_minute',
    'night_window_end_minute',
    'night_work_allowed'
  ]),
  value: z.union([
    z.number().finite().nonnegative(),
    z.boolean(),
    z.array(z.union([z.number().int().min(0).max(6), dateSchema]))
  ]),
  source: z.string().min(2).max(255),
  severity: z.enum(['warning', 'blocking']).default('blocking')
}).strict().superRefine((rule, ctx) => {
  const numericCodes = new Set([
    'minimum_rest_minutes', 'maximum_shift_minutes', 'maximum_weekly_minutes',
    'minimum_break_minutes', 'break_after_minutes',
    'night_window_start_minute', 'night_window_end_minute'
  ]);
  if (numericCodes.has(rule.code) && typeof rule.value !== 'number') {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Diese Regel benötigt einen numerischen Wert.' });
  }
  if (['sunday_work_allowed', 'night_work_allowed'].includes(rule.code) && typeof rule.value !== 'boolean') {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Diese Regel benötigt einen booleschen Wert.' });
  }
  if (['disallowed_weekdays', 'holiday_dates'].includes(rule.code) && !Array.isArray(rule.value)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Diese Regel benötigt eine Liste.' });
  }
  if (rule.code === 'disallowed_weekdays' &&
      Array.isArray(rule.value) && rule.value.some(value => typeof value !== 'number')) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Wochentage müssen Zahlen von 0 bis 6 sein.' });
  }
  if (rule.code === 'holiday_dates' &&
      Array.isArray(rule.value) && rule.value.some(value => typeof value !== 'string')) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Feiertage müssen lokale Datumswerte sein.' });
  }
});

const ruleProfileFieldsSchema = z.object({
  name: z.string().min(2).max(160),
  scope: z.record(z.string(), z.unknown()).default({}),
  effectiveFrom: dateSchema,
  effectiveUntil: dateSchema.nullable().optional(),
  sourceName: z.string().min(2).max(255),
  sourceReference: z.string().min(2).max(2000),
  rules: z.array(ruleSchema).min(1).max(100)
}).strict();
const ruleProfileSchema = ruleProfileFieldsSchema.refine(value =>
  !value.effectiveUntil || value.effectiveUntil >= value.effectiveFrom, {
  path: ['effectiveUntil'], message: 'effectiveUntil darf nicht vor effectiveFrom liegen.'
});
const ruleVersionSchema = ruleProfileFieldsSchema.omit({ name: true, scope: true }).refine(value =>
  !value.effectiveUntil || value.effectiveUntil >= value.effectiveFrom, {
  path: ['effectiveUntil'], message: 'effectiveUntil darf nicht vor effectiveFrom liegen.'
});

const templateSchema = z.object({
  siteId: uuidSchema,
  name: z.string().min(2).max(160),
  timeZone: timeZoneSchema.optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  requiredQualification: z.string().min(2).max(100),
  frequency: z.enum(['DAILY', 'WEEKLY']),
  interval: z.number().int().min(1).max(52).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional()
}).strict().refine(value => value.frequency !== 'WEEKLY' || Boolean(value.weekdays?.length), {
  path: ['weekdays'], message: 'Wöchentliche Vorlagen benötigen mindestens einen Wochentag.'
});

const swapSchema = z.object({
  requesterEmployeeId: uuidSchema,
  proposedEmployeeId: uuidSchema,
  expectedShiftVersion: z.number().int().positive(),
  reason: z.string().min(2).max(1000)
}).strict();

function parsePage(query: Request['query']): { page: number; pageSize: number } {
  const parsed = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50)
  }).parse(query);
  return parsed;
}

async function writeAudit(
  client: PoolClient,
  tenantId: string,
  actorId: string,
  eventType: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await client.query(
    `INSERT INTO planning_audit_events
      (tenant_id, actor_user_id, event_type, entity_type, entity_id, details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [tenantId, actorId, eventType, entityType, entityId, JSON.stringify(details)]
  );
}

async function hasApprovedException(
  client: PoolClient,
  tenantId: string,
  shiftId: string,
  employeeId: string | null,
  finding: PlanningFinding
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM schedule_rule_exceptions e
       JOIN schedule_rule_findings f ON f.tenant_id=e.tenant_id AND f.id=e.finding_id
      WHERE e.tenant_id=$1 AND f.shift_id=$2
        AND f.employee_id IS NOT DISTINCT FROM $3::uuid
        AND f.rule_code=$4 AND f.details=$5::jsonb AND e.status='approved'
      LIMIT 1`,
    [tenantId, shiftId, employeeId, finding.code, JSON.stringify(finding.details ?? {})]
  );
  return result.rows.length > 0;
}

function sendValidationFailure(res: Response, findings: PlanningFinding[], status = 409): void {
  res.status(status).json({
    success: false,
    code: 'PLANNING_VALIDATION_FAILED',
    message: 'Die serverseitige Planungsprüfung hat blockierende Befunde ergeben.',
    data: { findings }
  });
}

export async function listPlanningShifts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const { page, pageSize } = parsePage(req.query);
    const filters = z.object({
      from: dateSchema.optional(),
      to: dateSchema.optional(),
      siteId: uuidSchema.optional(),
      employeeId: uuidSchema.optional(),
      planningStatus: z.enum(['draft', 'validated', 'published', 'cancelled']).optional()
    }).parse(req.query);
    const values: unknown[] = [tenantId];
    const clauses = ['s.tenant_id=$1'];
    const addFilter = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    if (filters.from) addFilter('s.shift_date >= ?::date', filters.from);
    if (filters.to) addFilter('s.shift_date <= ?::date', filters.to);
    if (filters.siteId) addFilter('s.site_id = ?', filters.siteId);
    if (filters.employeeId) {
      values.push(filters.employeeId);
      clauses.push(`(s.employee_id=$${values.length} OR EXISTS (
        SELECT 1 FROM shift_staffing_assignments a
         WHERE a.tenant_id=s.tenant_id AND a.shift_id=s.id
           AND a.employee_id=$${values.length} AND a.status='assigned'
      ))`);
    }
    if (filters.planningStatus) addFilter('s.planning_status = ?', filters.planningStatus);

    const result = await withTenantTransaction(tenantId, async client => {
      const count = await client.query(
        `SELECT count(*)::int AS total FROM shifts s WHERE ${clauses.join(' AND ')}`,
        values
      );
      const pageValues = [...values, pageSize, (page - 1) * pageSize];
      const rows = await client.query(
        `SELECT s.id,s.site_id,st.name AS site_name,st.time_zone,s.employee_id,
                s.shift_date,s.start_time,s.end_time,s.starts_at,s.ends_at,s.time_zone,
                s.break_minutes,s.type,s.status,s.planning_status,s.required_qualification,
                s.schedule_period_id,s.revision_version,
                COALESCE(a.staff_count, CASE WHEN s.employee_id IS NULL THEN 0 ELSE 1 END) AS assigned_count
           FROM shifts s
           JOIN sites st ON st.id=s.site_id AND st.tenant_id=s.tenant_id
           LEFT JOIN LATERAL (
             SELECT count(*)::int AS staff_count FROM shift_staffing_assignments sa
              WHERE sa.tenant_id=s.tenant_id AND sa.shift_id=s.id AND sa.status='assigned'
           ) a ON TRUE
          WHERE ${clauses.join(' AND ')}
          ORDER BY s.shift_date,s.start_time,s.id
          LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
        pageValues
      );
      return { rows: rows.rows, total: count.rows[0].total as number };
    });
    res.json({
      success: true,
      data: result.rows,
      pagination: { page, pageSize, total: result.total, pages: Math.ceil(result.total / pageSize) }
    });
  } catch (error) {
    next(error);
  }
}
export async function createSchedulePeriod(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = periodSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const period = await client.query(
        `INSERT INTO schedule_periods (tenant_id,name,date_from,date_to,time_zone,created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id,name,date_from,date_to,time_zone,status,revision_version`,
        [tenantId, input.name, input.dateFrom, input.dateTo, input.timeZone, actorId]
      );
      await writeAudit(client, tenantId, actorId, 'period.created', 'schedule_period', period.rows[0].id);
      return period.rows[0];
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function createPlanningShift(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = shiftInputSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      if (input.clientMutationId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:planning-shift:${input.clientMutationId}`]);
        const existing = await client.query(
          `SELECT s.id,s.site_id,s.employee_id,s.schedule_period_id,s.shift_date,s.start_time,s.end_time,s.starts_at,s.ends_at,
                  s.time_zone,s.break_minutes,s.type,s.planning_status,s.required_qualification,s.revision_version,
                  COALESCE(r.required_count,1) AS required_count
             FROM shifts s
             LEFT JOIN shift_staffing_requirements r
               ON r.tenant_id=s.tenant_id AND r.shift_id=s.id
              AND r.qualification_type=s.required_qualification
            WHERE s.tenant_id=$1 AND s.client_mutation_id=$2`,
          [tenantId, input.clientMutationId]
        );
        if (existing.rows.length) {
          const row = existing.rows[0];
          const resolved = resolveShiftTime(input, row.time_zone);
          const samePayload =
            row.site_id === input.siteId &&
            row.schedule_period_id === (input.schedulePeriodId ?? null) &&
            (row.shift_date.toISOString?.().slice(0, 10) ?? String(row.shift_date).slice(0, 10)) === input.date &&
            String(row.start_time).slice(0, 5) === input.startTime.slice(0, 5) &&
            String(row.end_time).slice(0, 5) === input.endTime.slice(0, 5) &&
            new Date(row.starts_at).getTime() === resolved.startsAt.getTime() &&
            new Date(row.ends_at).getTime() === resolved.endsAt.getTime() &&
            Number(row.break_minutes) === input.breakMinutes &&
            row.type === input.type &&
            row.required_qualification === input.requiredQualification &&
            Number(row.required_count) === input.requiredStaffCount;
          let sameEmployee = true;
          if (samePayload && input.employeeId) {
            const assigned = await client.query(
              `SELECT 1 FROM shift_staffing_assignments
                WHERE tenant_id=$1 AND shift_id=$2 AND employee_id=$3 AND status='assigned'
               UNION SELECT 1 FROM shifts WHERE tenant_id=$1 AND id=$2 AND employee_id=$3`,
              [tenantId, row.id, input.employeeId]
            );
            sameEmployee = assigned.rows.length > 0;
          }
          if (!samePayload || !sameEmployee) return { idempotencyConflict: true as const };
          const { required_count: _requiredCount, ...shift } = row;
          return {
            replayed: true as const,
            shift,
            validationRunId: null,
            findings: []
          };
        }
      }

      let schedulePeriod: { date_from: Date | string; date_to: Date | string } | undefined;
      if (input.schedulePeriodId) {
        const period = await client.query(
          `SELECT date_from,date_to,status FROM schedule_periods
            WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
          [tenantId, input.schedulePeriodId]
        );
        if (!period.rows.length) return { periodMissing: true as const };
        if (period.rows[0].status !== 'draft') return { periodClosed: true as const };
        schedulePeriod = period.rows[0];
      }

      const candidate: ShiftCandidate = { ...input, tenantId, requiredQualification: input.requiredQualification };
      const validation = await validateShiftCandidate(client, candidate);
      if (schedulePeriod) {
        const periodFrom = schedulePeriod.date_from instanceof Date
          ? schedulePeriod.date_from.toISOString().slice(0, 10)
          : String(schedulePeriod.date_from).slice(0, 10);
        const periodTo = schedulePeriod.date_to instanceof Date
          ? schedulePeriod.date_to.toISOString().slice(0, 10)
          : String(schedulePeriod.date_to).slice(0, 10);
        if (input.date < periodFrom || validation.resolved.endDate > periodTo) {
          validation.findings.push({
            code: 'OUTSIDE_SCHEDULE_PERIOD',
            severity: 'blocking',
            message: 'Die Schicht liegt außerhalb des Datumsbereichs der Dienstplanperiode.',
            details: { periodFrom, periodTo, shiftFrom: input.date, shiftTo: validation.resolved.endDate }
          });
        }
      }
      const blocking = validation.findings.some(finding => finding.severity === 'blocking');
      if (blocking) {
        const stored = await storePlanningFindings(client, tenantId, validation.findings, {
          employeeId: input.employeeId ?? undefined,
          profileVersionId: validation.profileVersionId
        });
        return { validationFailure: stored.findings };
      }

      const created = await client.query(
        `INSERT INTO shifts
          (tenant_id,site_id,employee_id,shift_date,start_time,end_time,starts_at,ends_at,time_zone,
           break_minutes,type,status,planning_status,required_qualification,schedule_period_id,client_mutation_id)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,'Offen','draft',$11,$12,$13)
         RETURNING id,site_id,shift_date,start_time,end_time,starts_at,ends_at,time_zone,
                   break_minutes,type,status,planning_status,required_qualification,schedule_period_id,revision_version`,
        [
          tenantId, input.siteId, input.date, input.startTime, input.endTime,
          validation.resolved.startsAt, validation.resolved.endsAt, validation.resolved.timeZone,
          input.breakMinutes, input.type, input.requiredQualification, input.schedulePeriodId ?? null,
          input.clientMutationId ?? null
        ]
      );
      const shiftId = created.rows[0].id as string;
      await client.query(
        `INSERT INTO shift_staffing_requirements (tenant_id,shift_id,qualification_type,required_count)
         VALUES ($1,$2,$3,$4)`,
        [tenantId, shiftId, input.requiredQualification, input.requiredStaffCount]
      );
      if (input.employeeId) {
        await client.query(
          `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, shiftId, input.employeeId, actorId]
        );
        await client.query('UPDATE shifts SET employee_id=$1 WHERE tenant_id=$2 AND id=$3', [input.employeeId, tenantId, shiftId]);
      }
      const stored = await storePlanningFindings(client, tenantId, validation.findings, {
        shiftId, employeeId: input.employeeId ?? undefined, profileVersionId: validation.profileVersionId
      });
      await writeAudit(client, tenantId, actorId, 'shift.created', 'shift', shiftId, { validationRunId: stored.runId });
      return { replayed: false as const, shift: created.rows[0], validationRunId: stored.runId, findings: stored.findings };
    });

    if ('validationFailure' in result) {
      sendValidationFailure(res, result.validationFailure ?? [], 422);
      return;
    }
    if ('periodMissing' in result) {
      res.status(404).json({ success: false, message: 'Dienstplanperiode nicht gefunden.' });
      return;
    }
    if ('periodClosed' in result) {
      res.status(409).json({ success: false, code: 'SCHEDULE_PERIOD_NOT_DRAFT' });
      return;
    }
    if ('idempotencyConflict' in result) {
      res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', message: 'clientMutationId wurde bereits mit abweichenden Schichtdaten verwendet.' });
      return;
    }
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function listShiftAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const shiftId = uuidSchema.parse(req.params.id);
    const result = await withTenantTransaction(tenantId, client => client.query(
      `SELECT a.id,a.shift_id,a.employee_id,e.first_name,e.last_name,a.status,
              a.revision_version,a.assigned_at,a.released_at
         FROM shift_staffing_assignments a
         JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
        WHERE a.tenant_id=$1 AND a.shift_id=$2
        ORDER BY a.status,a.assigned_at`,
      [tenantId, shiftId]
    ));
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function assignEmployee(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const shiftId = uuidSchema.parse(req.params.id);
    const input = z.object({
      employeeId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      breakMinutes: z.number().int().min(0).max(1440).optional()
    }).strict().parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const current = await client.query(
        `SELECT id,site_id,shift_date,start_time,end_time,starts_at,ends_at,time_zone,
                break_minutes,required_qualification,revision_version,planning_status
           FROM shifts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, shiftId]
      );
      if (!current.rows.length) return { status: 404 as const };
      const shift = current.rows[0];
      if (shift.planning_status === 'published') {
        return { status: 409 as const, published: true as const };
      }
      if (Number(shift.revision_version) !== input.expectedVersion) {
        return { status: 409 as const, currentVersion: shift.revision_version };
      }
      const validation = await validateShiftCandidate(client, {
        tenantId,
        siteId: shift.site_id,
        employeeId: input.employeeId,
        date: shift.shift_date.toISOString?.().slice(0, 10) ?? String(shift.shift_date).slice(0, 10),
        startTime: String(shift.start_time).slice(0, 8),
        endTime: String(shift.end_time).slice(0, 8),
        timeZone: shift.time_zone,
        requiredQualification: shift.required_qualification,
        breakMinutes: input.breakMinutes ?? shift.break_minutes,
        excludeShiftId: shiftId
      });
      const blockers = validation.findings.filter(finding => finding.severity === 'blocking');
      if (blockers.length) {
        const stored = await storePlanningFindings(client, tenantId, validation.findings, {
          shiftId, employeeId: input.employeeId, profileVersionId: validation.profileVersionId
        });
        return { status: 422 as const, findings: stored.findings, runId: stored.runId };
      }
      const assigned = await client.query(
        `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id,shift_id,employee_id)
         DO UPDATE SET status='assigned',revision_version=shift_staffing_assignments.revision_version+1,
                       assigned_by=EXCLUDED.assigned_by,assigned_at=CURRENT_TIMESTAMP,released_at=NULL
         RETURNING id,revision_version`,
        [tenantId, shiftId, input.employeeId, actorId]
      );
      const updated = await client.query(
        `UPDATE shifts SET employee_id=COALESCE(employee_id,$1),
                           break_minutes=COALESCE($2,break_minutes),
                           planning_status='validated',
                           revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$3 AND id=$4 AND revision_version=$5
          RETURNING revision_version`,
        [input.employeeId, input.breakMinutes ?? null, tenantId, shiftId, input.expectedVersion]
      );
      if (!updated.rows.length) return { status: 409 as const };
      await storePlanningFindings(client, tenantId, validation.findings, {
        shiftId, employeeId: input.employeeId, profileVersionId: validation.profileVersionId
      });
      await writeAudit(client, tenantId, actorId, 'shift.employee_assigned', 'shift', shiftId, {
        employeeId: input.employeeId, assignmentId: assigned.rows[0].id
      });
      return { status: 200 as const, assignmentId: assigned.rows[0].id, revisionVersion: updated.rows[0].revision_version };
    });
    if (result.status === 404) {
      res.status(404).json({ success: false, message: 'Schicht nicht gefunden.' });
    } else if (result.status === 422) {
      sendValidationFailure(res, result.findings);
    } else if (result.status === 409) {
      res.status(409).json({
        success: false,
        code: 'published' in result ? 'SCHEDULE_PERIOD_PUBLISHED' : 'REVISION_CONFLICT',
        currentVersion: 'currentVersion' in result ? result.currentVersion : undefined
      });
    } else {
      res.status(200).json({ success: true, data: result });
    }
  } catch (error) {
    next(error);
  }
}

export async function createRuleProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = ruleProfileSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const profile = await client.query(
        `INSERT INTO schedule_rule_profiles (tenant_id,name,scope,created_by)
         VALUES ($1,$2,$3::jsonb,$4) RETURNING id,name,scope`,
        [tenantId, input.name, JSON.stringify(input.scope), actorId]
      );
      const version = await client.query(
        `INSERT INTO schedule_rule_profile_versions
          (tenant_id,profile_id,version_number,effective_from,effective_until,source_name,source_reference,rules,created_by)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7::jsonb,$8)
         RETURNING id,profile_id,version_number,effective_from,effective_until,source_name,source_reference,rules,status`,
        [tenantId, profile.rows[0].id, input.effectiveFrom, input.effectiveUntil ?? null,
          input.sourceName, input.sourceReference, JSON.stringify(input.rules), actorId]
      );
      await writeAudit(client, tenantId, actorId, 'rule_profile.created', 'rule_profile', profile.rows[0].id, {
        versionId: version.rows[0].id
      });
      return { profile: profile.rows[0], version: version.rows[0] };
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function approveRuleProfileVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profileId = uuidSchema.parse(req.params.profileId);
    const versionId = uuidSchema.parse(req.params.versionId);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const current = await client.query(
        `SELECT created_by,status FROM schedule_rule_profile_versions
          WHERE tenant_id=$1 AND profile_id=$2 AND id=$3 FOR UPDATE`,
        [tenantId, profileId, versionId]
      );
      if (!current.rows.length) return { status: 404 as const };
      if (current.rows[0].created_by === actorId) return { status: 403 as const };
      if (current.rows[0].status !== 'draft') return { status: 409 as const };
      const approved = await client.query(
        `UPDATE schedule_rule_profile_versions
            SET status='approved',approved_by=$1,approved_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$2 AND profile_id=$3 AND id=$4 AND status='draft'
          RETURNING id,version_number,effective_from,effective_until,status,approved_by,approved_at`,
        [actorId, tenantId, profileId, versionId]
      );
      if (!approved.rows.length) return { status: 409 as const };
      await writeAudit(client, tenantId, actorId, 'rule_profile_version.approved', 'rule_profile_version', versionId);
      return { status: 200 as const, data: approved.rows[0] };
    });
    if (result.status === 404) {
      res.status(404).json({ success: false, message: 'Entwurfsrevision des Regelprofils nicht gefunden.' });
      return;
    }
    if (result.status === 403) {
      res.status(403).json({ success: false, message: 'Eine Regelprofilrevision darf nicht durch ihren Ersteller freigegeben werden.' });
      return;
    }
    if (result.status === 409) {
      res.status(409).json({ success: false, code: 'REVISION_CONFLICT', message: 'Regelprofilrevision ist nicht mehr im Entwurfsstatus.' });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (error) {
    next(error);
  }
}

export async function publishSchedulePeriod(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const periodId = uuidSchema.parse(req.params.id);
    const expectedVersion = z.number().int().positive().parse(req.body?.expectedVersion);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const periodResult = await client.query(
        'SELECT id,date_from,date_to,status,revision_version FROM schedule_periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenantId, periodId]
      );
      if (!periodResult.rows.length) return { status: 404 as const };
      const period = periodResult.rows[0];
      if (Number(period.revision_version) !== expectedVersion || period.status !== 'draft') {
        return { status: 409 as const, currentVersion: period.revision_version, statusValue: period.status };
      }
      const shifts = await client.query(
        `SELECT s.id,s.site_id,s.employee_id,s.shift_date,s.start_time,s.end_time,s.time_zone,
                s.break_minutes,s.required_qualification,s.starts_at,s.ends_at
           FROM shifts s
          WHERE s.tenant_id=$1 AND s.schedule_period_id=$2 AND s.planning_status <> 'cancelled'
          ORDER BY s.starts_at,s.id FOR UPDATE`,
        [tenantId, periodId]
      );
      const allFindings: PlanningFinding[] = [];
      const runIds: string[] = [];
      for (const shift of shifts.rows) {
        const assignments = await client.query(
          `SELECT employee_id FROM shift_staffing_assignments
            WHERE tenant_id=$1 AND shift_id=$2 AND status='assigned'
          UNION
          SELECT employee_id FROM shifts
           WHERE tenant_id=$1 AND id=$2 AND employee_id IS NOT NULL`,
          [tenantId, shift.id]
        );
        for (const assignment of assignments.rows) {
          const validation = await validateShiftCandidate(client, {
            tenantId, siteId: shift.site_id, employeeId: assignment.employee_id,
            date: shift.shift_date.toISOString?.().slice(0, 10) ?? String(shift.shift_date).slice(0, 10),
            startTime: String(shift.start_time).slice(0, 8),
            endTime: String(shift.end_time).slice(0, 8),
            timeZone: shift.time_zone,
            requiredQualification: shift.required_qualification,
            breakMinutes: shift.break_minutes,
            excludeShiftId: shift.id
          });
          const stored = await storePlanningFindings(client, tenantId, validation.findings, {
            shiftId: shift.id, employeeId: assignment.employee_id, profileVersionId: validation.profileVersionId
          });
          runIds.push(stored.runId);
          for (const finding of validation.findings) {
            if (!await hasApprovedException(client, tenantId, shift.id, assignment.employee_id, finding)) {
              allFindings.push(finding);
            }
          }
        }
        if (!assignments.rows.length) {
          const finding: PlanningFinding = {
            code: 'UNASSIGNED_SHIFT',
            severity: 'blocking',
            message: `Schicht ${shift.id} hat keine Mitarbeiterzuweisung.`,
            details: { shiftId: shift.id }
          };
          await storePlanningFindings(client, tenantId, [finding], { shiftId: shift.id });
          if (!await hasApprovedException(client, tenantId, shift.id, null, finding)) allFindings.push(finding);
        }
      }
      const coverage = await client.query(
        `WITH assignments AS (
           SELECT tenant_id,shift_id,employee_id FROM shift_staffing_assignments
            WHERE tenant_id=$1 AND status='assigned'
           UNION
           SELECT tenant_id,id,employee_id FROM shifts
            WHERE tenant_id=$1 AND employee_id IS NOT NULL
         )
         SELECT s.id,r.qualification_type,r.required_count,
                count(DISTINCT CASE WHEN EXISTS (
                  SELECT 1 FROM employee_qualifications q
                   WHERE q.tenant_id=s.tenant_id AND q.employee_id=a.employee_id
                     AND q.qualification_type=r.qualification_type AND q.verified=TRUE
                     AND q.status='VALID'
                     AND (q.expiry_date IS NULL OR q.expiry_date >= s.shift_date)
                ) THEN a.employee_id END)::int AS assigned_count
           FROM shifts s
           JOIN shift_staffing_requirements r ON r.tenant_id=s.tenant_id AND r.shift_id=s.id
           LEFT JOIN assignments a ON a.tenant_id=s.tenant_id AND a.shift_id=s.id
          WHERE s.tenant_id=$1 AND s.schedule_period_id=$2 AND s.planning_status <> 'cancelled'
          GROUP BY s.id,r.qualification_type,r.required_count`,
        [tenantId, periodId]
      );
      const coverageFindings: PlanningFinding[] = coverage.rows
        .filter(row => Number(row.assigned_count) < Number(row.required_count))
        .map(row => ({
          code: 'STAFFING_SHORTFALL',
          severity: 'blocking',
          message: `Schicht ${row.id} ist unterbesetzt (${row.assigned_count}/${row.required_count}).`,
          details: { shiftId: row.id, assignedCount: row.assigned_count, requiredCount: row.required_count }
        }));
      const activeCoverageFindings: PlanningFinding[] = [];
      for (const finding of coverageFindings) {
        const shiftId = String(finding.details?.shiftId);
        await storePlanningFindings(client, tenantId, [finding], { shiftId });
        if (!await hasApprovedException(client, tenantId, shiftId, null, finding)) activeCoverageFindings.push(finding);
      }
      const findings = [...allFindings, ...activeCoverageFindings];
      if (findings.some(finding => finding.severity === 'blocking')) {
        return { status: 422 as const, findings, runIds };
      }
      const published = await client.query(
        `UPDATE schedule_periods SET status='published',published_by=$1,published_at=CURRENT_TIMESTAMP,
            revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$2 AND id=$3 AND revision_version=$4 AND status='draft'
          RETURNING id,status,revision_version,published_at`,
        [actorId, tenantId, periodId, expectedVersion]
      );
      if (!published.rows.length) return { status: 409 as const };
      await client.query(
        `UPDATE shifts SET planning_status='published',revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$1 AND schedule_period_id=$2 AND planning_status <> 'cancelled'`,
        [tenantId, periodId]
      );
      await writeAudit(client, tenantId, actorId, 'period.published', 'schedule_period', periodId, { runIds });
      return { status: 200 as const, period: published.rows[0], runIds };
    });
    if (result.status === 404) res.status(404).json({ success: false, message: 'Dienstplanperiode nicht gefunden.' });
    else if (result.status === 409) res.status(409).json({ success: false, code: 'REVISION_CONFLICT', ...result });
    else if (result.status === 422) sendValidationFailure(res, result.findings, 422);
    else res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function createShiftSwapRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const shiftId = uuidSchema.parse(req.params.id);
    const input = swapSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const shift = await client.query(
        `SELECT id,revision_version FROM shifts WHERE tenant_id=$1 AND id=$2 AND planning_status <> 'cancelled'`,
        [tenantId, shiftId]
      );
      if (!shift.rows.length) return undefined;
      if (Number(shift.rows[0].revision_version) !== input.expectedShiftVersion) return { conflict: true };
      const requester = await client.query(
        `SELECT 1 FROM shift_staffing_assignments
          WHERE tenant_id=$1 AND shift_id=$2 AND employee_id=$3 AND status='assigned'
         UNION SELECT 1 FROM shifts WHERE tenant_id=$1 AND id=$2 AND employee_id=$3`,
        [tenantId, shiftId, input.requesterEmployeeId]
      );
      if (!requester.rows.length) return { forbidden: true };
      const created = await client.query(
        `INSERT INTO shift_swap_requests
          (tenant_id,shift_id,requester_employee_id,proposed_employee_id,requested_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id,shift_id,requester_employee_id,proposed_employee_id,status,revision_version,requested_at`,
        [tenantId, shiftId, input.requesterEmployeeId, input.proposedEmployeeId, actorId]
      );
      await writeAudit(client, tenantId, actorId, 'shift_swap.requested', 'shift_swap_request', created.rows[0].id, { reason: input.reason });
      return { request: created.rows[0] };
    });
    if (!result) res.status(404).json({ success: false, message: 'Schicht nicht gefunden.' });
    else if ('conflict' in result) res.status(409).json({ success: false, code: 'REVISION_CONFLICT' });
    else if ('forbidden' in result) res.status(403).json({ success: false, message: 'Antragsteller ist dieser Schicht nicht zugewiesen.' });
    else res.status(201).json({ success: true, data: result.request });
  } catch (error) {
    next(error);
  }
}

export async function decideShiftSwap(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestId = uuidSchema.parse(req.params.requestId);
    const input = z.object({
      decision: z.enum(['approved', 'rejected']),
      expectedVersion: z.number().int().positive(),
      decisionNote: z.string().max(1000).optional()
    }).strict().parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const swap = await client.query(
        `SELECT id,shift_id,requester_employee_id,proposed_employee_id,status,revision_version
           FROM shift_swap_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, requestId]
      );
      if (!swap.rows.length) return { status: 404 as const };
      const row = swap.rows[0];
      if (row.status !== 'pending' || Number(row.revision_version) !== input.expectedVersion) return { status: 409 as const };
      if (input.decision === 'approved') {
        const shift = await client.query(
          `SELECT site_id,shift_date,start_time,end_time,ends_at,time_zone,break_minutes,required_qualification
             FROM shifts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [tenantId, row.shift_id]
        );
        if (!shift.rows.length) return { status: 404 as const };
        const data = shift.rows[0];
        const validation = await validateShiftCandidate(client, {
          tenantId, siteId: data.site_id, employeeId: row.proposed_employee_id,
          date: data.shift_date.toISOString?.().slice(0, 10) ?? String(data.shift_date).slice(0, 10),
          startTime: String(data.start_time).slice(0, 8), endTime: String(data.end_time).slice(0, 8),
          timeZone: data.time_zone,
          requiredQualification: data.required_qualification, breakMinutes: data.break_minutes,
          excludeShiftId: row.shift_id
        });
        if (validation.findings.some(finding => finding.severity === 'blocking')) {
          const stored = await storePlanningFindings(client, tenantId, validation.findings, {
            shiftId: row.shift_id, employeeId: row.proposed_employee_id,
            profileVersionId: validation.profileVersionId
          });
          return { status: 422 as const, findings: stored.findings };
        }
        await client.query(
          `UPDATE shift_staffing_assignments SET status='released',released_at=CURRENT_TIMESTAMP,
              revision_version=revision_version+1
            WHERE tenant_id=$1 AND shift_id=$2 AND employee_id=$3 AND status='assigned'`,
          [tenantId, row.shift_id, row.requester_employee_id]
        );
        await client.query(
          `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id,shift_id,employee_id)
           DO UPDATE SET status='assigned',revision_version=shift_staffing_assignments.revision_version+1,
             assigned_by=EXCLUDED.assigned_by,assigned_at=CURRENT_TIMESTAMP,released_at=NULL`,
          [tenantId, row.shift_id, row.proposed_employee_id, actorId]
        );
        await client.query(
          `UPDATE shifts SET employee_id=$1,revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=$2 AND id=$3`,
          [row.proposed_employee_id, tenantId, row.shift_id]
        );
      }
      const changed = await client.query(
        `UPDATE shift_swap_requests SET status=$1,revision_version=revision_version+1,
            decided_by=$2,decided_at=CURRENT_TIMESTAMP,decision_note=$3
          WHERE tenant_id=$4 AND id=$5 AND revision_version=$6
          RETURNING id,status,revision_version,decided_by,decided_at`,
        [input.decision, actorId, input.decisionNote ?? null, tenantId, requestId, input.expectedVersion]
      );
      await writeAudit(client, tenantId, actorId, `shift_swap.${input.decision}`, 'shift_swap_request', requestId);
      return { status: 200 as const, request: changed.rows[0] };
    });
    if (result.status === 404) res.status(404).json({ success: false, message: 'Diensttausch-Antrag oder Schicht nicht gefunden.' });
    else if (result.status === 409) res.status(409).json({ success: false, code: 'REVISION_CONFLICT' });
    else if (result.status === 422) sendValidationFailure(res, result.findings);
    else res.json({ success: true, data: result.request });
  } catch (error) {
    next(error);
  }
}

export async function listPlanningFindings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const { page, pageSize } = parsePage(req.query);
    const shiftId = req.query.shiftId ? uuidSchema.parse(req.query.shiftId) : undefined;
    const result = await withTenantTransaction(tenantId, async client => {
      const count = await client.query(
        `SELECT count(*)::int AS total FROM schedule_rule_findings
          WHERE tenant_id=$1 AND ($2::uuid IS NULL OR shift_id=$2)`,
        [tenantId, shiftId ?? null]
      );
      const rows = await client.query(
        `SELECT id,run_id,shift_id,employee_id,rule_code,severity,message,source_name,
                profile_version_id,details,created_at
           FROM schedule_rule_findings
          WHERE tenant_id=$1 AND ($2::uuid IS NULL OR shift_id=$2)
          ORDER BY created_at DESC,id
          LIMIT $3 OFFSET $4`,
        [tenantId, shiftId ?? null, pageSize, (page - 1) * pageSize]
      );
      return { rows: rows.rows, total: count.rows[0].total as number };
    });
    res.json({
      success: true, data: result.rows,
      pagination: { page, pageSize, total: result.total, pages: Math.ceil(result.total / pageSize) }
    });
  } catch (error) {
    next(error);
  }
}

export async function createShiftTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = templateSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const site = await client.query('SELECT time_zone FROM sites WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL', [tenantId, input.siteId]);
      if (!site.rows.length) return undefined;
      const zone = input.timeZone ?? site.rows[0].time_zone;
      const time = resolveShiftTime({
        date: '2024-01-08', startTime: input.startTime, endTime: input.endTime, timeZone: zone
      }, zone);
      const row = await client.query(
        `INSERT INTO schedule_templates
          (tenant_id,site_id,name,time_zone,local_start_time,local_end_time,required_qualification,recurrence,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         RETURNING id,name,site_id,time_zone,local_start_time,local_end_time,required_qualification,recurrence,revision_version`,
        [tenantId, input.siteId, input.name, time.timeZone, input.startTime, input.endTime,
          input.requiredQualification, JSON.stringify({ frequency: input.frequency, interval: input.interval, weekdays: input.weekdays ?? [] }), actorId]
      );
      await writeAudit(client, tenantId, actorId, 'template.created', 'schedule_template', row.rows[0].id);
      return row.rows[0];
    });
    if (!result) {
      res.status(404).json({ success: false, message: 'Objekt nicht gefunden.' });
      return;
    }
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function applyShiftTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templateId = uuidSchema.parse(req.params.templateId);
    const input = z.object({
      dateFrom: dateSchema,
      dateTo: dateSchema,
      schedulePeriodId: uuidSchema.optional()
    }).strict().refine(value => value.dateTo >= value.dateFrom, {
      path: ['dateTo'], message: 'dateTo darf nicht vor dateFrom liegen.'
    }).parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const template = await client.query(
        `SELECT id,site_id,name,time_zone,local_start_time,local_end_time,required_qualification,recurrence,active
           FROM schedule_templates WHERE tenant_id=$1 AND id=$2`,
        [tenantId, templateId]
      );
      if (!template.rows.length || !template.rows[0].active) return undefined;
      const value = template.rows[0];
      if (input.schedulePeriodId) {
        const period = await client.query(
          `SELECT date_from,date_to,status FROM schedule_periods
            WHERE tenant_id=$1 AND id=$2 FOR SHARE`,
          [tenantId, input.schedulePeriodId]
        );
        if (!period.rows.length) return { periodMissing: true as const };
        if (period.rows[0].status !== 'draft') return { periodClosed: true as const };
        const periodFrom = period.rows[0].date_from instanceof Date
          ? period.rows[0].date_from.toISOString().slice(0, 10)
          : String(period.rows[0].date_from).slice(0, 10);
        const periodTo = period.rows[0].date_to instanceof Date
          ? period.rows[0].date_to.toISOString().slice(0, 10)
          : String(period.rows[0].date_to).slice(0, 10);
        if (input.dateFrom < periodFrom || input.dateTo > periodTo) return { periodOutOfRange: true as const };
      }
      const recurrence = value.recurrence as { frequency: 'DAILY' | 'WEEKLY'; interval: number; weekdays: number[] };
      const start = new Date(`${input.dateFrom}T00:00:00Z`);
      const end = new Date(`${input.dateTo}T00:00:00Z`);
      if ((end.getTime() - start.getTime()) / 86400000 > 366) {
        return { tooLarge: true as const };
      }
      const results: Array<{ date: string; status: string; shiftId?: string; findings?: PlanningFinding[] }> = [];
      let eligibleDay = 0;
      for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const date = cursor.toISOString().slice(0, 10);
        const weekday = cursor.getUTCDay();
        const eligible = recurrence.frequency === 'DAILY'
          ? eligibleDay++ % recurrence.interval === 0
          : recurrence.weekdays.includes(weekday) &&
            Math.floor((cursor.getTime() - start.getTime()) / 604800000) % recurrence.interval === 0;
        if (!eligible) continue;
        if (results.length >= 366) return { tooLarge: true as const };
        let resolved: ReturnType<typeof resolveShiftTime>;
        try {
          resolved = resolveShiftTime({
            date, startTime: String(value.local_start_time).slice(0, 8),
            endTime: String(value.local_end_time).slice(0, 8), timeZone: value.time_zone
          }, value.time_zone);
        } catch (error) {
          results.push({ date, status: 'REJECTED', findings: [{
            code: 'LOCAL_TIME_INVALID', severity: 'blocking',
            message: error instanceof Error ? error.message : 'Lokale Zeit konnte nicht aufgelöst werden.'
          }] });
          continue;
        }
        const created = await client.query(
          `INSERT INTO shifts
            (tenant_id,site_id,shift_date,start_time,end_time,starts_at,ends_at,time_zone,
             type,status,planning_status,required_qualification,schedule_period_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Tagdienst','Offen','draft',$9,$10)
           RETURNING id`,
          [tenantId, value.site_id, date, value.local_start_time, value.local_end_time,
            resolved.startsAt, resolved.endsAt, resolved.timeZone, value.required_qualification,
            input.schedulePeriodId ?? null]
        );
        await client.query(
          `INSERT INTO shift_staffing_requirements (tenant_id,shift_id,qualification_type,required_count)
           VALUES ($1,$2,$3,1)`,
          [tenantId, created.rows[0].id, value.required_qualification]
        );
        results.push({ date, status: 'draft', shiftId: created.rows[0].id });
      }
      await writeAudit(client, tenantId, actorId, 'template.applied', 'schedule_template', templateId, {
        dateFrom: input.dateFrom, dateTo: input.dateTo, createdCount: results.filter(row => row.shiftId).length
      });
      return { occurrences: results, finalValidationRequired: true };
    });
    if (!result) res.status(404).json({ success: false, message: 'Vorlage nicht gefunden oder deaktiviert.' });
    else if ('periodMissing' in result) res.status(404).json({ success: false, message: 'Dienstplanperiode nicht gefunden.' });
    else if ('periodClosed' in result) res.status(409).json({ success: false, code: 'SCHEDULE_PERIOD_NOT_DRAFT' });
    else if ('periodOutOfRange' in result) res.status(422).json({ success: false, code: 'OUTSIDE_SCHEDULE_PERIOD' });
    else if ('tooLarge' in result) res.status(400).json({ success: false, message: 'Der Vorlagenzeitraum darf höchstens 366 Tage umfassen.' });
    else res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function workHoursReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const input = z.object({ from: dateSchema, to: dateSchema }).refine(value => value.to >= value.from).parse(req.query);
    const output = await withTenantTransaction(tenantId, client => client.query(
      `WITH staffing AS (
         SELECT s.id,s.tenant_id,a.employee_id,s.site_id,s.starts_at,s.ends_at
           FROM shifts s
           JOIN shift_staffing_assignments a
             ON a.tenant_id=s.tenant_id AND a.shift_id=s.id AND a.status='assigned'
          WHERE s.tenant_id=$1 AND s.planning_status <> 'cancelled'
            AND s.shift_date BETWEEN $2::date AND $3::date
         UNION
         SELECT s.id,s.tenant_id,s.employee_id,s.site_id,s.starts_at,s.ends_at
           FROM shifts s
          WHERE s.tenant_id=$1 AND s.employee_id IS NOT NULL
            AND s.planning_status <> 'cancelled'
            AND s.shift_date BETWEEN $2::date AND $3::date
            AND NOT EXISTS (
              SELECT 1 FROM shift_staffing_assignments a
               WHERE a.tenant_id=s.tenant_id AND a.shift_id=s.id AND a.status='assigned'
            )
       )
       SELECT e.id AS employee_id,e.personnel_number,e.first_name,e.last_name,
              count(st.id)::int AS assigned_shifts,
              COALESCE(sum(EXTRACT(EPOCH FROM (st.ends_at-st.starts_at))/3600),0)::numeric(10,2) AS planned_hours,
              count(*) FILTER (WHERE EXTRACT(ISODOW FROM st.starts_at AT TIME ZONE si.time_zone) IN (6,7))::int AS weekend_shifts
         FROM staffing st
         JOIN employees e ON e.tenant_id=st.tenant_id AND e.id=st.employee_id
         JOIN sites si ON si.tenant_id=st.tenant_id AND si.id=st.site_id
        GROUP BY e.id,e.personnel_number,e.first_name,e.last_name
        ORDER BY e.last_name,e.first_name`,
      [tenantId, input.from, input.to]
    ));
    const rows = output.rows;
    if (req.query.format === 'csv') {
      const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const csv = [
        ['employeeId', 'personnelNumber', 'firstName', 'lastName', 'assignedShifts', 'plannedHours', 'weekendShifts'].join(','),
        ...rows.map(row => [
          row.employee_id, row.personnel_number, row.first_name, row.last_name, row.assigned_shifts,
          row.planned_hours, row.weekend_shifts
        ].map(escape).join(','))
      ].join('\r\n');
      res.type('text/csv').set('Content-Disposition', 'attachment; filename="planning-work-hours.csv"').send(csv);
      return;
    }
    res.json({ success: true, data: rows, range: input });
  } catch (error) {
    next(error);
  }
}

export async function listPlanningAudit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const { page, pageSize } = parsePage(req.query);
    const entityId = req.query.entityId ? uuidSchema.parse(req.query.entityId) : undefined;
    const rows = await withTenantTransaction(tenantId, client => client.query(
      `SELECT id,actor_user_id,event_type,entity_type,entity_id,details,created_at
         FROM planning_audit_events
        WHERE tenant_id=$1 AND ($2::uuid IS NULL OR entity_id=$2)
        ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,
      [tenantId, entityId ?? null, pageSize, (page - 1) * pageSize]
    ));
    res.json({ success: true, data: rows.rows, pagination: { page, pageSize } });
  } catch (error) {
    next(error);
  }
}

export async function listSchedulePeriods(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const { page, pageSize } = parsePage(req.query);
    const result = await withTenantTransaction(tenantId, async client => {
      const count = await client.query('SELECT count(*)::int AS total FROM schedule_periods WHERE tenant_id=$1', [tenantId]);
      const rows = await client.query(
        `SELECT id,name,date_from,date_to,time_zone,status,revision_version,
                created_by,published_by,published_at,created_at,updated_at
           FROM schedule_periods WHERE tenant_id=$1
          ORDER BY date_from DESC,id LIMIT $2 OFFSET $3`,
        [tenantId, pageSize, (page - 1) * pageSize]
      );
      return { rows: rows.rows, total: count.rows[0].total as number };
    });
    res.json({
      success: true, data: result.rows,
      pagination: { page, pageSize, total: result.total, pages: Math.ceil(result.total / pageSize) }
    });
  } catch (error) {
    next(error);
  }
}

export async function listRuleProfiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const { page, pageSize } = parsePage(req.query);
    const result = await withTenantTransaction(tenantId, async client => {
      const count = await client.query('SELECT count(*)::int AS total FROM schedule_rule_profiles WHERE tenant_id=$1', [tenantId]);
      const rows = await client.query(
        `SELECT p.id,p.name,p.scope,p.active,p.created_by,p.created_at,
                v.id AS version_id,v.version_number,v.effective_from,v.effective_until,
                v.source_name,v.source_reference,v.rules,v.status AS version_status,
                v.approved_by,v.approved_at
           FROM schedule_rule_profiles p
           LEFT JOIN schedule_rule_profile_versions v
             ON v.tenant_id=p.tenant_id AND v.profile_id=p.id
          WHERE p.tenant_id=$1
          ORDER BY p.name,v.version_number DESC
          LIMIT $2 OFFSET $3`,
        [tenantId, pageSize, (page - 1) * pageSize]
      );
      return { rows: rows.rows, total: count.rows[0].total as number };
    });
    res.json({
      success: true, data: result.rows,
      pagination: { page, pageSize, total: result.total, pages: Math.ceil(result.total / pageSize) }
    });
  } catch (error) {
    next(error);
  }
}

export async function createRuleProfileVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profileId = uuidSchema.parse(req.params.profileId);
    const input = ruleVersionSchema.parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const profile = await client.query(
        'SELECT id FROM schedule_rule_profiles WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenantId, profileId]
      );
      if (!profile.rows.length) return undefined;
      const previous = await client.query(
        'SELECT COALESCE(max(version_number),0)::int AS version FROM schedule_rule_profile_versions WHERE tenant_id=$1 AND profile_id=$2',
        [tenantId, profileId]
      );
      const versionNumber = Number(previous.rows[0].version) + 1;
      const inserted = await client.query(
        `INSERT INTO schedule_rule_profile_versions
          (tenant_id,profile_id,version_number,effective_from,effective_until,source_name,
           source_reference,rules,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         RETURNING id,profile_id,version_number,effective_from,effective_until,
                   source_name,source_reference,rules,status`,
        [tenantId, profileId, versionNumber, input.effectiveFrom, input.effectiveUntil ?? null,
          input.sourceName, input.sourceReference, JSON.stringify(input.rules), actorId]
      );
      await writeAudit(client, tenantId, actorId, 'rule_profile_version.created', 'rule_profile_version', inserted.rows[0].id);
      return inserted.rows[0];
    });
    if (!result) res.status(404).json({ success: false, message: 'Regelprofil nicht gefunden.' });
    else res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function requestRuleException(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const findingId = uuidSchema.parse(req.params.findingId);
    const reason = z.string().min(5).max(2000).parse(req.body?.reason);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const finding = await client.query(
        `SELECT id,rule_code,severity,shift_id,employee_id
           FROM schedule_rule_findings WHERE tenant_id=$1 AND id=$2`,
        [tenantId, findingId]
      );
      if (!finding.rows.length) return undefined;
      const created = await client.query(
        `INSERT INTO schedule_rule_exceptions (tenant_id,finding_id,reason,requested_by)
         VALUES ($1,$2,$3,$4)
         RETURNING id,finding_id,reason,status,requested_by,requested_at`,
        [tenantId, findingId, reason, actorId]
      );
      await writeAudit(client, tenantId, actorId, 'rule_exception.requested', 'rule_exception', created.rows[0].id, {
        findingId, ruleCode: finding.rows[0].rule_code
      });
      return created.rows[0];
    });
    if (!result) res.status(404).json({ success: false, message: 'Prüfbefund nicht gefunden.' });
    else res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function decideRuleException(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const exceptionId = uuidSchema.parse(req.params.exceptionId);
    const input = z.object({
      decision: z.enum(['approved', 'rejected']),
      note: z.string().max(2000).optional()
    }).strict().parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const exception = await client.query(
        `SELECT id,requested_by,status FROM schedule_rule_exceptions
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, exceptionId]
      );
      if (!exception.rows.length) return { status: 404 as const };
      if (exception.rows[0].status !== 'pending') return { status: 409 as const };
      if (exception.rows[0].requested_by === actorId) return { status: 403 as const };
      const decided = await client.query(
        `UPDATE schedule_rule_exceptions
            SET status=$1,decided_by=$2,decided_at=CURRENT_TIMESTAMP,decision_note=$3
          WHERE tenant_id=$4 AND id=$5 AND status='pending'
          RETURNING id,finding_id,status,requested_by,decided_by,decided_at,decision_note`,
        [input.decision, actorId, input.note ?? null, tenantId, exceptionId]
      );
      await writeAudit(client, tenantId, actorId, `rule_exception.${input.decision}`, 'rule_exception', exceptionId);
      return { status: 200 as const, exception: decided.rows[0] };
    });
    if (result.status === 404) res.status(404).json({ success: false, message: 'Ausnahmeantrag nicht gefunden.' });
    else if (result.status === 403) res.status(403).json({ success: false, message: 'Eine Ausnahme darf nicht von der antragstellenden Person freigegeben werden.' });
    else if (result.status === 409) res.status(409).json({ success: false, code: 'REVISION_CONFLICT' });
    else res.json({ success: true, data: result.exception });
  } catch (error) {
    next(error);
  }
}

export async function listShiftSwapRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const { page, pageSize } = parsePage(req.query);
    const status = req.query.status ? z.enum(['pending', 'approved', 'rejected', 'withdrawn']).parse(req.query.status) : undefined;
    const result = await withTenantTransaction(tenantId, async client => {
      const count = await client.query(
        'SELECT count(*)::int AS total FROM shift_swap_requests WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2)',
        [tenantId, status ?? null]
      );
      const rows = await client.query(
        `SELECT id,shift_id,requester_employee_id,proposed_employee_id,status,revision_version,
                requested_by,requested_at,decided_by,decided_at,decision_note
           FROM shift_swap_requests
          WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2)
          ORDER BY requested_at DESC,id LIMIT $3 OFFSET $4`,
        [tenantId, status ?? null, pageSize, (page - 1) * pageSize]
      );
      return { rows: rows.rows, total: count.rows[0].total as number };
    });
    res.json({
      success: true, data: result.rows,
      pagination: { page, pageSize, total: result.total, pages: Math.ceil(result.total / pageSize) }
    });
  } catch (error) {
    next(error);
  }
}

export async function coverageReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const input = z.object({ from: dateSchema, to: dateSchema })
      .refine(value => value.to >= value.from, { path: ['to'], message: 'to darf nicht vor from liegen.' })
      .parse(req.query);
    const result = await withTenantTransaction(tenantId, client => client.query(
      `WITH assignments AS (
         SELECT tenant_id,shift_id,employee_id FROM shift_staffing_assignments
          WHERE tenant_id=$1 AND status='assigned'
         UNION
         SELECT tenant_id,id,employee_id FROM shifts
          WHERE tenant_id=$1 AND employee_id IS NOT NULL
       )
       SELECT s.id AS shift_id,s.shift_date,s.starts_at,s.ends_at,si.id AS site_id,si.name AS site_name,
              r.qualification_type,r.required_count,
              count(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM employee_qualifications q
                 WHERE q.tenant_id=s.tenant_id AND q.employee_id=a.employee_id
                   AND q.qualification_type=r.qualification_type AND q.verified=TRUE
                   AND q.status='VALID' AND (q.expiry_date IS NULL OR q.expiry_date >= s.shift_date)
              ) THEN a.employee_id END)::int AS assigned_count
         FROM shifts s
         JOIN sites si ON si.tenant_id=s.tenant_id AND si.id=s.site_id
         LEFT JOIN shift_staffing_requirements r ON r.tenant_id=s.tenant_id AND r.shift_id=s.id
         LEFT JOIN assignments a ON a.tenant_id=s.tenant_id AND a.shift_id=s.id
        WHERE s.tenant_id=$1 AND s.shift_date BETWEEN $2::date AND $3::date
          AND s.planning_status <> 'cancelled'
        GROUP BY s.id,si.id,si.name,r.qualification_type,r.required_count
        ORDER BY s.shift_date,si.name,s.starts_at`,
      [tenantId, input.from, input.to]
    ));
    res.json({
      success: true,
      data: result.rows.map(row => ({
        ...row,
        shortfall: row.required_count == null ? null : Math.max(0, Number(row.required_count) - Number(row.assigned_count))
      })),
      range: input
    });
  } catch (error) {
    next(error);
  }
}
