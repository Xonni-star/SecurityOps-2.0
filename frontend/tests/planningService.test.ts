import { describe, expect, test } from 'vitest';
import { ApiError } from '../services/apiClient';
import {
  calendarRange, mergeOutboxShifts, planningErrorDetails, reconcileShiftMutation, shiftCalendarDate
} from '../services/planningService';
import type { OutboxMutation } from '../services/indexedDbService';

describe('service planning helpers', () => {
  test('calculates month, ISO-style Monday week, and day navigation ranges', () => {
    expect(calendarRange('2026-02-14', 'month')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(calendarRange('2026-11-13', 'week')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(calendarRange('2026-11-13', 'day')).toEqual({ from: '2026-11-13', to: '2026-11-13' });
    expect(shiftCalendarDate('2026-01-31', 'month', 1)).toBe('2026-02-28');
  });

  test('projects supported offline create fields as pending and exposes queued conflicts', () => {
    const mutation: OutboxMutation = {
      id: 'local-shift-id',
      tenantId: 'tenant-a',
      userId: 'user-a',
      deviceId: 'device-a',
      entityType: 'shift',
      action: 'CREATE',
      payload: {
        siteId: 'site-a',
        date: '2026-11-13',
        startTime: '22:00',
        endTime: '06:00',
        type: 'Nachtdienst',
        requiredQualification: 'Unterrichtung § 34a GewO',
        breakMinutes: 30,
        status: 'Offen'
      },
      occurredAt: '2026-11-13T12:00:00.000Z',
      baseVersion: 1,
      retryCount: 0,
      status: 'CONFLICT',
      errorMessage: 'Revision conflict'
    };

    const [shift] = mergeOutboxShifts([], [mutation], 'tenant-a', [], [{
      id: 'site-a', tenantId: 'tenant-a', name: 'Objekt A'
    } as any]);
    expect(shift).toMatchObject({
      id: 'local-shift-id',
      siteName: 'Objekt A',
      date: '2026-11-13',
      planningStatus: 'draft',
      syncStatus: 'conflict',
      assignedCount: 0
    });
  });

  test('preserves validation findings and conflict codes from API errors', () => {
    const finding = { code: 'QUALIFICATION_MISSING', severity: 'blocking' as const, message: 'Qualifikation fehlt.' };
    const result = planningErrorDetails(new ApiError(
      422, 'Serverprüfung fehlgeschlagen.', undefined, false,
      'PLANNING_VALIDATION_FAILED', { findings: [finding] }
    ));
    expect(result.code).toBe('PLANNING_VALIDATION_FAILED');
    expect(result.findings).toEqual([finding]);
  });

  test('reconciles an offline create to its server ID and leaves conflicts visible', () => {
    const mutation: OutboxMutation = {
      id: 'local-shift-id',
      tenantId: 'tenant-a',
      userId: 'user-a',
      deviceId: 'device-a',
      entityType: 'shift',
      action: 'CREATE',
      payload: { siteId: 'site-a' },
      occurredAt: '2026-11-13T12:00:00.000Z',
      baseVersion: 1,
      retryCount: 0,
      status: 'PENDING'
    };
    const pending = [{
      id: 'local-shift-id', tenantId: 'tenant-a', siteId: 'site-a', siteName: 'Objekt A',
      date: '2026-11-13', startTime: '08:00', endTime: '16:00', type: 'Tagdienst',
      status: 'Offen', requiredQualification: 'Unterrichtung', revisionVersion: 1,
      syncStatus: 'pending'
    }] as any;

    expect(reconcileShiftMutation(pending, mutation, {
      status: 'SYNCED', serverId: 'server-shift-id', serverVersion: 1
    })[0]).toMatchObject({ id: 'server-shift-id', syncStatus: 'synced' });
    expect(reconcileShiftMutation(pending, mutation, {
      status: 'CONFLICT', serverId: 'server-shift-id', serverVersion: 2
    })[0]).toMatchObject({ id: 'local-shift-id', syncStatus: 'conflict' });
  });
});
