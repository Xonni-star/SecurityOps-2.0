import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, apiClient } from '../services/apiClient';
import {
  calendarRange, mergeOutboxShifts, planningApi, planningErrorDetails, reconcileShiftMutation, shiftCalendarDate
} from '../services/planningService';
import type { OutboxMutation } from '../services/indexedDbService';

afterEach(() => vi.restoreAllMocks());

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

  test('uses the documented rule-profile list, version, and approval contracts', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({});
    const rule = {
      code: 'minimum_rest_minutes' as const,
      value: 720,
      source: 'Policy section 4',
      severity: 'blocking' as const
    };

    await planningApi.listRuleProfiles();
    await planningApi.createRuleProfile({
      name: 'Profile A',
      scope: {},
      effectiveFrom: '2026-11-01',
      sourceName: 'Policy',
      sourceReference: 'policy-2026',
      rules: [rule]
    });
    await planningApi.createRuleProfileVersion('profile/a', {
      effectiveFrom: '2027-01-01',
      sourceName: 'Policy',
      sourceReference: 'policy-2027',
      rules: [rule]
    });
    await planningApi.approveRuleProfileVersion('profile/a', 'version a');
    await planningApi.setRuleProfileActive('profile/a', false);

    expect(get).toHaveBeenCalledWith('/planning/rule-profiles?page=1&pageSize=200');
    expect(post).toHaveBeenNthCalledWith(1, '/planning/rule-profiles', expect.objectContaining({ name: 'Profile A', rules: [rule] }));
    expect(post).toHaveBeenNthCalledWith(2, '/planning/rule-profiles/profile%2Fa/versions', {
      effectiveFrom: '2027-01-01',
      sourceName: 'Policy',
      sourceReference: 'policy-2027',
      rules: [rule]
    });
    expect(post).toHaveBeenNthCalledWith(3, '/planning/rule-profiles/profile%2Fa/versions/version%20a/approve', {});
    expect(patch).toHaveBeenCalledWith('/planning/rule-profiles/profile%2Fa', { active: false });
  });

  test('uses documented templates, cover, actual-time, and report endpoints', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
    await planningApi.listTemplates('site/a');
    await planningApi.createTemplate({
      siteId: 'site-a',
      name: 'Weekly',
      startTime: '08:00',
      endTime: '16:00',
      requiredQualification: 'Sachkunde',
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: [1, 2]
    });
    await planningApi.applyTemplate('template/a', {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      schedulePeriodId: 'period-a'
    });
    await planningApi.createCoverRequest('shift/a', {
      expectedShiftVersion: 4, clientMutationId: 'cover-mutation', reason: 'Ausfall'
    });
    await planningApi.coverRequests('pending', 'shift/a');
    await planningApi.decideCoverRequest('request/a', {
      decision: 'approved', expectedVersion: 1, employeeId: 'employee-a', clientMutationId: 'decision-mutation'
    });
    await planningApi.recordActualTime('shift/a', {
      employeeId: 'employee-a',
      actualStartAt: '2026-11-13T08:03:00+01:00',
      actualEndAt: '2026-11-13T16:05:00+01:00',
      breakMinutes: 30,
      expectedVersion: 0,
      clientMutationId: 'actual-mutation'
    });
    await planningApi.workHours('2026-11-01', '2026-11-30');
    await planningApi.coverage('2026-11-01', '2026-11-30');
    await planningApi.qualifications('2026-11-01', '2026-11-30');
    await planningApi.absences('2026-11-01', '2026-11-30');

    expect(get).toHaveBeenCalledWith('/planning/templates?siteId=site%2Fa&page=1&pageSize=200');
    expect(get).toHaveBeenCalledWith('/planning/cover-requests?status=pending&shiftId=shift%2Fa&page=1&pageSize=200');
    expect(get).toHaveBeenCalledWith('/planning/reports/qualifications?from=2026-11-01&to=2026-11-30');
    expect(get).toHaveBeenCalledWith('/planning/reports/absences?from=2026-11-01&to=2026-11-30');
    expect(post).toHaveBeenCalledWith('/planning/shifts/shift%2Fa/cover-requests', expect.objectContaining({ expectedShiftVersion: 4 }));
    expect(post).toHaveBeenCalledWith('/planning/cover-requests/request%2Fa/decision', expect.objectContaining({ expectedVersion: 1 }));
    expect(post).toHaveBeenCalledWith('/planning/shifts/shift%2Fa/actual-time', expect.objectContaining({
      expectedVersion: 0,
      actualStartAt: '2026-11-13T08:03:00+01:00'
    }));
  });
});
