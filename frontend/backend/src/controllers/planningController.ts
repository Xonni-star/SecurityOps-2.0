import { createHash } from 'crypto';
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
    'overtime_threshold_weekly_minutes',
    'minimum_break_minutes',
    'break_after_minutes',
    'disallowed_weekdays',
    'weekend_weekdays',
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
    'overtime_threshold_weekly_minutes',
    'minimum_break_minutes', 'break_after_minutes',
    'night_window_start_minute', 'night_window_end_minute'
  ]);
  if (numericCodes.has(rule.code) && typeof rule.value !== 'number') {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Diese Regel benötigt einen numerischen Wert.' });
  }
  if (['sunday_work_allowed', 'night_work_allowed'].includes(rule.code) && typeof rule.value !== 'boolean') {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Diese Regel benötigt einen booleschen Wert.' });
  }
  if (['disallowed_weekdays', 'weekend_weekdays', 'holiday_dates'].includes(rule.code) && !Array.isArray(rule.value)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Diese Regel benötigt eine Liste.' });
  }
  if (['disallowed_weekdays', 'weekend_weekdays'].includes(rule.code) &&
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

const reportRangeSchema = z.object({ from: dateSchema, to: dateSchema })
  .refine(value => value.to >= value.from, { path: ['to'], message: 'to darf nicht vor from liegen.' })
  .refine(value => (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86400000 <= 366, {
    path: ['to'], message: 'Der Berichtszeitraum darf höchstens 367 Kalendertage umfassen.'
  });

type ReportRuleProfile = {
  id: string;
  scope: Record<string, unknown>;
  effective_from: string | Date;
  effective_until: string | Date | null;
  source_name: string;
  source_reference: string;
  rules: Array<{ code: string; value: unknown; source: string }>;
};

function dateOnly(value: string | Date): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function ruleFor(rules: unknown, code: string): { value: unknown; source?: string } | undefined {
  if (!Array.isArray(rules)) return undefined;
  const found = rules.find((value): value is { code: string; value: unknown; source?: string } =>
    typeof value === 'object' && value !== null && (value as { code?: unknown }).code === code
  );
  return found;
}

function selectReportProfile(profiles: ReportRuleProfile[], siteId: string, date: string): ReportRuleProfile | undefined {
  return profiles.find(profile => {
    const scopeSite = profile.scope?.siteId;
    return dateOnly(profile.effective_from) <= date &&
      (!profile.effective_until || dateOnly(profile.effective_until) >= date) &&
      (typeof scopeSite !== 'string' || scopeSite === siteId);
  });
}

const calendarFormatters = new Map<string, Intl.DateTimeFormat>();

function calendarParts(value: Date, timeZone: string): { date: string; weekday: number; minute: number } {
  let formatter = calendarFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    calendarFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(value);
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  const date = `${part('year').toString().padStart(4, '0')}-${part('month').toString().padStart(2, '0')}-${part('day').toString().padStart(2, '0')}`;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { date, weekday, minute: part('hour') * 60 + part('minute') };
}

function localWeekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
  return start.toISOString().slice(0, 10);
}

type IntervalSummary = {
  minutes: number;
  weekendMinutes: number;
  holidayMinutes: number;
  nightMinutes: number;
  weekMinutes: Map<string, number>;
};

function summarizeInterval(
  startValue: Date | string,
  endValue: Date | string,
  timeZone: string,
  calendar: { weekendDays?: number[]; holidays?: string[]; nightStart?: number; nightEnd?: number }
): IntervalSummary {
  const start = startValue instanceof Date ? startValue.getTime() : Date.parse(startValue);
  const end = endValue instanceof Date ? endValue.getTime() : Date.parse(endValue);
  const result: IntervalSummary = {
    minutes: 0, weekendMinutes: 0, holidayMinutes: 0, nightMinutes: 0, weekMinutes: new Map()
  };
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return result;
  for (let cursor = start; cursor < end;) {
    const next = Math.min(cursor + 60000, end);
    const minutes = (next - cursor) / 60000;
    const local = calendarParts(new Date(cursor + (next - cursor) / 2), timeZone);
    const week = localWeekStart(local.date);
    result.minutes += minutes;
    result.weekMinutes.set(week, (result.weekMinutes.get(week) ?? 0) + minutes);
    if (calendar.weekendDays?.includes(local.weekday)) result.weekendMinutes += minutes;
    if (calendar.holidays?.includes(local.date)) result.holidayMinutes += minutes;
    if (calendar.nightStart !== undefined && calendar.nightEnd !== undefined) {
      const inNightWindow = calendar.nightStart < calendar.nightEnd
        ? local.minute >= calendar.nightStart && local.minute < calendar.nightEnd
        : local.minute >= calendar.nightStart || local.minute < calendar.nightEnd;
      if (inNightWindow) result.nightMinutes += minutes;
    }
    cursor = next;
  }
  return result;
}

function configuredCalendar(profile: ReportRuleProfile | undefined): {
  weekendDays?: number[];
  holidays?: string[];
  nightStart?: number;
  nightEnd?: number;
  sources: string[];
} {
  const rules = profile?.rules;
  const weekend = ruleFor(rules, 'weekend_weekdays');
  const holidays = ruleFor(rules, 'holiday_dates');
  const nightStart = ruleFor(rules, 'night_window_start_minute');
  const nightEnd = ruleFor(rules, 'night_window_end_minute');
  const numeric = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440;
  return {
    weekendDays: Array.isArray(weekend?.value) && weekend.value.every(value => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6)
      ? weekend.value as number[] : undefined,
    holidays: Array.isArray(holidays?.value) && holidays.value.every(value => typeof value === 'string')
      ? holidays.value as string[] : undefined,
    nightStart: numeric(nightStart?.value) ? Number(nightStart!.value) : undefined,
    nightEnd: numeric(nightEnd?.value) ? Number(nightEnd!.value) : undefined,
    sources: [weekend?.source, holidays?.source, nightStart?.source, nightEnd?.source]
      .filter((source): source is string => typeof source === 'string')
  };
}

function metricStatus(configuredCount: number, expectedCount: number): 'available' | 'partial' | 'unconfigured' {
  if (configuredCount === 0) return 'unconfigured';
  return configuredCount < expectedCount ? 'partial' : 'available';
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

function mutationPayloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function findMutationReceipt(
  client: PoolClient,
  tenantId: string,
  mutationId: string,
  entityType: string,
  action: string,
  payloadHash: string
): Promise<{ response: unknown } | { conflict: true } | undefined> {
  const receipt = await client.query(
    `SELECT entity_type,action,payload_hash,response_json
       FROM sync_idempotency_receipts WHERE tenant_id=$1 AND client_mutation_id=$2`,
    [tenantId, mutationId]
  );
  if (!receipt.rows.length) return undefined;
  const row = receipt.rows[0];
  if (row.entity_type !== entityType || row.action !== action || row.payload_hash !== payloadHash) {
    return { conflict: true };
  }
  return { response: row.response_json };
}

async function saveMutationReceipt(
  client: PoolClient,
  tenantId: string,
  mutationId: string,
  entityType: string,
  action: string,
  payloadHash: string,
  resourceId: string,
  version: number,
  response: unknown
): Promise<void> {
  await client.query(
    `INSERT INTO sync_idempotency_receipts
      (tenant_id,client_mutation_id,entity_type,action,payload_hash,status,server_id,server_version,response_json)
     VALUES ($1,$2,$3,$4,$5,'APPLIED',$6,$7,$8::jsonb)`,
    [tenantId, mutationId, entityType, action, payloadHash, resourceId, version, JSON.stringify(response)]
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
                s.shift_date::text AS shift_date,s.end_date::text AS end_date,
                s.start_time,s.end_time,s.starts_at,s.ends_at,s.time_zone,
                s.break_minutes,s.type,s.status,s.planning_status,s.required_qualification,
                s.schedule_period_id,s.revision_version,
                COALESCE(a.staff_count, CASE WHEN s.employee_id IS NULL THEN 0 ELSE 1 END) AS assigned_count,
                COALESCE(r.required_count,1) AS required_count
           FROM shifts s
           JOIN sites st ON st.id=s.site_id AND st.tenant_id=s.tenant_id
           LEFT JOIN LATERAL (
             SELECT count(*)::int AS staff_count FROM shift_staffing_assignments sa
              WHERE sa.tenant_id=s.tenant_id AND sa.shift_id=s.id AND sa.status='assigned'
           ) a ON TRUE
           LEFT JOIN shift_staffing_requirements r
             ON r.tenant_id=s.tenant_id AND r.shift_id=s.id
            AND r.qualification_type=s.required_qualification
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
         RETURNING id,name,date_from::text AS date_from,date_to::text AS date_to,time_zone,status,revision_version`,
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
          `SELECT s.id,s.site_id,s.employee_id,s.schedule_period_id,
                  s.shift_date::text AS shift_date,s.end_date::text AS end_date,
                  s.start_time,s.end_time,s.starts_at,s.ends_at,
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
            dateOnly(row.shift_date) === input.date &&
            dateOnly(row.end_date) === resolved.endDate &&
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
        const periodFrom = dateOnly(schedulePeriod.date_from);
        const periodTo = dateOnly(schedulePeriod.date_to);
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
          (tenant_id,site_id,employee_id,shift_date,end_date,start_time,end_time,starts_at,ends_at,time_zone,
           break_minutes,type,status,planning_status,required_qualification,schedule_period_id,client_mutation_id)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Offen','draft',$12,$13,$14)
         RETURNING id,site_id,shift_date::text AS shift_date,end_date::text AS end_date,
                   start_time,end_time,starts_at,ends_at,time_zone,
                   break_minutes,type,status,planning_status,required_qualification,schedule_period_id,revision_version`,
        [
          tenantId, input.siteId, input.date, validation.resolved.endDate, input.startTime, input.endTime,
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
        `SELECT id,site_id,shift_date,end_date,start_time,end_time,starts_at,ends_at,time_zone,
                break_minutes,required_qualification,revision_version,planning_status,schedule_period_id
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
        date: dateOnly(shift.shift_date),
        endDate: dateOnly(shift.end_date),
        startTime: String(shift.start_time).slice(0, 8),
        endTime: String(shift.end_time).slice(0, 8),
        timeZone: shift.time_zone,
        storedStartsAt: shift.starts_at,
        storedEndsAt: shift.ends_at,
        requiredQualification: shift.required_qualification,
        breakMinutes: input.breakMinutes ?? shift.break_minutes,
        excludeShiftId: shiftId
      });
      if (shift.schedule_period_id) {
        const period = await client.query(
          'SELECT date_from,date_to FROM schedule_periods WHERE tenant_id=$1 AND id=$2',
          [tenantId, shift.schedule_period_id]
        );
        if (period.rows.length) {
          const periodFrom = dateOnly(period.rows[0].date_from);
          const periodTo = dateOnly(period.rows[0].date_to);
          const shiftFrom = dateOnly(shift.shift_date);
          const shiftTo = validation.resolved.endDate;
          if (shiftFrom < periodFrom || shiftTo > periodTo) {
            validation.findings.push({
              code: 'OUTSIDE_SCHEDULE_PERIOD', severity: 'blocking',
              message: 'Die Schicht liegt außerhalb des Datumsbereichs der Dienstplanperiode.',
              details: { periodFrom, periodTo, shiftFrom, shiftTo }
            });
          }
        }
      }
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
      const periodFrom = dateOnly(period.date_from);
      const periodTo = dateOnly(period.date_to);
      const shifts = await client.query(
        `SELECT s.id,s.site_id,s.employee_id,s.shift_date,s.end_date,s.start_time,s.end_time,s.time_zone,
                s.break_minutes,s.required_qualification,s.starts_at,s.ends_at
           FROM shifts s
          WHERE s.tenant_id=$1 AND s.schedule_period_id=$2 AND s.planning_status <> 'cancelled'
          ORDER BY s.starts_at,s.id FOR UPDATE`,
        [tenantId, periodId]
      );
      const allFindings: PlanningFinding[] = [];
      const runIds: string[] = [];
      for (const shift of shifts.rows) {
        const shiftFrom = dateOnly(shift.shift_date);
        const shiftTo = dateOnly(shift.end_date);
        const outsidePeriod = shiftFrom < periodFrom || shiftTo > periodTo
          ? {
            code: 'OUTSIDE_SCHEDULE_PERIOD',
            severity: 'blocking' as const,
            message: `Schicht ${shift.id} liegt außerhalb des Datumsbereichs der Dienstplanperiode.`,
            details: { shiftId: shift.id, periodFrom, periodTo, shiftFrom, shiftTo }
          }
          : undefined;
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
            date: shiftFrom,
            endDate: shiftTo,
            startTime: String(shift.start_time).slice(0, 8),
            endTime: String(shift.end_time).slice(0, 8),
            timeZone: shift.time_zone,
            storedStartsAt: shift.starts_at,
            storedEndsAt: shift.ends_at,
            requiredQualification: shift.required_qualification,
            breakMinutes: shift.break_minutes,
            excludeShiftId: shift.id
          });
          if (outsidePeriod) validation.findings.push(outsidePeriod);
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
        if (outsidePeriod && !assignments.rows.length) {
          await storePlanningFindings(client, tenantId, [outsidePeriod], { shiftId: shift.id });
          if (!await hasApprovedException(client, tenantId, shift.id, null, outsidePeriod)) {
            allFindings.push(outsidePeriod);
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
          `SELECT site_id,shift_date,end_date,start_time,end_time,starts_at,ends_at,time_zone,
                  break_minutes,required_qualification,schedule_period_id
             FROM shifts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [tenantId, row.shift_id]
        );
        if (!shift.rows.length) return { status: 404 as const };
        const data = shift.rows[0];
        const validation = await validateShiftCandidate(client, {
          tenantId, siteId: data.site_id, employeeId: row.proposed_employee_id,
          date: dateOnly(data.shift_date),
          endDate: dateOnly(data.end_date),
          startTime: String(data.start_time).slice(0, 8), endTime: String(data.end_time).slice(0, 8),
          timeZone: data.time_zone,
          storedStartsAt: data.starts_at,
          storedEndsAt: data.ends_at,
          requiredQualification: data.required_qualification, breakMinutes: data.break_minutes,
          excludeShiftId: row.shift_id
        });
        if (data.schedule_period_id) {
          const period = await client.query(
            'SELECT date_from,date_to FROM schedule_periods WHERE tenant_id=$1 AND id=$2',
            [tenantId, data.schedule_period_id]
          );
          if (period.rows.length) {
            const periodFrom = dateOnly(period.rows[0].date_from);
            const periodTo = dateOnly(period.rows[0].date_to);
            if (dateOnly(data.shift_date) < periodFrom || validation.resolved.endDate > periodTo) {
              validation.findings.push({
                code: 'OUTSIDE_SCHEDULE_PERIOD', severity: 'blocking',
                message: 'Die Schicht liegt außerhalb des Datumsbereichs der Dienstplanperiode.',
                details: { periodFrom, periodTo, shiftFrom: dateOnly(data.shift_date), shiftTo: validation.resolved.endDate }
              });
            }
          }
        }
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

export async function createCoverRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const shiftId = uuidSchema.parse(req.params.id);
    const input = z.object({
      requestedEmployeeId: uuidSchema.optional(),
      expectedShiftVersion: z.number().int().positive(),
      clientMutationId: z.string().min(1).max(64),
      reason: z.string().trim().min(1).max(1000)
    }).strict().parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const hash = mutationPayloadHash({ shiftId, ...input });
    const result = await withTenantTransaction(tenantId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:planning-mutation:${input.clientMutationId}`]);
      const prior = await findMutationReceipt(client, tenantId, input.clientMutationId, 'shift_cover_request', 'create', hash);
      if (prior) return 'conflict' in prior ? { status: 409 as const, code: 'IDEMPOTENCY_KEY_REUSED' }
        : { status: 200 as const, request: prior.response };
      const shift = await client.query(
        `SELECT revision_version,planning_status FROM shifts
          WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, shiftId]
      );
      if (!shift.rows.length) return { status: 404 as const };
      if (shift.rows[0].planning_status === 'cancelled') return { status: 409 as const, code: 'SHIFT_CANCELLED' };
      if (Number(shift.rows[0].revision_version) !== input.expectedShiftVersion) {
        return { status: 409 as const, code: 'REVISION_CONFLICT', currentVersion: shift.rows[0].revision_version };
      }
      if (input.requestedEmployeeId) {
        const alreadyAssigned = await client.query(
          `SELECT 1 FROM shift_staffing_assignments
            WHERE tenant_id=$1 AND shift_id=$2 AND employee_id=$3 AND status='assigned'
           UNION SELECT 1 FROM shifts WHERE tenant_id=$1 AND id=$2 AND employee_id=$3`,
          [tenantId, shiftId, input.requestedEmployeeId]
        );
        if (alreadyAssigned.rows.length) return { status: 409 as const, code: 'EMPLOYEE_ALREADY_ASSIGNED' };
      }
      const created = await client.query(
        `INSERT INTO shift_cover_requests
          (tenant_id,shift_id,shift_revision_version_at_request,requested_employee_id,reason,requested_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id,shift_id,requested_employee_id,reason,status,revision_version,
                   shift_revision_version_at_request,requested_by,requested_at`,
        [tenantId, shiftId, input.expectedShiftVersion, input.requestedEmployeeId ?? null, input.reason, actorId]
      );
      const response = created.rows[0];
      await saveMutationReceipt(client, tenantId, input.clientMutationId, 'shift_cover_request', 'create',
        hash, response.id, Number(response.revision_version), response);
      await writeAudit(client, tenantId, actorId, 'shift_cover.requested', 'shift_cover_request', response.id, {
        shiftId, requestedEmployeeId: input.requestedEmployeeId ?? null
      });
      return { status: 201 as const, request: response };
    });
    if (result.status === 404) res.status(404).json({ success: false, message: 'Schicht nicht gefunden.' });
    else if (result.status === 409) res.status(409).json({ success: false, ...result });
    else res.status(result.status).json({ success: true, data: result.request });
  } catch (error) {
    next(error);
  }
}

export async function listCoverRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const input = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
      shiftId: uuidSchema.optional()
    }).parse(req.query);
    const result = await withTenantTransaction(tenantId, async client => {
      const params = [tenantId, input.status ?? null, input.shiftId ?? null];
      const count = await client.query(
        `SELECT count(*)::int AS total FROM shift_cover_requests
          WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR shift_id=$3)`,
        params
      );
      const rows = await client.query(
        `SELECT c.id,c.shift_id,c.requested_employee_id,e.first_name AS requested_first_name,
                e.last_name AS requested_last_name,c.reason,c.status,c.revision_version,
                c.shift_revision_version_at_request,c.requested_by,c.requested_at,
                c.decided_by,c.decided_at,c.decision_note
           FROM shift_cover_requests c
           LEFT JOIN employees e ON e.tenant_id=c.tenant_id AND e.id=c.requested_employee_id
          WHERE c.tenant_id=$1 AND ($2::text IS NULL OR c.status=$2) AND ($3::uuid IS NULL OR c.shift_id=$3)
          ORDER BY c.requested_at DESC,c.id LIMIT $4 OFFSET $5`,
        [...params, input.pageSize, (input.page - 1) * input.pageSize]
      );
      return { rows: rows.rows, total: Number(count.rows[0].total) };
    });
    res.json({
      success: true, data: result.rows,
      pagination: { page: input.page, pageSize: input.pageSize, total: result.total, pages: Math.ceil(result.total / input.pageSize) }
    });
  } catch (error) {
    next(error);
  }
}

export async function decideCoverRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const requestId = uuidSchema.parse(req.params.requestId);
    const input = z.object({
      decision: z.enum(['approved', 'rejected']),
      expectedVersion: z.number().int().positive(),
      employeeId: uuidSchema.optional(),
      clientMutationId: z.string().min(1).max(64),
      decisionNote: z.string().max(1000).optional()
    }).strict().parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const hash = mutationPayloadHash({ requestId, ...input });
    const result = await withTenantTransaction(tenantId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:planning-mutation:${input.clientMutationId}`]);
      const prior = await findMutationReceipt(client, tenantId, input.clientMutationId, 'shift_cover_request', 'decide', hash);
      if (prior) return 'conflict' in prior ? { status: 409 as const, code: 'IDEMPOTENCY_KEY_REUSED' }
        : { status: 200 as const, request: prior.response };
      const request = await client.query(
        `SELECT id,shift_id,shift_revision_version_at_request,requested_employee_id,requested_by,
                status,revision_version
           FROM shift_cover_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, requestId]
      );
      if (!request.rows.length) return { status: 404 as const };
      const cover = request.rows[0];
      if (cover.status !== 'pending' || Number(cover.revision_version) !== input.expectedVersion) {
        return { status: 409 as const, code: 'REVISION_CONFLICT', currentVersion: cover.revision_version };
      }
      if (cover.requested_by === actorId) return { status: 403 as const };
      let employeeId: string | null = null;
      if (input.decision === 'approved') {
        employeeId = cover.requested_employee_id ?? input.employeeId ?? null;
        if (!employeeId || (cover.requested_employee_id && input.employeeId && cover.requested_employee_id !== input.employeeId)) {
          return { status: 400 as const, code: 'COVER_EMPLOYEE_REQUIRED' };
        }
        const shiftResult = await client.query(
          `SELECT id,site_id,shift_date,end_date,start_time,end_time,starts_at,ends_at,time_zone,
                  break_minutes,required_qualification,revision_version,planning_status,schedule_period_id
             FROM shifts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [tenantId, cover.shift_id]
        );
        if (!shiftResult.rows.length || shiftResult.rows[0].planning_status === 'cancelled') {
          return { status: 409 as const, code: 'SHIFT_CANCELLED' };
        }
        const shift = shiftResult.rows[0];
        if (Number(shift.revision_version) !== Number(cover.shift_revision_version_at_request)) {
          return { status: 409 as const, code: 'SHIFT_CHANGED', currentShiftVersion: shift.revision_version };
        }
        const validation = await validateShiftCandidate(client, {
          tenantId, siteId: shift.site_id, employeeId,
          date: dateOnly(shift.shift_date),
          endDate: dateOnly(shift.end_date),
          startTime: String(shift.start_time).slice(0, 8),
          endTime: String(shift.end_time).slice(0, 8),
          timeZone: shift.time_zone,
          storedStartsAt: shift.starts_at,
          storedEndsAt: shift.ends_at,
          requiredQualification: shift.required_qualification,
          breakMinutes: shift.break_minutes,
          excludeShiftId: cover.shift_id
        });
        if (shift.schedule_period_id) {
          const period = await client.query(
            'SELECT date_from,date_to FROM schedule_periods WHERE tenant_id=$1 AND id=$2',
            [tenantId, shift.schedule_period_id]
          );
          if (period.rows.length) {
            const periodFrom = dateOnly(period.rows[0].date_from);
            const periodTo = dateOnly(period.rows[0].date_to);
            if (dateOnly(shift.shift_date) < periodFrom || validation.resolved.endDate > periodTo) {
              validation.findings.push({
                code: 'OUTSIDE_SCHEDULE_PERIOD', severity: 'blocking',
                message: 'Die Schicht liegt außerhalb des Datumsbereichs der Dienstplanperiode.',
                details: {
                  periodFrom, periodTo, shiftFrom: dateOnly(shift.shift_date), shiftTo: validation.resolved.endDate
                }
              });
            }
          }
        }
        const blockers = validation.findings.filter(finding => finding.severity === 'blocking');
        if (blockers.length) {
          const stored = await storePlanningFindings(client, tenantId, validation.findings, {
            shiftId: cover.shift_id, employeeId, profileVersionId: validation.profileVersionId
          });
          return { status: 422 as const, findings: stored.findings, runId: stored.runId };
        }
        await client.query(
          `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tenant_id,shift_id,employee_id)
           DO UPDATE SET status='assigned',revision_version=shift_staffing_assignments.revision_version+1,
                         assigned_by=EXCLUDED.assigned_by,assigned_at=CURRENT_TIMESTAMP,released_at=NULL`,
          [tenantId, cover.shift_id, employeeId, actorId]
        );
        const updatedShift = await client.query(
          `UPDATE shifts SET employee_id=COALESCE(employee_id,$1),
                             planning_status=CASE WHEN planning_status='draft' THEN 'validated' ELSE planning_status END,
                             revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=$2 AND id=$3 AND revision_version=$4
            RETURNING revision_version`,
          [employeeId, tenantId, cover.shift_id, shift.revision_version]
        );
        if (!updatedShift.rows.length) return { status: 409 as const, code: 'SHIFT_CHANGED' };
        await storePlanningFindings(client, tenantId, validation.findings, {
          shiftId: cover.shift_id, employeeId, profileVersionId: validation.profileVersionId
        });
      }
      const updated = await client.query(
        `UPDATE shift_cover_requests
            SET status=$1,decided_by=$2,decided_at=CURRENT_TIMESTAMP,decision_note=$3,
                revision_version=revision_version+1
          WHERE tenant_id=$4 AND id=$5 AND revision_version=$6 AND status='pending'
          RETURNING id,shift_id,requested_employee_id,reason,status,revision_version,
                    shift_revision_version_at_request,requested_by,requested_at,decided_by,decided_at,decision_note`,
        [input.decision, actorId, input.decisionNote ?? null, tenantId, requestId, input.expectedVersion]
      );
      if (!updated.rows.length) return { status: 409 as const, code: 'REVISION_CONFLICT' };
      const response = updated.rows[0];
      await saveMutationReceipt(client, tenantId, input.clientMutationId, 'shift_cover_request', 'decide',
        hash, requestId, Number(response.revision_version), response);
      await writeAudit(client, tenantId, actorId, `shift_cover.${input.decision}`, 'shift_cover_request', requestId, {
        shiftId: cover.shift_id, employeeId, decisionNote: input.decisionNote ?? null
      });
      return { status: 200 as const, request: response };
    });
    if (result.status === 404) res.status(404).json({ success: false, message: 'Vertretungsantrag nicht gefunden.' });
    else if (result.status === 403) res.status(403).json({ success: false, message: 'Ein Vertretungsantrag darf nicht durch den Ersteller entschieden werden.' });
    else if (result.status === 422) sendValidationFailure(res, result.findings);
    else if (result.status === 400) res.status(400).json({ success: false, code: result.code });
    else if (result.status === 409) res.status(409).json({ success: false, ...result });
    else res.json({ success: true, data: result.request });
  } catch (error) {
    next(error);
  }
}

export async function recordActualTime(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const shiftId = uuidSchema.parse(req.params.id);
    const input = z.object({
      employeeId: uuidSchema,
      actualStartAt: z.string().datetime({ offset: true }),
      actualEndAt: z.string().datetime({ offset: true }),
      breakMinutes: z.number().int().min(0).max(1440).default(0),
      expectedVersion: z.number().int().min(0),
      clientMutationId: z.string().min(1).max(64),
      notes: z.string().max(1000).optional()
    }).strict().parse(req.body);
    const start = new Date(input.actualStartAt);
    const end = new Date(input.actualEndAt);
    const elapsedMinutes = (end.getTime() - start.getTime()) / 60000;
    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0 || input.breakMinutes > elapsedMinutes) {
      res.status(400).json({ success: false, message: 'Tatsächlicher Zeitraum oder Pause ist ungültig.' });
      return;
    }
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const hash = mutationPayloadHash({ shiftId, ...input });
    const result = await withTenantTransaction(tenantId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:planning-mutation:${input.clientMutationId}`]);
      const prior = await findMutationReceipt(client, tenantId, input.clientMutationId, 'shift_actual_time', 'upsert', hash);
      if (prior) return 'conflict' in prior ? { status: 409 as const, code: 'IDEMPOTENCY_KEY_REUSED' }
        : { status: 200 as const, actualTime: prior.response };
      const shift = await client.query(
        `SELECT planning_status FROM shifts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, shiftId]
      );
      if (!shift.rows.length) return { status: 404 as const };
      if (shift.rows[0].planning_status === 'cancelled') return { status: 409 as const, code: 'SHIFT_CANCELLED' };
      const assignment = await client.query(
        `SELECT id FROM shift_staffing_assignments
          WHERE tenant_id=$1 AND shift_id=$2 AND employee_id=$3 AND status='assigned'`,
        [tenantId, shiftId, input.employeeId]
      );
      if (!assignment.rows.length) return { status: 403 as const };
      const current = await client.query(
        `SELECT id,actual_start_at,actual_end_at,break_minutes,revision_version,notes
           FROM shift_actual_times WHERE tenant_id=$1 AND shift_id=$2 AND employee_id=$3 FOR UPDATE`,
        [tenantId, shiftId, input.employeeId]
      );
      if ((!current.rows.length && input.expectedVersion !== 0) ||
          (current.rows.length && Number(current.rows[0].revision_version) !== input.expectedVersion)) {
        return { status: 409 as const, code: 'REVISION_CONFLICT', currentVersion: current.rows[0]?.revision_version ?? 0 };
      }
      const previous = current.rows[0] ?? null;
      const saved = previous
        ? await client.query(
          `UPDATE shift_actual_times
              SET actual_start_at=$1,actual_end_at=$2,break_minutes=$3,notes=$4,
                  revision_version=revision_version+1,recorded_by=$5,recorded_at=CURRENT_TIMESTAMP
            WHERE tenant_id=$6 AND id=$7 AND revision_version=$8
            RETURNING id,shift_id,employee_id,actual_start_at,actual_end_at,break_minutes,
                      revision_version,recorded_by,recorded_at,notes`,
          [start.toISOString(), end.toISOString(), input.breakMinutes, input.notes ?? null,
            actorId, tenantId, previous.id, input.expectedVersion]
        )
        : await client.query(
          `INSERT INTO shift_actual_times
            (tenant_id,shift_id,employee_id,actual_start_at,actual_end_at,break_minutes,recorded_by,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id,shift_id,employee_id,actual_start_at,actual_end_at,break_minutes,
                     revision_version,recorded_by,recorded_at,notes`,
          [tenantId, shiftId, input.employeeId, start.toISOString(), end.toISOString(),
            input.breakMinutes, actorId, input.notes ?? null]
        );
      if (!saved.rows.length) return { status: 409 as const, code: 'REVISION_CONFLICT' };
      const response = saved.rows[0];
      await saveMutationReceipt(client, tenantId, input.clientMutationId, 'shift_actual_time', 'upsert',
        hash, response.id, Number(response.revision_version), response);
      await writeAudit(client, tenantId, actorId, previous ? 'shift.actual_time.corrected' : 'shift.actual_time.recorded',
        'shift_actual_time', response.id, {
          shiftId, employeeId: input.employeeId, previous, actualStartAt: start.toISOString(),
          actualEndAt: end.toISOString(), breakMinutes: input.breakMinutes, revisionVersion: response.revision_version
        });
      return { status: previous ? 200 as const : 201 as const, actualTime: response };
    });
    if (result.status === 404) res.status(404).json({ success: false, message: 'Schicht nicht gefunden.' });
    else if (result.status === 403) res.status(403).json({ success: false, message: 'Mitarbeiter ist dieser Schicht nicht zugewiesen.' });
    else if (result.status === 409) res.status(409).json({ success: false, ...result });
    else res.status(result.status).json({ success: true, data: result.actualTime });
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

export async function listShiftTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const input = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
      includeInactive: z.enum(['true', 'false']).optional().transform(value => value === 'true'),
      siteId: uuidSchema.optional()
    }).parse(req.query);
    const result = await withTenantTransaction(tenantId, async client => {
      const count = await client.query(
        `SELECT count(*)::int AS total FROM schedule_templates
          WHERE tenant_id=$1 AND ($2::boolean OR active=TRUE) AND ($3::uuid IS NULL OR site_id=$3)`,
        [tenantId, input.includeInactive, input.siteId ?? null]
      );
      const rows = await client.query(
        `SELECT t.id,t.site_id,s.name AS site_name,t.name,t.time_zone,
                t.local_start_time,t.local_end_time,t.required_qualification,
                t.recurrence,t.active,t.revision_version,t.created_at,t.updated_at
           FROM schedule_templates t
           JOIN sites s ON s.tenant_id=t.tenant_id AND s.id=t.site_id
          WHERE t.tenant_id=$1 AND ($2::boolean OR t.active=TRUE) AND ($3::uuid IS NULL OR t.site_id=$3)
          ORDER BY t.name,t.id LIMIT $4 OFFSET $5`,
        [tenantId, input.includeInactive, input.siteId ?? null, input.pageSize, (input.page - 1) * input.pageSize]
      );
      return { rows: rows.rows, total: Number(count.rows[0].total) };
    });
    res.json({
      success: true,
      data: result.rows,
      pagination: { page: input.page, pageSize: input.pageSize, total: result.total, pages: Math.ceil(result.total / input.pageSize) }
    });
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
      let periodRange: { dateFrom: string; dateTo: string } | undefined;
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
        const periodFrom = dateOnly(period.rows[0].date_from);
        const periodTo = dateOnly(period.rows[0].date_to);
        if (input.dateFrom < periodFrom || input.dateTo > periodTo) return { periodOutOfRange: true as const };
        periodRange = { dateFrom: periodFrom, dateTo: periodTo };
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
        if (periodRange && (date < periodRange.dateFrom || resolved.endDate > periodRange.dateTo)) {
          results.push({ date, status: 'REJECTED', findings: [{
            code: 'OUTSIDE_SCHEDULE_PERIOD', severity: 'blocking',
            message: 'Die Vorlagen-Schicht endet außerhalb des Datumsbereichs der Dienstplanperiode.',
            details: { periodFrom: periodRange.dateFrom, periodTo: periodRange.dateTo, shiftFrom: date, shiftTo: resolved.endDate }
          }] });
          continue;
        }
        const created = await client.query(
          `INSERT INTO shifts
            (tenant_id,site_id,shift_date,end_date,start_time,end_time,starts_at,ends_at,time_zone,
             type,status,planning_status,required_qualification,schedule_period_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Tagdienst','Offen','draft',$10,$11)
           RETURNING id`,
          [tenantId, value.site_id, date, resolved.endDate, value.local_start_time, value.local_end_time,
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
    const input = reportRangeSchema.parse(req.query);
    const rows = await withTenantTransaction(tenantId, async client => {
      const profilesResult = await client.query(
        `SELECT v.id,p.scope,v.effective_from::text,v.effective_until::text,
                v.source_name,v.source_reference,v.rules
           FROM schedule_rule_profile_versions v
           JOIN schedule_rule_profiles p ON p.tenant_id=v.tenant_id AND p.id=v.profile_id
          WHERE v.tenant_id=$1 AND p.active=TRUE AND v.status='approved'
            AND v.effective_from <= $3::date
            AND (v.effective_until IS NULL OR v.effective_until >= $2::date)
          ORDER BY v.effective_from DESC,v.version_number DESC`,
        [tenantId, input.from, input.to]
      );
      const profiles = profilesResult.rows as ReportRuleProfile[];
      const staffing = await client.query(
        `WITH assigned AS (
           SELECT tenant_id,shift_id,employee_id FROM shift_staffing_assignments
            WHERE tenant_id=$1 AND status='assigned'
           UNION
           SELECT s.tenant_id,s.id,s.employee_id FROM shifts s
            WHERE s.tenant_id=$1 AND s.employee_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM shift_staffing_assignments a
                 WHERE a.tenant_id=s.tenant_id AND a.shift_id=s.id AND a.status='assigned'
              )
         )
         SELECT s.id AS shift_id,s.site_id,si.time_zone,s.shift_date::text AS shift_date,
                s.starts_at,s.ends_at,s.break_minutes,a.employee_id,
                e.personnel_number,e.first_name,e.last_name,
                t.actual_start_at,t.actual_end_at,t.break_minutes AS actual_break_minutes
           FROM shifts s
           JOIN sites si ON si.tenant_id=s.tenant_id AND si.id=s.site_id
           JOIN assigned a ON a.tenant_id=s.tenant_id AND a.shift_id=s.id
           JOIN employees e ON e.tenant_id=a.tenant_id AND e.id=a.employee_id
           LEFT JOIN shift_actual_times t
             ON t.tenant_id=s.tenant_id AND t.shift_id=s.id AND t.employee_id=a.employee_id
          WHERE s.tenant_id=$1 AND s.planning_status <> 'cancelled'
            AND s.shift_date BETWEEN $2::date AND $3::date
          ORDER BY e.last_name,e.first_name,s.starts_at,s.id`,
        [tenantId, input.from, input.to]
      );
      type MetricTrack = {
        plannedConfigured: number; plannedCount: number;
        actualConfigured: number; actualCount: number;
        sources: Set<string>;
      };
      type WeekTrack = {
        expectedShifts: number; missingActual: boolean; actualMinutes: number;
        thresholds: Set<number>; unconfigured: boolean; sources: Set<string>;
      };
      type EmployeeTrack = {
        employee_id: string; personnel_number: string; first_name: string; last_name: string;
        assigned_shifts: number; actual_shift_count: number;
        overtimeBreakAmbiguous: boolean;
        plannedMinutes: number; actualMinutes: number;
        calendar: Record<'weekend' | 'holiday' | 'night', MetricTrack>;
        weeks: Map<string, WeekTrack>;
      };
      const employees = new Map<string, EmployeeTrack>();
      const metrics = ['weekend', 'holiday', 'night'] as const;
      const addSource = (set: Set<string>, value: unknown) => {
        if (value !== undefined) set.add(JSON.stringify(value));
      };
      for (const shift of staffing.rows) {
        const employee = employees.get(shift.employee_id) ?? {
          employee_id: shift.employee_id,
          personnel_number: shift.personnel_number,
          first_name: shift.first_name,
          last_name: shift.last_name,
          assigned_shifts: 0,
          actual_shift_count: 0,
          overtimeBreakAmbiguous: false,
          plannedMinutes: 0,
          actualMinutes: 0,
          calendar: {
            weekend: { plannedConfigured: 0, plannedCount: 0, actualConfigured: 0, actualCount: 0, sources: new Set<string>() },
            holiday: { plannedConfigured: 0, plannedCount: 0, actualConfigured: 0, actualCount: 0, sources: new Set<string>() },
            night: { plannedConfigured: 0, plannedCount: 0, actualConfigured: 0, actualCount: 0, sources: new Set<string>() }
          },
          weeks: new Map<string, WeekTrack>()
        };
        employee.assigned_shifts += 1;
        const profile = selectReportProfile(profiles, shift.site_id, dateOnly(shift.shift_date));
        const calendar = configuredCalendar(profile);
        const weekendRule = ruleFor(profile?.rules, 'weekend_weekdays');
        const holidayRule = ruleFor(profile?.rules, 'holiday_dates');
        const nightStartRule = ruleFor(profile?.rules, 'night_window_start_minute');
        const nightEndRule = ruleFor(profile?.rules, 'night_window_end_minute');
        const overtimeRule = ruleFor(profile?.rules, 'overtime_threshold_weekly_minutes');
        const source = (rule: { source?: string } | undefined) => profile && rule ? {
          profileVersionId: profile.id,
          profileSourceName: profile.source_name,
          profileSourceReference: profile.source_reference,
          ruleSource: rule.source
        } : undefined;
        const plan = summarizeInterval(shift.starts_at, shift.ends_at, shift.time_zone, calendar);
        const plannedBreak = Number(shift.break_minutes ?? 0);
        employee.plannedMinutes += Math.max(0, plan.minutes - plannedBreak);
        const hasActual = shift.actual_start_at !== null && shift.actual_end_at !== null;
        const actual = hasActual
          ? summarizeInterval(shift.actual_start_at, shift.actual_end_at, shift.time_zone, calendar)
          : undefined;
        const actualWeekMinutes = actual ? new Map(actual.weekMinutes) : new Map<string, number>();
        if (actual) {
          employee.actual_shift_count += 1;
          employee.actualMinutes += Math.max(0, actual.minutes - Number(shift.actual_break_minutes ?? 0));
          const breakMinutes = Number(shift.actual_break_minutes ?? 0);
          if (actualWeekMinutes.size > 1 && breakMinutes > 0) {
            employee.overtimeBreakAmbiguous = true;
          } else if (actualWeekMinutes.size === 1 && breakMinutes > 0) {
            const [week, minutes] = [...actualWeekMinutes.entries()][0];
            actualWeekMinutes.set(week, Math.max(0, minutes - breakMinutes));
          }
        }
        for (const metric of metrics) {
          const configured = metric === 'weekend' ? calendar.weekendDays !== undefined
            : metric === 'holiday' ? calendar.holidays !== undefined
              : calendar.nightStart !== undefined && calendar.nightEnd !== undefined;
          const summaryKey = metric === 'weekend' ? 'weekendMinutes' : metric === 'holiday' ? 'holidayMinutes' : 'nightMinutes';
          const ruleSource = metric === 'weekend' ? source(weekendRule)
            : metric === 'holiday' ? source(holidayRule)
              : source(nightStartRule) && source(nightEndRule)
                ? { nightWindowStart: source(nightStartRule), nightWindowEnd: source(nightEndRule) } : undefined;
          const track = employee.calendar[metric];
          if (configured) {
            track.plannedConfigured += 1;
            if (plan[summaryKey] > 0) track.plannedCount += 1;
            addSource(track.sources, ruleSource);
            if (actual) {
              track.actualConfigured += 1;
              if (actual[summaryKey] > 0) track.actualCount += 1;
            }
          }
        }
        const threshold = overtimeRule?.value;
        const thresholdValue = typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0
          ? threshold : undefined;
        const thresholdSource = source(overtimeRule);
        const weeksForShift = new Set([...plan.weekMinutes.keys(), ...actualWeekMinutes.keys()]);
        for (const week of weeksForShift) {
          const track = employee.weeks.get(week) ?? {
            expectedShifts: 0, missingActual: false, actualMinutes: 0,
            thresholds: new Set<number>(), unconfigured: false, sources: new Set<string>()
          };
          if (plan.weekMinutes.has(week)) track.expectedShifts += 1;
          if (plan.weekMinutes.has(week) && !actual) track.missingActual = true;
          if (actual) track.actualMinutes += actualWeekMinutes.get(week) ?? 0;
          if (thresholdValue !== undefined) {
            track.thresholds.add(thresholdValue);
            addSource(track.sources, thresholdSource);
          } else {
            track.unconfigured = true;
          }
          employee.weeks.set(week, track);
        }
        employees.set(shift.employee_id, employee);
      }

      return [...employees.values()].map(employee => {
        const calendarReport = Object.fromEntries(metrics.map(metric => {
          const track = employee.calendar[metric];
          const plannedStatus = metricStatus(track.plannedConfigured, employee.assigned_shifts);
          const actualStatus = employee.actual_shift_count === 0 ? 'unavailable'
            : track.actualConfigured === 0 ? 'unconfigured'
              : employee.actual_shift_count < employee.assigned_shifts || track.actualConfigured < employee.actual_shift_count
                ? 'partial' : 'available';
          const label = metric === 'weekend' ? 'weekend' : metric === 'holiday' ? 'holiday' : 'night';
          return [label, {
            plannedShifts: track.plannedConfigured ? track.plannedCount : null,
            plannedStatus,
            actualShifts: track.actualConfigured ? track.actualCount : null,
            actualStatus,
            sources: [...track.sources].map(value => JSON.parse(value))
          }];
        })) as Record<string, {
          plannedShifts: number | null; plannedStatus: string;
          actualShifts: number | null; actualStatus: string; sources: unknown[];
        }>;
        const weekTracks = [...employee.weeks.values()];
        const overtimeStatus = employee.actual_shift_count === 0 ? 'unavailable'
          : weekTracks.some(week => week.missingActual) ? 'partial'
            : weekTracks.some(week => week.unconfigured || week.thresholds.size === 0) ? 'unconfigured'
              : employee.overtimeBreakAmbiguous || weekTracks.some(week => week.thresholds.size > 1) ? 'ambiguous'
                : 'available';
        const overtimeMinutes = overtimeStatus === 'available'
          ? weekTracks.reduce((sum, week) => sum + Math.max(0, week.actualMinutes - [...week.thresholds][0]), 0)
          : null;
        const overtimeSources = [...new Set(weekTracks.flatMap(week => [...week.sources]))].map(value => JSON.parse(value));
        return {
          employee_id: employee.employee_id,
          personnel_number: employee.personnel_number,
          first_name: employee.first_name,
          last_name: employee.last_name,
          assigned_shifts: employee.assigned_shifts,
          planned_hours: Number((employee.plannedMinutes / 60).toFixed(2)),
          actual_hours: employee.actual_shift_count ? Number((employee.actualMinutes / 60).toFixed(2)) : null,
          actual_status: employee.actual_shift_count === 0 ? 'unavailable'
            : employee.actual_shift_count < employee.assigned_shifts ? 'partial' : 'complete',
          overtime_hours: overtimeMinutes === null ? null : Number((overtimeMinutes / 60).toFixed(2)),
          overtime_status: overtimeStatus,
          overtime_sources: overtimeSources,
          planned_weekend_shifts: calendarReport.weekend.plannedShifts,
          weekend_shifts: calendarReport.weekend.plannedShifts,
          actual_weekend_shifts: calendarReport.weekend.actualShifts,
          planned_holiday_shifts: calendarReport.holiday.plannedShifts,
          actual_holiday_shifts: calendarReport.holiday.actualShifts,
          planned_night_shifts: calendarReport.night.plannedShifts,
          actual_night_shifts: calendarReport.night.actualShifts,
          calendar: calendarReport
        };
      });
    });
    if (req.query.format === 'csv') {
      const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const csv = [
        ['employeeId', 'personnelNumber', 'firstName', 'lastName', 'assignedShifts', 'plannedHours',
          'actualHours', 'actualStatus', 'overtimeHours', 'overtimeStatus', 'plannedWeekendShifts',
          'actualWeekendShifts', 'plannedHolidayShifts', 'actualHolidayShifts', 'plannedNightShifts',
          'actualNightShifts'].join(','),
        ...rows.map(row => [
          row.employee_id, row.personnel_number, row.first_name, row.last_name, row.assigned_shifts,
          row.planned_hours, row.actual_hours, row.actual_status, row.overtime_hours, row.overtime_status,
          row.planned_weekend_shifts, row.actual_weekend_shifts, row.planned_holiday_shifts,
          row.actual_holiday_shifts, row.planned_night_shifts, row.actual_night_shifts
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
        `SELECT id,name,date_from::text AS date_from,date_to::text AS date_to,time_zone,status,revision_version,
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

export async function listRuleProfileVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profileId = uuidSchema.parse(req.params.profileId);
    const tenantId = req.user!.tenantId;
    const { page, pageSize } = parsePage(req.query);
    const result = await withTenantTransaction(tenantId, async client => {
      const profile = await client.query(
        'SELECT id FROM schedule_rule_profiles WHERE tenant_id=$1 AND id=$2',
        [tenantId, profileId]
      );
      if (!profile.rows.length) return undefined;
      const count = await client.query(
        'SELECT count(*)::int AS total FROM schedule_rule_profile_versions WHERE tenant_id=$1 AND profile_id=$2',
        [tenantId, profileId]
      );
      const versions = await client.query(
        `SELECT id,profile_id,version_number,effective_from,effective_until,source_name,
                source_reference,rules,status,created_by,created_at,approved_by,approved_at
           FROM schedule_rule_profile_versions
          WHERE tenant_id=$1 AND profile_id=$2
          ORDER BY version_number DESC LIMIT $3 OFFSET $4`,
        [tenantId, profileId, pageSize, (page - 1) * pageSize]
      );
      return { rows: versions.rows, total: Number(count.rows[0].total) };
    });
    if (!result) {
      res.status(404).json({ success: false, message: 'Regelprofil nicht gefunden.' });
      return;
    }
    res.json({
      success: true, data: result.rows,
      pagination: { page, pageSize, total: result.total, pages: Math.ceil(result.total / pageSize) }
    });
  } catch (error) {
    next(error);
  }
}

export async function setRuleProfileActive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profileId = uuidSchema.parse(req.params.profileId);
    const input = z.object({ active: z.boolean() }).strict().parse(req.body);
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.userId;
    const result = await withTenantTransaction(tenantId, async client => {
      const updated = await client.query(
        `UPDATE schedule_rule_profiles SET active=$1,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$2 AND id=$3
          RETURNING id,name,scope,active,updated_at`,
        [input.active, tenantId, profileId]
      );
      if (!updated.rows.length) return undefined;
      await writeAudit(client, tenantId, actorId, 'rule_profile.activation_changed', 'rule_profile', profileId, {
        active: input.active
      });
      return updated.rows[0];
    });
    if (!result) res.status(404).json({ success: false, message: 'Regelprofil nicht gefunden.' });
    else res.json({ success: true, data: result });
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
    const input = reportRangeSchema.parse(req.query);
    const result = await withTenantTransaction(tenantId, client => client.query(
      `WITH assignments AS (
         SELECT tenant_id,shift_id,employee_id FROM shift_staffing_assignments
          WHERE tenant_id=$1 AND status='assigned'
         UNION
         SELECT tenant_id,id,employee_id FROM shifts
          WHERE tenant_id=$1 AND employee_id IS NOT NULL
       )
       SELECT s.id AS shift_id,s.shift_date,s.starts_at,s.ends_at,si.id AS site_id,si.name AS site_name,
              COALESCE(r.qualification_type,s.required_qualification) AS qualification_type,
              COALESCE(r.required_count,1) AS required_count,
              count(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM employee_qualifications q
                 WHERE q.tenant_id=s.tenant_id AND q.employee_id=a.employee_id
                   AND q.qualification_type=COALESCE(r.qualification_type,s.required_qualification) AND q.verified=TRUE
                   AND q.status='VALID' AND (q.expiry_date IS NULL OR q.expiry_date >= s.shift_date)
              ) THEN a.employee_id END)::int AS assigned_count
         FROM shifts s
         JOIN sites si ON si.tenant_id=s.tenant_id AND si.id=s.site_id
         LEFT JOIN shift_staffing_requirements r ON r.tenant_id=s.tenant_id AND r.shift_id=s.id
         LEFT JOIN assignments a ON a.tenant_id=s.tenant_id AND a.shift_id=s.id
        WHERE s.tenant_id=$1 AND s.shift_date BETWEEN $2::date AND $3::date
          AND s.planning_status <> 'cancelled'
        GROUP BY s.id,s.shift_date,s.starts_at,s.ends_at,si.id,si.name,
                 r.qualification_type,r.required_count,s.required_qualification
        ORDER BY s.shift_date,si.name,s.starts_at`,
      [tenantId, input.from, input.to]
    ));
    const data = result.rows.map(row => ({
      ...row,
      shortfall: Math.max(0, Number(row.required_count) - Number(row.assigned_count))
    }));
    const qualifications = new Map<string, { requiredCount: number; assignedCount: number; shortfall: number }>();
    for (const row of data) {
      const summary = qualifications.get(row.qualification_type) ?? { requiredCount: 0, assignedCount: 0, shortfall: 0 };
      summary.requiredCount += Number(row.required_count);
      summary.assignedCount += Math.min(Number(row.required_count), Number(row.assigned_count));
      summary.shortfall += Number(row.shortfall);
      qualifications.set(row.qualification_type, summary);
    }
    res.json({
      success: true,
      data,
      summary: {
        shifts: new Set(data.map(row => row.shift_id)).size,
        requiredCount: data.reduce((sum, row) => sum + Number(row.required_count), 0),
        assignedQualifiedCount: data.reduce((sum, row) => sum + Math.min(Number(row.required_count), Number(row.assigned_count)), 0),
        shortfall: data.reduce((sum, row) => sum + Number(row.shortfall), 0),
        byQualification: [...qualifications].map(([qualificationType, values]) => ({ qualificationType, ...values }))
      },
      range: input
    });
  } catch (error) {
    next(error);
  }
}

export async function qualificationReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const input = reportRangeSchema.parse(req.query);
    const result = await withTenantTransaction(tenantId, client => client.query(
      `WITH assigned AS (
         SELECT tenant_id,shift_id,employee_id FROM shift_staffing_assignments
          WHERE tenant_id=$1 AND status='assigned'
         UNION
         SELECT s.tenant_id,s.id,s.employee_id FROM shifts s
          WHERE s.tenant_id=$1 AND s.employee_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM shift_staffing_assignments a
               WHERE a.tenant_id=s.tenant_id AND a.shift_id=s.id AND a.status='assigned'
            )
       ),
       employee_counts AS (
         SELECT q.qualification_type,
                count(DISTINCT q.employee_id) FILTER (
                  WHERE e.archived_at IS NULL AND e.status='Aktiv' AND q.verified=TRUE
                    AND q.status='VALID' AND (q.expiry_date IS NULL OR q.expiry_date >= $3::date)
                )::int AS active_qualified_employees,
                count(DISTINCT q.employee_id)::int AS employees_with_record
           FROM employee_qualifications q
           JOIN employees e ON e.tenant_id=q.tenant_id AND e.id=q.employee_id
          WHERE q.tenant_id=$1
          GROUP BY q.qualification_type
       ),
       requirements AS (
         SELECT s.tenant_id,s.id AS shift_id,s.shift_date,
                COALESCE(r.qualification_type,s.required_qualification) AS qualification_type,
                COALESCE(r.required_count,1) AS required_count
           FROM shifts s
           LEFT JOIN shift_staffing_requirements r ON r.tenant_id=s.tenant_id AND r.shift_id=s.id
          WHERE s.tenant_id=$1 AND s.planning_status <> 'cancelled'
            AND s.shift_date BETWEEN $2::date AND $3::date
       ),
       demand AS (
         SELECT r.qualification_type,
                sum(r.required_count)::int AS required_slots,
                sum(LEAST(r.required_count,(
                  SELECT count(DISTINCT a.employee_id)::int
                    FROM assigned a
                   WHERE a.tenant_id=r.tenant_id AND a.shift_id=r.shift_id
                     AND EXISTS (
                       SELECT 1 FROM employee_qualifications q
                        WHERE q.tenant_id=a.tenant_id AND q.employee_id=a.employee_id
                          AND q.qualification_type=r.qualification_type AND q.verified=TRUE
                          AND q.status='VALID' AND (q.expiry_date IS NULL OR q.expiry_date >= r.shift_date)
                     )
                )))::int AS assigned_qualified_slots
           FROM requirements r
          GROUP BY r.qualification_type
       )
       SELECT COALESCE(e.qualification_type,d.qualification_type) AS qualification_type,
              COALESCE(e.active_qualified_employees,0)::int AS active_qualified_employees,
              COALESCE(e.employees_with_record,0)::int AS employees_with_record,
              COALESCE(d.required_slots,0)::int AS required_slots,
              COALESCE(d.assigned_qualified_slots,0)::int AS assigned_qualified_slots,
              GREATEST(COALESCE(d.required_slots,0)-COALESCE(d.assigned_qualified_slots,0),0)::int AS shortfall
         FROM employee_counts e FULL OUTER JOIN demand d USING (qualification_type)
        ORDER BY qualification_type`,
      [tenantId, input.from, input.to]
    ));
    res.json({
      success: true, data: result.rows, range: input,
      note: 'Qualifikationen werden nur als einsatzfähig gezählt, wenn sie verifiziert, gültig und am Periodenende nicht abgelaufen sind.'
    });
  } catch (error) {
    next(error);
  }
}

export async function absenceReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const input = reportRangeSchema.parse(req.query);
    const report = await withTenantTransaction(tenantId, async client => {
      const rows = await client.query(
        `SELECT absence_type,status,count(*)::int AS absence_records,
                count(DISTINCT employee_id)::int AS affected_employees,
                sum(GREATEST(0,LEAST(date_to,$3::date)-GREATEST(date_from,$2::date)+1))::int AS overlapping_calendar_days
           FROM employee_absences
          WHERE tenant_id=$1 AND date_from <= $3::date AND date_to >= $2::date
          GROUP BY absence_type,status
          ORDER BY absence_type,status`,
        [tenantId, input.from, input.to]
      );
      const affected = await client.query(
        `SELECT count(DISTINCT employee_id)::int AS affected_employees
           FROM employee_absences
          WHERE tenant_id=$1 AND date_from <= $3::date AND date_to >= $2::date`,
        [tenantId, input.from, input.to]
      );
      return { rows: rows.rows, affectedEmployees: Number(affected.rows[0].affected_employees) };
    });
    res.json({
      success: true, data: report.rows, range: input,
      summary: {
        absenceRecords: report.rows.reduce((sum, row) => sum + Number(row.absence_records), 0),
        affectedEmployees: report.affectedEmployees
      }
    });
  } catch (error) {
    next(error);
  }
}
