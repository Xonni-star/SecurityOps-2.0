import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  loadTenantData: vi.fn(),
  state: {
    emergencyPlans: [] as any[],
    alarmIncidents: [] as any[],
    sites: [] as any[],
    authUser: { permissions: ['alarm:read', 'alarm:manage', 'alarm:report', 'alarm:respond'], tenantId: 'tenant-a' },
    loadTenantData: vi.fn()
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
  status: 'gemeldet',
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
    mocks.state.sites = [site];
    mocks.state.authUser = {
      permissions: ['alarm:read', 'alarm:manage', 'alarm:report', 'alarm:respond'],
      tenantId: 'tenant-a'
    };
    mocks.state.loadTenantData = mocks.loadTenantData;
    mocks.get.mockResolvedValue([]);
    mocks.post.mockResolvedValue({});
    mocks.loadTenantData.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test('alarm reports are persisted through the API and refresh tenant data', async () => {
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

    expect(mocks.post).toHaveBeenCalledWith('/alarms', expect.objectContaining({
      siteId: 'site-a',
      scenario: 'BMA - Brandmeldeanlage',
      severity: 'Dringend',
      title: 'BMA ausgelöst',
      emergencyPlanId: null
    }));
    expect(mocks.loadTenantData).toHaveBeenCalled();
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
    const acknowledge = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Bestätigen'));
    await act(async () => acknowledge?.click());

    expect(container.textContent).toContain('Bitte vor der Statusänderung');
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
