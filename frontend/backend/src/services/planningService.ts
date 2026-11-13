import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';

export interface LocalShiftTime {
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
  timeZone?: string;
  startOffsetMinutes?: number;
  endOffsetMinutes?: number;
}

export interface ShiftCandidate extends LocalShiftTime {
  tenantId: string;
  siteId: string;
  employeeId?: string | null;
  requiredQualification: string;
  breakMinutes?: number;
  excludeShiftId?: string;
}

export interface PlanningFinding {
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
  sourceName?: string;
  details?: Record<string, unknown>;
}

export interface ResolvedShiftTime {
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  endDate: string;
}

export class PlanningTimeError extends Error {
  readonly statusCode = 400;
}

function wallParts(epochMs: number, timeZone: string): number[] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(epochMs));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return [value('year'), value('month'), value('day'), value('hour'), value('minute'), value('second')];
}

function parseLocalDateTime(date: string, time: string): { date: string; time: string; epochMs: number } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!dateMatch || !timeMatch) throw new PlanningTimeError('Datum oder Uhrzeit ist ungültig.');
  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText, secondText = '0'] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(epochMs);
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59
  ) {
    throw new PlanningTimeError('Datum oder Uhrzeit ist ungültig.');
  }
  return { date, time: `${hourText}:${minuteText}:${secondText}`, epochMs };
}

function offsetAt(epochMs: number, timeZone: string): number {
  const [year, month, day, hour, minute, second] = wallParts(epochMs, timeZone);
  const roundedEpoch = Math.floor(epochMs / 1000) * 1000;
  return Math.round((Date.UTC(year, month - 1, day, hour, minute, second) - roundedEpoch) / 60000);
}

function resolveLocalCandidates(date: string, time: string, timeZone: string): Array<{ instant: Date; offsetMinutes: number }> {
  const local = parseLocalDateTime(date, time);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(offsetAt(local.epochMs + hours * 60 * 60 * 1000, timeZone));
  }

  return [...offsets]
    .map(offsetMinutes => ({ instant: new Date(local.epochMs - offsetMinutes * 60000), offsetMinutes }))
    .filter(candidate => {
      const actual = wallParts(candidate.instant.getTime(), timeZone);
      const [year, month, day, hour, minute, second] = actual;
      const expected = new Date(local.epochMs);
      return year === expected.getUTCFullYear() && month === expected.getUTCMonth() + 1 &&
        day === expected.getUTCDate() && hour === expected.getUTCHours() &&
        minute === expected.getUTCMinutes() && second === expected.getUTCSeconds();
    })
    .sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

function resolveLocalInstant(
  date: string,
  time: string,
  timeZone: string,
  selectedOffset?: number
): Date {
  const candidates = resolveLocalCandidates(date, time, timeZone);
  if (candidates.length === 0) {
    throw new PlanningTimeError(`Die lokale Uhrzeit ${date} ${time} liegt in einer Zeitumstellungslücke in ${timeZone}.`);
  }
  if (selectedOffset !== undefined) {
    const selected = candidates.find(candidate => candidate.offsetMinutes === selectedOffset);
    if (!selected) throw new PlanningTimeError(`Der ausgewählte UTC-Offset ist für ${date} ${time} in ${timeZone} nicht gültig.`);
    return selected.instant;
  }
  if (candidates.length > 1) {
    throw new PlanningTimeError(`Die lokale Uhrzeit ${date} ${time} ist in ${timeZone} mehrdeutig; startOffsetMinutes/endOffsetMinutes muss angegeben werden.`);
  }
  return candidates[0].instant;
}

function addOneDate(date: string): string {
  const parsed = parseLocalDateTime(date, '12:00');
  return new Date(parsed.epochMs + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function resolveShiftTime(input: LocalShiftTime, siteTimeZone: string): ResolvedShiftTime {
  const timeZone = input.timeZone ?? siteTimeZone;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new PlanningTimeError('timeZone muss eine gültige IANA-Zeitzone sein.');
  }
  void formatter;

  const start = resolveLocalInstant(input.date, input.startTime, timeZone, input.startOffsetMinutes);
  const endDate = input.endDate ?? (input.endTime <= input.startTime ? addOneDate(input.date) : input.date);
  const end = resolveLocalInstant(endDate, input.endTime, timeZone, input.endOffsetMinutes);
  if (end.getTime() <= start.getTime()) {
    throw new PlanningTimeError('Das Schichtende muss nach dem Schichtbeginn liegen.');
  }
  return { timeZone, startsAt: start, endsAt: end, endDate };
}

type Rule = { code?: string; value?: unknown; severity?: string; source?: string };

function getRule(rules: unknown, code: string): Rule | undefined {
  if (!Array.isArray(rules)) return undefined;
  return rules.find((value): value is Rule =>
    typeof value === 'object' && value !== null && (value as Rule).code === code
  );
}

function numericRule(rules: unknown, code: string): number | undefined {
  const value = getRule(rules, code)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function dateListBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end && dates.length <= 8; cursor = addOneDate(cursor)) dates.push(cursor);
  return dates;
}

function addCalendarDays(date: string, days: number): string {
  const parsed = parseLocalDateTime(date, '12:00');
  return new Date(parsed.epochMs + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function localMinuteOfDay(value: string): number {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function shiftOverlapsConfiguredWindow(
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  windowStart: number,
  windowEnd: number
): boolean {
  const dates = dateListBetween(startDate, endDate);
  const start = localMinuteOfDay(startTime);
  let end = (dates.length - 1) * 1440 + localMinuteOfDay(endTime);
  if (end <= start) end += 1440;
  for (let day = 0; day < dates.length; day++) {
    const windowFrom = day * 1440 + windowStart;
    let windowTo = day * 1440 + windowEnd;
    if (windowTo <= windowFrom) windowTo += 1440;
    if (start < windowTo && end > windowFrom) return true;
  }
  return false;
}

export async function validateShiftCandidate(
  client: PoolClient,
  candidate: ShiftCandidate
): Promise<{ resolved: ResolvedShiftTime; findings: PlanningFinding[]; profileVersionId?: string }> {
  const site = await client.query(
    'SELECT time_zone FROM sites WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL',
    [candidate.tenantId, candidate.siteId]
  );
  if (!site.rows.length) {
    return {
      resolved: resolveShiftTime(candidate, 'UTC'),
      findings: [{ code: 'SITE_UNAVAILABLE', severity: 'blocking', message: 'Objekt ist nicht vorhanden oder archiviert.' }]
    };
  }

  const resolved = resolveShiftTime({ ...candidate, timeZone: site.rows[0].time_zone }, site.rows[0].time_zone);
  const findings: PlanningFinding[] = [];
  let profileVersionId: string | undefined;
  const profile = await client.query(
    `SELECT v.id, v.source_name, v.rules
       FROM schedule_rule_profile_versions v
       JOIN schedule_rule_profiles p ON p.id=v.profile_id AND p.tenant_id=v.tenant_id
      WHERE v.tenant_id=$1 AND p.active=TRUE
        AND (p.scope->>'siteId' IS NULL OR p.scope->>'siteId'=$3)
        AND v.status='approved'
        AND v.effective_from <= $2::date
        AND (v.effective_until IS NULL OR v.effective_until >= $2::date)
      ORDER BY v.effective_from DESC, v.version_number DESC
      LIMIT 1`,
    [candidate.tenantId, candidate.date, candidate.siteId]
  );
  const rules = profile.rows[0]?.rules;
  profileVersionId = profile.rows[0]?.id;
  const ruleSource = profile.rows[0]?.source_name as string | undefined;
  const addRuleFinding = (
    code: string,
    message: string,
    details?: Record<string, unknown>,
    ruleCode = code
  ) => {
    const rule = getRule(rules, ruleCode);
    findings.push({
      code,
      severity: rule?.severity === 'warning' ? 'warning' : 'blocking',
      message,
      sourceName: rule?.source ?? ruleSource,
      details: { ...details, profileVersionId }
    });
  };

  const durationMinutes = Math.floor((resolved.endsAt.getTime() - resolved.startsAt.getTime()) / 60000);
  const maximumShiftMinutes = numericRule(rules, 'maximum_shift_minutes');
  if (maximumShiftMinutes !== undefined && durationMinutes > maximumShiftMinutes) {
    addRuleFinding(
      'MAXIMUM_SHIFT_DURATION',
      'Die Schichtdauer überschreitet den aktiven konfigurierten Grenzwert.',
      { durationMinutes, maximumShiftMinutes },
      'maximum_shift_minutes'
    );
  }

  const minimumBreakMinutes = numericRule(rules, 'minimum_break_minutes');
  const breakAfterMinutes = numericRule(rules, 'break_after_minutes');
  if (minimumBreakMinutes !== undefined && breakAfterMinutes !== undefined &&
      durationMinutes > breakAfterMinutes && (candidate.breakMinutes ?? 0) < minimumBreakMinutes) {
    addRuleFinding(
      'MINIMUM_BREAK',
      'Die konfigurierte Mindestpause ist für diese Schicht nicht hinterlegt.',
      { minimumBreakMinutes, breakAfterMinutes, suppliedBreakMinutes: candidate.breakMinutes ?? 0 },
      'minimum_break_minutes'
    );
  }

  const shiftDates = dateListBetween(candidate.date, resolved.endDate);
  const disallowedWeekdays = getRule(rules, 'disallowed_weekdays')?.value;
  if (Array.isArray(disallowedWeekdays)) {
    const dayNumbers = shiftDates.map(date => new Date(`${date}T12:00:00Z`).getUTCDay());
    if (dayNumbers.some(day => disallowedWeekdays.includes(day))) {
      addRuleFinding(
        'DISALLOWED_WEEKDAY',
        'Die Schicht fällt auf einen im aktiven Regelprofil ausgeschlossenen Wochentag.',
        { weekdays: dayNumbers },
        'disallowed_weekdays'
      );
    }
  }
  if (getRule(rules, 'sunday_work_allowed')?.value === false &&
      shiftDates.some(date => new Date(`${date}T12:00:00Z`).getUTCDay() === 0)) {
    addRuleFinding('SUNDAY_WORK', 'Das aktive Regelprofil schließt Sonntagsarbeit für diesen Zeitraum aus.', undefined, 'sunday_work_allowed');
  }
  const holidayDates = getRule(rules, 'holiday_dates')?.value;
  if (Array.isArray(holidayDates) && shiftDates.some(date => holidayDates.includes(date))) {
    addRuleFinding('CONFIGURED_HOLIDAY_WORK', 'Die Schicht fällt auf ein als Feiertag konfiguriertes Datum.', { dates: shiftDates }, 'holiday_dates');
  }
  const nightStart = numericRule(rules, 'night_window_start_minute');
  const nightEnd = numericRule(rules, 'night_window_end_minute');
  if (getRule(rules, 'night_work_allowed')?.value === false &&
      nightStart !== undefined && nightEnd !== undefined &&
      nightStart < 1440 && nightEnd < 1440 &&
      shiftOverlapsConfiguredWindow(candidate.date, resolved.endDate, candidate.startTime,
        candidate.endTime, nightStart, nightEnd)) {
    addRuleFinding(
      'NIGHT_WORK',
      'Die Schicht überschneidet sich mit dem konfigurierten Nachtarbeitsfenster.',
      { nightWindowStartMinute: nightStart, nightWindowEndMinute: nightEnd },
      'night_work_allowed'
    );
  }
  if (!candidate.employeeId) return { resolved, findings, profileVersionId };

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${candidate.tenantId}:employee-shift:${candidate.employeeId}`]);
  const employee = await client.query(
    `SELECT status, archived_at
       FROM employees WHERE tenant_id=$1 AND id=$2`,
    [candidate.tenantId, candidate.employeeId]
  );
  if (!employee.rows.length || employee.rows[0].archived_at || employee.rows[0].status !== 'Aktiv') {
    findings.push({ code: 'EMPLOYEE_UNAVAILABLE', severity: 'blocking', message: 'Mitarbeiter ist nicht aktiv.' });
    return { resolved, findings, profileVersionId };
  }

  const siteAssignment = await client.query(
    'SELECT 1 FROM employee_site_assignments WHERE tenant_id=$1 AND employee_id=$2 AND site_id=$3',
    [candidate.tenantId, candidate.employeeId, candidate.siteId]
  );
  if (!siteAssignment.rows.length) {
    findings.push({ code: 'SITE_ASSIGNMENT_MISSING', severity: 'blocking', message: 'Mitarbeiter ist diesem Objekt nicht zugeordnet.' });
  }

  const qualification = await client.query(
    `SELECT 1 FROM employee_qualifications
      WHERE tenant_id=$1 AND employee_id=$2 AND qualification_type=$3
        AND verified=TRUE AND status='VALID'
        AND (expiry_date IS NULL OR expiry_date >= $4::date)
      LIMIT 1`,
    [candidate.tenantId, candidate.employeeId, candidate.requiredQualification, resolved.endDate]
  );
  if (!qualification.rows.length) {
    findings.push({
      code: 'QUALIFICATION_MISSING',
      severity: 'blocking',
      message: `Mitarbeiter besitzt keine gültige Qualifikation "${candidate.requiredQualification}" für den Schichtbeginn.`
    });
  }

  const absence = await client.query(
    `SELECT 1 FROM employee_absences
      WHERE tenant_id=$1 AND employee_id=$2 AND status='APPROVED'
        AND date_from <= $4::date AND date_to >= $3::date
      LIMIT 1`,
    [candidate.tenantId, candidate.employeeId, candidate.date, resolved.endDate]
  );
  if (absence.rows.length) {
    findings.push({ code: 'APPROVED_ABSENCE', severity: 'blocking', message: 'Mitarbeiter hat eine genehmigte Abwesenheit im Schichtzeitraum.' });
  }

  const overlap = await client.query(
    `SELECT s.id FROM shifts s
      WHERE s.tenant_id=$1 AND s.id IS DISTINCT FROM $2
        AND s.planning_status <> 'cancelled'
        AND s.starts_at < $4 AND s.ends_at > $3
        AND (s.employee_id=$5 OR EXISTS (
          SELECT 1 FROM shift_staffing_assignments a
           WHERE a.tenant_id=s.tenant_id AND a.shift_id=s.id
             AND a.employee_id=$5 AND a.status='assigned'
        ))
      LIMIT 1`,
    [candidate.tenantId, candidate.excludeShiftId ?? null, resolved.startsAt, resolved.endsAt, candidate.employeeId]
  );
  if (overlap.rows.length) {
    findings.push({ code: 'SHIFT_OVERLAP', severity: 'blocking', message: 'Mitarbeiter ist einer zeitlich überlappenden Schicht zugewiesen.' });
  }

  const minimumRestMinutes = numericRule(rules, 'minimum_rest_minutes');
  if (minimumRestMinutes !== undefined) {
    const rest = await client.query(
      `SELECT CASE
         WHEN s.ends_at <= $3 THEN EXTRACT(EPOCH FROM ($3 - s.ends_at)) / 60
         ELSE EXTRACT(EPOCH FROM (s.starts_at - $4)) / 60
       END AS rest_minutes
       FROM shifts s
       WHERE s.tenant_id=$1 AND s.id IS DISTINCT FROM $2
         AND s.planning_status <> 'cancelled'
         AND (s.employee_id=$5 OR EXISTS (
           SELECT 1 FROM shift_staffing_assignments a
            WHERE a.tenant_id=s.tenant_id AND a.shift_id=s.id
              AND a.employee_id=$5 AND a.status='assigned'
         ))
         AND (s.ends_at <= $3 OR s.starts_at >= $4)
       ORDER BY CASE WHEN s.ends_at <= $3 THEN $3-s.ends_at ELSE s.starts_at-$4 END
       LIMIT 1`,
      [candidate.tenantId, candidate.excludeShiftId ?? null, resolved.startsAt, resolved.endsAt, candidate.employeeId]
    );
    if (rest.rows.length && Number(rest.rows[0].rest_minutes) < minimumRestMinutes) {
      addRuleFinding(
        'MINIMUM_REST',
        'Die konfigurierte Mindestruhezeit zwischen den Schichten wird unterschritten.',
        { actualRestMinutes: Number(rest.rows[0].rest_minutes), minimumRestMinutes },
        'minimum_rest_minutes'
      );
    }
  }

  const maximumWeeklyMinutes = numericRule(rules, 'maximum_weekly_minutes');
  if (maximumWeeklyMinutes !== undefined) {
    const weekday = new Date(`${candidate.date}T12:00:00Z`).getUTCDay();
    const weekStart = addCalendarDays(candidate.date, -((weekday + 6) % 7));
    for (let weekIndex = 0; weekIndex < 2; weekIndex++) {
      const localWeekStart = addCalendarDays(weekStart, weekIndex * 7);
      const localWeekEnd = addCalendarDays(localWeekStart, 7);
      const bounds = await client.query(
        `SELECT ($1::date::timestamp AT TIME ZONE $3) AS starts_at,
                ($2::date::timestamp AT TIME ZONE $3) AS ends_at`,
        [localWeekStart, localWeekEnd, resolved.timeZone]
      );
      const weekStartAt = new Date(bounds.rows[0].starts_at);
      const weekEndAt = new Date(bounds.rows[0].ends_at);
      const candidateWeekMinutes = Math.max(0,
        Math.min(resolved.endsAt.getTime(), weekEndAt.getTime()) -
        Math.max(resolved.startsAt.getTime(), weekStartAt.getTime())
      ) / 60000;
      const work = await client.query(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(s.ends_at,$4)-GREATEST(s.starts_at,$3)))/60),0) AS minutes
           FROM shifts s
          WHERE s.tenant_id=$1 AND s.id IS DISTINCT FROM $2
            AND s.planning_status <> 'cancelled'
            AND s.starts_at < $4 AND s.ends_at > $3
            AND (s.employee_id=$5 OR EXISTS (
              SELECT 1 FROM shift_staffing_assignments a
               WHERE a.tenant_id=s.tenant_id AND a.shift_id=s.id
                 AND a.employee_id=$5 AND a.status='assigned'
            ))`,
        [candidate.tenantId, candidate.excludeShiftId ?? null, weekStartAt, weekEndAt, candidate.employeeId]
      );
      const existingMinutes = Number(work.rows[0].minutes);
      if (existingMinutes + candidateWeekMinutes > maximumWeeklyMinutes) {
        addRuleFinding(
          'MAXIMUM_WEEKLY_WORK',
          'Die konfigurierte wöchentliche Arbeitszeit wird überschritten.',
          { localWeekStart, existingMinutes, candidateWeekMinutes, maximumWeeklyMinutes },
          'maximum_weekly_minutes'
        );
        break;
      }
      if (resolved.endsAt <= weekEndAt) break;
    }
  }

  return { resolved, findings, profileVersionId };
}

export async function storePlanningFindings(
  client: PoolClient,
  tenantId: string,
  findings: PlanningFinding[],
  options: { shiftId?: string; employeeId?: string; profileVersionId?: string } = {}
): Promise<{ runId: string; findings: Array<PlanningFinding & { id: string }> }> {
  const runId = randomUUID();
  const stored: Array<PlanningFinding & { id: string }> = [];
  for (const finding of findings) {
    const result = await client.query(
      `INSERT INTO schedule_rule_findings
        (tenant_id, run_id, shift_id, employee_id, rule_code, severity, message,
         source_name, profile_version_id, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       RETURNING id`,
      [
        tenantId, runId, options.shiftId ?? null, options.employeeId ?? null,
        finding.code, finding.severity, finding.message, finding.sourceName ?? null,
        options.profileVersionId ?? null, JSON.stringify(finding.details ?? {})
      ]
    );
    stored.push({ ...finding, id: result.rows[0].id });
  }
  return { runId, findings: stored };
}
