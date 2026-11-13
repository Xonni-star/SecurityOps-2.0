import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  enqueueMutation: vi.fn(),
  getOutbox: vi.fn(),
  triggerManualSync: vi.fn(),
  state: {
    authUser: {
      id: 'user-1', email: 'outgoing@example.test', tenantId: 'tenant-a',
      permissions: ['handovers:read', 'handovers:create']
    },
    currentTenantId: 'tenant-a',
    isOnline: false,
    isSyncing: false,
    triggerManualSync: vi.fn(),
    getTenantSites: vi.fn(),
    getTenantEmployees: vi.fn(),
    getTenantShifts: vi.fn(),
    getTenantDocuments: vi.fn()
  }
}));

vi.mock('../services/apiClient', () => ({
  apiClient: { get: mocks.get, post: mocks.post, patch: mocks.patch }
}));

vi.mock('../services/indexedDbService', () => ({
  offlineVault: { enqueueMutation: mocks.enqueueMutation, getOutbox: mocks.getOutbox }
}));

vi.mock('../store', () => ({
  useSecurityStore: (selector?: (state: typeof mocks.state) => unknown) =>
    selector ? selector(mocks.state) : mocks.state
}));

import { HandoversModule } from '../components/HandoversModule';

describe('HandoversModule', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.state.authUser = {
      id: 'user-1', email: 'outgoing@example.test', tenantId: 'tenant-a',
      permissions: ['handovers:read', 'handovers:create']
    };
    mocks.state.currentTenantId = 'tenant-a';
    mocks.state.isOnline = false;
    mocks.state.isSyncing = false;
    mocks.state.triggerManualSync = mocks.triggerManualSync;
    mocks.state.getTenantSites.mockReturnValue([{ id: 'site-1', name: 'Objekt Nord' }]);
    mocks.state.getTenantEmployees.mockReturnValue([
      { id: 'employee-1', firstName: 'Alex', lastName: 'Alt', email: 'outgoing@example.test' },
      { id: 'employee-2', firstName: 'Sam', lastName: 'Neu', email: 'incoming@example.test' }
    ]);
    mocks.state.getTenantShifts.mockReturnValue([]);
    mocks.state.getTenantDocuments.mockReturnValue([]);
    mocks.get.mockImplementation((path: string) => path.includes('/dashboard')
      ? Promise.resolve({
        today: 0, waiting_handover_confirmation: 0, waiting_takeover_acknowledgement: 0,
        open_handovers: 0, open_tasks: 0, overdue_tasks: 0
      })
      : Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 }));
    mocks.enqueueMutation.mockResolvedValue({});
    mocks.getOutbox.mockResolvedValue([]);
    mocks.triggerManualSync.mockResolvedValue({ success: 0, failed: 0, conflicts: 0 });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test('offline handover is persisted to IndexedDB and never reported server-confirmed', async () => {
    await act(async () => root.render(<HandoversModule />));
    const create = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Neue Übergabe'));
    await act(async () => create?.click());
    const submit = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Übergabe lokal sichern'));
    await act(async () => submit?.click());

    expect(mocks.enqueueMutation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      userId: 'user-1',
      entityType: 'handover',
      action: 'CREATE',
      payload: expect.objectContaining({
        siteId: 'site-1',
        outgoingEmployeeId: 'employee-1',
        incomingEmployeeId: 'employee-2'
      })
    }));
    expect(container.textContent).toContain('Offline in der IndexedDB gespeichert.');
    expect(container.textContent).toContain('Serverbestätigung steht noch aus.');
    expect(container.textContent).not.toContain('Serverseitig bestätigt');
    expect(mocks.triggerManualSync).not.toHaveBeenCalled();
  });

  test('read-only users do not receive a handover creation action', async () => {
    mocks.state.authUser.permissions = ['handovers:read'];
    await act(async () => root.render(<HandoversModule />));
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent?.includes('Neue Übergabe'))).toBe(false);
  });
});
