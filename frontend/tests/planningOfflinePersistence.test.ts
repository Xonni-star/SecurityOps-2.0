import { afterEach, describe, expect, test } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbService } from '../services/indexedDbService';

describe('service planning offline cache', () => {
  const services: IndexedDbService[] = [];

  afterEach(() => {
    services.splice(0).forEach(service => service.close());
  });

  test('retains the tenant/user plan snapshot across vault reopen', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: new IDBFactory()
    });

    const beforeRestart = new IndexedDbService();
    services.push(beforeRestart);
    const snapshot = {
      shifts: [{ id: 'shift-a', date: '2026-11-13', planningStatus: 'draft' }],
      periods: [{ id: 'period-a', status: 'draft' }]
    };
    await beforeRestart.savePlanningCache('tenant-a', 'user-a', snapshot.shifts, snapshot.periods, {
      from: '2026-11-01',
      to: '2026-11-30'
    });

    const afterRestart = new IndexedDbService();
    services.push(afterRestart);
    const cached = await afterRestart.getPlanningCache('tenant-a', 'user-a');
    expect(cached).toMatchObject(snapshot);
    expect(cached).toMatchObject({ rangeFrom: '2026-11-01', rangeTo: '2026-11-30' });
    expect(cached?.cachedAt).toBeTruthy();
    expect(await afterRestart.getPlanningCache('tenant-b', 'user-a')).toBeNull();
  });
});
