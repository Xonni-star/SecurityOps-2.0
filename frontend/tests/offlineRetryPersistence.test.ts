import { afterEach, describe, expect, test } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbService } from '../services/indexedDbService';

describe('Offline outbox retry persistence', () => {
  const services: IndexedDbService[] = [];

  afterEach(() => {
    services.splice(0).forEach(service => service.close());
  });

  function createVault(): IndexedDbService {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: new IDBFactory()
    });
    const vault = new IndexedDbService();
    services.push(vault);
    return vault;
  }

  test('persists retry timing and replays the same mutation ID after reopening', async () => {
    const beforeRestart = createVault();
    await beforeRestart.enqueueMutation({
      id: 'retry-mutation-id',
      tenantId: 'tenant-retry-test',
      userId: 'user-retry-test',
      entityType: 'task',
      action: 'CREATE',
      payload: { title: 'Persisted task' },
      occurredAt: '2026-11-14T11:59:00.000Z',
      baseVersion: 1
    });
    await beforeRestart.updateMutationStatus('retry-mutation-id', 'FAILED', {
      errorMessage: 'HTTP 503: Temporarily unavailable',
      retryable: true
    });

    const afterRestart = new IndexedDbService();
    services.push(afterRestart);
    beforeRestart.close();

    const stored = await afterRestart.getOutbox('tenant-retry-test', undefined, 'user-retry-test');
    const nextAttemptAt = Date.parse(stored[0].nextAttemptAt!);
    expect(await afterRestart.getPendingOutbox('tenant-retry-test', 'user-retry-test')).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextAttemptAt - Date.now()) + 10));

    const due = await afterRestart.getPendingOutbox('tenant-retry-test', 'user-retry-test');
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      id: 'retry-mutation-id',
      tenantId: 'tenant-retry-test',
      userId: 'user-retry-test',
      payload: { title: 'Persisted task' },
      retryCount: 1,
      retryable: true,
      nextAttemptAt: stored[0].nextAttemptAt
    });
  });

  test('rejects a mutation ID collision without replacing another tenant outbox entry', async () => {
    const vault = createVault();
    const original = {
      id: 'shared-mutation-id',
      tenantId: 'tenant-a',
      userId: 'user-a',
      entityType: 'task' as const,
      action: 'CREATE' as const,
      payload: { title: 'Tenant A task' },
      occurredAt: '2026-11-14T11:59:00.000Z',
      baseVersion: 1
    };

    await vault.enqueueMutation(original);
    await expect(vault.enqueueMutation({
      ...original,
      tenantId: 'tenant-b',
      userId: 'user-b',
      payload: { title: 'Tenant B task' }
    })).rejects.toMatchObject({ name: 'ConstraintError' });

    await expect(vault.getOutbox('tenant-a', undefined, 'user-a')).resolves.toMatchObject([
      expect.objectContaining({
        id: 'shared-mutation-id',
        tenantId: 'tenant-a',
        userId: 'user-a',
        payload: { title: 'Tenant A task' }
      })
    ]);
    await expect(vault.getOutbox('tenant-b', undefined, 'user-b')).resolves.toEqual([]);
  });

  test('does not automatically replay terminal failures or conflicts', async () => {
    const vault = createVault();
    await vault.enqueueMutation({
      id: 'terminal-mutation-id',
      tenantId: 'tenant-retry-test',
      userId: 'user-retry-test',
      entityType: 'task',
      action: 'CREATE',
      payload: { title: 'Denied task' },
      occurredAt: '2026-11-14T11:59:00.000Z',
      baseVersion: 1
    });
    await vault.updateMutationStatus('terminal-mutation-id', 'FAILED', {
      errorMessage: 'HTTP 403: Forbidden',
      retryable: false
    });
    await vault.enqueueMutation({
      id: 'conflicted-mutation-id',
      tenantId: 'tenant-retry-test',
      userId: 'user-retry-test',
      entityType: 'task',
      action: 'UPDATE',
      payload: { title: 'Conflicted task' },
      occurredAt: '2026-11-14T11:59:01.000Z',
      baseVersion: 1
    });
    await vault.updateMutationStatus('conflicted-mutation-id', 'CONFLICT');

    expect(await vault.getPendingOutbox('tenant-retry-test', 'user-retry-test')).toEqual([]);
    expect(await vault.getOutbox('tenant-retry-test', undefined, 'user-retry-test')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'terminal-mutation-id', status: 'FAILED', retryable: false, nextAttemptAt: undefined }),
      expect.objectContaining({ id: 'conflicted-mutation-id', status: 'CONFLICT', retryable: false, nextAttemptAt: undefined })
    ]));
    expect(await vault.getPendingOutbox('tenant-retry-test', 'user-retry-test', { includeFailed: true }))
      .toMatchObject([{ id: 'terminal-mutation-id', status: 'FAILED' }]);
  });

  test('stops automatic retries at the configured attempt bound', async () => {
    const vault = createVault();
    await vault.enqueueMutation({
      id: 'bounded-mutation-id',
      tenantId: 'tenant-retry-test',
      userId: 'user-retry-test',
      entityType: 'task',
      action: 'CREATE',
      payload: { title: 'Bounded task' },
      occurredAt: '2026-11-14T11:59:00.000Z',
      baseVersion: 1
    });

    for (let attempt = 1; attempt <= 6; attempt++) {
      await vault.updateMutationStatus('bounded-mutation-id', 'FAILED', { retryable: true });
    }

    expect(await vault.getPendingOutbox('tenant-retry-test', 'user-retry-test')).toEqual([]);
    expect(await vault.getOutbox('tenant-retry-test', undefined, 'user-retry-test')).toMatchObject([
      { id: 'bounded-mutation-id', retryCount: 6, retryable: false, nextAttemptAt: undefined }
    ]);
  });
});
