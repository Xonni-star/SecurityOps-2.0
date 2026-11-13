import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  reportAlarmIncident: vi.fn(),
  changeAlarmStatus: vi.fn(),
  addAlarmAction: vi.fn(),
  loadTenantData: vi.fn(),
  loadAlarmIncidents: vi.fn(),
  state: {
    emergencyPlans: [] as any[],
    alarmIncidents: [] as any[],
    alarmTypes: [] as any[],
    alarmSites: [] as any[],
    clients: [] as any[],
    employees: [] as any[],
    documents: [] as any[],
    pendingAlarmMutations: [] as any[],
    isOnline: true,
    sites: [] as any[],
    authUser: { permissions: ['alarm:read', 'alarm:manage', 'alarm:report', 'alarm:respond'], tenantId: 'tenant-a' },
    loadTenantData: vi.fn(),
    loadAlarmIncidents: vi.fn()
  }
}));

vi.mock('../services/apiClient', () => ({
  apiClient: { get: mocks.get, post: mocks.post, patch: mocks.patch }
}));

vi.mock('../store', () => ({
  useSecurityStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}));

import { AlarmsModule } from '../components/AlarmsModule';

const site = {
  id: 'site-a',
  tenantId: 'tenant-a',
  name: 'Objekt A'
};

const incident = {
  id: 'alarm-a',
  tenantId: 'tenant-a',
  siteId: 'site-a',
  siteName: 'Objekt A',
  scenario: 'BMA - Brandmeldeanlage',
  severity: 'Kritisch',
  status: 'neu',
  title: 'Brandmelder ausgelöst',
  description: 'Technikraum prüfen',
  reportedAt: '2026-11-12T10:00:00.000Z',
  revisionVersion: 1
};

describe('AlarmsModule', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.state.emergencyPlans = [];
    mocks.state.alarmIncidents = [incident];
    mocks.state.alarmTypes = [{ id: 'type-a', code: 'fire', label: 'Brand', isActive: true }];
    mocks.state.alarmSites = [{ ...site, customerId: 'customer-a' }];
    mocks.state.clients = [];
    mocks.state.employees = [];
    mocks.state.documents = [];
    mocks.state.pendingAlarmMutations = [];
    mocks.state.isOnline = true;
    Object.assign(mocks.state, {
      reportAlarmIncident: mocks.reportAlarmIncident,
      changeAlarmStatus: mocks.changeAlarmStatus,
      addAlarmAction: mocks.addAlarmAction
    });
    mocks.state.sites = [site];
    mocks.state.authUser = {
      permissions: ['alarm:read', 'alarm:manage', 'alarm:report', 'alarm:respond'],
      tenantId: 'tenant-a'
    };
    mocks.state.loadTenantData = mocks.loadTenantData;
    mocks.state.loadAlarmIncidents = mocks.loadAlarmIncidents;
    mocks.get.mockResolvedValue([]);
    mocks.post.mockResolvedValue({});
    mocks.reportAlarmIncident.mockResolvedValue({ state: 'confirmed' });
    mocks.changeAlarmStatus.mockResolvedValue({ state: 'confirmed' });
    mocks.addAlarmAction.mockResolvedValue({ state: 'confirmed' });
    mocks.loadTenantData.mockResolvedValue(undefined);
    mocks.loadAlarmIncidents.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test('alarm reports are submitted through the durable alarm mutation store', async () => {
    await act(async () => root.render(<AlarmsModule />));
    const reportButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Alarm melden'));
    await act(async () => reportButton?.click());

    const title = container.querySelector<HTMLInputElement>('input[maxlength="255"]');
    if (!title) throw new Error('Alarmtitel-Feld fehlt');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), 'value')?.set;
      setter?.call(title, 'BMA ausgelöst');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      title.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const selects = container.querySelectorAll('select');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(selects[0]), 'value')?.set;
      setter?.call(selects[0], 'site-a');
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Meldung speichern'));
    await act(async () => save?.click());

    expect(mocks.reportAlarmIncident).toHaveBeenCalledWith(expect.objectContaining({
      siteId: 'site-a',
      severity: 'Dringend',
      title: 'BMA ausgelöst',
      emergencyPlanId: null
    }));
  });

  test('read-only access does not expose alarm reporting or plan administration actions', async () => {
    mocks.state.authUser = { permissions: ['alarm:read'], tenantId: 'tenant-a' };
    await act(async () => root.render(<AlarmsModule />));

    expect(container.textContent).toContain('Brandmelder ausgelöst');
    expect(container.textContent).not.toContain('Alarm melden');
    await act(async () => {
      const plansTab = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Notfallpläne'));
      plansTab?.click();
    });
    expect(container.textContent).not.toContain('Notfallplan anlegen');
  });

  test('incident response requires a documented action note', async () => {
    await act(async () => root.render(<AlarmsModule />));
    const changeStatus = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Status ändern'));
    await act(async () => changeStatus?.click());

    expect(container.textContent).toContain('Bitte einen zulässigen Zielstatus und eine Begründung auswählen.');
    expect(mocks.changeAlarmStatus).not.toHaveBeenCalled();
  });

  test('dashboard filters are requested from the server with the active criteria', async () => {
    await act(async () => root.render(<AlarmsModule />));
    const priority = Array.from(container.querySelectorAll('select'))
      .find(select => Array.from(select.options).some(option => option.textContent === 'Alle Prioritäten'));
    if (!priority) throw new Error('Prioritätsfilter fehlt');
    await act(async () => {
      priority.value = 'Kritisch';
      priority.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(mocks.loadAlarmIncidents).toHaveBeenLastCalledWith(expect.objectContaining({
      severity: 'Kritisch'
    }));
  });
});
