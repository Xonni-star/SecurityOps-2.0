import { Request, NextFunction } from 'express';
import { withTenantTransaction } from '../config/database';
import { reportAlarmIncident, transitionAlarmIncident } from '../controllers/alarmController';

jest.mock('../config/database', () => ({
  withTenantTransaction: jest.fn()
}));

const transaction = { query: jest.fn() };
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const siteId = '33333333-3333-4333-8333-333333333333';
const incidentId = '44444444-4444-4444-8444-444444444444';
const planId = '55555555-5555-4555-8555-555555555555';

function request(overrides: Partial<Request> = {}): Request {
  return {
    params: { id: incidentId },
    body: {},
    user: {
      userId, tenantId, email: 'guard@example.test', role: 'Wachdienstmitarbeiter',
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
  (withTenantTransaction as jest.Mock).mockImplementation((_tenantId: string, callback: (db: any) => unknown) => callback(transaction));
});

describe('alarm reporting and response lifecycle', () => {
  test('incident report persists the authenticated tenant and actor and writes an audit event', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{
      id: incidentId, tenant_id: tenantId, site_id: siteId, status: 'gemeldet', revision_version: 1
    }] }).mockResolvedValueOnce({ rows: [] });
    const res = response();

    await reportAlarmIncident(request({
      body: {
        siteId, scenario: 'BMA - Brandmeldeanlage', severity: 'Kritisch',
        title: 'Brandmeldeanlage ausgelöst', description: 'Rauch im Technikraum'
      }
    }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(transaction.query.mock.calls[0][0]).toContain('FROM sites s WHERE s.id=$2 AND s.tenant_id=$1');
    expect(transaction.query.mock.calls[0][1]).toEqual([
      tenantId, siteId, null, 'BMA - Brandmeldeanlage', 'Kritisch',
      'Brandmeldeanlage ausgelöst', 'Rauch im Technikraum', userId
    ]);
    expect(transaction.query.mock.calls[1][1][4]).toBe('incident_reported');
  });

  test('incident cannot link an inactive, foreign-site, or mismatched emergency plan', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [] });
    const res = response();

    await reportAlarmIncident(request({
      body: {
        siteId, emergencyPlanId: planId, scenario: 'BMA - Brandmeldeanlage',
        severity: 'Dringend', title: 'Alarm'
      }
    }), res, next);

    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(transaction.query).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('escalating a newly reported incident records acknowledgement, escalation, and an audit event', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{
      id: incidentId, status: 'gemeldet', revision_version: 1
    }] }).mockResolvedValueOnce({ rows: [{
      id: incidentId, status: 'eskaliert', revision_version: 2
    }] }).mockResolvedValueOnce({ rows: [] });
    const res = response();

    await transitionAlarmIncident(request({
      body: { action: 'escalate', note: 'Einsatzleitung informiert', revisionVersion: 1 }
    }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data).toMatchObject({ status: 'eskaliert', revision_version: 2 });
    expect(transaction.query.mock.calls[1][0]).toContain("acknowledged_at=CASE WHEN $1::varchar IN ('bestätigt','eskaliert','abgeschlossen')");
    expect(transaction.query.mock.calls[2][1][4]).toBe('incident_escalated');
  });

  test('stale incident revisions cannot change the status', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{
      id: incidentId, status: 'gemeldet', revision_version: 2
    }] });

    await transitionAlarmIncident(request({
      body: { action: 'acknowledge', note: 'Übernommen', revisionVersion: 1 }
    }), response(), next);

    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    expect(transaction.query).toHaveBeenCalledTimes(1);
  });

  test('a resolved incident cannot be reopened by a transition request', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{
      id: incidentId, status: 'abgeschlossen', revision_version: 2
    }] });

    await transitionAlarmIncident(request({
      body: { action: 'escalate', note: 'erneut eskalieren', revisionVersion: 2 }
    }), response(), next);

    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    expect(transaction.query).toHaveBeenCalledTimes(1);
  });
});
