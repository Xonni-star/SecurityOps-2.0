import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  store: {} as any,
  getStorageEstimates: vi.fn()
}));

vi.mock('../store', () => ({
  useSecurityStore: vi.fn(() => mocks.store)
}));

vi.mock('../services/indexedDbService', () => ({
  offlineVault: {
    getStorageEstimates: mocks.getStorageEstimates,
    getDeviceId: vi.fn(() => 'device-a')
  }
}));

import { SyncManagerModal } from '../components/SyncManagerModal';

function shiftConflict(serverPayload?: Record<string, unknown>) {
  return {
    id: 'mutation-shift-a',
    tenantId: 'tenant-a',
    userId: 'user-a',
    entityType: 'shift',
    action: 'UPDATE',
    payload: { id: 'shift-a', startTime: '08:00' },
    createdAt: '2026-11-13T10:00:00.000Z',
    retryCount: 0,
    status: 'conflict',
    conflictDetails: {
      clientVersion: 1,
      serverVersion: 2,
      ...(serverPayload ? { serverPayload } : {})
    }
  };
}

describe('SyncManagerModal shift conflict snapshots', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.getStorageEstimates.mockResolvedValue({
      usageBytes: 1000,
      quotaBytes: 100000,
      percentage: 1
    });
    mocks.store = {
      isOnline: true,
      currentTenantId: 'tenant-a',
      currentUserId: 'user-a',
      authUser: { id: 'user-a' },
      toggleNetworkSimulation: vi.fn(),
      syncQueue: [shiftConflict({
        id: 'shift-a',
        shift_date: '2026-11-14',
        start_time: '09:00',
        revision_version: 2
      })],
      triggerManualSync: vi.fn(),
      resolveConflict: vi.fn().mockResolvedValue(undefined),
      clearCompletedSyncs: vi.fn(),
      getCurrentTenant: () => ({ name: 'Tenant A' })
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test('shows the server snapshot before enabling shift conflict decisions', async () => {
    await act(async () => root.render(<SyncManagerModal isOpen onClose={vi.fn()} />));
    const openConflict = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Konflikt lösen'));
    if (!openConflict) throw new Error('Konflikt öffnen fehlt');
    await act(async () => openConflict.click());

    expect(container.textContent).toContain('"shift_date": "2026-11-14"');
    expect(container.textContent).not.toContain('Konfliktauflösung ist gesperrt');
    const useLocal = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Lokale Version durchsetzen'));
    expect(useLocal?.disabled).toBe(false);
    await act(async () => useLocal?.click());
    expect(mocks.store.resolveConflict).toHaveBeenCalledWith('mutation-shift-a', 'USE_LOCAL');
  });

  test('blocks shift decisions when the server has not returned a snapshot', async () => {
    mocks.store.syncQueue = [shiftConflict()];
    await act(async () => root.render(<SyncManagerModal isOpen onClose={vi.fn()} />));
    const openConflict = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Konflikt lösen'));
    if (!openConflict) throw new Error('Konflikt öffnen fehlt');
    await act(async () => openConflict.click());

    expect(container.textContent).toContain('Der Server hat noch keinen aktuellen Schicht-Snapshot geliefert.');
    const decisions = Array.from(container.querySelectorAll('button')).filter(button =>
      button.textContent?.includes('Lokale Version durchsetzen') ||
      button.textContent?.includes('Server-Stand übernehmen')
    );
    expect(decisions).toHaveLength(2);
    expect(decisions.every(button => button.disabled)).toBe(true);
    expect(mocks.store.resolveConflict).not.toHaveBeenCalled();
  });
});
