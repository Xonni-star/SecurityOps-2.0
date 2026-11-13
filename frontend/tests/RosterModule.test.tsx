import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listShifts: vi.fn(),
  listPeriods: vi.fn(),
  coverage: vi.fn(),
  listAssignments: vi.fn(),
  assignEmployee: vi.fn(),
  listFindings: vi.fn(),
  listSwaps: vi.fn(),
  coverRequests: vi.fn(),
  createCoverRequest: vi.fn(),
  decideCoverRequest: vi.fn(),
  recordActualTime: vi.fn(),
  getActualTime: vi.fn(),
  listTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  staffingSuggestions: vi.fn(),
  listRuleProfiles: vi.fn(),
  createRuleProfile: vi.fn(),
  createRuleProfileVersion: vi.fn(),
  approveRuleProfileVersion: vi.fn(),
  setRuleProfileActive: vi.fn(),
  createShift: vi.fn(),
  updateShift: vi.fn(),
  deleteShift: vi.fn(),
  createPeriod: vi.fn(),
  publishPeriod: vi.fn(),
  createTemplate: vi.fn(),
  applyTemplate: vi.fn(),
  createSwap: vi.fn(),
  decideSwap: vi.fn(),
  workHours: vi.fn(),
  qualifications: vi.fn(),
  absences: vi.fn(),
  getOutbox: vi.fn(),
  savePlanningCache: vi.fn(),
  getPlanningCache: vi.fn(),
  enqueueOfflineAction: vi.fn(),
  storeState: {} as any
}));

vi.mock('../store', () => ({
  useSecurityStore: Object.assign(
    vi.fn(() => mocks.storeState),
    {
      setState: vi.fn((updater: any) => {
        const next = typeof updater === 'function' ? updater(mocks.storeState) : updater;
        Object.assign(mocks.storeState, next);
      })
    }
  )
}));

vi.mock('../services/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    downloadFile: vi.fn()
  },
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    data?: unknown;
    isNetworkError: boolean;
    constructor(status: number, message: string, _errors?: string[], network = false, code?: string, data?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.data = data;
      this.isNetworkError = network;
    }
  }
}));

vi.mock('../services/indexedDbService', () => ({
  offlineVault: {
    getOutbox: mocks.getOutbox,
    savePlanningCache: mocks.savePlanningCache,
    getPlanningCache: mocks.getPlanningCache
  }
}));

vi.mock('../services/planningService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/planningService')>();
  return {
    ...actual,
    planningApi: {
      listShifts: mocks.listShifts,
      listPeriods: mocks.listPeriods,
      coverage: mocks.coverage,
      listAssignments: mocks.listAssignments,
      assignEmployee: mocks.assignEmployee,
      listFindings: mocks.listFindings,
      listSwaps: mocks.listSwaps,
      coverRequests: mocks.coverRequests,
      createCoverRequest: mocks.createCoverRequest,
      decideCoverRequest: mocks.decideCoverRequest,
      recordActualTime: mocks.recordActualTime,
      getActualTime: mocks.getActualTime,
      listTemplates: mocks.listTemplates,
      updateTemplate: mocks.updateTemplate,
      staffingSuggestions: mocks.staffingSuggestions,
      listRuleProfiles: mocks.listRuleProfiles,
      createRuleProfile: mocks.createRuleProfile,
      createRuleProfileVersion: mocks.createRuleProfileVersion,
      approveRuleProfileVersion: mocks.approveRuleProfileVersion,
      setRuleProfileActive: mocks.setRuleProfileActive,
      createShift: mocks.createShift,
      updateShift: mocks.updateShift,
      deleteShift: mocks.deleteShift,
      createPeriod: mocks.createPeriod,
      publishPeriod: mocks.publishPeriod,
      createTemplate: mocks.createTemplate,
      applyTemplate: mocks.applyTemplate,
      createSwap: mocks.createSwap,
      decideSwap: mocks.decideSwap,
      workHours: mocks.workHours,
      qualifications: mocks.qualifications,
      absences: mocks.absences
    }
  };
});

import { RosterModule } from '../components/RosterModule';
import { ApiError } from '../services/apiClient';

const site = { id: 'site-a', tenantId: 'tenant-a', clientId: 'client-a', clientName: 'Kunde A', name: 'Objekt A' } as any;
const shiftDate = new Date();
const date = `${shiftDate.getFullYear()}-${String(shiftDate.getMonth() + 1).padStart(2, '0')}-${String(shiftDate.getDate()).padStart(2, '0')}`;
const shift = {
  id: 'shift-a',
  site_id: 'site-a',
  site_name: 'Objekt A',
  shift_date: date,
  start_time: '08:00:00',
  end_time: '16:00:00',
  type: 'Tagdienst',
  status: 'Offen',
  planning_status: 'draft',
  schedule_period_id: 'period-a',
  required_qualification: 'Unterrichtung § 34a GewO',
  revision_version: 4,
  assigned_count: 0
};
const period = {
  id: 'period-a',
  name: 'November-Entwurf',
  date_from: `${date.slice(0, 7)}-01`,
  date_to: `${date.slice(0, 7)}-28`,
  time_zone: 'Europe/Berlin',
  status: 'draft',
  revision_version: 3
};

function setInput(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('RosterModule', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'mutation-id') });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.assign(mocks.storeState, {
      currentTenantId: 'tenant-a',
      currentUserId: 'user-a',
      authUser: {
        permissions: [
          'planning:read', 'planning:manage', 'planning:publish',
          'planning:reports:read', 'planning:swaps:manage', 'planning:swaps:approve',
          'planning:covers:manage', 'planning:covers:approve', 'planning:actuals:manage',
          'planning:rules:manage', 'planning:rules:approve',
          'shifts:manage'
        ]
      },
      sites: [site],
      clients: [{ id: 'client-a', companyName: 'Kunde A' }],
      employees: [{ id: 'employee-a', firstName: 'Ada', lastName: 'Guard', qualifications: [], absences: [] }],
      shifts: [],
      isOnline: true,
      syncQueue: [],
      isSyncing: false,
      lastSyncTime: null,
      enqueueOfflineAction: mocks.enqueueOfflineAction
    });
    mocks.getOutbox.mockResolvedValue([]);
    mocks.savePlanningCache.mockResolvedValue(undefined);
    mocks.getPlanningCache.mockResolvedValue({
      shifts: [shift], periods: [period], cachedAt: new Date().toISOString()
    });
    mocks.listShifts.mockResolvedValue([shift]);
    mocks.listPeriods.mockResolvedValue([period]);
    mocks.coverage.mockResolvedValue([]);
    mocks.listAssignments.mockResolvedValue([]);
    mocks.assignEmployee.mockResolvedValue({ revisionVersion: 5 });
    mocks.listFindings.mockResolvedValue([]);
    mocks.listSwaps.mockResolvedValue([]);
    mocks.coverRequests.mockResolvedValue([]);
    mocks.createCoverRequest.mockResolvedValue({});
    mocks.decideCoverRequest.mockResolvedValue({});
    mocks.recordActualTime.mockResolvedValue({ revision_version: 1 });
    mocks.getActualTime.mockResolvedValue({ current: null, history: [] });
    mocks.listTemplates.mockResolvedValue([]);
    mocks.updateTemplate.mockResolvedValue({});
    mocks.staffingSuggestions.mockResolvedValue({
      shiftId: 'shift-a',
      requirements: [],
      finalAssignmentRequiresConfirmation: true
    });
    mocks.listRuleProfiles.mockResolvedValue([]);
    mocks.createRuleProfile.mockResolvedValue({});
    mocks.createRuleProfileVersion.mockResolvedValue({});
    mocks.approveRuleProfileVersion.mockResolvedValue({});
    mocks.setRuleProfileActive.mockResolvedValue({});
    mocks.createPeriod.mockResolvedValue(period);
    mocks.createTemplate.mockResolvedValue({ id: 'template-a' });
    mocks.applyTemplate.mockResolvedValue({ occurrences: [] });
    mocks.createSwap.mockResolvedValue({});
    mocks.decideSwap.mockResolvedValue({});
    mocks.workHours.mockResolvedValue([]);
    mocks.qualifications.mockResolvedValue([]);
    mocks.absences.mockResolvedValue([]);
    mocks.enqueueOfflineAction.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test('loads the calendar, navigates periods, and switches to customer grouping', async () => {
    await act(async () => root.render(<RosterModule />));
    expect(container.textContent).toContain('Objekt A');
    expect(mocks.savePlanningCache).toHaveBeenCalledWith(
      'tenant-a', 'user-a', expect.any(Array), expect.any(Array),
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) })
    );

    const grouping = container.querySelector<HTMLSelectElement>('select[aria-label="Gruppierte Ansicht"]');
    if (!grouping) throw new Error('Gruppierte Ansicht fehlt');
    await act(async () => setInput(grouping, 'customer'));
    expect(container.textContent).toContain('Kunde A');

    const next = container.querySelector<HTMLButtonElement>('button[aria-label="Nächster Zeitraum"]');
    if (!next) throw new Error('Nächster Zeitraum fehlt');
    await act(async () => next.click());
    expect(mocks.listShifts).toHaveBeenCalledTimes(3);
  });

  test('saves an edit with the current revision and renders server validation findings', async () => {
    await act(async () => root.render(<RosterModule />));
    const eventButton = container.querySelector<HTMLButtonElement>('button[aria-label*="Objekt A"]');
    if (!eventButton) throw new Error('Kalendereintrag fehlt');
    await act(async () => eventButton.click());
    const edit = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Bearbeiten'));
    if (!edit) throw new Error('Bearbeiten fehlt');
    await act(async () => edit.click());

    const start = container.querySelector<HTMLInputElement>('input[type="time"]');
    if (!start) throw new Error('Beginn fehlt');
    await act(async () => setInput(start, '09:00'));
    mocks.updateShift.mockRejectedValueOnce(new ApiError(422, 'Serverprüfung fehlgeschlagen.', undefined, false, 'PLANNING_VALIDATION_FAILED', {
      findings: [{ code: 'MINIMUM_REST', severity: 'blocking', message: 'Ruhezeit zu kurz.' }]
    }));
    const submit = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Änderungen speichern'));
    if (!submit) throw new Error('Speichern fehlt');
    await act(async () => submit.click());

    expect(mocks.updateShift).toHaveBeenCalledWith('shift-a', expect.objectContaining({ startTime: '09:00', revisionVersion: 4 }));
    expect(container.textContent).toContain('PLANNING_VALIDATION_FAILED');
    expect(container.textContent).toContain('Ruhezeit zu kurz.');
  });

  test('requires online permission for publishing and surfaces blocking findings', async () => {
    await act(async () => root.render(<RosterModule />));
    mocks.publishPeriod.mockRejectedValueOnce(new ApiError(422, 'Blockierende Befunde.', undefined, false, 'PLANNING_VALIDATION_FAILED', {
      findings: [{ code: 'UNASSIGNED_SHIFT', severity: 'blocking', message: 'Schicht unbesetzt.' }]
    }));
    const publish = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Veröffentlichen'));
    if (!publish) throw new Error('Veröffentlichen fehlt');
    await act(async () => publish.click());
    expect(mocks.publishPeriod).toHaveBeenCalledWith('period-a', 3);
    expect(container.textContent).toContain('Schicht unbesetzt.');

    mocks.storeState.isOnline = false;
    await act(async () => root.render(<RosterModule />));
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Veröffentlichen'))?.hasAttribute('disabled')).toBe(true);
  });

  test('shows report sections as empty or unavailable instead of inventing missing metrics', async () => {
    await act(async () => root.render(<RosterModule />));
    const reports = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Berichte'));
    if (!reports) throw new Error('Berichte fehlen');
    await act(async () => reports.click());

    expect(container.textContent).toContain('Keine Berichtsdaten für diesen Zeitraum.');
    expect(container.textContent).toContain('Keine Besetzungsdaten für diesen Zeitraum.');
    expect(container.textContent).toContain('Geplante und tatsächliche Arbeitszeit');
    expect(container.textContent).toContain('Qualifikationsangebot und -bedarf');
    expect(container.textContent).toContain('Abwesenheiten');
    expect(container.textContent).not.toContain('Überstunden: 0');
  });

  test('renders nullable report values, configuration statuses, and source metadata', async () => {
    mocks.workHours.mockResolvedValue([{
      employee_id: 'employee-a',
      first_name: 'Ada',
      last_name: 'Guard',
      assigned_shifts: 2,
      planned_hours: 16,
      actual_hours: null,
      actual_status: 'partial',
      overtime_hours: null,
      overtime_status: 'unconfigured',
      overtime_sources: [],
      calendar: {
        weekend: {
          plannedShifts: null,
          plannedStatus: 'unconfigured',
          actualShifts: null,
          actualStatus: 'unavailable',
          sources: []
        },
        holiday: {
          plannedShifts: 1,
          plannedStatus: 'available',
          actualShifts: null,
          actualStatus: 'unavailable',
          sources: [{ profileSourceName: 'Tenant policy', ruleSource: 'Calendar appendix' }]
        },
        night: {
          plannedShifts: 0,
          plannedStatus: 'available',
          actualShifts: null,
          actualStatus: 'unavailable',
          sources: []
        }
      }
    }]);
    await act(async () => root.render(<RosterModule />));
    const reports = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Berichte'));
    if (!reports) throw new Error('Berichte fehlen');
    await act(async () => reports.click());

    expect(container.textContent).toContain('Nicht verfügbar (partial)');
    expect(container.textContent).toContain('Nicht verfügbar (unconfigured)');
    expect(container.textContent).toContain('Tenant policy');
    expect(container.textContent).not.toContain('Überstunden: 0');
  });

  test('shows planned-to-actual variance separately from configured overtime', async () => {
    mocks.workHours.mockResolvedValue([{
      employee_id: 'employee-a',
      first_name: 'Ada',
      last_name: 'Guard',
      assigned_shifts: 1,
      planned_hours: 8,
      actual_hours: 10,
      actual_status: 'complete',
      overtime_hours: null,
      overtime_status: 'unconfigured',
      overtime_sources: [],
      calendar: {}
    }]);
    await act(async () => root.render(<RosterModule />));
    const reports = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Berichte'));
    if (!reports) throw new Error('Berichte fehlen');
    await act(async () => reports.click());

    expect(container.textContent).toContain('Ist-Soll-Abweichung / Status');
    expect(container.textContent).toContain('+2 (complete)');
    expect(container.textContent).toContain('Nicht verfügbar (unconfigured)');
    expect(container.textContent).toContain('Überstunden sind eine separate, konfigurationsabhängige Kennzahl.');
  });

  test('lists and applies a server template without recreating it', async () => {
    mocks.listTemplates.mockResolvedValue([{
      id: 'template-a',
      site_id: 'site-a',
      site_name: 'Objekt A',
      name: 'Frühdienst',
      time_zone: 'Europe/Berlin',
      local_start_time: '08:00:00',
      local_end_time: '16:00:00',
      required_qualification: 'Sachkunde',
      recurrence: { frequency: 'WEEKLY', interval: 1, weekdays: [1, 2, 3, 4, 5] },
      active: true,
      revision_version: 1
    }]);
    mocks.applyTemplate.mockResolvedValue({
      occurrences: [{ status: 'draft', shiftId: 'draft-shift' }, { status: 'REJECTED' }],
      finalValidationRequired: true
    });
    await act(async () => root.render(<RosterModule />));
    const open = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Vorlagen');
    if (!open) throw new Error('Vorlagen-Schaltfläche fehlt');
    await act(async () => open.click());

    expect(mocks.listTemplates).toHaveBeenCalled();
    expect(container.textContent).toContain('Frühdienst');
    const apply = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Auf Entwurfsperiode anwenden'));
    if (!apply) throw new Error('Vorlagenanwendung fehlt');
    await act(async () => apply.click());
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.applyTemplate).toHaveBeenCalledWith('template-a', expect.objectContaining({ schedulePeriodId: 'period-a' }));
    expect(container.textContent).toContain('1 Schichtentwurf/Entwürfe erstellt; 1 Vorkommen serverseitig abgelehnt');
  });

  test('edits and deactivates templates with their loaded revision', async () => {
    const template = {
      id: 'template-a',
      site_id: 'site-a',
      site_name: 'Objekt A',
      name: 'Frühdienst',
      time_zone: 'Europe/Berlin',
      local_start_time: '08:00:00',
      local_end_time: '16:00:00',
      required_qualification: 'Sachkunde',
      recurrence: { frequency: 'WEEKLY', interval: 1, weekdays: [1, 2, 3, 4, 5] },
      active: true,
      revision_version: 6
    };
    mocks.listTemplates
      .mockResolvedValueOnce([template])
      .mockResolvedValueOnce([{ ...template, name: 'Spätdienst', revision_version: 7 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...template, name: 'Spätdienst', active: false, revision_version: 8 }])
      .mockResolvedValueOnce([{ ...template, name: 'Spätdienst', revision_version: 9 }]);
    await act(async () => root.render(<RosterModule />));
    const open = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Vorlagen');
    if (!open) throw new Error('Vorlagen-Schaltfläche fehlt');
    await act(async () => open.click());

    const edit = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Bearbeiten');
    if (!edit) throw new Error('Vorlage bearbeiten fehlt');
    await act(async () => edit.click());
    const name = container.querySelector<HTMLInputElement>('input[value="Frühdienst"]');
    if (!name) throw new Error('Vorlagenname fehlt');
    await act(async () => setInput(name, 'Spätdienst'));
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Änderungen speichern');
    if (!save) throw new Error('Änderungen speichern fehlt');
    await act(async () => save.click());

    expect(mocks.updateTemplate).toHaveBeenCalledWith('template-a', expect.objectContaining({
      expectedVersion: 6,
      name: 'Spätdienst'
    }));
    const deactivate = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Deaktivieren');
    if (!deactivate) throw new Error('Vorlage deaktivieren fehlt');
    await act(async () => deactivate.click());
    expect(mocks.updateTemplate).toHaveBeenLastCalledWith('template-a', {
      expectedVersion: 7,
      active: false
    });
    const showInactive = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Inaktive einblenden');
    if (!showInactive) throw new Error('Inaktive Vorlagen einblenden fehlt');
    await act(async () => showInactive.click());
    const activate = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Aktivieren');
    if (!activate) throw new Error('Vorlage aktivieren fehlt');
    await act(async () => activate.click());
    expect(mocks.updateTemplate).toHaveBeenLastCalledWith('template-a', {
      expectedVersion: 8,
      active: true
    });
  });

  test('shows staffing suggestions as nonbinding and requires a separate assignment action', async () => {
    mocks.storeState.employees = [
      { id: 'employee-a', firstName: 'Ada', lastName: 'Guard', qualifications: [], absences: [] },
      { id: 'employee-candidate', firstName: 'Alex', lastName: 'Guard', qualifications: [], absences: [] }
    ];
    mocks.staffingSuggestions.mockResolvedValue({
      shiftId: 'shift-a',
      requirements: [{
        qualificationType: 'Sachkunde',
        requiredCount: 1,
        assignedCount: 0,
        shortfall: 1,
        candidates: [{
          employeeId: 'employee-candidate',
          firstName: 'Alex',
          lastName: 'Guard',
          eligible: true,
          scheduledMinutesThisWeek: 240,
          reasons: ['active', 'qualified'],
          findings: []
        }]
      }],
      finalAssignmentRequiresConfirmation: true
    });
    await act(async () => root.render(<RosterModule />));
    const eventButton = container.querySelector<HTMLButtonElement>('button[aria-label*="Objekt A"]');
    if (!eventButton) throw new Error('Kalendereintrag fehlt');
    await act(async () => eventButton.click());
    expect(container.textContent).toContain('Nicht bindende Hinweise');
    expect(container.textContent).toContain('erscheinen nicht mit Einzelgrund');
    expect(container.textContent).toContain('Alex Guard');

    const selectCandidate = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Für Zuweisung auswählen'));
    if (!selectCandidate) throw new Error('Vorschlag auswählen fehlt');
    await act(async () => selectCandidate.click());
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Mitarbeiter zuweisen"]')?.value).toBe('employee-candidate');
    expect(mocks.assignEmployee).not.toHaveBeenCalled();

    const assign = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Zuweisen'));
    if (!assign) throw new Error('Zuweisen fehlt');
    await act(async () => assign.click());
    expect(mocks.assignEmployee).toHaveBeenCalledWith('shift-a', 'employee-candidate', 4);
  });

  test('clears tenant-bound planning data on identity changes and ignores stale template responses', async () => {
    const tenantATemplate = {
      id: 'template-tenant-a',
      site_id: 'site-a',
      site_name: 'Tenant A site',
      name: 'TENANT_A_TEMPLATE_SECRET',
      time_zone: 'Europe/Berlin',
      local_start_time: '08:00:00',
      local_end_time: '16:00:00',
      required_qualification: 'Sachkunde',
      recurrence: { frequency: 'WEEKLY' as const, interval: 1, weekdays: [1, 2, 3, 4, 5] },
      active: true,
      revision_version: 1
    };
    const tenantACover = {
      id: 'cover-tenant-a',
      shift_id: 'shift-a',
      requested_employee_id: 'employee-a',
      requested_first_name: 'Ada',
      requested_last_name: 'Guard',
      reason: 'TENANT_A_COVER_SECRET',
      status: 'pending',
      revision_version: 1,
      shift_revision_version_at_request: 4,
      requested_by: 'user-a',
      requested_at: '2026-11-13T08:00:00.000Z'
    };
    let resolveStaleTemplates!: (templates: typeof tenantATemplate[]) => void;
    const staleTemplates = new Promise<typeof tenantATemplate[]>(resolve => {
      resolveStaleTemplates = resolve;
    });
    mocks.listTemplates.mockResolvedValue([tenantATemplate]);
    mocks.coverRequests.mockResolvedValue([tenantACover]);
    mocks.listAssignments.mockResolvedValue([{
      id: 'assignment-a',
      shift_id: 'shift-a',
      employee_id: 'employee-a',
      first_name: 'Ada',
      last_name: 'Guard',
      status: 'assigned',
      revision_version: 1
    }, {
      id: 'assignment-b',
      shift_id: 'shift-a',
      employee_id: 'employee-b',
      first_name: 'Bea',
      last_name: 'Guard',
      status: 'assigned',
      revision_version: 1
    }]);
    mocks.staffingSuggestions.mockResolvedValue({
      shiftId: 'shift-a',
      requirements: [{
        qualificationType: 'Sachkunde',
        requiredCount: 1,
        assignedCount: 0,
        shortfall: 1,
        candidates: [{
          employeeId: 'employee-b',
          firstName: 'TENANT_A_CANDIDATE_SECRET',
          lastName: 'Guard',
          eligible: true,
          scheduledMinutesThisWeek: 0,
          reasons: [],
          findings: []
        }]
      }],
      finalAssignmentRequiresConfirmation: true
    });
    const tenantAActual = {
      id: 'actual-tenant-a',
      shift_id: 'shift-a',
      employee_id: 'employee-a',
      actual_start_at: '2027-01-10T08:03:00+01:00',
      actual_end_at: '2027-01-10T16:05:00+01:00',
      break_minutes: 30,
      revision_version: 2,
      recorded_by: 'user-a',
      recorded_at: '2027-01-10T15:10:00.000Z',
      notes: 'TENANT_A_ACTUAL_SECRET'
    };
    let resolveStaleActual!: (value: { current: typeof tenantAActual; history: any[] }) => void;
    const staleActual = new Promise<{ current: typeof tenantAActual; history: any[] }>(resolve => {
      resolveStaleActual = resolve;
    });
    mocks.getActualTime
      .mockResolvedValueOnce({
        current: tenantAActual,
        history: [{
          id: 'audit-tenant-a',
          actor_user_id: 'user-a',
          event_type: 'shift.actual_time.recorded',
          details: { notes: 'TENANT_A_HISTORY_SECRET' },
          created_at: tenantAActual.recorded_at
        }]
      })
      .mockReturnValueOnce(staleActual);

    await act(async () => root.render(<RosterModule />));
    const openTemplates = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Vorlagen');
    if (!openTemplates) throw new Error('Vorlagen-Schaltfläche fehlt');
    await act(async () => openTemplates.click());
    expect(container.textContent).toContain('TENANT_A_TEMPLATE_SECRET');

    const closeTemplates = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Schließen');
    if (!closeTemplates) throw new Error('Vorlagen schließen fehlt');
    await act(async () => closeTemplates.click());
    const openCovers = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Vertretungsanträge'));
    if (!openCovers) throw new Error('Vertretungsanträge fehlen');
    await act(async () => openCovers.click());
    expect(container.textContent).toContain('TENANT_A_COVER_SECRET');
    const closeDialog = container.querySelector<HTMLButtonElement>('button[aria-label="Dialog schließen"]');
    if (!closeDialog) throw new Error('Dialog schließen fehlt');
    await act(async () => closeDialog.click());

    const eventButton = container.querySelector<HTMLButtonElement>('button[aria-label*="Objekt A"]');
    if (!eventButton) throw new Error('Kalendereintrag fehlt');
    await act(async () => eventButton.click());
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
    const actualNotes = Array.from(container.querySelectorAll('label')).find(label =>
      label.textContent?.includes('Notiz (optional)')
    )?.querySelector<HTMLInputElement>('input');
    expect(container.textContent).toContain('TENANT_A_CANDIDATE_SECRET');
    expect(container.textContent).toContain('TENANT_A_HISTORY_SECRET');
    expect(actualNotes?.value).toBe('TENANT_A_ACTUAL_SECRET');
    const actualStart = container.querySelector<HTMLInputElement>('input[placeholder="2027-01-10T08:03:00+01:00"]');
    const actualEnd = container.querySelector<HTMLInputElement>('input[placeholder="2027-01-10T16:05:00+01:00"]');
    const notes = container.querySelectorAll<HTMLInputElement>('input[maxlength="1000"]');
    if (!actualStart || !actualEnd || notes.length < 2) throw new Error('Ist-Zeitformular fehlt');
    await act(async () => {
      setInput(actualStart, '2027-01-10T08:03:00+01:00');
      setInput(actualEnd, '2027-01-10T16:05:00+01:00');
      setInput(notes[notes.length - 1], 'TENANT_A_ACTUAL_NOTE_SECRET');
    });
    const actualEmployee = Array.from(container.querySelectorAll('label')).find(label =>
      label.textContent?.includes('Zugewiesene Person')
    )?.querySelector<HTMLSelectElement>('select');
    if (!actualEmployee) throw new Error('Ist-Zeitperson fehlt');
    await act(async () => setInput(actualEmployee, 'employee-b'));

    mocks.listTemplates.mockImplementationOnce(() => staleTemplates);
    const reopenTemplates = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Vorlagen');
    if (!reopenTemplates) throw new Error('Vorlagen-Schaltfläche fehlt');
    await act(async () => reopenTemplates.click());
    await act(async () => {
      const templateSection = Array.from(container.querySelectorAll('section')).find(section =>
        section.querySelector('h2')?.textContent === 'Schichtvorlagen'
      );
      const refreshTemplates = Array.from(templateSection?.querySelectorAll('button') ?? []).find(button => button.textContent?.trim() === 'Aktualisieren');
      if (!refreshTemplates) throw new Error('Vorlagen aktualisieren fehlt');
      refreshTemplates.click();
    });

    mocks.storeState.currentTenantId = 'tenant-b';
    mocks.storeState.currentUserId = 'user-b';
    mocks.storeState.sites = [];
    mocks.storeState.clients = [];
    mocks.storeState.employees = [];
    mocks.listShifts.mockResolvedValue([]);
    mocks.listPeriods.mockResolvedValue([]);
    mocks.coverage.mockResolvedValue([]);
    mocks.getOutbox.mockResolvedValue([]);
    await act(async () => root.render(<RosterModule />));

    expect(container.textContent).not.toContain('TENANT_A_TEMPLATE_SECRET');
    expect(container.textContent).not.toContain('TENANT_A_COVER_SECRET');
    expect(container.textContent).not.toContain('TENANT_A_CANDIDATE_SECRET');
    expect(container.textContent).not.toContain('TENANT_A_HISTORY_SECRET');
    expect(Array.from(container.querySelectorAll('input')).some(input => input.value === 'TENANT_A_ACTUAL_NOTE_SECRET')).toBe(false);
    expect(Array.from(container.querySelectorAll('input')).some(input => input.value === 'TENANT_A_ACTUAL_SECRET')).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => resolveStaleTemplates([tenantATemplate]));
    await act(async () => resolveStaleActual({ current: tenantAActual, history: [] }));
    expect(container.textContent).not.toContain('TENANT_A_TEMPLATE_SECRET');
    expect(container.textContent).not.toContain('TENANT_A_COVER_SECRET');
    expect(container.textContent).not.toContain('TENANT_A_CANDIDATE_SECRET');
    expect(container.textContent).not.toContain('TENANT_A_ACTUAL_SECRET');
  });

  test('creates a template without auto-applying it or supplying tenant-specific sample values', async () => {
    await act(async () => root.render(<RosterModule />));
    const open = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Vorlagen');
    if (!open) throw new Error('Vorlagen-Schaltfläche fehlt');
    await act(async () => open.click());

    const name = container.querySelector<HTMLInputElement>('input[aria-label="Vorlagenname"]');
    const siteSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Vorlagenobjekt"]');
    const qualification = container.querySelector<HTMLInputElement>('input[aria-label="Vorlagenqualifikation"]');
    const times = container.querySelectorAll<HTMLInputElement>('input[type="time"]');
    if (!name || !siteSelect || !qualification || times.length < 2) throw new Error('Vorlagenformular fehlt');
    expect(name.value).toBe('');
    expect(qualification.value).toBe('');
    await act(async () => {
      setInput(name, 'Wachposten Tag');
      setInput(siteSelect, 'site-a');
      setInput(times[0], '07:00');
      setInput(times[1], '15:00');
      setInput(qualification, 'Werkschutz');
    });
    const create = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Vorlage erstellen');
    if (!create) throw new Error('Vorlage erstellen fehlt');
    await act(async () => create.click());

    expect(mocks.createTemplate).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-a',
      name: 'Wachposten Tag',
      startTime: '07:00',
      endTime: '15:00',
      requiredQualification: 'Werkschutz',
      frequency: 'WEEKLY'
    }));
    expect(mocks.applyTemplate).not.toHaveBeenCalled();
  });

  test('submits a cover request online with the shift revision and mutation ID', async () => {
    await act(async () => root.render(<RosterModule />));
    const eventButton = container.querySelector<HTMLButtonElement>('button[aria-label*="Objekt A"]');
    if (!eventButton) throw new Error('Kalendereintrag fehlt');
    await act(async () => eventButton.click());
    const reason = Array.from(container.querySelectorAll<HTMLInputElement>('input[maxlength="1000"]')).find(input => input.type === 'text');
    if (!reason) throw new Error('Vertretungsbegründung fehlt');
    await act(async () => setInput(reason, 'Kurzfristiger Ausfall'));
    const request = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Vertretungsbedarf einreichen'));
    if (!request) throw new Error('Vertretungsantrag fehlt');
    await act(async () => request.click());

    expect(mocks.createCoverRequest).toHaveBeenCalledWith('shift-a', expect.objectContaining({
      expectedShiftVersion: 4,
      clientMutationId: 'mutation-id',
      reason: 'Kurzfristiger Ausfall'
    }));
  });

  test('lists cover requests and submits an online approval with the request version', async () => {
    mocks.coverRequests.mockResolvedValue([{
      id: 'cover-a',
      shift_id: 'shift-a',
      requested_employee_id: 'employee-a',
      requested_first_name: 'Ada',
      requested_last_name: 'Guard',
      reason: 'Ausfall',
      status: 'pending',
      revision_version: 2,
      shift_revision_version_at_request: 4,
      requested_by: 'user-b',
      requested_at: '2026-11-13T08:00:00.000Z'
    }]);
    await act(async () => root.render(<RosterModule />));
    const open = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Vertretungsanträge'));
    if (!open) throw new Error('Vertretungsanträge fehlen');
    await act(async () => open.click());
    expect(container.textContent).toContain('Ada Guard');

    const approve = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Genehmigen');
    if (!approve) throw new Error('Genehmigen fehlt');
    await act(async () => approve.click());
    expect(mocks.decideCoverRequest).toHaveBeenCalledWith('cover-a', expect.objectContaining({
      decision: 'approved',
      expectedVersion: 2,
      employeeId: 'employee-a',
      clientMutationId: 'mutation-id'
    }));
  });

  test('loads persisted actual-time revision and history before allowing a correction', async () => {
    mocks.listAssignments.mockResolvedValue([{
      id: 'assignment-a',
      shift_id: 'shift-a',
      employee_id: 'employee-a',
      first_name: 'Ada',
      last_name: 'Guard',
      status: 'assigned',
      revision_version: 1
    }]);
    const actualRecord = {
      id: 'actual-a',
      shift_id: 'shift-a',
      employee_id: 'employee-a',
      actual_start_at: '2027-01-10T08:03:00+01:00',
      actual_end_at: '2027-01-10T16:05:00+01:00',
      break_minutes: 30,
      revision_version: 7,
      recorded_by: 'user-b',
      recorded_at: '2027-01-10T15:10:00.000Z',
      notes: 'Initial capture'
    };
    mocks.getActualTime
      .mockResolvedValueOnce({
        current: actualRecord,
        history: [{ id: 'audit-a', actor_user_id: 'user-b', event_type: 'shift.actual_time.recorded', details: {}, created_at: actualRecord.recorded_at }]
      })
      .mockResolvedValueOnce({
        current: { ...actualRecord, revision_version: 8, notes: 'Corrected' },
        history: [{ id: 'audit-a', actor_user_id: 'user-b', event_type: 'shift.actual_time.recorded', details: {}, created_at: actualRecord.recorded_at }]
      });
    mocks.recordActualTime
      .mockRejectedValueOnce(new ApiError(500, 'Verbindung unterbrochen.', undefined, true))
      .mockResolvedValueOnce({ ...actualRecord, revision_version: 8, notes: 'Corrected' });
    await act(async () => root.render(<RosterModule />));
    const eventButton = container.querySelector<HTMLButtonElement>('button[aria-label*="Objekt A"]');
    if (!eventButton) throw new Error('Kalendereintrag fehlt');
    await act(async () => eventButton.click());
    await act(async () => new Promise(resolve => setTimeout(resolve, 0)));

    expect(mocks.getActualTime).toHaveBeenCalledWith('shift-a', 'employee-a');
    expect(container.textContent).toContain('Revision 7');
    expect(container.textContent).toContain('Änderungsverlauf (1)');
    const start = container.querySelector<HTMLInputElement>('input[placeholder="2027-01-10T08:03:00+01:00"]');
    const end = container.querySelector<HTMLInputElement>('input[placeholder="2027-01-10T16:05:00+01:00"]');
    if (!start || !end) throw new Error('Ist-Zeitfelder fehlen');
    await act(async () => {
      setInput(start, '2027-01-10T08:03:00+01:00');
      setInput(end, '2027-01-10T16:05:00+01:00');
    });
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Ist-Zeit serverseitig speichern'));
    if (!save) throw new Error('Ist-Zeit speichern fehlt');
    await act(async () => save.click());
    await act(async () => save.click());

    expect(mocks.recordActualTime).toHaveBeenNthCalledWith(1, 'shift-a', expect.objectContaining({
      employeeId: 'employee-a',
      actualStartAt: '2027-01-10T08:03:00+01:00',
      expectedVersion: 7,
      clientMutationId: 'mutation-id'
    }));
    expect(mocks.recordActualTime).toHaveBeenNthCalledWith(2, 'shift-a', expect.objectContaining({ clientMutationId: 'mutation-id' }));
    expect(mocks.getActualTime).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Revision 8');
    expect(container.querySelector<HTMLInputElement>('input[type="number"][min="0"][step="1"]')).toBeNull();
  });

  test('keeps template, cover, and actual-time workflows online-only', async () => {
    mocks.storeState.isOnline = false;
    await act(async () => root.render(<RosterModule />));
    const templateButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Vorlagen');
    const coverButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Vertretungsanträge'));
    if (!templateButton || !coverButton) throw new Error('Online-only Aktionen fehlen');
    expect(templateButton.disabled).toBe(true);
    expect(coverButton.disabled).toBe(true);

    const eventButton = container.querySelector<HTMLButtonElement>('button[aria-label*="Objekt A"]');
    if (!eventButton) throw new Error('Kalendereintrag fehlt');
    await act(async () => eventButton.click());
    expect(container.textContent).not.toContain('Vertretungsbedarf einreichen');
    expect(container.textContent).not.toContain('Ist-Zeit serverseitig speichern');
    expect(mocks.createCoverRequest).not.toHaveBeenCalled();
    expect(mocks.decideCoverRequest).not.toHaveBeenCalled();
    expect(mocks.recordActualTime).not.toHaveBeenCalled();
    expect(mocks.enqueueOfflineAction).not.toHaveBeenCalled();
  });

  test('creates sourced, effective-dated rule profiles without supplying default thresholds', async () => {
    await act(async () => root.render(<RosterModule />));
    const openButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Regelprofile'));
    if (!openButton) throw new Error('Regelprofile fehlen');
    await act(async () => openButton.click());
    const createButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Neues Regelprofil'));
    if (!createButton) throw new Error('Regelprofil erstellen fehlt');
    await act(async () => createButton.click());

    const fill = async (label: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
      if (!input) throw new Error(`${label} fehlt`);
      await act(async () => setInput(input, value));
    };
    await fill('Profilname', 'Arbeitszeitprofil');
    await fill('Quellenname', 'Betriebsvereinbarung');
    await fill('Quellenreferenz', 'BV-2026-01');
    await fill('Regelwert', '720');
    await fill('Quelle der Regel', 'Abschnitt 4');

    const addRule = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Regel hinzufügen'));
    if (!addRule) throw new Error('Regel hinzufügen fehlt');
    await act(async () => addRule.click());
    const submit = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Entwurfsrevision speichern'));
    if (!submit) throw new Error('Speichern fehlt');
    await act(async () => submit.click());

    expect(mocks.createRuleProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Arbeitszeitprofil',
      scope: {},
      sourceName: 'Betriebsvereinbarung',
      sourceReference: 'BV-2026-01',
      rules: [{
        code: 'minimum_rest_minutes',
        value: 720,
        source: 'Abschnitt 4',
        severity: 'blocking'
      }]
    }));
    expect(container.textContent).toContain('Regelprofil und erste Entwurfsrevision gespeichert');
  });

  test('delegates rule-profile creator approval restrictions to the server and displays its rejection', async () => {
    mocks.listRuleProfiles.mockResolvedValue([{
      id: 'profile-a',
      name: 'Arbeitszeitprofil',
      scope: {},
      active: true,
      created_by: 'user-b',
      created_at: '2026-11-01T00:00:00Z',
      version_id: 'version-a',
      version_number: 1,
      effective_from: '2026-11-01',
      source_name: 'Betriebsvereinbarung',
      source_reference: 'BV-2026-01',
      rules: [{ code: 'minimum_rest_minutes', value: 720, source: 'Abschnitt 4', severity: 'blocking' }],
      version_status: 'draft'
    }]);
    mocks.approveRuleProfileVersion.mockRejectedValueOnce(new ApiError(
      403, 'Eine Regelprofilrevision darf nicht durch ihren Ersteller freigegeben werden.'
    ));
    await act(async () => root.render(<RosterModule />));
    const openButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Regelprofile'));
    if (!openButton) throw new Error('Regelprofile fehlen');
    await act(async () => openButton.click());
    const approveButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Revision freigeben'));
    if (!approveButton) throw new Error('Freigabe fehlt');
    await act(async () => approveButton.click());

    expect(mocks.approveRuleProfileVersion).toHaveBeenCalledWith('profile-a', 'version-a');
    expect(container.textContent).toContain('darf nicht durch ihren Ersteller freigegeben werden');
  });

  test('does not expose cached rule profiles or mutations while offline', async () => {
    mocks.storeState.isOnline = false;
    mocks.listRuleProfiles.mockResolvedValue([{
      id: 'profile-a',
      name: 'Online-Profil',
      scope: {},
      active: true,
      created_by: 'user-b',
      created_at: '2026-11-01T00:00:00Z',
      version_id: 'version-a',
      version_number: 1,
      effective_from: '2026-11-01',
      source_name: 'Policy',
      source_reference: 'policy-2026',
      rules: [],
      version_status: 'draft'
    }]);
    await act(async () => root.render(<RosterModule />));
    const openButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Regelprofile'));
    if (!openButton) throw new Error('Regelprofile fehlen');
    await act(async () => openButton.click());

    expect(container.textContent).not.toContain('Online-Profil');
    expect(container.textContent).toContain('nicht offline gespeichert oder freigegeben');
    const createButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Neues Regelprofil'));
    expect(createButton?.disabled).toBe(true);
    expect(mocks.listRuleProfiles).not.toHaveBeenCalled();
  });

  test('warns when the offline planning cache does not include the requested date range', async () => {
    mocks.storeState.isOnline = false;
    mocks.getPlanningCache.mockResolvedValue({
      shifts: [{ ...shift, date: '2000-01-15' }],
      periods: [],
      rangeFrom: '2000-01-01',
      rangeTo: '2000-01-31',
      cachedAt: new Date().toISOString()
    });
    await act(async () => root.render(<RosterModule />));

    expect(container.textContent).toContain('enthält nur den zuletzt geladenen Bereich 2000-01-01 bis 2000-01-31');
    expect(container.textContent).toContain('Leere Bereiche außerhalb des Caches bestätigen nicht, dass dort keine Schichten bestehen.');
  });

  test('queues only a supported offline draft create and labels it pending, not approved', async () => {
    mocks.storeState.isOnline = false;
    await act(async () => root.render(<RosterModule />));
    const create = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Schicht anlegen'));
    if (!create) throw new Error('Schicht anlegen fehlt');
    await act(async () => create.click());
    const submit = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Entwurf speichern'));
    if (!submit) throw new Error('Offline-Entwurf speichern fehlt');
    await act(async () => submit.click());

    expect(mocks.enqueueOfflineAction).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'shift',
      action: 'CREATE',
      baseVersion: 1,
      payload: expect.not.objectContaining({ schedulePeriodId: expect.anything(), requiredStaffCount: expect.anything(), employeeId: expect.anything() })
    }));
    expect(container.textContent).toContain('Noch nicht servergeprüft');
    expect(container.textContent).toContain('Offline-Cache');
  });

  test('queues offline draft updates with the server ID and base revision', async () => {
    mocks.storeState.isOnline = false;
    await act(async () => root.render(<RosterModule />));
    const eventButton = container.querySelector<HTMLButtonElement>('button[aria-label*="Objekt A"]');
    if (!eventButton) throw new Error('Kalendereintrag fehlt');
    await act(async () => eventButton.click());
    const edit = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Bearbeiten'));
    if (!edit) throw new Error('Offline-Bearbeiten fehlt');
    await act(async () => edit.click());

    const start = container.querySelector<HTMLInputElement>('input[type="time"]');
    if (!start) throw new Error('Beginn fehlt');
    await act(async () => setInput(start, '09:00'));
    const submit = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Änderungen speichern'));
    if (!submit) throw new Error('Offline-Änderung speichern fehlt');
    await act(async () => submit.click());

    expect(mocks.enqueueOfflineAction).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'shift',
      action: 'UPDATE',
      baseVersion: 4,
      payload: expect.objectContaining({
        id: 'shift-a',
        startTime: '09:00'
      })
    }));
    const queuedPayload = mocks.enqueueOfflineAction.mock.calls[0][0].payload;
    expect(queuedPayload).not.toHaveProperty('schedulePeriodId');
    expect(queuedPayload).not.toHaveProperty('requiredStaffCount');
    expect(container.textContent).toContain('lokal vorgemerkt');
    expect(container.querySelector('button[aria-label*="Sync pending"]')).not.toBeNull();
  });

  test("does not project another user's shift outbox entries into the planning view", async () => {
    mocks.storeState.isOnline = false;
    mocks.getOutbox.mockResolvedValue([{
      id: 'foreign-mutation',
      tenantId: 'tenant-a',
      userId: 'user-b',
      deviceId: 'device-b',
      entityType: 'shift',
      action: 'CREATE',
      payload: {
        siteId: 'site-a',
        date,
        startTime: '11:00',
        endTime: '12:00',
        type: 'Tagdienst',
        requiredQualification: 'Unterrichtung'
      },
      occurredAt: new Date().toISOString(),
      baseVersion: 1,
      retryCount: 0,
      status: 'PENDING'
    }]);
    await act(async () => root.render(<RosterModule />));
    expect(container.textContent).not.toContain('11:00');
    expect(container.textContent).toContain('08:00');
  });
});
