import React, { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bell, CalendarDays, ChevronLeft, ChevronRight, Copy, Download,
  FileText, LoaderCircle, Plus, Printer, RefreshCw, ShieldCheck, Users, X
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { Employee, Shift, Site } from '../types';
import { ApiError, apiClient } from '../services/apiClient';
import { offlineVault, OutboxMutation } from '../services/indexedDbService';
import {
  AbsenceReportRow, calendarRange, CoverRequest, CoverageRow, mapPlanningShift, mergeOutboxShifts,
  PlanningFinding, planningApi, planningErrorDetails, PlanningShift, QualificationReportRow,
  RuleProfileRow, SchedulePeriod, ShiftAssignment, ShiftSwap, ShiftTemplate, shiftCalendarDate,
  PlanningRule, PlanningRuleCode, WorkHoursRow, StaffingSuggestion, ActualTimeRecord, ActualTimeHistoryEntry,
  PlanningNotification
} from '../services/planningService';

type CalendarView = 'month' | 'week' | 'day';
type GroupView = 'time' | 'employee' | 'site' | 'customer';
type EditorState = {
  mode: 'create' | 'edit';
  shift?: PlanningShift;
};

interface ShiftFormState {
  siteId: string;
  date: string;
  startTime: string;
  endTime: string;
  type: Shift['type'];
  requiredQualification: string;
  requiredStaffCount: number;
  breakMinutes: number;
  schedulePeriodId: string;
  employeeId: string;
  repeatCount: number;
  repeatEveryDays: number;
}

interface RuleVersionInput {
  effectiveFrom: string;
  effectiveUntil?: string;
  sourceName: string;
  sourceReference: string;
  rules: PlanningRule[];
}

interface RuleProfileInput extends RuleVersionInput {
  name: string;
  scope: Record<string, unknown>;
}

interface TemplateFormState {
  siteId: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  requiredStaffCount: number;
  requiredQualification: string;
  effectiveFrom: string;
  effectiveUntil: string;
  frequency: 'DAILY' | 'WEEKLY';
  interval: number;
  weekdays: number[];
}

const ruleCodeLabels: Record<PlanningRuleCode, string> = {
  minimum_rest_minutes: 'Mindest-Ruhezeit (Minuten)',
  maximum_shift_minutes: 'Maximale Schichtdauer (Minuten)',
  maximum_weekly_minutes: 'Maximale Wochenarbeitszeit (Minuten)',
  overtime_threshold_weekly_minutes: 'Überstundenschwelle je Woche (Minuten)',
  minimum_break_minutes: 'Mindestpause (Minuten)',
  break_after_minutes: 'Pause spätestens nach (Minuten)',
  disallowed_weekdays: 'Nicht erlaubte Wochentage (0=So bis 6=Sa)',
  weekend_weekdays: 'Wochenendtage (0=So bis 6=Sa)',
  sunday_work_allowed: 'Sonntagsarbeit erlaubt',
  holiday_dates: 'Feiertage (lokale Datumswerte)',
  night_window_start_minute: 'Beginn Nachtzeit (Minuten ab Mitternacht)',
  night_window_end_minute: 'Ende Nachtzeit (Minuten ab Mitternacht)',
  night_work_allowed: 'Nachtarbeit erlaubt'
};

const numericRuleCodes = new Set<PlanningRuleCode>([
  'minimum_rest_minutes',
  'maximum_shift_minutes',
  'maximum_weekly_minutes',
  'overtime_threshold_weekly_minutes',
  'minimum_break_minutes',
  'break_after_minutes',
  'night_window_start_minute',
  'night_window_end_minute'
]);

const booleanRuleCodes = new Set<PlanningRuleCode>([
  'sunday_work_allowed',
  'night_work_allowed'
]);

const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none';
const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50';

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}

function defaultForm(date: string, site?: Site, shift?: PlanningShift): ShiftFormState {
  return {
    siteId: shift?.siteId ?? site?.id ?? '',
    date: shift?.date ?? date,
    startTime: shift?.startTime ?? '08:00',
    endTime: shift?.endTime ?? '16:00',
    type: shift?.type ?? 'Tagdienst',
    requiredQualification: shift?.requiredQualification ?? 'Unterrichtung § 34a GewO',
    requiredStaffCount: shift?.requiredStaffCount ?? 1,
    breakMinutes: shift?.breakMinutes ?? 0,
    schedulePeriodId: shift?.schedulePeriodId ?? '',
    employeeId: '',
    repeatCount: 1,
    repeatEveryDays: 1
  };
}

function employeeName(id: string | undefined, employees: Employee[]): string {
  const employee = employees.find(item => item.id === id);
  return employee ? `${employee.firstName} ${employee.lastName}` : 'Nicht zugewiesen';
}

function shiftLabel(shift: PlanningShift): string {
  return `${shift.startTime}–${shift.endTime} ${shift.siteName || 'Objekt'}`;
}

function toShiftFormPayload(form: ShiftFormState): Record<string, unknown> {
  return {
    siteId: form.siteId,
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
    type: form.type,
    requiredQualification: form.requiredQualification,
    breakMinutes: form.breakMinutes
  };
}

function newClientMutationId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Der Browser kann keine sichere Mutations-ID erzeugen.');
  return globalThis.crypto.randomUUID();
}

function reportValue(value: number | null | undefined, status?: string): string {
  if (value == null) return `Nicht verfügbar${status ? ` (${status})` : ''}`;
  return `${value}${status ? ` (${status})` : ''}`;
}

function reportVariance(value: number | null | undefined, status?: string): string {
  if (value == null) return reportValue(null, status);
  return `${value > 0 ? '+' : ''}${value}${status ? ` (${status})` : ''}`;
}

function reportSources(sources: unknown[] | undefined): string {
  return sources?.length ? sources.map(source => typeof source === 'string' ? source : JSON.stringify(source)).join('; ') : 'Keine Quelle gemeldet';
}

function planningCacheRangeWarning(
  cached: { rangeFrom?: string; rangeTo?: string },
  requested: { from: string; to: string }
): string {
  if (!cached.rangeFrom || !cached.rangeTo) {
    return 'Der Offline-Cache enthält keinen gespeicherten Datumsbereich. Eine leere Ansicht bestätigt nicht, dass im angeforderten Zeitraum keine Schichten bestehen.';
  }
  if (requested.from >= cached.rangeFrom && requested.to <= cached.rangeTo) return '';
  return `Der Offline-Cache enthält nur den zuletzt geladenen Bereich ${cached.rangeFrom} bis ${cached.rangeTo}; ${requested.from} bis ${requested.to} ist nicht vollständig enthalten. Leere Bereiche außerhalb des Caches bestätigen nicht, dass dort keine Schichten bestehen.`;
}

export const RosterModule: React.FC = () => {
  const store = useSecurityStore();
  const { currentTenantId, currentUserId, authUser, sites, clients, employees, isOnline, syncQueue, isSyncing, lastSyncTime } = store;
  const identityKey = JSON.stringify([currentTenantId, currentUserId]);
  const identityKeyRef = useRef(identityKey);
  const detailsRequestIdRef = useRef(0);
  const isCurrentIdentity = (requestIdentity: string) => identityKeyRef.current === requestIdentity;
  const permissions = authUser?.permissions ?? [];
  const canRead = permissions.includes('planning:read');
  const canManage = permissions.includes('planning:manage');
  const canPublish = permissions.includes('planning:publish');
  const canReport = permissions.includes('planning:reports:read');
  const canRequestSwap = permissions.includes('planning:swaps:manage');
  const canDecideSwap = permissions.includes('planning:swaps:approve');
  const canRequestCover = permissions.includes('planning:covers:manage');
  const canDecideCover = permissions.includes('planning:covers:approve');
  const canManageActuals = permissions.includes('planning:actuals:manage');
  const canApproveActuals = permissions.includes('planning:actuals:approve');
  const canManageRules = permissions.includes('planning:rules:manage');
  const canApproveRules = permissions.includes('planning:rules:approve');

  const [view, setView] = useState<CalendarView>('month');
  const [groupView, setGroupView] = useState<GroupView>('time');
  const [anchorDate, setAnchorDate] = useState(() => localDate(new Date()));
  const range = useMemo(() => calendarRange(anchorDate, view), [anchorDate, view]);
  const [shifts, setShifts] = useState<PlanningShift[]>([]);
  const [periods, setPeriods] = useState<SchedulePeriod[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [outbox, setOutbox] = useState<OutboxMutation[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingCache, setUsingCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string>();
  const [loadError, setLoadError] = useState('');
  const [cacheWarning, setCacheWarning] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [filterSiteId, setFilterSiteId] = useState('');
  const [filterClientId, setFilterClientId] = useState('');
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [form, setForm] = useState<ShiftFormState>(() => defaultForm(localDate(new Date())));
  const [saving, setSaving] = useState(false);
  const [periodFormOpen, setPeriodFormOpen] = useState(false);
  const [periodForm, setPeriodForm] = useState({
    name: '',
    dateFrom: range.from,
    dateTo: range.to,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
  });
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [showInactiveTemplates, setShowInactiveTemplates] = useState(false);
  const [templateEditingId, setTemplateEditingId] = useState('');
  const [templateEditForm, setTemplateEditForm] = useState<TemplateFormState | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    frequency: 'WEEKLY' as 'DAILY' | 'WEEKLY',
    interval: 1,
    weekdays: [1, 2, 3, 4, 5],
    siteId: '',
    startTime: '',
    endTime: '',
    breakMinutes: 0,
    requiredStaffCount: 1,
    effectiveFrom: '',
    effectiveUntil: '',
    requiredQualification: ''
  });
  const [detailsShift, setDetailsShift] = useState<PlanningShift | null>(null);
  const [staffingSuggestions, setStaffingSuggestions] = useState<StaffingSuggestion | null>(null);
  const [actualCurrent, setActualCurrent] = useState<ActualTimeRecord | null>(null);
  const [actualHistory, setActualHistory] = useState<ActualTimeHistoryEntry[]>([]);
  const [actualLoading, setActualLoading] = useState(false);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [findings, setFindings] = useState<PlanningFinding[]>([]);
  const [swaps, setSwaps] = useState<ShiftSwap[]>([]);
  const [shiftCoverRequests, setShiftCoverRequests] = useState<CoverRequest[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [assignmentEmployeeId, setAssignmentEmployeeId] = useState('');
  const [swapEmployeeId, setSwapEmployeeId] = useState('');
  const [swapReason, setSwapReason] = useState('');
  const [coverEmployeeId, setCoverEmployeeId] = useState('');
  const [coverReason, setCoverReason] = useState('');
  const [coverDecisionEmployeeIds, setCoverDecisionEmployeeIds] = useState<Record<string, string>>({});
  const [coverRequestMutationIds, setCoverRequestMutationIds] = useState<Record<string, string>>({});
  const [coverDecisionMutationIds, setCoverDecisionMutationIds] = useState<Record<string, string>>({});
  const [coverListOpen, setCoverListOpen] = useState(false);
  const [allCoverRequests, setAllCoverRequests] = useState<CoverRequest[]>([]);
  const [coverListLoading, setCoverListLoading] = useState(false);
  const [actualForm, setActualForm] = useState({
    employeeId: '',
    actualStartAt: '',
    actualEndAt: '',
    breakMinutes: 0,
    expectedVersion: 0,
    notes: ''
  });
  const [actualSavedRevision, setActualSavedRevision] = useState<number | null>(null);
  const [actualMutationIds, setActualMutationIds] = useState<Record<string, string>>({});
  const [planningNotifications, setPlanningNotifications] = useState<PlanningNotification[]>([]);
  const [planningNotificationsOpen, setPlanningNotificationsOpen] = useState(false);
  const [planningNotificationsLoading, setPlanningNotificationsLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [workHours, setWorkHours] = useState<WorkHoursRow[]>([]);
  const [reportCoverage, setReportCoverage] = useState<CoverageRow[]>([]);
  const [reportQualifications, setReportQualifications] = useState<QualificationReportRow[]>([]);
  const [reportAbsences, setReportAbsences] = useState<AbsenceReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [ruleProfilesOpen, setRuleProfilesOpen] = useState(false);
  const [ruleProfiles, setRuleProfiles] = useState<RuleProfileRow[]>([]);
  const [ruleProfilesLoading, setRuleProfilesLoading] = useState(false);
  const [ruleProfilesError, setRuleProfilesError] = useState('');
  const [ruleProfilesMessage, setRuleProfilesMessage] = useState('');

  useLayoutEffect(() => {
    identityKeyRef.current = identityKey;
    detailsRequestIdRef.current += 1;
    setShifts([]);
    setPeriods([]);
    setCoverage([]);
    setOutbox([]);
    setUsingCache(false);
    setCachedAt(undefined);
    setLoadError('');
    setCacheWarning('');
    setActionError('');
    setActionMessage('');
    setSelectedPeriodId('');
    setFilterSiteId('');
    setFilterClientId('');
    setFilterEmployeeId('');
    setFilterStatus('');
    setSearch('');
    setEditor(null);
    setForm(defaultForm(localDate(new Date())));
    setSaving(false);
    setPeriodFormOpen(false);
    setPeriodForm({
      name: '',
      dateFrom: range.from,
      dateTo: range.to,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
    });
    setTemplateOpen(false);
    setTemplates([]);
    setTemplatesLoading(false);
    setSelectedTemplateId('');
    setShowInactiveTemplates(false);
    setTemplateEditingId('');
    setTemplateEditForm(null);
    setTemplateForm({
      name: '',
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: [1, 2, 3, 4, 5],
      siteId: '',
      startTime: '',
      endTime: '',
      breakMinutes: 0,
      requiredStaffCount: 1,
      effectiveFrom: '',
      effectiveUntil: '',
      requiredQualification: ''
    });
    setDetailsShift(null);
    setStaffingSuggestions(null);
    setActualCurrent(null);
    setActualHistory([]);
    setActualLoading(false);
    setAssignments([]);
    setFindings([]);
    setSwaps([]);
    setShiftCoverRequests([]);
    setDetailsLoading(false);
    setAssignmentEmployeeId('');
    setSwapEmployeeId('');
    setSwapReason('');
    setCoverEmployeeId('');
    setCoverReason('');
    setCoverDecisionEmployeeIds({});
    setCoverRequestMutationIds({});
    setCoverDecisionMutationIds({});
    setCoverListOpen(false);
    setAllCoverRequests([]);
    setCoverListLoading(false);
    setActualForm({
      employeeId: '',
      actualStartAt: '',
      actualEndAt: '',
      breakMinutes: 0,
      expectedVersion: 0,
      notes: ''
    });
    setActualSavedRevision(null);
    setActualMutationIds({});
    setPlanningNotifications([]);
    setPlanningNotificationsOpen(false);
    setPlanningNotificationsLoading(false);
    setReportOpen(false);
    setWorkHours([]);
    setReportCoverage([]);
    setReportQualifications([]);
    setReportAbsences([]);
    setReportLoading(false);
    setRuleProfilesOpen(false);
    setRuleProfiles([]);
    setRuleProfilesLoading(false);
    setRuleProfilesError('');
    setRuleProfilesMessage('');
  }, [identityKey]);

  const loadOutbox = useCallback(async () => {
    const items = await offlineVault.getOutbox(currentTenantId, 'shift');
    const userItems = items.filter(item => item.userId === currentUserId);
    if (identityKeyRef.current === identityKey) setOutbox(userItems);
    return userItems;
  }, [currentTenantId, currentUserId, identityKey]);

  const refresh = useCallback(async () => {
    const requestIdentity = identityKey;
    if (!canRead) {
      setLoadError('Für die Dienstplanung fehlt die Berechtigung „planning:read“.');
      setShifts([]);
      setPeriods([]);
      return;
    }
    setLoading(true);
    setLoadError('');
    setCacheWarning('');
    try {
      let rawShifts: Record<string, any>[];
      let loadedPeriods: SchedulePeriod[];
      let cacheIsActive = !isOnline;
      if (isOnline) {
        [rawShifts, loadedPeriods] = await Promise.all([
          planningApi.listShifts(range.from, range.to),
          planningApi.listPeriods()
        ]);
        if (!isCurrentIdentity(requestIdentity)) return;
        if (canReport) {
          try {
            const report = await planningApi.coverage(range.from, range.to);
            if (!isCurrentIdentity(requestIdentity)) return;
            setCoverage(report);
          } catch (error) {
            if (!isCurrentIdentity(requestIdentity)) return;
            setCoverage([]);
            setCacheWarning(`Besetzungsbedarf konnte über coverage nicht geladen werden: ${error instanceof Error ? error.message : 'unbekannter Fehler'}`);
          }
        } else {
          setCoverage([]);
        }
        const mapped = rawShifts.map(row => mapPlanningShift(row, currentTenantId, employees));
        try {
          await offlineVault.savePlanningCache(currentTenantId, currentUserId, mapped, loadedPeriods, range);
          if (!isCurrentIdentity(requestIdentity)) return;
          setCachedAt(new Date().toISOString());
        } catch (error) {
          if (!isCurrentIdentity(requestIdentity)) return;
          setCacheWarning(`Der Onlineplan ist geladen, konnte aber nicht offline gespeichert werden: ${error instanceof Error ? error.message : 'Speicherfehler'}`);
        }
        if (!isCurrentIdentity(requestIdentity)) return;
        setPeriods(loadedPeriods);
        setUsingCache(false);
      } else {
        const cached = await offlineVault.getPlanningCache(currentTenantId, currentUserId);
        if (!isCurrentIdentity(requestIdentity)) return;
        if (!cached) throw new Error('Für diesen Benutzer und Mandanten ist noch kein Dienstplancache vorhanden.');
        rawShifts = cached.shifts;
        loadedPeriods = cached.periods;
        setPeriods(loadedPeriods);
        setCachedAt(cached.cachedAt);
        setCacheWarning(planningCacheRangeWarning(cached, range));
        setUsingCache(true);
        cacheIsActive = true;
      }

      const queued = await loadOutbox();
      if (!isCurrentIdentity(requestIdentity)) return;
      const mapped = rawShifts.map(row =>
        'planningStatus' in row ? row as PlanningShift : mapPlanningShift(row, currentTenantId, employees)
      );
      const cachedRangeShifts = mapped.filter(shift => shift.date >= range.from && shift.date <= range.to);
      const merged = mergeOutboxShifts(cachedRangeShifts, queued, currentTenantId, employees, sites);
      setShifts(merged);
      setUsingCache(cacheIsActive);
      useSecurityStore.setState(state => ({
        shifts: [
          ...state.shifts.filter(shift => shift.tenantId !== currentTenantId || shift.date < range.from || shift.date > range.to),
          ...merged
        ]
      }));
      if (!selectedPeriodId || !loadedPeriods.some(period => period.id === selectedPeriodId)) {
        const activePeriod = loadedPeriods.find(period => period.status === 'draft' &&
          period.date_from <= range.to && period.date_to >= range.from);
        setSelectedPeriodId(activePeriod?.id ?? '');
      }
      setLoadError('');
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      if (isOnline) {
        try {
          const cached = await offlineVault.getPlanningCache(currentTenantId, currentUserId);
          if (!isCurrentIdentity(requestIdentity)) return;
          if (cached) {
            const mapped = cached.shifts.map(row =>
              'planningStatus' in row ? row as PlanningShift : mapPlanningShift(row, currentTenantId, employees)
            ).filter(shift => shift.date >= range.from && shift.date <= range.to);
            const queued = await loadOutbox();
            if (!isCurrentIdentity(requestIdentity)) return;
            setShifts(mergeOutboxShifts(mapped, queued, currentTenantId, employees, sites));
            setPeriods(cached.periods);
            setCachedAt(cached.cachedAt);
            setCacheWarning(planningCacheRangeWarning(cached, range));
            setUsingCache(true);
            setLoadError(`Serverdaten konnten nicht aktualisiert werden. Offline-Cache vom ${new Date(cached.cachedAt).toLocaleString()} wird angezeigt.`);
          } else {
            setLoadError(error instanceof Error ? error.message : 'Dienstplandaten konnten nicht geladen werden.');
          }
        } catch (cacheError) {
          if (!isCurrentIdentity(requestIdentity)) return;
          setLoadError(`${error instanceof Error ? error.message : 'Dienstplandaten konnten nicht geladen werden.'} Offline-Cache: ${cacheError instanceof Error ? cacheError.message : 'Lesefehler'}`);
        }
      } else {
        setLoadError(error instanceof Error ? error.message : 'Dienstplan-Cache konnte nicht geladen werden.');
      }
    } finally {
      if (isCurrentIdentity(requestIdentity)) setLoading(false);
    }
  }, [canRead, canReport, currentTenantId, currentUserId, employees, identityKey, isOnline, loadOutbox, range.from, range.to, selectedPeriodId, sites]);

  useEffect(() => {
    void refresh();
  }, [refresh, lastSyncTime]);

  useEffect(() => {
    if (!isOnline) setRuleProfiles([]);
  }, [isOnline]);

  const loadRuleProfiles = async () => {
    const requestIdentity = identityKey;
    if (!canRead) return;
    if (!isOnline) {
      setRuleProfilesError('Regelprofile werden aus Sicherheitsgründen nicht offline gespeichert oder freigegeben.');
      return;
    }
    setRuleProfilesLoading(true);
    setRuleProfilesError('');
    try {
      const profiles = await planningApi.listRuleProfiles();
      if (!isCurrentIdentity(requestIdentity)) return;
      setRuleProfiles(profiles);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      setRuleProfilesError(planningErrorDetails(error).message);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setRuleProfilesLoading(false);
    }
  };

  const saveRuleProfile = async (input: RuleProfileInput, profileId?: string): Promise<boolean> => {
    if (!canManageRules || !isOnline) return false;
    setRuleProfilesError('');
    setRuleProfilesMessage('');
    try {
      if (profileId) {
        const { name: _name, scope: _scope, ...version } = input;
        await planningApi.createRuleProfileVersion(profileId, version);
        setRuleProfilesMessage('Neue Regelprofilrevision als Entwurf gespeichert. Sie ist noch nicht freigegeben.');
      } else {
        await planningApi.createRuleProfile(input);
        setRuleProfilesMessage('Regelprofil und erste Entwurfsrevision gespeichert. Die Revision ist noch nicht freigegeben.');
      }
      await loadRuleProfiles();
      return true;
    } catch (error) {
      const detail = planningErrorDetails(error);
      setRuleProfilesError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
      return false;
    }
  };

  const approveRuleProfileVersion = async (profile: RuleProfileRow, versionId: string): Promise<boolean> => {
    if (!canApproveRules || !isOnline) return false;
    if (!window.confirm(`Regelprofil „${profile.name}“ Revision freigeben? Nur nach fachlicher Prüfung der Quelle und Werte bestätigen.`)) return false;
    setRuleProfilesError('');
    setRuleProfilesMessage('');
    try {
      await planningApi.approveRuleProfileVersion(profile.id, versionId);
      setRuleProfilesMessage('Regelprofilrevision serverseitig freigegeben.');
      await loadRuleProfiles();
      return true;
    } catch (error) {
      const detail = planningErrorDetails(error);
      setRuleProfilesError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
      return false;
    }
  };

  const setRuleProfileActive = async (profile: RuleProfileRow): Promise<boolean> => {
    if (!canManageRules || !isOnline) return false;
    setRuleProfilesError('');
    setRuleProfilesMessage('');
    try {
      await planningApi.setRuleProfileActive(profile.id, !profile.active);
      setRuleProfilesMessage(`Regelprofil ${profile.active ? 'deaktiviert' : 'aktiviert'}.`);
      await loadRuleProfiles();
      return true;
    } catch (error) {
      const detail = planningErrorDetails(error);
      setRuleProfilesError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
      return false;
    }
  };

  const openRuleProfiles = () => {
    setRuleProfilesOpen(true);
    setRuleProfilesError('');
    setRuleProfilesMessage('');
    void loadRuleProfiles();
  };

  const activePeriod = periods.find(period => period.id === selectedPeriodId);
  const coverageByShift = useMemo(() => new Map(coverage.map(row => [row.shift_id, row])), [coverage]);
  const filteredShifts = useMemo(() => shifts.filter(shift => {
    if (filterSiteId && shift.siteId !== filterSiteId) return false;
    if (selectedPeriodId && shift.schedulePeriodId !== selectedPeriodId) return false;
    const site = sites.find(item => item.id === shift.siteId);
    if (filterClientId && site?.clientId !== filterClientId) return false;
    if (filterEmployeeId && shift.employeeId !== filterEmployeeId) return false;
    if (filterStatus && shift.planningStatus !== filterStatus) return false;
    if (search) {
      const haystack = `${shift.siteName} ${site?.clientName ?? ''} ${shift.employeeName ?? ''} ${shift.requiredQualification} ${shift.type}`.toLocaleLowerCase();
      if (!haystack.includes(search.toLocaleLowerCase())) return false;
    }
    return true;
  }), [filterClientId, filterEmployeeId, filterSiteId, filterStatus, search, selectedPeriodId, shifts, sites]);

  const openEditor = (mode: 'create' | 'edit', shift?: PlanningShift) => {
    setActionError('');
    setActionMessage('');
    setForm({
      ...defaultForm(shift?.date ?? anchorDate, sites[0], shift),
      schedulePeriodId: mode === 'create' && !isOnline ? '' : shift?.schedulePeriodId ?? (mode === 'create' ? selectedPeriodId : '')
    });
    setEditor({ mode, shift });
  };

  const handleSaveShift = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !editor) return;
    const requestIdentity = identityKey;
    setSaving(true);
    setActionError('');
    setActionMessage('');
    const repeatCount = editor.mode === 'create' ? Math.min(31, Math.max(1, form.repeatCount)) : 1;
    try {
      if (!form.siteId) throw new Error('Bitte ein Objekt auswählen.');
      if (editor.mode === 'edit' && editor.shift?.planningStatus === 'published') {
        throw new Error('Veröffentlichte Schichten können nicht direkt geändert werden. Verwenden Sie den Diensttausch.');
      }

      if (!isOnline) {
        if (!permissions.includes('shifts:manage')) {
          throw new Error('Offline-Entwürfe benötigen zusätzlich die Sync-Berechtigung „shifts:manage“.');
        }
        const mutationId = crypto.randomUUID();
        if (editor.mode === 'edit') {
          const shift = editor.shift;
          if (!shift) throw new Error('Die zu bearbeitende Schicht fehlt.');
          if (shift.syncStatus && shift.syncStatus !== 'synced') {
            throw new Error('Diese Schicht hat eine ausstehende oder fehlgeschlagene Synchronisierung. Bitte erst online abgleichen.');
          }
          if (form.schedulePeriodId !== (shift.schedulePeriodId ?? '') ||
              form.requiredStaffCount !== (shift.requiredStaffCount ?? 1) ||
              repeatCount !== 1) {
            throw new Error('Offline können Periodenzuordnung und Mindestbesetzung nicht geändert werden.');
          }
          const payload = {
            id: shift.id,
            siteId: form.siteId,
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            type: form.type,
            requiredQualification: form.requiredQualification,
            breakMinutes: form.breakMinutes
          };
          await store.enqueueOfflineAction({
            id: mutationId,
            tenantId: currentTenantId,
            entityType: 'shift',
            action: 'UPDATE',
            payload,
            baseVersion: shift.revisionVersion ?? 1
          });
          if (!isCurrentIdentity(requestIdentity)) return;
          const updatedShift: PlanningShift = {
            ...shift,
            siteId: form.siteId,
            siteName: sites.find(item => item.id === form.siteId)?.name ?? shift.siteName,
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            type: form.type,
            requiredQualification: form.requiredQualification,
            breakMinutes: form.breakMinutes,
            planningStatus: 'draft',
            syncStatus: 'pending'
          };
          setShifts(current => current.map(item => item.id === shift.id ? updatedShift : item));
          useSecurityStore.setState(state => ({
            shifts: state.shifts.map(item => item.id === shift.id ? updatedShift : item)
          }));
          await loadOutbox();
          if (!isCurrentIdentity(requestIdentity)) return;
          setActionMessage('Änderung lokal vorgemerkt. Sie ist noch nicht servergeprüft oder veröffentlicht.');
          setEditor(null);
          return;
        }
        if (form.employeeId || form.schedulePeriodId || form.requiredStaffCount !== 1 || repeatCount !== 1) {
          throw new Error('Offline sind nur einzelne, unbesetzte Entwürfe ohne Periodenbindung mit Mindestbesetzung 1 unterstützt.');
        }
        const payload = {
          siteId: form.siteId,
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          type: form.type,
          status: 'Offen',
          requiredQualification: form.requiredQualification,
          breakMinutes: form.breakMinutes
        };
        await store.enqueueOfflineAction({
          id: mutationId,
          tenantId: currentTenantId,
          entityType: 'shift',
          action: 'CREATE',
          payload,
          baseVersion: 1
        });
        if (!isCurrentIdentity(requestIdentity)) return;
        const site = sites.find(item => item.id === form.siteId);
        const localShift: PlanningShift = {
          id: mutationId,
          tenantId: currentTenantId,
          siteId: form.siteId,
          siteName: site?.name ?? '',
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          type: form.type,
          status: 'Offen',
          requiredQualification: form.requiredQualification,
          revisionVersion: 1,
          planningStatus: 'draft',
          assignedCount: 0,
          requiredStaffCount: 1,
          breakMinutes: form.breakMinutes,
          syncStatus: 'pending'
        };
        setShifts(current => [...current.filter(shift => shift.id !== mutationId), localShift]);
        useSecurityStore.setState(state => ({ shifts: [localShift, ...state.shifts] }));
        await loadOutbox();
        if (!isCurrentIdentity(requestIdentity)) return;
        setActionMessage('Entwurf lokal vorgemerkt. Noch nicht servergeprüft, zugewiesen oder veröffentlicht.');
        setEditor(null);
        return;
      }

      if (editor.mode === 'create') {
        const created: PlanningShift[] = [];
        for (let index = 0; index < repeatCount; index += 1) {
          const date = addDays(form.date, index * Math.max(1, form.repeatEveryDays));
          const result = await planningApi.createShift({
            ...toShiftFormPayload(form),
            date,
            requiredStaffCount: form.requiredStaffCount,
            schedulePeriodId: form.schedulePeriodId || undefined,
            employeeId: form.employeeId || undefined,
            clientMutationId: crypto.randomUUID()
          });
          if (!isCurrentIdentity(requestIdentity)) return;
          const mapped = mapPlanningShift(result.shift, currentTenantId, employees);
          const site = sites.find(item => item.id === mapped.siteId);
          created.push({ ...mapped, siteName: site?.name ?? mapped.siteName });
        }
        setShifts(current => [...created, ...current]);
        useSecurityStore.setState(state => ({ shifts: [...created, ...state.shifts] }));
        setActionMessage(`${created.length} Entwurf/Entwürfe wurden serverseitig angelegt. Eine Veröffentlichung ist noch nicht erfolgt.`);
      } else if (editor.shift) {
        const result = await planningApi.updateShift(editor.shift.id, {
          ...toShiftFormPayload(form),
          revisionVersion: editor.shift.revisionVersion ?? 1
        });
        if (!isCurrentIdentity(requestIdentity)) return;
        const updated = mapPlanningShift(result.shift, currentTenantId, employees);
        setShifts(current => current.map(shift => shift.id === updated.id ? updated : shift));
        useSecurityStore.setState(state => ({ shifts: state.shifts.map(shift => shift.id === updated.id ? updated : shift) }));
        setActionMessage('Schicht als Entwurf aktualisiert; sie wurde nicht veröffentlicht.');
      }
      setEditor(null);
      void refresh();
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setFindings(detail.findings);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setSaving(false);
    }
  };

  const deleteShift = async (shift: PlanningShift) => {
    if (!canManage || !isOnline || shift.planningStatus === 'published') return;
    const requestIdentity = identityKey;
    if (!window.confirm(`Schicht ${shift.date} ${shift.startTime}–${shift.endTime} endgültig löschen?`)) return;
    setActionError('');
    try {
      await planningApi.deleteShift(shift.id, shift.revisionVersion ?? 1);
      if (!isCurrentIdentity(requestIdentity)) return;
      setShifts(current => current.filter(item => item.id !== shift.id));
      useSecurityStore.setState(state => ({ shifts: state.shifts.filter(item => item.id !== shift.id) }));
      setActionMessage('Schicht wurde gelöscht.');
      void refresh();
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    }
  };

  const createPeriod = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !isOnline) return;
    const requestIdentity = identityKey;
    setSaving(true);
    setActionError('');
    try {
      const period = await planningApi.createPeriod(periodForm);
      if (!isCurrentIdentity(requestIdentity)) return;
      setPeriods(current => [period, ...current]);
      setSelectedPeriodId(period.id);
      setPeriodFormOpen(false);
      setActionMessage('Dienstplanperiode als Entwurf angelegt.');
      void refresh();
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionError(planningErrorDetails(error).message);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setSaving(false);
    }
  };

  const publishPeriod = async () => {
    if (!canPublish || !activePeriod || !isOnline) return;
    const requestIdentity = identityKey;
    if (!window.confirm(`Periode „${activePeriod.name}“ serverseitig neu prüfen und veröffentlichen? Die Veröffentlichung ist verbindlich und nicht offline verfügbar.`)) return;
    setActionError('');
    setFindings([]);
    setSaving(true);
    try {
      await planningApi.publishPeriod(activePeriod.id, activePeriod.revision_version);
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionMessage('Periode wurde serverseitig validiert und veröffentlicht.');
      await refresh();
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
      setFindings(detail.findings);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setSaving(false);
    }
  };

  const loadTemplates = async (includeInactive = showInactiveTemplates) => {
    const requestIdentity = identityKey;
    if (!canRead || !isOnline) {
      setTemplates([]);
      return;
    }
    setTemplatesLoading(true);
    setActionError('');
    try {
      const rows = await planningApi.listTemplates(undefined, includeInactive);
      if (!isCurrentIdentity(requestIdentity)) return;
      setTemplates(rows);
      setSelectedTemplateId(current => current && rows.some(template => template.id === current)
        ? current : rows[0]?.id ?? '');
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionError(planningErrorDetails(error).message);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setTemplatesLoading(false);
    }
  };

  const beginTemplateEdit = (template: ShiftTemplate) => {
    setTemplateEditingId(template.id);
    setTemplateEditForm({
      siteId: template.site_id,
      name: template.name,
      startTime: template.local_start_time.slice(0, 5),
      endTime: template.local_end_time.slice(0, 5),
      breakMinutes: template.break_minutes,
      requiredStaffCount: template.required_staff_count,
      effectiveFrom: template.effective_from?.slice(0, 10) ?? '',
      effectiveUntil: template.effective_until?.slice(0, 10) ?? '',
      requiredQualification: template.required_qualification,
      frequency: template.recurrence.frequency,
      interval: template.recurrence.interval,
      weekdays: template.recurrence.weekdays ?? []
    });
  };

  const saveTemplateEdit = async (event: FormEvent, template: ShiftTemplate) => {
    event.preventDefault();
    if (!templateEditForm || !canManage || !isOnline) return;
    if (templateEditForm.frequency === 'WEEKLY' && templateEditForm.weekdays.length === 0) {
      setActionError('Wöchentliche Vorlagen benötigen mindestens einen Wochentag.');
      return;
    }
    const requestIdentity = identityKey;
    setSaving(true);
    setActionError('');
    try {
      await planningApi.updateTemplate(template.id, {
        expectedVersion: template.revision_version,
        ...templateEditForm,
        effectiveFrom: templateEditForm.effectiveFrom || null,
        effectiveUntil: templateEditForm.effectiveUntil || null,
        weekdays: templateEditForm.frequency === 'WEEKLY' ? templateEditForm.weekdays : undefined
      });
      if (!isCurrentIdentity(requestIdentity)) return;
      setTemplateEditingId('');
      setTemplateEditForm(null);
      setActionMessage('Vorlage mit ihrer aktuellen Revision gespeichert.');
      await loadTemplates(showInactiveTemplates);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setSaving(false);
    }
  };

  const toggleTemplateActive = async (template: ShiftTemplate) => {
    if (!canManage || !isOnline) return;
    const requestIdentity = identityKey;
    setSaving(true);
    setActionError('');
    try {
      await planningApi.updateTemplate(template.id, {
        expectedVersion: template.revision_version,
        active: !template.active
      });
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionMessage(`Vorlage ${template.active ? 'deaktiviert' : 'aktiviert'}.`);
      await loadTemplates(showInactiveTemplates);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setSaving(false);
    }
  };

  const createTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !isOnline || !templateForm.siteId) return;
    const requestIdentity = identityKey;
    if (templateForm.frequency === 'WEEKLY' && templateForm.weekdays.length === 0) {
      setActionError('Wöchentliche Vorlagen benötigen mindestens einen Wochentag.');
      return;
    }
    setSaving(true);
    setActionError('');
    try {
      await planningApi.createTemplate({
        siteId: templateForm.siteId,
        name: templateForm.name,
        startTime: templateForm.startTime,
        endTime: templateForm.endTime,
        breakMinutes: templateForm.breakMinutes,
        requiredStaffCount: templateForm.requiredStaffCount,
        effectiveFrom: templateForm.effectiveFrom || undefined,
        effectiveUntil: templateForm.effectiveUntil || undefined,
        requiredQualification: templateForm.requiredQualification,
        frequency: templateForm.frequency,
        interval: templateForm.interval,
        weekdays: templateForm.frequency === 'WEEKLY' ? templateForm.weekdays : undefined
      });
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionMessage('Vorlage serverseitig erstellt. Wählen Sie eine Vorlage aus der Liste aus, um sie auf eine Entwurfsperiode anzuwenden.');
      await loadTemplates(showInactiveTemplates);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setSaving(false);
    }
  };

  const applyTemplateById = async (templateId: string) => {
    if (!canManage || !isOnline || !activePeriod || !templateId) return;
    const requestIdentity = identityKey;
    setSaving(true);
    setActionError('');
    try {
      const applied = await planningApi.applyTemplate(templateId, {
        dateFrom: activePeriod.date_from.slice(0, 10),
        dateTo: activePeriod.date_to.slice(0, 10),
        schedulePeriodId: activePeriod.id
      });
      if (!isCurrentIdentity(requestIdentity)) return;
      const created = applied.occurrences.filter(item => item.shiftId).length;
      const rejected = applied.occurrences.filter(item => item.status === 'REJECTED').length;
      setActionMessage(`${created} Schichtentwurf/Entwürfe erstellt; ${rejected} Vorkommen serverseitig abgelehnt. Die endgültige Prüfung bleibt der Veröffentlichung vorbehalten.`);
      await refresh();
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setSaving(false);
    }
  };

  const loadActualTimeForEmployee = async (shiftId: string, employeeId: string, requestId: number) => {
    if (!employeeId) {
      setActualCurrent(null);
      setActualHistory([]);
      setActualLoading(false);
      return;
    }
    const requestIdentity = identityKey;
    setActualLoading(true);
    try {
      const result = await planningApi.getActualTime(shiftId, employeeId);
      if (!isCurrentIdentity(requestIdentity) || detailsRequestIdRef.current !== requestId) return;
      setActualCurrent(result.current);
      setActualHistory(result.history);
      setActualForm(current => ({
        ...current,
        employeeId,
        actualStartAt: result.current?.actual_start_at ?? '',
        actualEndAt: result.current?.actual_end_at ?? '',
        breakMinutes: result.current?.break_minutes ?? current.breakMinutes,
        expectedVersion: result.current?.revision_version ?? 0,
        notes: result.current?.notes ?? ''
      }));
      setActualSavedRevision(result.current?.revision_version ?? null);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity) || detailsRequestIdRef.current !== requestId) return;
      setActionError(planningErrorDetails(error).message);
    } finally {
      if (isCurrentIdentity(requestIdentity) && detailsRequestIdRef.current === requestId) setActualLoading(false);
    }
  };

  const openDetails = async (shift: PlanningShift) => {
    const requestIdentity = identityKey;
    const detailsRequestId = ++detailsRequestIdRef.current;
    setDetailsShift(shift);
    setStaffingSuggestions(null);
    setActualCurrent(null);
    setActualHistory([]);
    setActualLoading(false);
    setAssignments([]);
    setFindings([]);
    setSwaps([]);
    setShiftCoverRequests([]);
    setAssignmentEmployeeId('');
    setSwapEmployeeId('');
    setCoverEmployeeId('');
    setCoverReason('');
    setActualSavedRevision(null);
    setActualForm({
      employeeId: shift.employeeId ?? '',
      actualStartAt: '',
      actualEndAt: '',
      breakMinutes: shift.breakMinutes,
      expectedVersion: 0,
      notes: ''
    });
    setActionError('');
    setActionMessage('');
    setDetailsLoading(true);
    try {
      if (shift.syncStatus === 'pending' || !isOnline) {
        setActionMessage('Lokaler Entwurf: Serverzuweisungen und Regelbefunde sind offline nicht verfügbar.');
        return;
      }
      const [assignmentRows, findingRows, swapRows, coverRows, suggestions] = await Promise.all([
        planningApi.listAssignments(shift.id),
        planningApi.listFindings(shift.id),
        planningApi.listSwaps(),
        planningApi.coverRequests(undefined, shift.id),
        planningApi.staffingSuggestions(shift.id)
      ]);
      if (!isCurrentIdentity(requestIdentity) || detailsRequestIdRef.current !== detailsRequestId) return;
      setAssignments(assignmentRows);
      const currentActualEmployee = assignmentRows.some(item =>
        item.status === 'assigned' && item.employee_id === shift.employeeId
      ) ? shift.employeeId : assignmentRows.find(item => item.status === 'assigned')?.employee_id ?? '';
      setActualForm(current => ({ ...current, employeeId: currentActualEmployee }));
      setFindings(findingRows);
      setSwaps(swapRows.filter(item => item.shift_id === shift.id));
      setShiftCoverRequests(coverRows);
      setStaffingSuggestions(suggestions);
      await loadActualTimeForEmployee(shift.id, currentActualEmployee, detailsRequestId);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity) || detailsRequestIdRef.current !== detailsRequestId) return;
      setActionError(planningErrorDetails(error).message);
    } finally {
      if (isCurrentIdentity(requestIdentity) && detailsRequestIdRef.current === detailsRequestId) setDetailsLoading(false);
    }
  };

  const assignEmployee = async (employeeId: string) => {
    if (!detailsShift || !canManage || !isOnline) return;
    const requestIdentity = identityKey;
    setActionError('');
    setFindings([]);
    try {
      const result = await planningApi.assignEmployee(detailsShift.id, employeeId, detailsShift.revisionVersion ?? 1);
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionMessage('Zuweisung serverseitig geprüft und gespeichert.');
      await openDetails({ ...detailsShift, revisionVersion: result.revisionVersion });
      await refresh();
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
      setFindings(detail.findings);
    }
  };

  const requestSwap = async (event: FormEvent) => {
    event.preventDefault();
    if (!detailsShift || !canRequestSwap || !isOnline || !swapEmployeeId) return;
    const requestIdentity = identityKey;
    const requesterId = detailsShift.employeeId || assignments.find(item => item.status === 'assigned')?.employee_id;
    if (!requesterId) {
      setActionError('Ein Diensttausch setzt eine bestehende Zuweisung voraus.');
      return;
    }
    try {
      await planningApi.createSwap(detailsShift.id, {
        requesterEmployeeId: requesterId,
        proposedEmployeeId: swapEmployeeId,
        expectedShiftVersion: detailsShift.revisionVersion ?? 1,
        reason: swapReason
      });
      if (!isCurrentIdentity(requestIdentity)) return;
      setSwapReason('');
      setSwapEmployeeId('');
      setActionMessage('Diensttausch wurde zur Entscheidung eingereicht.');
      await openDetails(detailsShift);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
      setFindings(detail.findings);
    }
  };

  const decideSwap = async (swap: ShiftSwap, decision: 'approved' | 'rejected') => {
    if (!canDecideSwap || !isOnline) return;
    const requestIdentity = identityKey;
    if (!window.confirm(`Diensttausch ${decision === 'approved' ? 'genehmigen' : 'ablehnen'}?`)) return;
    try {
      await planningApi.decideSwap(swap.id, { decision, expectedVersion: swap.revision_version });
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionMessage(`Diensttausch ${decision === 'approved' ? 'genehmigt' : 'abgelehnt'}.`);
      if (detailsShift) await openDetails(detailsShift);
      await refresh();
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
      setFindings(detail.findings);
    }
  };

  const requestCover = async (event: FormEvent) => {
    event.preventDefault();
    if (!detailsShift || !canRequestCover || !isOnline) return;
    const requestIdentity = identityKey;
    const shiftId = detailsShift.id;
    setActionError('');
    try {
      const mutationId = coverRequestMutationIds[shiftId] ?? newClientMutationId();
      setCoverRequestMutationIds(current => ({ ...current, [shiftId]: mutationId }));
      await planningApi.createCoverRequest(shiftId, {
        requestedEmployeeId: coverEmployeeId || undefined,
        expectedShiftVersion: detailsShift.revisionVersion ?? 1,
        clientMutationId: mutationId,
        reason: coverReason.trim()
      });
      if (!isCurrentIdentity(requestIdentity)) return;
      setCoverRequestMutationIds(current => {
        const next = { ...current };
        delete next[shiftId];
        return next;
      });
      setCoverEmployeeId('');
      setCoverReason('');
      setActionMessage('Vertretungsbedarf wurde serverseitig eingereicht.');
      await openDetails(detailsShift);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      if (!(error instanceof ApiError) || !error.isNetworkError) {
        setCoverRequestMutationIds(current => {
          const next = { ...current };
          delete next[shiftId];
          return next;
        });
      }
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    }
  };

  const decideCover = async (request: CoverRequest, decision: 'approved' | 'rejected') => {
    if (!canDecideCover || !isOnline) return;
    const requestIdentity = identityKey;
    const employeeId = request.requested_employee_id ?? coverDecisionEmployeeIds[request.id];
    if (decision === 'approved' && !employeeId) {
      setActionError('Für die Genehmigung muss eine Vertretung ausgewählt werden.');
      return;
    }
    setActionError('');
    try {
      const mutationId = coverDecisionMutationIds[request.id] ?? newClientMutationId();
      setCoverDecisionMutationIds(current => ({ ...current, [request.id]: mutationId }));
      await planningApi.decideCoverRequest(request.id, {
        decision,
        expectedVersion: request.revision_version,
        employeeId: decision === 'approved' ? employeeId : undefined,
        clientMutationId: mutationId
      });
      if (!isCurrentIdentity(requestIdentity)) return;
      setCoverDecisionMutationIds(current => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      setActionMessage(`Vertretungsantrag ${decision === 'approved' ? 'genehmigt' : 'abgelehnt'}.`);
      const refreshed = await planningApi.coverRequests();
      if (!isCurrentIdentity(requestIdentity)) return;
      setAllCoverRequests(refreshed);
      if (detailsShift?.id === request.shift_id) await openDetails(detailsShift);
      await refresh();
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      if (!(error instanceof ApiError) || !error.isNetworkError) {
        setCoverDecisionMutationIds(current => {
          const next = { ...current };
          delete next[request.id];
          return next;
        });
      }
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    }
  };

  const loadCoverRequests = async () => {
    const requestIdentity = identityKey;
    if (!canRead || !isOnline) return;
    setCoverListLoading(true);
    setActionError('');
    try {
      const requests = await planningApi.coverRequests();
      if (!isCurrentIdentity(requestIdentity)) return;
      setAllCoverRequests(requests);
      setCoverListOpen(true);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionError(planningErrorDetails(error).message);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setCoverListLoading(false);
    }
  };

  const recordActualTime = async (event: FormEvent) => {
    event.preventDefault();
    if (!detailsShift || !canManageActuals || !isOnline) return;
    const requestIdentity = identityKey;
    const detailsRequestId = detailsRequestIdRef.current;
    const shiftId = detailsShift.id;
    const employeeId = actualForm.employeeId;
    setActionError('');
    try {
      const actualKey = `${shiftId}:${employeeId}`;
      const mutationId = actualMutationIds[actualKey] ?? newClientMutationId();
      setActualMutationIds(current => ({ ...current, [actualKey]: mutationId }));
      const saved = await planningApi.recordActualTime(shiftId, {
        employeeId,
        actualStartAt: actualForm.actualStartAt,
        actualEndAt: actualForm.actualEndAt,
        breakMinutes: actualForm.breakMinutes,
        expectedVersion: actualForm.expectedVersion,
        clientMutationId: mutationId,
        notes: actualForm.notes.trim() || undefined
      });
      if (!isCurrentIdentity(requestIdentity) || detailsRequestIdRef.current !== detailsRequestId) return;
      setActualSavedRevision(saved.revision_version);
      setActualMutationIds(current => {
        const next = { ...current };
        delete next[actualKey];
        return next;
      });
      setActualForm(current => ({ ...current, expectedVersion: saved.revision_version }));
      await loadActualTimeForEmployee(shiftId, employeeId, detailsRequestId);
      if (isCurrentIdentity(requestIdentity) && detailsRequestIdRef.current === detailsRequestId) {
        setActionMessage(`Ist-Zeit gespeichert (Revision ${saved.revision_version}). Weitere Korrekturen verwenden die geladene Serverrevision.`);
      }
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity) || detailsRequestIdRef.current !== detailsRequestId) return;
      if (!(error instanceof ApiError) || !error.isNetworkError) {
        const actualKey = `${shiftId}:${employeeId}`;
        setActualMutationIds(current => {
          const next = { ...current };
          delete next[actualKey];
          return next;
        });
      }
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    }
  };

  const approveActualTime = async () => {
    if (!detailsShift || !actualCurrent || !canApproveActuals || !isOnline ||
        actualCurrent.approval_status !== 'pending' || actualCurrent.recorded_by === currentUserId) return;
    const requestIdentity = identityKey;
    const detailsRequestId = detailsRequestIdRef.current;
    try {
      const approved = await planningApi.approveActualTime(detailsShift.id, {
        employeeId: actualCurrent.employee_id,
        expectedVersion: actualCurrent.revision_version
      });
      if (!isCurrentIdentity(requestIdentity) || detailsRequestIdRef.current !== detailsRequestId) return;
      setActualCurrent(approved);
      await loadActualTimeForEmployee(detailsShift.id, approved.employee_id, detailsRequestId);
      if (isCurrentIdentity(requestIdentity) && detailsRequestIdRef.current === detailsRequestId) {
        setActionMessage(`Ist-Zeit-Revision ${approved.revision_version} unabhängig genehmigt.`);
      }
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity) || detailsRequestIdRef.current !== detailsRequestId) return;
      const detail = planningErrorDetails(error);
      setActionError(`${detail.code ? `${detail.code}: ` : ''}${detail.message}`);
    }
  };

  const loadPlanningNotifications = async () => {
    if (!canRead || !isOnline) return;
    const requestIdentity = identityKey;
    setPlanningNotificationsLoading(true);
    setActionError('');
    try {
      const rows = await planningApi.planningNotifications();
      if (!isCurrentIdentity(requestIdentity)) return;
      setPlanningNotifications(rows);
      setPlanningNotificationsOpen(true);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionError(planningErrorDetails(error).message);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setPlanningNotificationsLoading(false);
    }
  };

  const markPlanningNotificationRead = async (notification: PlanningNotification) => {
    if (!isOnline || notification.read_at) return;
    const requestIdentity = identityKey;
    try {
      const updated = await planningApi.markPlanningNotificationRead(notification.id);
      if (!isCurrentIdentity(requestIdentity)) return;
      setPlanningNotifications(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionError(planningErrorDetails(error).message);
    }
  };

  const loadReports = async () => {
    const requestIdentity = identityKey;
    if (!canReport || !isOnline) return;
    setReportLoading(true);
    setActionError('');
    try {
      const [hours, cover, qualifications, absences] = await Promise.all([
        planningApi.workHours(range.from, range.to),
        planningApi.coverage(range.from, range.to),
        planningApi.qualifications(range.from, range.to),
        planningApi.absences(range.from, range.to)
      ]);
      if (!isCurrentIdentity(requestIdentity)) return;
      setWorkHours(hours);
      setReportCoverage(cover);
      setReportQualifications(qualifications);
      setReportAbsences(absences);
      setReportOpen(true);
    } catch (error) {
      if (!isCurrentIdentity(requestIdentity)) return;
      setActionError(planningErrorDetails(error).message);
    } finally {
      if (isCurrentIdentity(requestIdentity)) setReportLoading(false);
    }
  };

  const downloadHoursCsv = async () => {
    if (!canReport || !isOnline) return;
    try {
      const blob = await apiClient.downloadFile(`/planning/reports/work-hours?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&format=csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'planning-work-hours.csv';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setActionError(planningErrorDetails(error).message);
    }
  };

  const groupedShifts = useMemo(() => {
    const groups = new Map<string, PlanningShift[]>();
    for (const shift of filteredShifts) {
      const site = sites.find(item => item.id === shift.siteId);
      const key = groupView === 'employee'
        ? shift.employeeId ? employeeName(shift.employeeId, employees) : 'Nicht zugewiesen'
        : groupView === 'site'
          ? shift.siteName || 'Objekt'
          : groupView === 'customer'
            ? site?.clientName || 'Kunde nicht verfügbar'
            : shift.date;
      groups.set(key, [...(groups.get(key) ?? []), shift]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'de'));
  }, [employees, filteredShifts, groupView, sites]);

  const headerLabel = useMemo(() => {
    const date = new Date(`${anchorDate}T12:00:00`);
    if (view === 'day') return date.toLocaleDateString('de-DE', { dateStyle: 'full' });
    if (view === 'week') return `${new Date(`${range.from}T12:00:00`).toLocaleDateString('de-DE')} – ${new Date(`${range.to}T12:00:00`).toLocaleDateString('de-DE')}`;
    return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  }, [anchorDate, range.from, range.to, view]);

  const calendarDays = useMemo(() => {
    const start = new Date(`${range.from}T12:00:00`);
    const end = new Date(`${range.to}T12:00:00`);
    if (view === 'month') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const days: string[] = [];
    for (const cursor = new Date(start); cursor <= end || (view === 'month' && days.length % 7 !== 0); cursor.setDate(cursor.getDate() + 1)) {
      days.push(localDate(cursor));
      if (view === 'month' && days.length >= 42) break;
    }
    return days;
  }, [range.from, range.to, view]);

  if (!canRead) {
    return (
      <section className="rounded-2xl border border-amber-500/30 bg-slate-900 p-6 text-sm text-amber-200" role="alert">
        Die Dienstplanung ist für dieses Benutzerkonto nicht freigegeben (planning:read).
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="roster-title">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-blue-400" aria-hidden="true" />
            <h1 id="roster-title" className="text-xl font-bold text-white">Dienst- und Einsatzplanung</h1>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-400">
            Entwürfe werden serverseitig geprüft. Eine Veröffentlichung erfolgt nur über die versionierte Dienstplanperiode; Offline-Eingaben sind nicht validiert oder freigegeben.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && <button className={primaryButtonClass} onClick={() => openEditor('create')}><Plus size={14} /> Schicht anlegen</button>}
          {canManage && isOnline && <button className={buttonClass} onClick={() => { setPeriodForm(current => ({ ...current, dateFrom: range.from, dateTo: range.to })); setPeriodFormOpen(open => !open); }}>Periode anlegen</button>}
          {canRead && <button className={buttonClass} disabled={!isOnline || templatesLoading} onClick={() => { setTemplateOpen(open => !open); if (!templateOpen) void loadTemplates(); }}>Vorlagen</button>}
          {canRead && <button className={buttonClass} disabled={!isOnline || coverListLoading} onClick={() => void loadCoverRequests()}>{coverListLoading ? 'Vertretungen…' : 'Vertretungsanträge'}</button>}
          {canRead && <button className={buttonClass} disabled={!isOnline || planningNotificationsLoading} onClick={() => void loadPlanningNotifications()}>
            {planningNotificationsLoading ? <LoaderCircle className="animate-spin" size={14} /> : <Bell size={14} />}
            Benachrichtigungen{planningNotifications.some(item => !item.read_at) ? ` (${planningNotifications.filter(item => !item.read_at).length})` : ''}
          </button>}
          {canPublish && activePeriod?.status === 'draft' && (
            <button className={primaryButtonClass} disabled={!isOnline || saving} onClick={() => void publishPeriod()}>
              <ShieldCheck size={14} /> Veröffentlichen
            </button>
          )}
          {canReport && <button className={buttonClass} disabled={!isOnline || reportLoading} onClick={() => void loadReports()}>
            {reportLoading ? <LoaderCircle className="animate-spin" size={14} /> : <FileText size={14} />} Berichte
          </button>}
          {canRead && <button className={buttonClass} onClick={openRuleProfiles}>Regelprofile</button>}
          {canReport && <button className={buttonClass} disabled={!isOnline} onClick={() => void downloadHoursCsv()}><Download size={14} /> CSV</button>}
          <button className={buttonClass} onClick={() => window.print()}><Printer size={14} /> Drucken</button>
          <button className={buttonClass} disabled={loading} onClick={() => void refresh()} aria-label="Dienstplan aktualisieren">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Aktualisieren
          </button>
        </div>
      </header>

      <div className={`rounded-xl border px-3 py-2 text-xs ${usingCache ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-slate-800 bg-slate-900 text-slate-400'}`} aria-live="polite">
        {usingCache
          ? `Offline-Cache${cachedAt ? ` vom ${new Date(cachedAt).toLocaleString()}` : ''}. Änderungen werden nicht serverseitig validiert.`
          : isOnline ? 'Online mit Planungs-API verbunden.' : 'Offline; keine serverseitigen Prüfungen oder Freigaben möglich.'}
        {outbox.length > 0 && <span className="ml-2 font-semibold">{outbox.length} ausstehende/fehlerhafte Schichtmutation(en)</span>}
        {isSyncing && <span className="ml-2">Synchronisierung läuft…</span>}
      </div>
      <p className="text-[11px] text-slate-500">Offline ist nur der zuletzt geladene Datumsbereich je Mandant und Benutzer zwischengespeichert; andere Zeiträume sind offline nicht vollständig verfügbar.</p>
      {loadError && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status">{loadError}</div>}
      {cacheWarning && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status">{cacheWarning}</div>}
      {actionError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">{actionError}</div>}
      {actionMessage && <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200" role="status">{actionMessage}</div>}
      {findings.length > 0 && !editor && !detailsShift && <FindingsList findings={findings} />}

      {periodFormOpen && (
        <form onSubmit={event => void createPeriod(event)} className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-slate-300">Name<input required minLength={2} className={`${fieldClass} mt-1`} value={periodForm.name} onChange={event => setPeriodForm({ ...periodForm, name: event.target.value })} /></label>
          <label className="text-xs text-slate-300">Von<input required type="date" className={`${fieldClass} mt-1`} value={periodForm.dateFrom} onChange={event => setPeriodForm({ ...periodForm, dateFrom: event.target.value })} /></label>
          <label className="text-xs text-slate-300">Bis<input required type="date" className={`${fieldClass} mt-1`} value={periodForm.dateTo} onChange={event => setPeriodForm({ ...periodForm, dateTo: event.target.value })} /></label>
          <label className="text-xs text-slate-300">IANA-Zeitzone<input required className={`${fieldClass} mt-1`} value={periodForm.timeZone} onChange={event => setPeriodForm({ ...periodForm, timeZone: event.target.value })} /></label>
          <div className="flex items-end gap-2"><button className={primaryButtonClass} disabled={saving || !isOnline}>Entwurf anlegen</button><button type="button" className={buttonClass} onClick={() => setPeriodFormOpen(false)}>Schließen</button></div>
        </form>
      )}

      {templateOpen && (
        <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-100">Schichtvorlagen</h2>
            <div className="flex gap-2">
              <button type="button" className={buttonClass} disabled={!isOnline || templatesLoading} onClick={() => { const next = !showInactiveTemplates; setShowInactiveTemplates(next); void loadTemplates(next); }}>{showInactiveTemplates ? 'Nur aktive' : 'Inaktive einblenden'}</button>
              <button type="button" className={buttonClass} disabled={!isOnline || templatesLoading} onClick={() => void loadTemplates()}>{templatesLoading ? 'Laden…' : 'Aktualisieren'}</button>
            </div>
          </div>
          {templatesLoading && templates.length === 0
            ? <p className="text-xs text-slate-400" role="status">Vorlagen werden geladen…</p>
            : templates.length === 0
              ? <p className="text-xs text-slate-400">Keine aktiven Vorlagen verfügbar.</p>
              : <div className="space-y-2">{templates.map(template => (
                <article key={template.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${selectedTemplateId === template.id ? 'border-blue-500/60 bg-blue-500/5' : 'border-slate-800 bg-slate-950'}`}>
                  <label className="flex min-w-0 flex-1 items-start gap-2 text-xs text-slate-200">
                    <input type="radio" name="selected-template" checked={selectedTemplateId === template.id} onChange={() => setSelectedTemplateId(template.id)} />
                    <span><strong>{template.name}</strong> · {template.site_name ?? sites.find(site => site.id === template.site_id)?.name ?? template.site_id} · {template.local_start_time.slice(0, 5)}–{template.local_end_time.slice(0, 5)} · {template.required_qualification}<span className="block text-slate-500">Bedarf {template.required_staff_count} · Pause {template.break_minutes} min · gültig {template.effective_from?.slice(0, 10) ?? 'ab unbegrenzt'} bis {template.effective_until?.slice(0, 10) ?? 'unbegrenzt'} · {template.recurrence.frequency === 'WEEKLY' ? 'Wöchentlich' : 'Täglich'}, Intervall {template.recurrence.interval}{template.recurrence.weekdays?.length ? ` · Wochentage: ${template.recurrence.weekdays.join(', ')}` : ''} · {template.time_zone} · Revision {template.revision_version} · {template.active ? 'aktiv' : 'inaktiv'}</span></span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {canManage && <button type="button" className={buttonClass} disabled={!isOnline || !template.active || activePeriod?.status !== 'draft' || saving} onClick={() => { setSelectedTemplateId(template.id); void applyTemplateById(template.id); }}>Auf Entwurfsperiode anwenden</button>}
                    {canManage && <button type="button" className={buttonClass} disabled={!isOnline || saving} onClick={() => beginTemplateEdit(template)}>Bearbeiten</button>}
                    {canManage && <button type="button" className={buttonClass} disabled={!isOnline || saving} onClick={() => void toggleTemplateActive(template)}>{template.active ? 'Deaktivieren' : 'Aktivieren'}</button>}
                  </div>
                  {templateEditingId === template.id && templateEditForm && <form className="grid w-full gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => void saveTemplateEdit(event, template)}>
                    <label className="text-xs text-slate-400">Vorlagenname<input required minLength={2} className={`${fieldClass} mt-1`} value={templateEditForm.name} onChange={event => setTemplateEditForm(current => current ? { ...current, name: event.target.value } : current)} /></label>
                    <label className="text-xs text-slate-400">Objekt<select required className={`${fieldClass} mt-1`} value={templateEditForm.siteId} onChange={event => setTemplateEditForm(current => current ? { ...current, siteId: event.target.value } : current)}>{sites.filter(site => !site.archivedAt).map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
                    <label className="text-xs text-slate-400">Beginn<input required type="time" className={`${fieldClass} mt-1`} value={templateEditForm.startTime} onChange={event => setTemplateEditForm(current => current ? { ...current, startTime: event.target.value } : current)} /></label>
                    <label className="text-xs text-slate-400">Ende<input required type="time" className={`${fieldClass} mt-1`} value={templateEditForm.endTime} onChange={event => setTemplateEditForm(current => current ? { ...current, endTime: event.target.value } : current)} /></label>
                    <label className="text-xs text-slate-400">Pause (Minuten)<input aria-label="Vorlagenpause" required type="number" min={0} max={1440} className={`${fieldClass} mt-1`} value={templateEditForm.breakMinutes} onChange={event => setTemplateEditForm(current => current ? { ...current, breakMinutes: Number(event.target.value) } : current)} /></label>
                    <label className="text-xs text-slate-400">Personalbedarf<input aria-label="Vorlagenbedarf" required type="number" min={1} max={500} className={`${fieldClass} mt-1`} value={templateEditForm.requiredStaffCount} onChange={event => setTemplateEditForm(current => current ? { ...current, requiredStaffCount: Number(event.target.value) } : current)} /></label>
                    <label className="text-xs text-slate-400">Gültig ab<input aria-label="Vorlage gültig ab" type="date" className={`${fieldClass} mt-1`} value={templateEditForm.effectiveFrom} onChange={event => setTemplateEditForm(current => current ? { ...current, effectiveFrom: event.target.value } : current)} /></label>
                    <label className="text-xs text-slate-400">Gültig bis<input aria-label="Vorlage gültig bis" type="date" className={`${fieldClass} mt-1`} value={templateEditForm.effectiveUntil} onChange={event => setTemplateEditForm(current => current ? { ...current, effectiveUntil: event.target.value } : current)} /></label>
                    <label className="text-xs text-slate-400">Qualifikation<input required minLength={2} className={`${fieldClass} mt-1`} value={templateEditForm.requiredQualification} onChange={event => setTemplateEditForm(current => current ? { ...current, requiredQualification: event.target.value } : current)} /></label>
                    <label className="text-xs text-slate-400">Wiederholung<select className={`${fieldClass} mt-1`} value={templateEditForm.frequency} onChange={event => setTemplateEditForm(current => current ? { ...current, frequency: event.target.value as 'DAILY' | 'WEEKLY' } : current)}><option value="WEEKLY">Wöchentlich</option><option value="DAILY">Täglich</option></select></label>
                    <label className="text-xs text-slate-400">Intervall<input required type="number" min={1} max={52} className={`${fieldClass} mt-1`} value={templateEditForm.interval} onChange={event => setTemplateEditForm(current => current ? { ...current, interval: Number(event.target.value) } : current)} /></label>
                    {templateEditForm.frequency === 'WEEKLY' && <fieldset className="text-xs text-slate-400"><legend>Wochentage</legend><div className="mt-2 flex flex-wrap gap-2">{['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, index) => <label key={day} className="flex items-center gap-1"><input type="checkbox" checked={templateEditForm.weekdays.includes(index)} onChange={event => setTemplateEditForm(current => current ? { ...current, weekdays: event.target.checked ? [...current.weekdays, index] : current.weekdays.filter(value => value !== index) } : current)} />{day}</label>)}</div></fieldset>}
                    <div className="flex items-end gap-2"><button className={primaryButtonClass} disabled={saving || !isOnline}>Änderungen speichern</button><button type="button" className={buttonClass} onClick={() => { setTemplateEditingId(''); setTemplateEditForm(null); }}>Abbrechen</button></div>
                  </form>}
                </article>
              ))}</div>}
          {canManage && <form onSubmit={event => void createTemplate(event)} className="grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-300">Vorlagenname<input aria-label="Vorlagenname" required minLength={2} className={`${fieldClass} mt-1`} value={templateForm.name} onChange={event => setTemplateForm({ ...templateForm, name: event.target.value })} /></label>
            <label className="text-xs text-slate-300">Objekt<select aria-label="Vorlagenobjekt" required className={`${fieldClass} mt-1`} value={templateForm.siteId} onChange={event => setTemplateForm({ ...templateForm, siteId: event.target.value })}><option value="">Objekt auswählen</option>{sites.filter(site => !site.archivedAt).map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <label className="text-xs text-slate-300">Beginn<input required type="time" className={`${fieldClass} mt-1`} value={templateForm.startTime} onChange={event => setTemplateForm({ ...templateForm, startTime: event.target.value })} /></label>
            <label className="text-xs text-slate-300">Ende<input required type="time" className={`${fieldClass} mt-1`} value={templateForm.endTime} onChange={event => setTemplateForm({ ...templateForm, endTime: event.target.value })} /></label>
            <label className="text-xs text-slate-300">Pause (Minuten)<input aria-label="Vorlagenpause" required type="number" min={0} max={1440} className={`${fieldClass} mt-1`} value={templateForm.breakMinutes} onChange={event => setTemplateForm({ ...templateForm, breakMinutes: Number(event.target.value) })} /></label>
            <label className="text-xs text-slate-300">Personalbedarf<input aria-label="Vorlagenbedarf" required type="number" min={1} max={500} className={`${fieldClass} mt-1`} value={templateForm.requiredStaffCount} onChange={event => setTemplateForm({ ...templateForm, requiredStaffCount: Number(event.target.value) })} /></label>
            <label className="text-xs text-slate-300">Gültig ab<input aria-label="Vorlage gültig ab" type="date" className={`${fieldClass} mt-1`} value={templateForm.effectiveFrom} onChange={event => setTemplateForm({ ...templateForm, effectiveFrom: event.target.value })} /></label>
            <label className="text-xs text-slate-300">Gültig bis<input aria-label="Vorlage gültig bis" type="date" className={`${fieldClass} mt-1`} value={templateForm.effectiveUntil} onChange={event => setTemplateForm({ ...templateForm, effectiveUntil: event.target.value })} /></label>
            <label className="text-xs text-slate-300">Qualifikation<input aria-label="Vorlagenqualifikation" required minLength={2} className={`${fieldClass} mt-1`} value={templateForm.requiredQualification} onChange={event => setTemplateForm({ ...templateForm, requiredQualification: event.target.value })} /></label>
            <label className="text-xs text-slate-300">Wiederholung<select className={`${fieldClass} mt-1`} value={templateForm.frequency} onChange={event => setTemplateForm({ ...templateForm, frequency: event.target.value as 'DAILY' | 'WEEKLY' })}><option value="WEEKLY">Wöchentlich</option><option value="DAILY">Täglich</option></select></label>
            <label className="text-xs text-slate-300">Intervall (Wochen/Tage)<input required type="number" min={1} max={52} step={1} className={`${fieldClass} mt-1`} value={templateForm.interval} onChange={event => setTemplateForm({ ...templateForm, interval: Number(event.target.value) })} /></label>
            {templateForm.frequency === 'WEEKLY' && <fieldset className="text-xs text-slate-300"><legend>Wochentage</legend><div className="mt-2 flex flex-wrap gap-2">{['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, index) => <label key={day} className="flex items-center gap-1"><input type="checkbox" checked={templateForm.weekdays.includes(index)} onChange={event => setTemplateForm(current => ({ ...current, weekdays: event.target.checked ? [...current.weekdays, index] : current.weekdays.filter(value => value !== index) }))} />{day}</label>)}</div></fieldset>}
            <div className="flex items-end gap-2"><button className={primaryButtonClass} disabled={saving || !isOnline}>Vorlage erstellen</button><button type="button" className={buttonClass} onClick={() => setTemplateOpen(false)}>Schließen</button></div>
          </form>}
          <p className="text-xs text-amber-300">Vorlagenänderungen und Aktivierung werden mit der aktuellen Revision online gespeichert. Vorlagenanwendung erzeugt ausschließlich Entwürfe in der ausgewählten offenen Dienstplanperiode; es gibt keinen Hard-Delete- oder separaten Kopier-Endpunkt.</p>
        </section>
      )}

      <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 lg:grid-cols-[auto_1fr]">
        <div className="flex flex-wrap items-center gap-2">
          <button className={buttonClass} aria-label="Vorheriger Zeitraum" onClick={() => setAnchorDate(date => shiftCalendarDate(date, view, -1))}><ChevronLeft size={15} /></button>
          <button className={buttonClass} onClick={() => setAnchorDate(localDate(new Date()))}>Heute</button>
          <button className={buttonClass} aria-label="Nächster Zeitraum" onClick={() => setAnchorDate(date => shiftCalendarDate(date, view, 1))}><ChevronRight size={15} /></button>
          <strong className="min-w-36 text-sm text-slate-100">{headerLabel}</strong>
          <label className="sr-only" htmlFor="calendar-anchor">Zeitraum auswählen</label>
          <input id="calendar-anchor" type="date" className={fieldClass + ' w-auto'} value={anchorDate} onChange={event => setAnchorDate(event.target.value)} />
          <select aria-label="Kalenderansicht" className={fieldClass + ' w-auto'} value={view} onChange={event => setView(event.target.value as CalendarView)}>
            <option value="month">Monat</option><option value="week">Woche</option><option value="day">Tag</option>
          </select>
          <select aria-label="Gruppierte Ansicht" className={fieldClass + ' w-auto'} value={groupView} onChange={event => setGroupView(event.target.value as GroupView)}>
            <option value="time">Zeitkalender</option><option value="employee">Mitarbeiteransicht</option><option value="site">Objektansicht</option><option value="customer">Kundenansicht</option>
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-slate-400">Dienstplanperiode<select aria-label="Dienstplanperiode" className={`${fieldClass} mt-1`} value={selectedPeriodId} onChange={event => setSelectedPeriodId(event.target.value)}><option value="">Keine Periode</option>{periods.map(period => <option key={period.id} value={period.id}>{period.name} · {period.status === 'published' ? 'veröffentlicht' : 'Entwurf'} · {period.date_from.slice(0, 10)}–{period.date_to.slice(0, 10)}</option>)}</select></label>
          <label className="text-xs text-slate-400">Kunde<select className={`${fieldClass} mt-1`} value={filterClientId} onChange={event => setFilterClientId(event.target.value)}><option value="">Alle Kunden</option>{clients.map(client => <option key={client.id} value={client.id}>{client.companyName}</option>)}</select></label>
          <label className="text-xs text-slate-400">Objekt<select className={`${fieldClass} mt-1`} value={filterSiteId} onChange={event => setFilterSiteId(event.target.value)}><option value="">Alle Objekte</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <label className="text-xs text-slate-400">Mitarbeiter<select className={`${fieldClass} mt-1`} value={filterEmployeeId} onChange={event => setFilterEmployeeId(event.target.value)}><option value="">Alle Mitarbeitenden</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
          <label className="text-xs text-slate-400">Status / Suche<div className="mt-1 flex gap-1"><select aria-label="Planungsstatus" className={fieldClass} value={filterStatus} onChange={event => setFilterStatus(event.target.value)}><option value="">Alle</option><option value="draft">Entwurf</option><option value="validated">Geprüft</option><option value="published">Veröffentlicht</option><option value="cancelled">Abgebrochen</option></select><input aria-label="Dienstplan durchsuchen" className={fieldClass} placeholder="Suchen…" value={search} onChange={event => setSearch(event.target.value)} /></div></label>
        </div>
      </div>

      {activePeriod && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs">
          <span className="text-slate-300">Periode <strong>{activePeriod.name}</strong> · {activePeriod.status === 'published' ? 'Veröffentlicht' : 'Entwurf'} · Revision {activePeriod.revision_version}</span>
          {activePeriod.status === 'draft' && <span className="text-amber-300">Finale Prüfung erfolgt ausschließlich beim Online-Veröffentlichen.</span>}
        </div>
      )}

      {loading && shifts.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-12 text-sm text-slate-400" role="status"><LoaderCircle className="animate-spin" size={18} /> Dienstplandaten werden geladen…</div>
      ) : filteredShifts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-10 text-center">
          <CalendarDays className="mx-auto mb-2 text-slate-500" size={24} />
          <p className="text-sm font-semibold text-slate-200">Keine Schichten in diesem Zeitraum</p>
          <p className="mt-1 text-xs text-slate-400">{loadError ? 'Der Serverplan oder Offline-Cache ist nicht verfügbar.' : 'Passen Sie Filter und Zeitraum an oder legen Sie einen Entwurf an.'}</p>
        </div>
      ) : groupView !== 'time' ? (
        <div className="space-y-3">
          {groupedShifts.map(([group, items]) => <section key={group} className="rounded-2xl border border-slate-800 bg-slate-900/80">
            <h2 className="border-b border-slate-800 px-4 py-3 text-sm font-bold text-slate-100">{group} <span className="ml-1 text-xs font-normal text-slate-500">({items.length})</span></h2>
            <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">{items.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)).map(shift => <ShiftCard key={shift.id} shift={shift} coverage={coverageByShift.get(shift.id)} canManage={canManage} isOnline={isOnline} onDetails={() => void openDetails(shift)} onEdit={() => openEditor('edit', shift)} onCopy={() => openEditor('create', shift)} onDelete={() => void deleteShift(shift)} />)}</div>
          </section>)}
        </div>
      ) : (
        <div className={`grid gap-px overflow-hidden rounded-2xl border border-slate-800 bg-slate-800 ${view === 'month' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-7' : view === 'week' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-7' : 'grid-cols-1'}`}>
          {view !== 'day' && ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(day => <div key={day} className="hidden bg-slate-900 px-2 py-2 text-center text-xs font-semibold text-slate-400 lg:block">{day}</div>)}
          {calendarDays.map(date => {
            const dayShifts = filteredShifts
              .filter(shift => shift.date === date)
              .sort((a, b) => a.startTime.localeCompare(b.startTime));
            const outsideMonth = view === 'month' && date.slice(0, 7) !== anchorDate.slice(0, 7);
            return (
              <div key={date} className={`min-h-36 bg-slate-950/80 p-2 ${outsideMonth ? 'opacity-50' : ''}`}>
                <div className="mb-2 flex items-center justify-between">
                  <time dateTime={date} className="text-xs font-semibold text-slate-400">
                    {new Date(`${date}T12:00:00`).toLocaleDateString('de-DE', {
                      weekday: 'short', day: 'numeric', month: view === 'month' ? undefined : 'short'
                    })}
                  </time>
                  {dayShifts.length > 0 && <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{dayShifts.length}</span>}
                </div>
                <div className="space-y-1">
                  {dayShifts.slice(0, view === 'month' ? 3 : 20).map(shift => (
                    <button
                      key={shift.id}
                      className={`w-full rounded-lg border px-2 py-1 text-left text-[11px] leading-4 transition hover:border-blue-400 ${shift.planningStatus === 'published' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : shift.syncStatus === 'conflict' || shift.syncStatus === 'failed' ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : shift.syncStatus === 'pending' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-slate-700 bg-slate-900 text-slate-200'}`}
                      onClick={() => void openDetails(shift)}
                      aria-label={`${date} ${shiftLabel(shift)}, ${shift.planningStatus}${shift.syncStatus ? `, Sync ${shift.syncStatus}` : ''}`}
                    >
                      <span className="block font-mono">{shift.startTime}–{shift.endTime}</span>
                      <span className="block truncate">{shift.siteName}</span>
                      <span className="block truncate text-[10px] opacity-75">{shift.employeeName || (shift.assignedCount ? `${shift.assignedCount} zugewiesen` : 'Offen')}</span>
                    </button>
                  ))}
                </div>
                {dayShifts.length > 3 && view === 'month' && (
                  <button className="w-full text-left text-[10px] text-blue-300" onClick={() => { setAnchorDate(date); setView('day'); }}>
                    +{dayShifts.length - 3} weitere anzeigen
                  </button>
                )}
                {canManage && <button className="mt-1 inline-flex items-center gap-1 text-[10px] text-blue-300 hover:text-blue-200" onClick={() => { setAnchorDate(date); openEditor('create'); }}><Plus size={11} /> Entwurf</button>}
              </div>
            );
          })}
        </div>
      )}

      {canReport && coverage.length > 0 && <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Schichten im Zeitraum" value={filteredShifts.length} />
        <Metric label="Offene Schichten" value={filteredShifts.filter(shift => shift.assignedCount === 0).length} />
        <Metric label="Unterbesetzung laut Coverage-API" value={coverage.filter(item => item.shortfall && item.shortfall > 0).length} />
      </div>}

      {editor && (
        <Dialog title={editor.mode === 'create' ? editor.shift ? 'Schicht kopieren' : 'Schichtentwurf anlegen' : 'Schicht bearbeiten'} onClose={() => setEditor(null)}>
          <form onSubmit={event => void handleSaveShift(event)} className="space-y-3">
            <label className="block text-xs text-slate-300">Objekt<select required className={`${fieldClass} mt-1`} value={form.siteId} onChange={event => setForm({ ...form, siteId: event.target.value })}><option value="">Objekt auswählen</option>{sites.filter(site => !site.archivedAt).map(site => <option key={site.id} value={site.id}>{site.name} · {site.clientName}</option>)}</select></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-300">Datum<input required type="date" className={`${fieldClass} mt-1`} value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label>
              <label className="text-xs text-slate-300">Periode<select className={`${fieldClass} mt-1`} value={form.schedulePeriodId} onChange={event => setForm({ ...form, schedulePeriodId: event.target.value })}><option value="">Ohne Periode</option>{periods.filter(period => period.status === 'draft').map(period => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
              <label className="text-xs text-slate-300">Beginn<input required type="time" className={`${fieldClass} mt-1`} value={form.startTime} onChange={event => setForm({ ...form, startTime: event.target.value })} /></label>
              <label className="text-xs text-slate-300">Ende<input required type="time" className={`${fieldClass} mt-1`} value={form.endTime} onChange={event => setForm({ ...form, endTime: event.target.value })} /><span className="mt-1 block text-[10px] text-slate-500">Ende vor Beginn bedeutet Folgetag. DST-Mehrdeutigkeiten muss der Server prüfen.</span></label>
              <label className="text-xs text-slate-300">Dienstart<select className={`${fieldClass} mt-1`} value={form.type} onChange={event => setForm({ ...form, type: event.target.value as Shift['type'] })}>{['Tagdienst', 'Nachtdienst', 'Revierdienst', 'Sonderposten'].map(type => <option key={type}>{type}</option>)}</select></label>
              <label className="text-xs text-slate-300">Benötigte Qualifikation<input required minLength={2} maxLength={100} className={`${fieldClass} mt-1`} value={form.requiredQualification} onChange={event => setForm({ ...form, requiredQualification: event.target.value })} /></label>
              <label className="text-xs text-slate-300">Mindestbesetzung{editor.mode === 'create' ? <input required type="number" min={1} max={500} className={`${fieldClass} mt-1`} value={form.requiredStaffCount} onChange={event => setForm({ ...form, requiredStaffCount: Number(event.target.value) })} /> : <div className={`${fieldClass} mt-1`}>{form.requiredStaffCount} — kann für bestehende Schichten nicht geändert werden</div>}<span className="mt-1 block text-[10px] text-slate-500">Beim Anlegen serverseitig gespeichert.</span></label>
              <label className="text-xs text-slate-300">Pause (Minuten)<input type="number" min={0} max={1440} className={`${fieldClass} mt-1`} value={form.breakMinutes} onChange={event => setForm({ ...form, breakMinutes: Number(event.target.value) })} /></label>
            </div>
            {editor.mode === 'create' && <label className="block text-xs text-slate-300">Initiale Zuweisung (online servergeprüft)<select disabled={!isOnline} className={`${fieldClass} mt-1`} value={form.employeeId} onChange={event => setForm({ ...form, employeeId: event.target.value })}><option value="">Unbesetzt</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>}
            {editor.mode === 'create' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-300">Anzahl Wiederholungen<input type="number" min={1} max={31} disabled={!isOnline} className={`${fieldClass} mt-1`} value={form.repeatCount} onChange={event => setForm({ ...form, repeatCount: Number(event.target.value) })} /></label><label className="text-xs text-slate-300">Abstand in Tagen<input type="number" min={1} max={365} disabled={!isOnline} className={`${fieldClass} mt-1`} value={form.repeatEveryDays} onChange={event => setForm({ ...form, repeatEveryDays: Number(event.target.value) })} /></label></div>}
            {!isOnline && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">{editor.mode === 'create' ? 'Offline möglich: nur ein unbesetzter Entwurf ohne Periodenbindung.' : 'Offline möglich: Entwurfsänderungen ohne Änderung von Periodenzuordnung oder Mindestbesetzung. Zuweisung und Veröffentlichung erfordern Online-Serverprüfung.'} Alle Änderungen bleiben bis zur Synchronisierung ungeprüft.</p>}
            {actionError && <p role="alert" className="text-xs text-rose-300">{actionError}</p>}
            {findings.length > 0 && <FindingsList findings={findings} />}
            <div className="flex justify-end gap-2"><button type="button" className={buttonClass} onClick={() => setEditor(null)}>Abbrechen</button><button className={primaryButtonClass} disabled={saving || !canManage || (editor.mode === 'edit' && !!editor.shift?.syncStatus && editor.shift.syncStatus !== 'synced')}>{saving ? 'Speichern…' : editor.mode === 'edit' ? 'Änderungen speichern' : 'Entwurf speichern'}</button></div>
          </form>
        </Dialog>
      )}

      {detailsShift && (
        <Dialog title="Schichtdetails und Besetzung" onClose={() => { setDetailsShift(null); setActionError(''); setActionMessage(''); }}>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
              <div className="font-semibold text-slate-100">{detailsShift.siteName} · {detailsShift.date} · {detailsShift.startTime}–{detailsShift.endTime}</div>
              <div className="mt-1 text-slate-400">{detailsShift.type} · {detailsShift.requiredQualification} · {detailsShift.planningStatus}</div>
              <div className="mt-1 text-slate-400">Besetzung: {coverageByShift.get(detailsShift.id)?.assigned_count ?? detailsShift.assignedCount}/{coverageByShift.get(detailsShift.id)?.required_count ?? detailsShift.requiredStaffCount ?? 'unbekannt'}</div>
              {detailsShift.syncStatus && <div className={`mt-2 font-semibold ${detailsShift.syncStatus === 'pending' ? 'text-amber-300' : 'text-rose-300'}`}>Sync: {detailsShift.syncStatus}. {detailsShift.syncStatus === 'pending' ? 'Noch nicht servergeprüft.' : 'Bitte Outbox-Konflikt/Fehler prüfen.'}</div>}
            </div>
            {detailsLoading && <div role="status" className="text-xs text-slate-400">Serverdetails werden geladen…</div>}
            {actionError && <div role="alert" className="text-xs text-rose-300">{actionError}</div>}
            {actionMessage && <div role="status" className="text-xs text-blue-300">{actionMessage}</div>}
            {findings.length > 0 && <FindingsList findings={findings} />}
            <section><h3 className="mb-2 text-xs font-bold uppercase text-slate-400">Zuweisungen</h3>
              {assignments.length === 0 ? <p className="text-xs text-slate-500">Keine serverseitigen Zuweisungen geladen.</p> : <ul className="space-y-1 text-xs">{assignments.filter(item => item.status === 'assigned').map(item => <li key={item.id} className="rounded-lg bg-slate-800 px-3 py-2">{item.first_name} {item.last_name} · Revision {item.revision_version}</li>)}</ul>}
              {canManage && isOnline && detailsShift.planningStatus !== 'published' && <div className="mt-2 flex gap-2"><select aria-label="Mitarbeiter zuweisen" className={fieldClass} value={assignmentEmployeeId} onChange={event => setAssignmentEmployeeId(event.target.value)}><option value="">Mitarbeiter auswählen</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select><button className={buttonClass} disabled={!assignmentEmployeeId} onClick={() => void assignEmployee(assignmentEmployeeId)}><Users size={14} /> Zuweisen</button></div>}
            </section>
            <section><h3 className="mb-2 text-xs font-bold uppercase text-slate-400">Qualifizierte Besetzungsvorschläge</h3>
              {!isOnline ? <p className="text-xs text-amber-300">Besetzungsvorschläge sind online-only.</p>
                : !staffingSuggestions ? <p className="text-xs text-slate-500">{detailsLoading ? 'Vorschläge werden geladen…' : 'Keine Vorschläge verfügbar.'}</p>
                  : <div className="space-y-3">
                    <p className="text-[11px] text-amber-300">Nicht bindende Hinweise. Die API prüft aktive Zuordnung, Qualifikation und Verfügbarkeit; eine Zuweisung erfolgt erst nach separater Bestätigung und erneuter Serverprüfung.</p>
                    {staffingSuggestions.requirements.map(requirement => <div key={requirement.qualificationType} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                      <div className="text-xs font-semibold text-slate-200">{requirement.qualificationType} · Bedarf {requirement.requiredCount}, qualifiziert zugewiesen {requirement.assignedCount}, offen {requirement.shortfall}</div>
                      {requirement.candidates.length === 0 ? <p className="mt-2 text-xs text-slate-500">Keine Kandidaten gemeldet.</p>
                        : <ul className="mt-2 space-y-2">{requirement.candidates.map(candidate => <li key={candidate.employeeId} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-slate-900 p-2 text-xs">
                          <div><strong>{candidate.firstName} {candidate.lastName}</strong> · {candidate.eligible ? 'geeignet' : 'nicht geeignet'} · {candidate.scheduledMinutesThisWeek} geplante Minuten diese Woche
                            <div className="mt-1 text-[10px] text-slate-500">Gründe: {candidate.reasons.join(', ') || 'Keine Gründe gemeldet'}</div>
                            {candidate.findings.length > 0 && <div className="mt-1 text-[10px] text-amber-300">{candidate.findings.map(finding => finding.message).join(' · ')}</div>}
                          </div>
                          {candidate.eligible && canManage && detailsShift.planningStatus !== 'published' && <button type="button" className={buttonClass} onClick={() => setAssignmentEmployeeId(candidate.employeeId)}>Für Zuweisung auswählen</button>}
                        </li>)}</ul>}
                      {(requirement.excludedCandidates?.length ?? 0) > 0 && <details className="mt-2 text-[10px] text-slate-400">
                        <summary className="cursor-pointer">Vorfilter-Ausschlüsse ({requirement.excludedCandidateCount}){requirement.excludedCandidatesTruncated ? ' · Liste gekürzt auf 50' : ''}</summary>
                        <ul className="mt-1 space-y-1">{(requirement.excludedCandidates ?? []).map(candidate => <li key={candidate.employeeId}>{candidate.employeeId}: {candidate.reasons.join(', ')}</li>)}</ul>
                      </details>}
                    </div>)}
                  </div>}
            </section>
            <section><h3 className="mb-2 text-xs font-bold uppercase text-slate-400">Diensttausch</h3>
              {swaps.length === 0 ? <p className="text-xs text-slate-500">Keine Tauschanträge.</p> : <ul className="space-y-2">{swaps.map(swap => <li key={swap.id} className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs"><div>{employeeName(swap.requester_employee_id, employees)} → {employeeName(swap.proposed_employee_id, employees)} · {swap.status}</div>{swap.decision_note && <div className="mt-1 text-slate-400">{swap.decision_note}</div>}{swap.status === 'pending' && canDecideSwap && isOnline && <div className="mt-2 flex gap-2"><button className={primaryButtonClass} onClick={() => void decideSwap(swap, 'approved')}>Genehmigen</button><button className={buttonClass} onClick={() => void decideSwap(swap, 'rejected')}>Ablehnen</button></div>}</li>)}</ul>}
              {canRequestSwap && isOnline && assignments.some(item => item.status === 'assigned') && <form className="mt-3 space-y-2" onSubmit={event => void requestSwap(event)}><label className="block text-xs text-slate-400">Vorgeschlagene Vertretung<select required className={`${fieldClass} mt-1`} value={swapEmployeeId} onChange={event => setSwapEmployeeId(event.target.value)}><option value="">Mitarbeiter auswählen</option>{employees.filter(employee => !assignments.some(item => item.employee_id === employee.id && item.status === 'assigned')).map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label><label className="block text-xs text-slate-400">Begründung<input required minLength={2} maxLength={1000} className={`${fieldClass} mt-1`} value={swapReason} onChange={event => setSwapReason(event.target.value)} /></label><button className={buttonClass} disabled={!swapEmployeeId}>Diensttausch beantragen</button></form>}
            </section>
            <section><h3 className="mb-2 text-xs font-bold uppercase text-slate-400">Vertretungsbedarf</h3>
              {shiftCoverRequests.length === 0 ? <p className="text-xs text-slate-500">Keine Vertretungsanträge für diese Schicht.</p> : <ul className="space-y-2">{shiftCoverRequests.map(request => <li key={request.id} className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs">
                <div className="font-semibold text-slate-200">{request.status} · {request.requested_employee_id ? `${request.requested_first_name ?? ''} ${request.requested_last_name ?? ''}`.trim() || employeeName(request.requested_employee_id, employees) : 'Vertretung noch nicht festgelegt'}</div>
                <p className="mt-1 text-slate-400">{request.reason}</p>
                {request.decision_note && <p className="mt-1 text-slate-500">Entscheidung: {request.decision_note}</p>}
                {request.status === 'pending' && canDecideCover && isOnline && <div className="mt-2 flex flex-wrap gap-2">
                  {!request.requested_employee_id && <select aria-label={`Vertretung für Antrag ${request.id}`} className={`${fieldClass} min-w-48 flex-1`} value={coverDecisionEmployeeIds[request.id] ?? ''} onChange={event => setCoverDecisionEmployeeIds(current => ({ ...current, [request.id]: event.target.value }))}><option value="">Vertretung auswählen</option>{employees.filter(employee => !assignments.some(item => item.employee_id === employee.id && item.status === 'assigned')).map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select>}
                  <button className={primaryButtonClass} disabled={!request.requested_employee_id && !coverDecisionEmployeeIds[request.id]} onClick={() => void decideCover(request, 'approved')}>Genehmigen</button>
                  <button className={buttonClass} onClick={() => void decideCover(request, 'rejected')}>Ablehnen</button>
                </div>}
              </li>)}</ul>}
              {canRequestCover && isOnline && detailsShift.assignedCount < (detailsShift.requiredStaffCount ?? 1) && <form className="mt-3 space-y-2" onSubmit={event => void requestCover(event)}>
                <label className="block text-xs text-slate-400">Gewünschte Vertretung (optional)<select className={`${fieldClass} mt-1`} value={coverEmployeeId} onChange={event => setCoverEmployeeId(event.target.value)}><option value="">Noch nicht festlegen</option>{employees.filter(employee => !assignments.some(item => item.employee_id === employee.id && item.status === 'assigned')).map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
                <label className="block text-xs text-slate-400">Begründung<input required minLength={1} maxLength={1000} className={`${fieldClass} mt-1`} value={coverReason} onChange={event => setCoverReason(event.target.value)} /></label>
                <button className={buttonClass} disabled={!detailsShift.revisionVersion}>Vertretungsbedarf einreichen</button>
              </form>}
            </section>
            <section><h3 className="mb-2 text-xs font-bold uppercase text-slate-400">Ist-Zeit erfassen / korrigieren</h3>
              {!isOnline && <p className="text-xs text-amber-300">Ist-Zeiten bleiben online-only und werden nicht in die Offline-Warteschlange aufgenommen.</p>}
              {isOnline && actualLoading && <p role="status" className="text-xs text-slate-400">Gespeicherte Ist-Zeit und Verlauf werden geladen…</p>}
              {isOnline && !actualLoading && actualForm.employeeId && actualCurrent && <p className="text-xs text-slate-300">Gespeicherter Nachweis, Revision {actualCurrent.revision_version} · {actualCurrent.actual_start_at} – {actualCurrent.actual_end_at} · Pause {actualCurrent.break_minutes} min · Status {actualCurrent.approval_status} · aufgezeichnet {new Date(actualCurrent.recorded_at).toLocaleString()}{actualCurrent.approved_at ? ` · genehmigt ${new Date(actualCurrent.approved_at).toLocaleString()}` : ''}</p>}
              {isOnline && actualCurrent?.approval_status === 'pending' && canApproveActuals && actualCurrent.recorded_by !== currentUserId && <button type="button" className={primaryButtonClass} disabled={actualLoading || detailsLoading} onClick={() => void approveActualTime()}>Ist-Zeit unabhängig genehmigen · Revision {actualCurrent.revision_version}</button>}
              {isOnline && actualCurrent?.approval_status === 'pending' && canApproveActuals && actualCurrent.recorded_by === currentUserId && <p className="text-xs text-amber-300">Eigene Ist-Zeit kann nicht genehmigt werden. Eine andere berechtigte Person muss die aktuelle Revision prüfen.</p>}
              {isOnline && !detailsLoading && !actualLoading && actualForm.employeeId && !actualCurrent && assignments.some(item => item.status === 'assigned') && <p className="text-xs text-slate-500">Für diese Person liegt noch kein gespeicherter Ist-Zeitnachweis vor.</p>}
              {isOnline && actualHistory.length > 0 && <details className="rounded-lg border border-slate-800 p-2 text-xs"><summary className="cursor-pointer text-slate-300">Änderungsverlauf ({actualHistory.length})</summary><ul className="mt-2 space-y-2">{actualHistory.map(entry => <li key={entry.id} className="border-t border-slate-800 pt-2"><div>{entry.event_type} · {new Date(entry.created_at).toLocaleString()} · Nutzer {entry.actor_user_id}</div><pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-slate-500">{JSON.stringify(entry.details)}</pre></li>)}</ul></details>}
              {actualForm.employeeId && <p className="text-[11px] text-amber-300">Korrekturen setzen den Freigabestatus auf ausstehend zurück. Nur unabhängig genehmigte Ist-Zeiten fließen in Ist-Soll-Abweichungen und Berichte ein; dies ist keine Aussage zur rechtlichen oder abrechnungstechnischen Anerkennung.</p>}
              {canManageActuals && isOnline && assignments.some(item => item.status === 'assigned') && <form className="space-y-2" onSubmit={event => void recordActualTime(event)}>
                <label className="block text-xs text-slate-400">Zugewiesene Person<select required className={`${fieldClass} mt-1`} value={actualForm.employeeId} onChange={event => {
                  const employeeId = event.target.value;
                  const requestId = ++detailsRequestIdRef.current;
                  setActualCurrent(null);
                  setActualHistory([]);
                  setActualSavedRevision(null);
                  setActualForm(current => ({ ...current, employeeId, actualStartAt: '', actualEndAt: '', expectedVersion: 0, notes: '' }));
                  void loadActualTimeForEmployee(detailsShift.id, employeeId, requestId);
                }}><option value="">Mitarbeiter auswählen</option>{assignments.filter(item => item.status === 'assigned').map(item => <option key={item.employee_id} value={item.employee_id}>{item.first_name} {item.last_name}</option>)}</select></label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-xs text-slate-400">Tatsächlicher Beginn (RFC 3339 mit Offset)<input required pattern="\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})" placeholder="2027-01-10T08:03:00+01:00" className={`${fieldClass} mt-1`} value={actualForm.actualStartAt} onChange={event => setActualForm(current => ({ ...current, actualStartAt: event.target.value }))} /></label>
                  <label className="text-xs text-slate-400">Tatsächliches Ende (RFC 3339 mit Offset)<input required pattern="\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})" placeholder="2027-01-10T16:05:00+01:00" className={`${fieldClass} mt-1`} value={actualForm.actualEndAt} onChange={event => setActualForm(current => ({ ...current, actualEndAt: event.target.value }))} /></label>
                  <label className="text-xs text-slate-400">Pause (Minuten)<input type="number" min={0} max={1440} required className={`${fieldClass} mt-1`} value={actualForm.breakMinutes} onChange={event => setActualForm(current => ({ ...current, breakMinutes: Number(event.target.value) }))} /></label>
                  <div className="text-xs text-slate-400">Erwartete Serverrevision<div className={`${fieldClass} mt-1`}>{actualCurrent?.revision_version ?? 0}</div></div>
                </div>
                <label className="block text-xs text-slate-400">Notiz (optional)<input maxLength={1000} className={`${fieldClass} mt-1`} value={actualForm.notes} onChange={event => setActualForm(current => ({ ...current, notes: event.target.value }))} /></label>
                <p className="text-[11px] text-slate-400">Revision 0 legt den ersten Nachweis an; Korrekturen verwenden die aktuell geladene Serverrevision.</p>
                <button className={buttonClass} disabled={!actualForm.employeeId || !actualForm.actualStartAt || !actualForm.actualEndAt || actualLoading || detailsLoading}>Ist-Zeit serverseitig speichern</button>
              </form>}
              {canManageActuals && isOnline && !assignments.some(item => item.status === 'assigned') && <p className="text-xs text-slate-500">Ist-Zeit ist erst nach einer serverseitigen Mitarbeiterzuweisung verfügbar.</p>}
            </section>
            <div className="flex flex-wrap justify-end gap-2">
              {canManage && detailsShift.planningStatus !== 'published' && <button className={buttonClass} disabled={!!detailsShift.syncStatus && detailsShift.syncStatus !== 'synced'} onClick={() => { setDetailsShift(null); openEditor('edit', detailsShift); }}>Bearbeiten</button>}
              {canManage && <button className={buttonClass} onClick={() => { setDetailsShift(null); openEditor('create', detailsShift); }}><Copy size={14} /> Kopieren</button>}
              {canManage && <button className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-300 disabled:opacity-50" disabled={!isOnline || detailsShift.planningStatus === 'published'} onClick={() => void deleteShift(detailsShift)}>Löschen</button>}
            </div>
          </div>
        </Dialog>
      )}

      {coverListOpen && <Dialog title="Vertretungsanträge" onClose={() => setCoverListOpen(false)}>
        <div className="space-y-3">
          <div className="flex justify-end"><button className={buttonClass} disabled={!isOnline || coverListLoading} onClick={() => void loadCoverRequests()}>{coverListLoading ? 'Laden…' : 'Aktualisieren'}</button></div>
          {!isOnline && <p className="text-xs text-amber-300">Vertretungsanträge und Entscheidungen sind nur online verfügbar.</p>}
          {allCoverRequests.length === 0
            ? <p className="rounded-lg border border-dashed border-slate-700 p-5 text-center text-xs text-slate-400">Keine Vertretungsanträge geladen.</p>
            : <ul className="space-y-2">{allCoverRequests.map(request => {
              const shift = shifts.find(item => item.id === request.shift_id);
              const requestedName = request.requested_employee_id
                ? `${request.requested_first_name ?? ''} ${request.requested_last_name ?? ''}`.trim() || employeeName(request.requested_employee_id, employees)
                : 'Nicht festgelegt';
              return <li key={request.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
                <div className="flex flex-wrap justify-between gap-2"><strong className="text-slate-100">{shift ? `${shift.date} · ${shift.siteName}` : `Schicht ${request.shift_id}`} · {request.status}</strong><span className="text-slate-500">{new Date(request.requested_at).toLocaleString()}</span></div>
                <p className="mt-1 text-slate-300">Gewünschte Vertretung: {requestedName}</p>
                <p className="mt-1 text-slate-400">{request.reason}</p>
                {request.status === 'pending' && canDecideCover && isOnline && <div className="mt-2 flex flex-wrap gap-2">
                  {!request.requested_employee_id && <select aria-label={`Vertretung für Antrag ${request.id}`} className={`${fieldClass} min-w-48 flex-1`} value={coverDecisionEmployeeIds[request.id] ?? ''} onChange={event => setCoverDecisionEmployeeIds(current => ({ ...current, [request.id]: event.target.value }))}><option value="">Vertretung auswählen</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select>}
                  <button className={primaryButtonClass} disabled={!request.requested_employee_id && !coverDecisionEmployeeIds[request.id]} onClick={() => void decideCover(request, 'approved')}>Genehmigen</button>
                  <button className={buttonClass} onClick={() => void decideCover(request, 'rejected')}>Ablehnen</button>
                </div>}
                {request.decision_note && <p className="mt-1 text-slate-500">Entscheidungsnotiz: {request.decision_note}</p>}
              </li>;
            })}</ul>}
          {!canDecideCover && <p className="text-[11px] text-slate-500">Für Entscheidungen wird planning:covers:approve benötigt.</p>}
        </div>
      </Dialog>}

      {planningNotificationsOpen && <Dialog title="Planungsbenachrichtigungen" onClose={() => setPlanningNotificationsOpen(false)}>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">Mandanten- und benutzerspezifischer In-App-Eingang. Keine E-Mail- oder Push-Zustellung.</p>
            <button type="button" className={buttonClass} disabled={!isOnline || planningNotificationsLoading} onClick={() => void loadPlanningNotifications()}>
              {planningNotificationsLoading ? 'Laden…' : 'Aktualisieren'}
            </button>
          </div>
          {!isOnline && <p className="text-xs text-amber-300">Benachrichtigungen sind online-only.</p>}
          {planningNotifications.length === 0
            ? <p className="rounded-lg border border-dashed border-slate-700 p-5 text-center text-xs text-slate-400">Keine Planungsbenachrichtigungen geladen.</p>
            : <ul className="space-y-2">{planningNotifications.map(notification => <li key={notification.id} className={`rounded-xl border p-3 text-xs ${notification.read_at ? 'border-slate-800 bg-slate-950 text-slate-400' : 'border-blue-500/30 bg-blue-500/5 text-slate-200'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><strong>{notification.event_type}</strong><div className="mt-1 text-slate-400">{notification.entity_type} · {notification.entity_id} · {new Date(notification.created_at).toLocaleString()}</div></div>
                {!notification.read_at && <button type="button" className={buttonClass} disabled={!isOnline} onClick={() => void markPlanningNotificationRead(notification)}>Als gelesen markieren</button>}
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] text-slate-500">{JSON.stringify(notification.details)}</pre>
              {notification.read_at && <div className="mt-1 text-[10px]">Gelesen {new Date(notification.read_at).toLocaleString()}</div>}
            </li>)}</ul>}
        </div>
      </Dialog>}

      {reportOpen && <Dialog title={`Planungsberichte · ${range.from} – ${range.to}`} onClose={() => setReportOpen(false)}>
        <div className="space-y-4">
          <div className="flex justify-end"><button className={buttonClass} onClick={() => window.print()}><Printer size={14} /> Drucken</button><button className={`${buttonClass} ml-2`} onClick={() => void downloadHoursCsv()}><Download size={14} /> Arbeitsstunden-CSV</button></div>
          <section>
            <h3 className="mb-2 text-xs font-bold text-slate-300">Geplante und tatsächliche Arbeitszeit</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500"><tr><th className="p-2">Mitarbeiter</th><th className="p-2">Schichten</th><th className="p-2">Soll-Stunden</th><th className="p-2">Erfasste Ist-Stunden / Status</th><th className="p-2">Genehmigte Ist-Stunden / Status</th><th className="p-2">Ist-Soll-Abweichung / Status / Quelle</th><th className="p-2">Minusstunden / Status</th><th className="p-2">Überstunden / Status</th><th className="p-2">Überstundenquelle</th></tr></thead>
                <tbody>{workHours.length === 0
                  ? <tr><td colSpan={9} className="p-3 text-center text-slate-500">Keine Berichtsdaten für diesen Zeitraum.</td></tr>
                  : workHours.map(row => <tr key={row.employee_id} className="border-t border-slate-800 align-top"><td className="p-2">{row.first_name} {row.last_name}</td><td className="p-2">{row.assigned_shifts}</td><td className="p-2">{reportValue(row.planned_hours)}</td><td className="p-2">{reportValue(row.captured_actual_hours, row.captured_actual_status)}</td><td className="p-2">{reportValue(row.actual_hours, row.actual_status)}<span className="mt-1 block text-[10px] text-slate-500">Freigabe: {row.actual_approval_status ?? 'Nicht gemeldet'}</span></td><td className="p-2">{reportVariance(row.hours_variance, row.hours_variance_status)}<span className="mt-1 block break-words text-[10px] text-slate-500">{row.hours_variance_source ?? 'Quelle nicht gemeldet'}</span></td><td className="p-2">{reportValue(row.minus_hours, row.hours_variance_status)}</td><td className="p-2">{reportValue(row.overtime_hours, row.overtime_status)}</td><td className="max-w-72 break-words p-2 text-slate-400">{reportSources(row.overtime_sources)}</td></tr>)}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-slate-500">Ist-Soll-Abweichung und Minusstunden stammen aus der API und basieren nur auf vollständig genehmigten Ist-Zeiten. Erfasste, aber nicht genehmigte Werte bleiben getrennt. Überstunden sind eine separate, konfigurationsabhängige Kennzahl.</p>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-bold text-slate-300">Wochenend-, Feiertags- und Nachtarbeit</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500"><tr><th className="p-2">Mitarbeiter</th><th className="p-2">Wochenende Soll / Ist</th><th className="p-2">Feiertag Soll / Ist</th><th className="p-2">Nacht Soll / Ist</th></tr></thead>
                <tbody>{workHours.length === 0
                  ? <tr><td colSpan={4} className="p-3 text-center text-slate-500">Keine Berichtsdaten für diesen Zeitraum.</td></tr>
                  : workHours.map(row => {
                    const weekend = row.calendar?.weekend;
                    const holiday = row.calendar?.holiday;
                    const night = row.calendar?.night;
                    const metric = (value: typeof weekend) => value
                      ? `${reportValue(value.plannedShifts, value.plannedStatus)} / ${reportValue(value.actualShifts, value.actualStatus)} · Quellen: ${reportSources(value.sources)}`
                      : 'Nicht verfügbar';
                    return <tr key={row.employee_id} className="border-t border-slate-800 align-top"><td className="p-2">{row.first_name} {row.last_name}</td><td className="max-w-72 p-2">{metric(weekend)}</td><td className="max-w-72 p-2">{metric(holiday)}</td><td className="max-w-72 p-2">{metric(night)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-bold text-slate-300">Besetzung / Personalbedarf</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500"><tr><th className="p-2">Datum</th><th className="p-2">Objekt</th><th className="p-2">Qualifikation</th><th className="p-2">Besetzt (qualifiziert)</th><th className="p-2">Bedarf</th><th className="p-2">Offen</th></tr></thead>
                <tbody>{reportCoverage.length === 0
                  ? <tr><td colSpan={6} className="p-3 text-center text-slate-500">Keine Besetzungsdaten für diesen Zeitraum.</td></tr>
                  : reportCoverage.map((row, index) => <tr key={`${row.shift_id}-${row.qualification_type ?? index}`} className="border-t border-slate-800"><td className="p-2">{String(row.shift_date).slice(0, 10)}</td><td className="p-2">{row.site_name}</td><td className="p-2">{row.qualification_type ?? 'Nicht angegeben'}</td><td className="p-2">{row.assigned_count}</td><td className="p-2">{row.required_count ?? 'Nicht verfügbar'}</td><td className="p-2">{row.shortfall ?? 'Nicht verfügbar'}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-bold text-slate-300">Qualifikationsangebot und -bedarf</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500"><tr><th className="p-2">Qualifikation</th><th className="p-2">Aktiv und gültig</th><th className="p-2">Datensatz</th><th className="p-2">Bedarf</th><th className="p-2">Qualifiziert besetzt</th><th className="p-2">Offen</th></tr></thead>
                <tbody>{reportQualifications.length === 0
                  ? <tr><td colSpan={6} className="p-3 text-center text-slate-500">Keine Qualifikationsdaten für diesen Zeitraum.</td></tr>
                  : reportQualifications.map(row => <tr key={row.qualification_type} className="border-t border-slate-800"><td className="p-2">{row.qualification_type}</td><td className="p-2">{row.active_qualified_employees}</td><td className="p-2">{row.employees_with_record}</td><td className="p-2">{row.required_slots}</td><td className="p-2">{row.assigned_qualified_slots}</td><td className="p-2">{row.shortfall}</td></tr>)}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-slate-500">Als einsatzfähig gezählt werden nur verifizierte, gültige und am Periodenende nicht abgelaufene Qualifikationen.</p>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-bold text-slate-300">Abwesenheiten</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500"><tr><th className="p-2">Art</th><th className="p-2">Status</th><th className="p-2">Datensätze</th><th className="p-2">Betroffene Personen (Gruppe)</th><th className="p-2">Überlappende Kalendertage</th></tr></thead>
                <tbody>{reportAbsences.length === 0
                  ? <tr><td colSpan={5} className="p-3 text-center text-slate-500">Keine Abwesenheitsdaten für diesen Zeitraum.</td></tr>
                  : reportAbsences.map(row => <tr key={`${row.absence_type}-${row.status}`} className="border-t border-slate-800"><td className="p-2">{row.absence_type}</td><td className="p-2">{row.status}</td><td className="p-2">{row.absence_records}</td><td className="p-2">{row.affected_employees}</td><td className="p-2">{row.overlapping_calendar_days}</td></tr>)}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-slate-500">Betroffenenzahlen werden je Art und Status gruppiert und sind nicht additiv.</p>
          </section>
          <section role="status" aria-label="Berichtsabdeckung" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200">
            <h3 className="mb-1 font-bold">Datenverfügbarkeit und Quellen</h3>
            <p>Nicht erfasste Ist-Zeiten und nicht konfigurierte bzw. mehrdeutige Kalender- oder Überstundenwerte bleiben als „Nicht verfügbar“ mit API-Status dargestellt; sie werden nicht zu null/0 umgedeutet. Berichtswerte sind keine Rechtskonformitätsaussage.</p>
          </section>
        </div>
      </Dialog>}

      {ruleProfilesOpen && <Dialog title="Versionierte Regelprofile" onClose={() => setRuleProfilesOpen(false)}>
        <RuleProfileManager
          profiles={ruleProfiles}
          loading={ruleProfilesLoading}
          error={ruleProfilesError}
          message={ruleProfilesMessage}
          canManage={canManageRules}
          canApprove={canApproveRules}
          isOnline={isOnline}
          onReload={() => void loadRuleProfiles()}
          onSave={saveRuleProfile}
          onApprove={approveRuleProfileVersion}
          onToggleActive={setRuleProfileActive}
        />
      </Dialog>}
    </section>
  );
};

function RuleProfileManager({
  profiles, loading, error, message, canManage, canApprove, isOnline, onReload, onSave, onApprove, onToggleActive
}: {
  profiles: RuleProfileRow[];
  loading: boolean;
  error: string;
  message: string;
  canManage: boolean;
  canApprove: boolean;
  isOnline: boolean;
  onReload: () => void;
  onSave: (input: RuleProfileInput, profileId?: string) => Promise<boolean>;
  onApprove: (profile: RuleProfileRow, versionId: string) => Promise<boolean>;
  onToggleActive: (profile: RuleProfileRow) => Promise<boolean>;
}) {
  const [target, setTarget] = useState<{ mode: 'create' } | { mode: 'version'; profileId: string } | null>(null);
  const [name, setName] = useState('');
  const [scopeText, setScopeText] = useState('{}');
  const [effectiveFrom, setEffectiveFrom] = useState(localDate(new Date()));
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [rules, setRules] = useState<PlanningRule[]>([]);
  const [ruleCode, setRuleCode] = useState<PlanningRuleCode>('minimum_rest_minutes');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleSource, setRuleSource] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState<'warning' | 'blocking'>('blocking');
  const [validationError, setValidationError] = useState('');
  const [saving, setSaving] = useState(false);
  const [approvingVersionId, setApprovingVersionId] = useState('');

  const groupedProfiles = useMemo(() => {
    const groups = new Map<string, { profile: RuleProfileRow; versions: RuleProfileRow[] }>();
    for (const row of profiles) {
      const current = groups.get(row.id);
      if (current) {
        if (row.version_id) current.versions.push(row);
      } else {
        groups.set(row.id, { profile: row, versions: row.version_id ? [row] : [] });
      }
    }
    return [...groups.values()].sort((a, b) => a.profile.name.localeCompare(b.profile.name, 'de'));
  }, [profiles]);

  const startCreate = () => {
    setTarget({ mode: 'create' });
    setName('');
    setScopeText('{}');
    setEffectiveFrom(localDate(new Date()));
    setEffectiveUntil('');
    setSourceName('');
    setSourceReference('');
    setRules([]);
    setRuleValue('');
    setRuleSource('');
    setValidationError('');
  };

  const startVersion = (profileId: string) => {
    setTarget({ mode: 'version', profileId });
    setName('');
    setScopeText('{}');
    setEffectiveFrom(localDate(new Date()));
    setEffectiveUntil('');
    setSourceName('');
    setSourceReference('');
    setRules([]);
    setRuleValue('');
    setRuleSource('');
    setValidationError('');
  };

  const addRule = () => {
    setValidationError('');
    const source = ruleSource.trim();
    if (source.length < 2 || source.length > 255) {
      setValidationError('Jede Regel benötigt eine Quellenangabe (2–255 Zeichen).');
      return;
    }

    let value: PlanningRule['value'];
    if (numericRuleCodes.has(ruleCode)) {
      const parsed = Number(ruleValue);
      if (!ruleValue.trim() || !Number.isFinite(parsed) || parsed < 0) {
        setValidationError('Für diese Regel ist ein endlicher, nicht negativer Zahlenwert erforderlich.');
        return;
      }
      value = parsed;
    } else if (booleanRuleCodes.has(ruleCode)) {
      if (ruleValue !== 'true' && ruleValue !== 'false') {
        setValidationError('Bitte einen booleschen Wert auswählen.');
        return;
      }
      value = ruleValue === 'true';
    } else {
      const entries = ruleValue.split(',').map(entry => entry.trim()).filter(Boolean);
      if (entries.length === 0) {
        setValidationError('Bitte mindestens einen Listenwert eingeben.');
        return;
      }
      if (ruleCode === 'disallowed_weekdays' || ruleCode === 'weekend_weekdays') {
        const weekdays = entries.map(Number);
        if (weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
          setValidationError('Wochentage müssen ganze Zahlen von 0 bis 6 sein (0 = Sonntag).');
          return;
        }
        value = weekdays;
      } else {
        if (entries.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
          setValidationError('Feiertage müssen lokale ISO-Datumswerte im Format JJJJ-MM-TT sein.');
          return;
        }
        value = entries;
      }
    }

    setRules(current => [...current, {
      code: ruleCode,
      value,
      source,
      severity: ruleSeverity
    }]);
    setRuleValue('');
    setRuleSource('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setValidationError('');
    if (!isOnline || !canManage) return;
    if (rules.length === 0 || rules.length > 100) {
      setValidationError('Eine Regelprofilrevision benötigt mindestens eine Regel.');
      return;
    }
    if (effectiveUntil && effectiveUntil < effectiveFrom) {
      setValidationError('Das Ende der Wirksamkeit darf nicht vor dem Beginn liegen.');
      return;
    }

    let scope: Record<string, unknown> = {};
    if (target?.mode === 'create') {
      try {
        const parsed: unknown = JSON.parse(scopeText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Der Geltungsbereich muss ein JSON-Objekt sein.');
        }
        scope = parsed as Record<string, unknown>;
      } catch (parseError) {
        setValidationError(parseError instanceof Error ? parseError.message : 'Ungültiges JSON im Geltungsbereich.');
        return;
      }
      if (name.trim().length < 2 || name.trim().length > 160) {
        setValidationError('Der Profilname muss 2 bis 160 Zeichen lang sein.');
        return;
      }
    }
    if (sourceName.trim().length < 2 || sourceName.trim().length > 255 ||
        sourceReference.trim().length < 2 || sourceReference.trim().length > 2000) {
      setValidationError('Quellenname und Quellenreferenz sind erforderlich (mindestens 2 Zeichen).');
      return;
    }

    setSaving(true);
    try {
      const input: RuleProfileInput = {
        name: target?.mode === 'create' ? name.trim() : '',
        scope,
        effectiveFrom,
        effectiveUntil: effectiveUntil || undefined,
        sourceName: sourceName.trim(),
        sourceReference: sourceReference.trim(),
        rules
      };
      const saved = await onSave(input, target?.mode === 'version' ? target.profileId : undefined);
      if (saved) setTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const approve = async (profile: RuleProfileRow, versionId: string) => {
    setApprovingVersionId(versionId);
    try {
      await onApprove(profile, versionId);
    } finally {
      setApprovingVersionId('');
    }
  };

  return (
    <div className="space-y-4">
      {!isOnline && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200" role="status">Regelprofile werden nicht offline gespeichert oder freigegeben.</p>}
      {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200" role="alert">{error}</p>}
      {message && <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-200" role="status">{message}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <p className="max-w-xl text-xs text-amber-200">Regelwerte benötigen eine belegte Quelle und fachliche Prüfung. Es werden keine gesetzlichen oder tariflichen Grenzwerte vorgegeben; die Freigabe ist keine Rechtskonformitätsbestätigung.</p>
        <div className="flex gap-2">
          <button type="button" className={buttonClass} disabled={!isOnline || loading} onClick={onReload}>{loading ? 'Laden…' : 'Aktualisieren'}</button>
          {canManage && <button type="button" className={primaryButtonClass} disabled={!isOnline} onClick={startCreate}>Neues Regelprofil</button>}
        </div>
      </div>

      {loading && profiles.length === 0
        ? <p className="py-6 text-center text-xs text-slate-400" role="status">Regelprofile werden geladen…</p>
        : groupedProfiles.length === 0
          ? <p className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-xs text-slate-400">Keine Regelprofile verfügbar.</p>
          : <div className="space-y-3">{groupedProfiles.map(({ profile, versions }) => (
            <section key={profile.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">{profile.name}</h3>
                  <p className="text-[11px] text-slate-500">Geltungsbereich: {JSON.stringify(profile.scope ?? {})} · {profile.active ? 'Aktiv' : 'Inaktiv'}</p>
                </div>
                {canManage && <div className="flex gap-2"><button type="button" className={buttonClass} disabled={!isOnline} onClick={() => void onToggleActive(profile)}>{profile.active ? 'Deaktivieren' : 'Aktivieren'}</button><button type="button" className={buttonClass} disabled={!isOnline} onClick={() => startVersion(profile.id)}>Neue Revision</button></div>}
              </div>
              {versions.length === 0
                ? <p className="mt-2 text-xs text-slate-500">Keine Revision verfügbar.</p>
                : <div className="mt-3 space-y-2">{[...versions].sort((a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0)).map(version => (
                  <article key={version.version_id} className="rounded-lg border border-slate-800 p-3 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="font-semibold text-slate-200">Revision {version.version_number ?? '—'} · {version.version_status ?? 'unbekannt'} · wirksam ab {version.effective_from?.slice(0, 10) ?? '—'}{version.effective_until ? ` bis ${version.effective_until.slice(0, 10)}` : ''}</div>
                      {version.version_id && version.version_status === 'draft' && canApprove && <button type="button" className={buttonClass} disabled={!isOnline || approvingVersionId === version.version_id} onClick={() => void approve(profile, version.version_id!)}>{approvingVersionId === version.version_id ? 'Freigabe…' : 'Revision freigeben'}</button>}
                    </div>
                    <p className="mt-1 break-words text-slate-400">Quelle: {version.source_name ?? 'nicht angegeben'} · {version.source_reference ?? 'keine Referenz'}</p>
                    {!isOnline && version.version_status === 'draft' && <p className="mt-1 text-amber-300">Offline nicht freigegeben.</p>}
                    <ul className="mt-2 space-y-1 text-slate-300">{(version.rules ?? []).map((rule, index) => <li key={`${rule.code}-${index}`}>{ruleCodeLabels[rule.code] ?? rule.code}: <code>{JSON.stringify(rule.value)}</code> · {rule.severity} · Quelle: {rule.source}</li>)}</ul>
                  </article>
                ))}</div>}
              {canApprove && <p className="mt-2 text-[10px] text-slate-500">Der Server verweigert die Freigabe durch den Ersteller der jeweiligen Revision.</p>}
            </section>
          ))}</div>}

      {target && <form onSubmit={event => void submit(event)} className="space-y-3 rounded-xl border border-blue-500/30 bg-slate-950 p-3">
        <h3 className="text-sm font-bold text-slate-100">{target.mode === 'create' ? 'Regelprofil und erste Revision erstellen' : 'Neue Entwurfsrevision erstellen'}</h3>
        {target.mode === 'create' && <>
          <label className="block text-xs text-slate-300">Profilname<input aria-label="Profilname" required minLength={2} maxLength={160} className={`${fieldClass} mt-1`} value={name} onChange={event => setName(event.target.value)} /></label>
          <label className="block text-xs text-slate-300">Geltungsbereich (JSON-Objekt, optional)<textarea aria-label="Geltungsbereich JSON" rows={2} className={`${fieldClass} mt-1 font-mono`} value={scopeText} onChange={event => setScopeText(event.target.value)} /></label>
        </>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-300">Wirksam ab<input aria-label="Wirksam ab" required type="date" className={`${fieldClass} mt-1`} value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} /></label>
          <label className="text-xs text-slate-300">Wirksam bis (optional)<input aria-label="Wirksam bis" type="date" className={`${fieldClass} mt-1`} value={effectiveUntil} onChange={event => setEffectiveUntil(event.target.value)} /></label>
          <label className="text-xs text-slate-300">Quellenname<input aria-label="Quellenname" required minLength={2} maxLength={255} className={`${fieldClass} mt-1`} value={sourceName} onChange={event => setSourceName(event.target.value)} /></label>
          <label className="text-xs text-slate-300">Quellenreferenz<input aria-label="Quellenreferenz" required minLength={2} maxLength={2000} className={`${fieldClass} mt-1`} value={sourceReference} onChange={event => setSourceReference(event.target.value)} /></label>
        </div>

        <fieldset className="space-y-2 rounded-lg border border-slate-800 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-300">Regel mit Quellenkennzeichnung hinzufügen</legend>
          <label className="block text-xs text-slate-400">Regeltyp<select className={`${fieldClass} mt-1`} value={ruleCode} onChange={event => { setRuleCode(event.target.value as PlanningRuleCode); setRuleValue(''); }}><option value="minimum_rest_minutes">{ruleCodeLabels.minimum_rest_minutes}</option>{(Object.keys(ruleCodeLabels) as PlanningRuleCode[]).filter(code => code !== 'minimum_rest_minutes').map(code => <option key={code} value={code}>{ruleCodeLabels[code]}</option>)}</select></label>
          {booleanRuleCodes.has(ruleCode)
            ? <label className="block text-xs text-slate-400">Wert<select className={`${fieldClass} mt-1`} value={ruleValue} onChange={event => setRuleValue(event.target.value)}><option value="">Wert auswählen</option><option value="true">Ja</option><option value="false">Nein</option></select></label>
            : <label className="block text-xs text-slate-400">{numericRuleCodes.has(ruleCode) ? 'Wert (Zahl)' : ruleCode === 'disallowed_weekdays' || ruleCode === 'weekend_weekdays' ? 'Wochentage, kommasepariert (0–6)' : 'Lokale Datumswerte, kommasepariert (JJJJ-MM-TT)'}<input aria-label="Regelwert" type={numericRuleCodes.has(ruleCode) ? 'number' : 'text'} min={numericRuleCodes.has(ruleCode) ? 0 : undefined} step={numericRuleCodes.has(ruleCode) ? 'any' : undefined} className={`${fieldClass} mt-1`} value={ruleValue} onChange={event => setRuleValue(event.target.value)} /></label>}
          <label className="block text-xs text-slate-400">Quelle dieser Regel<input aria-label="Quelle der Regel" minLength={2} maxLength={255} className={`${fieldClass} mt-1`} value={ruleSource} onChange={event => setRuleSource(event.target.value)} /></label>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <label className="text-xs text-slate-400">Schweregrad<select className={`${fieldClass} mt-1`} value={ruleSeverity} onChange={event => setRuleSeverity(event.target.value as 'warning' | 'blocking')}><option value="blocking">Blockierend</option><option value="warning">Hinweis</option></select></label>
            <button type="button" className={buttonClass} onClick={addRule}>Regel hinzufügen</button>
          </div>
          {rules.length > 0 && <ul className="space-y-1 text-xs text-slate-300">{rules.map((rule, index) => <li key={`${rule.code}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-900 p-2"><span>{ruleCodeLabels[rule.code]}: {JSON.stringify(rule.value)} · {rule.severity} · Quelle: {rule.source}</span><button type="button" className="text-rose-300" aria-label={`Regel ${index + 1} entfernen`} onClick={() => setRules(current => current.filter((_, currentIndex) => currentIndex !== index))}>Entfernen</button></li>)}</ul>}
        </fieldset>
        {validationError && <p role="alert" className="text-xs text-rose-300">{validationError}</p>}
        <p className="text-[11px] text-amber-200">Die Revision beginnt im Status Entwurf. Eine Freigabe erfolgt getrennt durch den Server; eine lokale Eingabe ersetzt keine rechtliche oder fachliche Bewertung.</p>
        <div className="flex justify-end gap-2"><button type="button" className={buttonClass} disabled={saving} onClick={() => setTarget(null)}>Abbrechen</button><button className={primaryButtonClass} disabled={saving || !isOnline}>{saving ? 'Speichern…' : 'Entwurfsrevision speichern'}</button></div>
      </form>}
    </div>
  );
}

function ShiftCard({
  shift, coverage, canManage, isOnline, onDetails, onEdit, onCopy, onDelete
}: {
  shift: PlanningShift;
  coverage?: CoverageRow;
  canManage: boolean;
  isOnline: boolean;
  onDetails: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return <article className="rounded-xl border border-slate-800 bg-slate-950 p-3">
    <button className="block w-full text-left" onClick={onDetails}>
      <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-blue-300">{shift.date} · {shift.startTime}–{shift.endTime}</span><span className="text-[10px] text-slate-500">{shift.planningStatus}</span></div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{shift.siteName}</div>
      <div className="mt-1 text-xs text-slate-400">{shift.employeeName || (shift.assignedCount > 0 ? `${shift.assignedCount} zugewiesen` : 'Unbesetzt')} · {shift.type}</div>
      <div className="mt-1 text-[11px] text-slate-500">{shift.requiredQualification} · {coverage ? `${coverage.assigned_count}/${coverage.required_count ?? '?'}` : `${shift.assignedCount}/${shift.requiredStaffCount ?? '?'}`}</div>
      {shift.syncStatus && <div className={`mt-2 text-[10px] font-semibold ${shift.syncStatus === 'pending' ? 'text-amber-300' : 'text-rose-300'}`}>{shift.syncStatus === 'pending' ? 'Offline ausstehend · nicht geprüft' : `Sync ${shift.syncStatus} · prüfen`}</div>}
      {shift.pendingDelete && <div className="mt-1 text-[10px] text-rose-300">Löschung ausstehend</div>}
    </button>
    {canManage && <div className="mt-3 flex flex-wrap gap-1.5">
      <button className={buttonClass} disabled={!isOnline || shift.planningStatus === 'published' || shift.pendingDelete} onClick={onEdit}>Bearbeiten</button>
      <button className={buttonClass} onClick={onCopy}><Copy size={12} /> Kopieren</button>
      <button className="rounded-lg border border-rose-500/20 px-2 py-1.5 text-[11px] text-rose-300 disabled:opacity-50" disabled={!isOnline || shift.planningStatus === 'published' || shift.pendingDelete} onClick={onDelete}>Löschen</button>
    </div>}
  </article>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 text-lg font-bold text-slate-100">{value}</div></div>;
}

function FindingsList({ findings }: { findings: PlanningFinding[] }) {
  return <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3" aria-label="Serverseitige Prüfbefunde">
    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-200"><AlertTriangle size={14} /> Serverbefunde</h3>
    <ul className="space-y-1 text-xs">{findings.map((finding, index) => <li key={`${finding.id ?? finding.code}-${index}`} className={finding.severity === 'blocking' ? 'text-rose-200' : 'text-amber-100'}><strong>{finding.severity === 'blocking' ? 'Blockierend' : 'Hinweis'} · {finding.code}:</strong> {finding.message}{finding.source_name && <span className="text-slate-400"> · Quelle: {finding.source_name}</span>}</li>)}</ul>
  </section>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0f172a] p-4 shadow-2xl sm:p-6">
      <header className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3"><h2 className="text-base font-bold text-white">{title}</h2><button className="rounded p-1 text-slate-400 hover:text-white" aria-label="Dialog schließen" onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}
