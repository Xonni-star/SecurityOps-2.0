import { Request, NextFunction } from 'express';
import { withTenantTransaction } from '../config/database';
import { acknowledgeAssignment, approveSop } from '../controllers/sopController';

jest.mock('../config/database', () => ({
  withTenantTransaction: jest.fn()
}));

const transaction = { query: jest.fn() };
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const sopId = '33333333-3333-4333-8333-333333333333';
const assignmentId = '44444444-4444-4444-8444-444444444444';
const employeeId = '55555555-5555-4555-8555-555555555555';
const otherEmployeeId = '66666666-6666-4666-8666-666666666666';
const authorId = '77777777-7777-4777-8777-777777777777';

function request(overrides: Partial<Request> = {}): Request {
  return {
    params: { id: sopId, assignmentId },
    body: {},
    query: {},
    user: {
      userId, tenantId, email: 'employee@example.test', role: 'Wachdienstmitarbeiter',
      permissions: ['sop:acknowledge'], sessionHash: 'hash'
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

describe('SOP separation of duties and acknowledgements', () => {
  test('author cannot approve their own instruction', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{
      id: sopId, created_by: userId, status: 'reviewed', draft_version_id: '77777777-7777-4777-8777-777777777777'
    }] });
    const res = response();

    await approveSop(request(), res, next);

    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
    expect(transaction.query).toHaveBeenCalledTimes(1);
  });

  test('reviewer cannot approve the instruction they reviewed', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{
      id: sopId, created_by: authorId, reviewed_by_user_id: userId,
      status: 'reviewed', draft_version_id: '88888888-8888-4888-8888-888888888888'
    }] });
    const res = response();

    await approveSop(request(), res, next);

    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.json).not.toHaveBeenCalled();
    expect(transaction.query).toHaveBeenCalledTimes(1);
  });

  test('cannot acknowledge an assignment belonging to another employee', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{ id: employeeId }] })
      .mockResolvedValueOnce({ rows: [{ id: assignmentId, employee_id: otherEmployeeId }] });
    const res = response();

    await acknowledgeAssignment(request({ body: { confirmed: true } }), res, next);

    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(transaction.query).toHaveBeenCalledTimes(2);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE sop_assignments'))).toBe(false);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('reports acknowledgement success only after the server-side update returns a persisted row', async () => {
    const persisted = {
      id: assignmentId, sop_id: sopId, version_id: '77777777-7777-4777-8777-777777777777',
      employee_id: employeeId, acknowledged_at: new Date(), acknowledged_by_user_id: userId,
      captured_at: null, server_received_at: new Date(), client_mutation_id: null
    };
    transaction.query.mockResolvedValueOnce({ rows: [{ id: employeeId }] })
      .mockResolvedValueOnce({ rows: [{ ...persisted, employee_id: employeeId, acknowledged_at: null }] })
      .mockResolvedValueOnce({ rows: [persisted] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await acknowledgeAssignment(request({ body: { confirmed: true } }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: persisted });
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE sop_assignments'))).toBe(true);
  });
});
