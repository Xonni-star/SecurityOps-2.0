import { Request, NextFunction } from 'express';
import { withTenantTransaction } from '../config/database';
import { linkEmployeeAccount, syncEmployeeMutations } from '../controllers/employeeController';

jest.mock('../config/database', () => ({
  withTenantTransaction: jest.fn()
}));

const transaction = { query: jest.fn() };
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const employeeId = '33333333-3333-4333-8333-333333333333';
const siteId = '44444444-4444-4444-8444-444444444444';
const mutationId = '55555555-5555-4555-8555-555555555555';

function request(action: 'CREATE' | 'UPDATE', payload: Record<string, unknown>, baseVersion = 1): Request {
  return {
    body: {
      deviceId: 'offline-device',
      mutations: [{
        clientUuid: mutationId, entityType: 'employee', action,
        baseVersion, payload
      }]
    },
    user: {
      userId, tenantId, email: 'manager@example.test', role: 'Personalverwaltung',
      permissions: ['employees:create', 'employees:update'], sessionHash: 'hash'
    }
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

describe('employee sync site memberships', () => {
  test('links an employee only to an account with membership in the same tenant', async () => {
    transaction.query
      .mockResolvedValueOnce({ rows: [{ revision_version: 3 }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: employeeId, account_user_id: userId, revision_version: 4 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();
    const req = {
      params: { id: employeeId },
      body: { userId, revisionVersion: 3 },
      user: {
        userId: '66666666-6666-4666-8666-666666666666', tenantId,
        email: 'manager@example.test', role: 'Personalverwaltung',
        permissions: ['employees:update'], sessionHash: 'hash'
      },
      ip: '127.0.0.1'
    } as unknown as Request;

    await linkEmployeeAccount(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data).toEqual({ id: employeeId, account_user_id: userId, revision_version: 4 });
    expect(transaction.query.mock.calls[1][0]).toContain('FROM user_roles WHERE user_id=$1 AND tenant_id=$2');
    expect(transaction.query.mock.calls[3][0]).toContain('account_user_id=$1');
    expect(transaction.query.mock.calls[4][0]).toContain('INSERT INTO audit_logs');
  });

  test('rejects account links without tenant membership before updating an employee', async () => {
    transaction.query
      .mockResolvedValueOnce({ rows: [{ revision_version: 3 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();
    const req = {
      params: { id: employeeId },
      body: { userId, revisionVersion: 3 },
      user: {
        userId: '66666666-6666-4666-8666-666666666666', tenantId,
        email: 'manager@example.test', role: 'Personalverwaltung',
        permissions: ['employees:update'], sessionHash: 'hash'
      }
    } as unknown as Request;

    await linkEmployeeAccount(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Mandanten/);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE employees'))).toBe(false);
  });

  test('CREATE persists validated assignedSiteIds in the employee transaction', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: siteId }] })
      .mockResolvedValueOnce({ rows: [{ id: employeeId, revision_version: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await syncEmployeeMutations(request('CREATE', {
      id: employeeId, personnelNumber: 'MA-1', firstName: 'Test', lastName: 'Employee',
      email: 'employee@example.test', phone: '+49 30 000', role: 'Wachdienstmitarbeiter',
      status: 'Aktiv', weeklyHours: 40, hourlyRate: 19, dateOfJoining: '2026-01-01',
      assignedSiteIds: [siteId]
    }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body.data[0]).toMatchObject({ status: 'SYNCED', serverId: employeeId });
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO employee_site_assignments'))).toBe(true);
  });

  test('CREATE rejects a foreign site before inserting an employee', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await syncEmployeeMutations(request('CREATE', {
      id: employeeId, personnelNumber: 'MA-1', firstName: 'Test', lastName: 'Employee',
      email: 'employee@example.test', phone: '+49 30 000', role: 'Wachdienstmitarbeiter',
      status: 'Aktiv', weeklyHours: 40, hourlyRate: 19, dateOfJoining: '2026-01-01',
      assignedSiteIds: [siteId]
    }), res, next);

    expect(res.body.data[0]).toMatchObject({ status: 'REJECTED' });
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO employees'))).toBe(false);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('employee_site_assignments'))).toBe(false);
  });

  test('UPDATE replaces memberships after the optimistic version update succeeds', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: siteId }] })
      .mockResolvedValueOnce({ rows: [{ revision_version: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await syncEmployeeMutations(request('UPDATE', { id: employeeId, assignedSiteIds: [siteId] }), res, next);

    expect(res.body.data[0]).toMatchObject({ status: 'SYNCED', serverVersion: 2 });
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE employees'))).toBe(true);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO employee_site_assignments'))).toBe(true);
  });

  test('UPDATE rejects a foreign site without changing employee or memberships', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await syncEmployeeMutations(request('UPDATE', { id: employeeId, assignedSiteIds: [siteId] }), res, next);

    expect(res.body.data[0]).toMatchObject({ status: 'REJECTED' });
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE employees'))).toBe(false);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('employee_site_assignments'))).toBe(false);
  });
});
