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
        method: 'QR_CODE',
        latitude: 52.52,
        longitude: 13.405
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
    expect(pending[0].payload).toMatchObject({ latitude: 52.52, longitude: 13.405 });
  });

  test('restores cached routes and active rounds, and orders offline start before scans and completion', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: new IDBFactory()
    });

    const beforeRestart = new IndexedDbService();
    services.push(beforeRestart);
    await beforeRestart.savePatrolCheckpointCache('tenant-patrol-test', 'user-patrol-test', [
      { id: 'checkpoint-patrol-test', siteId: 'site-patrol-test', name: 'Entrance' }
    ], [
      { id: 'route-patrol-test', siteId: 'site-patrol-test', currentVersion: 3, checkpoints: ['checkpoint-patrol-test'] }
    ]);
    await beforeRestart.savePatrolRound({
      tenantId: 'tenant-patrol-test',
      userId: 'user-patrol-test',
      roundId: 'round-patrol-test',
      siteId: 'site-patrol-test',
      routeId: 'route-patrol-test',
      routeVersion: 3,
      startedAt: '2026-11-12T12:00:00.000Z',
      status: 'completion_pending',
      serverSynced: false
    });

    const occurredAt = '2026-11-12T12:00:00.000Z';
    for (const mutation of [
      { id: 'z-round-start', recordType: 'round_start', action: 'CREATE' as const },
      { id: 'a-round-scan', recordType: 'scan', action: 'CREATE' as const },
      { id: 'm-round-complete', recordType: 'round_complete', action: 'UPDATE' as const }
    ]) {
      await beforeRestart.enqueueMutation({
        id: mutation.id,
        tenantId: 'tenant-patrol-test',
        userId: 'user-patrol-test',
        entityType: 'patrol',
        action: mutation.action,
        payload: { recordType: mutation.recordType, roundId: 'round-patrol-test' },
        occurredAt,
        baseVersion: 1
      });
    }
    await beforeRestart.enqueueMutation({
      id: 'other-user-pending',
      tenantId: 'tenant-patrol-test',
      userId: 'different-user',
      entityType: 'patrol',
      action: 'CREATE',
      payload: { recordType: 'scan' },
      occurredAt,
      baseVersion: 1
    });
    await beforeRestart.enqueueMutation({
      id: 'unknown-owner-pending',
      tenantId: 'tenant-patrol-test',
      userId: '',
      entityType: 'patrol',
      action: 'CREATE',
      payload: { recordType: 'scan' },
      occurredAt,
      baseVersion: 1
    });

    const afterRestart = new IndexedDbService();
    services.push(afterRestart);
    const cached = await afterRestart.getPatrolCheckpointCache('tenant-patrol-test', 'user-patrol-test');
    const rounds = await afterRestart.getPatrolRounds('tenant-patrol-test', 'user-patrol-test');
    const pending = await afterRestart.getPendingOutbox('tenant-patrol-test', 'user-patrol-test');

    expect(cached?.routes).toEqual([
      { id: 'route-patrol-test', siteId: 'site-patrol-test', currentVersion: 3, checkpoints: ['checkpoint-patrol-test'] }
    ]);
    expect(rounds).toMatchObject([
      { roundId: 'round-patrol-test', routeVersion: 3, status: 'completion_pending', serverSynced: false }
    ]);
    expect(pending.map(item => item.id)).toEqual(['z-round-start', 'a-round-scan', 'm-round-complete']);
  });
});
