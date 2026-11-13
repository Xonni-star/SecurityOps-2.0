import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listShifts: vi.fn(),
  listPeriods: vi.fn(),
  coverage: vi.fn(),
  listAssignments: vi.fn(),
  listFindings: vi.fn(),
  listSwaps: vi.fn(),
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
    constructor(status: number, message: string, _errors?: string[], _network = false, code?: string, data?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.data = data;
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
      listFindings: mocks.listFindings,
      listSwaps: mocks.listSwaps,
      createShift: mocks.createShift,
      updateShift: mocks.updateShift,
      deleteShift: mocks.deleteShift,
      createPeriod: mocks.createPeriod,
      publishPeriod: mocks.publishPeriod,
      createTemplate: mocks.createTemplate,
      applyTemplate: mocks.applyTemplate,
      createSwap: mocks.createSwap,
      decideSwap: mocks.decideSwap,
      workHours: mocks.workHours
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
    mocks.listFindings.mockResolvedValue([]);
    mocks.listSwaps.mockResolvedValue([]);
    mocks.createPeriod.mockResolvedValue(period);
    mocks.createTemplate.mockResolvedValue({ id: 'template-a' });
    mocks.applyTemplate.mockResolvedValue({ occurrences: [] });
    mocks.createSwap.mockResolvedValue({});
    mocks.decideSwap.mockResolvedValue({});
    mocks.workHours.mockResolvedValue([]);
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
    expect(container.querySelector('[aria-label="Berichtsabdeckung"]')?.textContent).toContain('Ist-Stunden und Überstunden');
    expect(container.querySelector('[aria-label="Berichtsabdeckung"]')?.textContent).toContain('Qualifikations- und Abwesenheitsauswertung');
    expect(container.textContent).not.toContain('Überstunden: 0');
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
