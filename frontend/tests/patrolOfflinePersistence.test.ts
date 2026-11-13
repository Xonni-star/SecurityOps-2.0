import { afterEach, describe, expect, test } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbService } from '../services/indexedDbService';

describe('Patrol offline outbox persistence', () => {
  const services: IndexedDbService[] = [];

  afterEach(() => {
    services.splice(0).forEach(service => service.close());
  });

  test('retains a pending scan and its verification token after reopening the vault', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: new IDBFactory()
    });

    const beforeRestart = new IndexedDbService();
    services.push(beforeRestart);
    await beforeRestart.enqueueMutation({
      id: 'patrol-mutation-123',
      tenantId: 'tenant-patrol-test',
      userId: 'user-patrol-test',
      entityType: 'patrol',
      action: 'CREATE',
      payload: {
        checkpointId: 'checkpoint-patrol-test',
        checkpointToken: 'A'.repeat(43),
        method: 'QR_CODE'
      },
      occurredAt: '2026-11-12T12:00:00.000Z',
      baseVersion: 1
    });

    const afterRestart = new IndexedDbService();
    services.push(afterRestart);
    const pending = await afterRestart.getOutbox('tenant-patrol-test', 'patrol');

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('patrol-mutation-123');
    expect(pending[0].status).toBe('PENDING');
    expect(pending[0].payload.checkpointToken).toBe('A'.repeat(43));
  });
});
