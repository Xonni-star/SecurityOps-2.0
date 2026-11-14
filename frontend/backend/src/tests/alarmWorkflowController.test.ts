import { Request, NextFunction } from 'express';
import { withTenantTransaction } from '../config/database';
import {
  listEmergencyPlanVersions,
  listRecentAlarmEvents,
  reportAlarmIncidentV2,
  syncAlarmMutations,
  transitionAlarmIncidentV2
} from '../controllers/alarmWorkflowController';

jest.mock('../config/database', () => ({
  withTenantTransaction: jest.fn()
}));

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const siteId = '33333333-3333-4333-8333-333333333333';
const incidentId = '44444444-4444-4444-8444-444444444444';
const db = { query: jest.fn() };

function request(overrides: Partial<Request> = {}): Request {
  return {
    params: { id: incidentId },
    query: {},
    body: {},
    user: {
      userId, tenantId, email: 'guard@example.test', fullName: 'Guard User', role: 'Objektleitung',
      permissions: ['alarm:read', 'alarm:report', 'alarm:respond'], sessionHash: 'hash'
    },
    ...overrides
  } as unknown as Request;
}

function response(): any {
  const res: any = { statusCode: 200, body: undefined };
  res.status = jest.fn((status: number) => { res.statusCode = status; return res; });
  res.json = jest.fn((body: unknown) => { res.body = body; return res; });
  return res;
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (withTenantTransaction as jest.Mock).mockImplementation(
    (_tenant: string, callback: (client: typeof db) => Promise<unknown>) => callback(db)
  );
});

describe('site-scoped alarm workflow', () => {
  test.each([
    ['incident_report', 'alarm:report', ['alarm:read']],
    ['action_create', 'alarm:action:create', ['alarm:report']],
    ['status_change', 'alarm:respond', ['alarm:report']]
  ] as const)('rejects %s synchronization without %s before database access', async (type, permission, permissions) => {
    const res = response();
    const payload = type === 'incident_report'
      ? {}
      : type === 'action_create'
        ? { incidentId, actionType: 'measure', description: 'Absperren' }
        : { incidentId, status: 'bestätigt', note: 'Übernommen', revisionVersion: 1 };

    await syncAlarmMutations(request({
      user: {
        userId, tenantId, email: 'guard@example.test', fullName: 'Guard User', role: 'Objektleitung',
        permissions: [...permissions], sessionHash: 'hash'
      },
      body: { mutations: [{ clientMutationId: `denied-${type}`, type, payload }] }
    }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data).toEqual([expect.objectContaining({
      clientMutationId: `denied-${type}`,
      state: 'conflict',
      error: `Zugriff verweigert: Fehlende Berechtigung '${permission}'`
    })]);
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  test('rejects reporting an incident outside the authenticated employee site assignments', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await reportAlarmIncidentV2(request({
      body: { siteId, alarmTypeId: '55555555-5555-4555-8555-555555555555', severity: 'Kritisch', title: 'Alarm' }
    }), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('requires alarm:archive in addition to response permission for incident archival', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{
      id: incidentId, site_id: siteId, status: 'abgeschlossen', revision_version: 1
    }] });

    await transitionAlarmIncidentV2(request({
      user: {
        userId, tenantId, email: 'lead@example.test', fullName: 'Lead User', role: 'Einsatzleitung',
        permissions: ['alarm:read', 'alarm:respond'], sessionHash: 'hash'
      },
      body: { status: 'archiviert', note: 'Archiviert', revisionVersion: 1 }
    }), response(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('returns only events for sites assigned to the caller', async () => {
    const eventRow = { id: 'event-id', site_id: siteId, site_name: 'Objekt A', action: 'incident_reported' };
    db.query.mockResolvedValueOnce({ rows: [{ site_id: siteId }] }).mockResolvedValueOnce({ rows: [eventRow] });
    const res = response();

    await listRecentAlarmEvents(request(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(db.query.mock.calls[1][0]).toContain('s.id=ANY($2)');
    expect(res.body.data).toEqual([eventRow]);
  });

  test('removes private contact snapshots without emergency_contact:read', async () => {
    const planId = '66666666-6666-4666-8666-666666666666';
    const version = { id: 'version-id', contact_snapshot: [{ name: 'Private contact', phone: '+49 30 1' }] };
    db.query.mockResolvedValueOnce({ rows: [{ site_id: siteId }] })
      .mockResolvedValueOnce({ rows: [{ site_id: siteId }] })
      .mockResolvedValueOnce({ rows: [version] });
    const res = response();

    await listEmergencyPlanVersions(request({ params: { id: planId } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data).toEqual([{ ...version, contact_snapshot: [] }]);
  });
});
