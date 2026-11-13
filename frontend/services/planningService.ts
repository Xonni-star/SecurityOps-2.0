import { Employee, Shift, Site } from '../types';
import { ApiError, apiClient } from './apiClient';
import type { OutboxMutation } from './indexedDbService';

export interface PlanningShift extends Shift {
  planningStatus: 'draft' | 'validated' | 'published' | 'cancelled';
  assignedCount: number;
  requiredStaffCount?: number;
  schedulePeriodId?: string;
  breakMinutes: number;
}

export interface SchedulePeriod {
  id: string;
  name: string;
  date_from: string;
  date_to: string;
  time_zone: string;
  status: 'draft' | 'published' | string;
  revision_version: number;
  published_at?: string | null;
}

export interface PlanningFinding {
  id?: string;
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
  source_name?: string;
  details?: Record<string, unknown>;
}

export interface CoverageRow {
  shift_id: string;
  shift_date: string;
  site_id: string;
  site_name: string;
  qualification_type?: string;
  required_count: number | null;
  assigned_count: number;
  shortfall: number | null;
}

export interface ShiftTemplate {
  id: string;
  site_id: string;
  site_name?: string;
  name: string;
  time_zone: string;
  local_start_time: string;
  local_end_time: string;
  required_qualification: string;
  recurrence: {
    frequency: 'DAILY' | 'WEEKLY';
    interval: number;
    weekdays: number[];
  };
  active: boolean;
  revision_version: number;
}

export interface StaffingSuggestion {
  shiftId: string;
  requirements: Array<{
    qualificationType: string;
    requiredCount: number;
    assignedCount: number;
    shortfall: number;
    candidates: Array<{
      employeeId: string;
      firstName: string;
      lastName: string;
      eligible: boolean;
      scheduledMinutesThisWeek: number;
      reasons: string[];
      findings: PlanningFinding[];
    }>;
  }>;
  finalAssignmentRequiresConfirmation: true;
}

export interface ActualTimeRecord {
  id: string;
  shift_id: string;
  employee_id: string;
  actual_start_at: string;
  actual_end_at: string;
  break_minutes: number;
  revision_version: number;
  recorded_by: string;
  recorded_at: string;
  notes?: string | null;
}

export interface ActualTimeHistoryEntry {
  id: string;
  actor_user_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ActualTimeRead {
  current: ActualTimeRecord | null;
  history: ActualTimeHistoryEntry[];
}

export interface CoverRequest {
  id: string;
  shift_id: string;
  requested_employee_id?: string | null;
  requested_first_name?: string | null;
  requested_last_name?: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  revision_version: number;
  shift_revision_version_at_request: number;
  requested_by: string;
  requested_at: string;
  decided_at?: string | null;
  decision_note?: string | null;
}

export interface WorkHoursRow {
  employee_id: string;
  personnel_number?: string | null;
  first_name: string;
  last_name: string;
  assigned_shifts: number;
  planned_hours: number;
  actual_hours: number | null;
  actual_status: 'unavailable' | 'partial' | 'complete' | string;
  overtime_hours: number | null;
  overtime_status: 'unavailable' | 'partial' | 'unconfigured' | 'ambiguous' | 'available' | string;
  overtime_sources: unknown[];
  planned_weekend_shifts?: number | null;
  actual_weekend_shifts?: number | null;
  planned_holiday_shifts?: number | null;
  actual_holiday_shifts?: number | null;
  planned_night_shifts?: number | null;
  actual_night_shifts?: number | null;
  calendar: Record<string, {
    plannedShifts: number | null;
    plannedStatus: string;
    actualShifts: number | null;
    actualStatus: string;
    sources: unknown[];
  }>;
}

export interface QualificationReportRow {
  qualification_type: string;
  active_qualified_employees: number;
  employees_with_record: number;
  required_slots: number;
  assigned_qualified_slots: number;
  shortfall: number;
}

export interface AbsenceReportRow {
  absence_type: string;
  status: string;
  absence_records: number;
  affected_employees: number;
  overlapping_calendar_days: number;
}

export interface ShiftAssignment {
  id: string;
  shift_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  status: 'assigned' | 'released' | string;
  revision_version: number;
}

export interface ShiftSwap {
  id: string;
  shift_id: string;
  requester_employee_id: string;
  proposed_employee_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | string;
  revision_version: number;
  requested_at: string;
  decided_at?: string | null;
  decision_note?: string | null;
}

export type PlanningRuleCode =
  | 'minimum_rest_minutes'
  | 'maximum_shift_minutes'
  | 'maximum_weekly_minutes'
  | 'overtime_threshold_weekly_minutes'
  | 'minimum_break_minutes'
  | 'break_after_minutes'
  | 'disallowed_weekdays'
  | 'weekend_weekdays'
  | 'sunday_work_allowed'
  | 'holiday_dates'
  | 'night_window_start_minute'
  | 'night_window_end_minute'
  | 'night_work_allowed';

export interface PlanningRule {
  code: PlanningRuleCode;
  value: number | boolean | Array<number | string>;
  source: string;
  severity: 'warning' | 'blocking';
}

export interface RuleProfileRow {
  id: string;
  name: string;
  scope: Record<string, unknown>;
  active: boolean;
  created_by: string;
  created_at: string;
  version_id?: string | null;
  version_number?: number | null;
  effective_from?: string | null;
  effective_until?: string | null;
  source_name?: string | null;
  source_reference?: string | null;
  rules?: PlanningRule[] | null;
  version_status?: 'draft' | 'approved' | string | null;
  approved_by?: string | null;
  approved_at?: string | null;
}

export interface RuleProfileVersion {
  id: string;
  profile_id: string;
  version_number: number;
  effective_from: string;
  effective_until?: string | null;
  source_name: string;
  source_reference: string;
  rules: PlanningRule[];
  status: 'draft' | 'approved' | string;
  approved_by?: string | null;
  approved_at?: string | null;
}

export interface SyncReceipt {
  status: 'SYNCED' | 'CONFLICT' | 'REJECTED';
  serverId: string;
  serverVersion: number;
}

export interface CalendarRange {
  from: string;
  to: string;
}

function dateOnly(value: unknown): string {
  return String(value ?? '').slice(0, 10);
}

function timeOnly(value: unknown): string {
  return String(value ?? '').slice(0, 5);
}

export function mapPlanningShift(
  row: Record<string, any>,
  tenantId: string,
  employees: Employee[] = []
): PlanningShift {
  const employeeId = row.employee_id ?? undefined;
  const employee = employees.find(candidate => candidate.id === employeeId);
  return {
    id: String(row.id),
    tenantId,
    siteId: String(row.site_id),
    siteName: String(row.site_name ?? ''),
    employeeId,
    employeeName: row.employee_name ?? (employee ? `${employee.firstName} ${employee.lastName}` : undefined),
    date: dateOnly(row.shift_date),
    startTime: timeOnly(row.start_time),
    endTime: timeOnly(row.end_time),
    type: row.type ?? 'Tagdienst',
    status: row.status ?? 'Offen',
    requiredQualification: row.required_qualification ?? '',
    conflictReason: row.conflict_reason ?? undefined,
    revisionVersion: Number(row.revision_version ?? 1),
    planningStatus: row.planning_status ?? 'draft',
    schedulePeriodId: row.schedule_period_id ?? undefined,
    assignedCount: Number(row.assigned_count ?? (employeeId ? 1 : 0)),
    requiredStaffCount: row.required_count == null ? undefined : Number(row.required_count),
    breakMinutes: Number(row.break_minutes ?? 0),
    syncStatus: row.syncStatus
  };
}

export function calendarRange(anchorDate: string, view: 'month' | 'week' | 'day'): CalendarRange {
  const anchor = new Date(`${anchorDate}T12:00:00`);
  if (Number.isNaN(anchor.getTime())) throw new Error('Ungültiges Kalenderdatum.');
  const from = new Date(anchor);
  const to = new Date(anchor);
  if (view === 'month') {
    from.setDate(1);
    to.setMonth(to.getMonth() + 1, 0);
  } else if (view === 'week') {
    const weekday = (anchor.getDay() + 6) % 7;
    from.setDate(anchor.getDate() - weekday);
    to.setTime(from.getTime());
    to.setDate(from.getDate() + 6);
  }
  const format = (date: Date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
  return { from: format(from), to: format(to) };
}

export function shiftCalendarDate(anchorDate: string, view: 'month' | 'week' | 'day', direction: -1 | 1): string {
  const date = new Date(`${anchorDate}T12:00:00`);
  if (view === 'month') {
    const dayOfMonth = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + direction);
    const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(dayOfMonth, lastDayOfMonth));
  } else {
    date.setDate(date.getDate() + direction * (view === 'week' ? 7 : 1));
  }
  return date.toISOString().slice(0, 10);
}

export function mergeOutboxShifts(
  serverShifts: PlanningShift[],
  mutations: OutboxMutation[],
  tenantId: string,
  employees: Employee[] = [],
  sites: Site[] = []
): PlanningShift[] {
  const merged = new Map(serverShifts.map(shift => [shift.id, shift]));
  for (const mutation of mutations) {
    if (mutation.tenantId !== tenantId || mutation.entityType !== 'shift') continue;
    const payload = mutation.payload ?? {};
    const shiftId = String(payload.id ?? mutation.id);
    const status = mutation.status === 'CONFLICT' ? 'conflict' : mutation.status === 'FAILED' ? 'failed' : 'pending';
    if (mutation.action === 'CREATE') {
      const localId = mutation.id;
      const employeeId = payload.employeeId ?? undefined;
      const employee = employees.find(candidate => candidate.id === employeeId);
      const site = sites.find(candidate => candidate.id === payload.siteId);
      merged.set(localId, {
        id: localId,
        tenantId,
        siteId: String(payload.siteId ?? ''),
        siteName: site?.name ?? '',
        employeeId,
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : undefined,
        date: dateOnly(payload.date ?? payload.shiftDate),
        startTime: timeOnly(payload.startTime),
        endTime: timeOnly(payload.endTime),
        type: payload.type ?? 'Tagdienst',
        status: payload.status ?? 'Offen',
        requiredQualification: payload.requiredQualification ?? '',
        revisionVersion: mutation.baseVersion,
        planningStatus: 'draft',
        assignedCount: employeeId ? 1 : 0,
        requiredStaffCount: 1,
        breakMinutes: Number(payload.breakMinutes ?? 0),
        syncStatus: status
      });
      continue;
    }

    const current = merged.get(shiftId);
    if (!current) continue;
    if (mutation.action === 'DELETE') {
      merged.set(shiftId, { ...current, pendingDelete: true, syncStatus: status });
    } else {
      merged.set(shiftId, {
        ...current,
        siteId: payload.siteId ?? current.siteId,
        date: dateOnly(payload.date ?? payload.shiftDate ?? current.date),
        startTime: payload.startTime ? timeOnly(payload.startTime) : current.startTime,
        endTime: payload.endTime ? timeOnly(payload.endTime) : current.endTime,
        type: payload.type ?? current.type,
        status: payload.status ?? current.status,
        requiredQualification: payload.requiredQualification ?? current.requiredQualification,
        syncStatus: status
      });
    }
  }
  return [...merged.values()];
}

export function reconcileShiftMutation(
  shifts: Shift[],
  mutation: OutboxMutation,
  receipt: SyncReceipt
): Shift[] {
  if (mutation.entityType !== 'shift') return shifts;
  const localId = mutation.action === 'CREATE' ? mutation.id : String(mutation.payload?.id ?? '');
  if (receipt.status === 'SYNCED' && mutation.action === 'DELETE') {
    return shifts.filter(shift => shift.id !== localId);
  }
  const syncStatus = receipt.status === 'SYNCED' ? 'synced' : receipt.status === 'CONFLICT' ? 'conflict' : 'failed';
  return shifts.map(shift => {
    if (shift.id !== localId) return shift;
    return {
      ...shift,
      id: receipt.status === 'SYNCED' && mutation.action === 'CREATE' ? receipt.serverId : shift.id,
      revisionVersion: receipt.status === 'SYNCED' ? receipt.serverVersion : shift.revisionVersion,
      syncStatus,
      pendingDelete: false
    };
  });
}

async function getAllPages<T>(path: string, query: URLSearchParams): Promise<T[]> {
  const pageSize = 200;
  const result: T[] = [];
  for (let page = 1; ; page += 1) {
    query.set('page', String(page));
    query.set('pageSize', String(pageSize));
    const rows = await apiClient.get<T[]>(`${path}?${query.toString()}`);
    result.push(...rows);
    if (rows.length < pageSize) return result;
  }
}

export const planningApi = {
  listShifts: (from: string, to: string) => getAllPages<Record<string, any>>(
    '/planning/shifts',
    new URLSearchParams({ from, to })
  ),
  listPeriods: () => getAllPages<SchedulePeriod>('/planning/periods', new URLSearchParams()),
  listFindings: (shiftId?: string) => getAllPages<PlanningFinding>(
    '/planning/findings',
    new URLSearchParams(shiftId ? { shiftId } : {})
  ),
  listRuleProfiles: () => getAllPages<RuleProfileRow>(
    '/planning/rule-profiles',
    new URLSearchParams()
  ),
  createRuleProfile: (input: {
    name: string;
    scope?: Record<string, unknown>;
    effectiveFrom: string;
    effectiveUntil?: string;
    sourceName: string;
    sourceReference: string;
    rules: PlanningRule[];
  }) => apiClient.post<{
    profile: { id: string; name: string; scope: Record<string, unknown> };
    version: RuleProfileVersion;
  }>(
    '/planning/rule-profiles', input
  ),
  createRuleProfileVersion: (profileId: string, input: {
    effectiveFrom: string;
    effectiveUntil?: string;
    sourceName: string;
    sourceReference: string;
    rules: PlanningRule[];
  }) => apiClient.post<RuleProfileVersion>(
    `/planning/rule-profiles/${encodeURIComponent(profileId)}/versions`, input
  ),
  approveRuleProfileVersion: (profileId: string, versionId: string) =>
    apiClient.post<RuleProfileVersion>(
      `/planning/rule-profiles/${encodeURIComponent(profileId)}/versions/${encodeURIComponent(versionId)}/approve`,
      {}
    ),
  setRuleProfileActive: (profileId: string, active: boolean) =>
    apiClient.patch<RuleProfileRow>(
      `/planning/rule-profiles/${encodeURIComponent(profileId)}`,
      { active }
    ),
  listAssignments: (shiftId: string) => apiClient.get<ShiftAssignment[]>(
    `/planning/shifts/${encodeURIComponent(shiftId)}/assignments`
  ),
  createPeriod: (input: { name: string; dateFrom: string; dateTo: string; timeZone: string }) =>
    apiClient.post<SchedulePeriod>('/planning/periods', input),
  createShift: (input: Record<string, unknown>) => apiClient.post<any>('/planning/shifts', input),
  assignEmployee: (shiftId: string, employeeId: string, expectedVersion: number) =>
    apiClient.post<any>(`/planning/shifts/${encodeURIComponent(shiftId)}/assignments`, {
      employeeId,
      expectedVersion
    }),
  updateShift: (shiftId: string, input: Record<string, unknown>) =>
    apiClient.patch<any>(`/shifts/${encodeURIComponent(shiftId)}`, input),
  deleteShift: (shiftId: string, revisionVersion: number) =>
    apiClient.delete<any>(`/shifts/${encodeURIComponent(shiftId)}?revisionVersion=${revisionVersion}`),
  publishPeriod: (periodId: string, expectedVersion: number) =>
    apiClient.post<any>(`/planning/periods/${encodeURIComponent(periodId)}/publish`, { expectedVersion }),
  listTemplates: (siteId?: string, includeInactive = false) => getAllPages<ShiftTemplate>(
    '/planning/templates',
    new URLSearchParams({
      ...(siteId ? { siteId } : {}),
      ...(includeInactive ? { includeInactive: 'true' } : {})
    })
  ),
  createTemplate: (input: {
    siteId: string;
    name: string;
    timeZone?: string;
    startTime: string;
    endTime: string;
    requiredQualification: string;
    frequency: 'DAILY' | 'WEEKLY';
    interval?: number;
    weekdays?: number[];
  }) => apiClient.post<ShiftTemplate>('/planning/templates', input),
  updateTemplate: (templateId: string, input: {
    expectedVersion: number;
    siteId?: string;
    name?: string;
    timeZone?: string;
    startTime?: string;
    endTime?: string;
    requiredQualification?: string;
    frequency?: 'DAILY' | 'WEEKLY';
    interval?: number;
    weekdays?: number[];
    active?: boolean;
  }) => apiClient.patch<ShiftTemplate>(
    `/planning/templates/${encodeURIComponent(templateId)}`, input
  ),
  applyTemplate: (templateId: string, input: { dateFrom: string; dateTo: string; schedulePeriodId?: string }) =>
    apiClient.post<{ occurrences: Array<{ date: string; status: string; shiftId?: string; findings?: PlanningFinding[] }>; finalValidationRequired: boolean }>(
      `/planning/templates/${encodeURIComponent(templateId)}/apply`, input
    ),
  staffingSuggestions: (shiftId: string) => apiClient.get<StaffingSuggestion>(
    `/planning/shifts/${encodeURIComponent(shiftId)}/staffing-suggestions`
  ),
  createSwap: (shiftId: string, input: Record<string, unknown>) =>
    apiClient.post<any>(`/planning/shifts/${encodeURIComponent(shiftId)}/swaps`, input),
  listSwaps: (status?: string) => getAllPages<ShiftSwap>(
    '/planning/swaps',
    new URLSearchParams(status ? { status } : {})
  ),
  decideSwap: (requestId: string, input: { decision: 'approved' | 'rejected'; expectedVersion: number; decisionNote?: string }) =>
    apiClient.post<any>(`/planning/swaps/${encodeURIComponent(requestId)}/decision`, input),
  createCoverRequest: (shiftId: string, input: {
    requestedEmployeeId?: string;
    expectedShiftVersion: number;
    clientMutationId: string;
    reason: string;
  }) => apiClient.post<CoverRequest>(
    `/planning/shifts/${encodeURIComponent(shiftId)}/cover-requests`, input
  ),
  coverRequests: (status?: string, shiftId?: string) => getAllPages<CoverRequest>(
    '/planning/cover-requests',
    new URLSearchParams({
      ...(status ? { status } : {}),
      ...(shiftId ? { shiftId } : {})
    })
  ),
  decideCoverRequest: (requestId: string, input: {
    decision: 'approved' | 'rejected';
    expectedVersion: number;
    employeeId?: string;
    clientMutationId: string;
    decisionNote?: string;
  }) => apiClient.post<CoverRequest>(
    `/planning/cover-requests/${encodeURIComponent(requestId)}/decision`, input
  ),
  recordActualTime: (shiftId: string, input: {
    employeeId: string;
    actualStartAt: string;
    actualEndAt: string;
    breakMinutes: number;
    expectedVersion: number;
    clientMutationId: string;
    notes?: string;
  }) => apiClient.post<{
    id: string;
    shift_id: string;
    employee_id: string;
    actual_start_at: string;
    actual_end_at: string;
    break_minutes: number;
    revision_version: number;
    recorded_by: string;
    recorded_at: string;
    notes?: string | null;
  }>(`/planning/shifts/${encodeURIComponent(shiftId)}/actual-time`, input),
  getActualTime: (shiftId: string, employeeId: string) => apiClient.get<ActualTimeRead>(
    `/planning/shifts/${encodeURIComponent(shiftId)}/actual-time?employeeId=${encodeURIComponent(employeeId)}`
  ),
  workHours: (from: string, to: string) => apiClient.get<WorkHoursRow[]>(
    `/planning/reports/work-hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  ),
  coverage: (from: string, to: string) => apiClient.get<CoverageRow[]>(
    `/planning/reports/coverage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  ),
  qualifications: (from: string, to: string) => apiClient.get<QualificationReportRow[]>(
    `/planning/reports/qualifications?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  ),
  absences: (from: string, to: string) => apiClient.get<AbsenceReportRow[]>(
    `/planning/reports/absences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
};

export function planningErrorDetails(error: unknown): { code?: string; findings: PlanningFinding[]; message: string } {
  if (error instanceof ApiError) {
    const data = error.data as { findings?: PlanningFinding[] } | undefined;
    return {
      code: error.code,
      findings: Array.isArray(data?.findings) ? data.findings : [],
      message: error.message
    };
  }
  return { findings: [], message: error instanceof Error ? error.message : 'Unbekannter Fehler.' };
}
