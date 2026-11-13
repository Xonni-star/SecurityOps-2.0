import { Request, NextFunction } from 'express';
import { withTenantTransaction } from '../config/database';
import {
  confirmHandover,
  createHandoverEndpoint,
  updateHandoverTaskEndpoint
} from '../controllers/handoverController';
import { hasMutationPermission } from '../controllers/syncController';
import { computePayloadHash } from '../services/syncHash';

jest.mock('../config/database', () => ({
  withTenantTransaction: jest.fn()
}));

const transaction = { query: jest.fn() };
const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const handoverId = '33333333-3333-4333-8333-333333333333';
const siteId = '44444444-4444-4444-8444-444444444444';
const outgoingEmployeeId = '55555555-5555-4555-8555-555555555555';
const incomingEmployeeId = '66666666-6666-4666-8666-666666666666';
const taskId = '77777777-7777-4777-8777-777777777777';

function request(overrides: Partial<Request> = {}): Request {
  return {
    params: { id: handoverId },
    query: {},
    body: {},
    user: {
      userId, tenantId, email: 'outgoing@example.test', role: 'Wachdienstmitarbeiter',
      permissions: ['handovers:create', 'handovers:confirm', 'handovers:tasks'], sessionHash: 'hash'
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
    (_tenant: string, callback: (db: any) => unknown) => callback(transaction)
  );
});

describe('handover API invariants', () => {
  test('allows canonical and legacy handover creation permissions for queued sync', () => {
    expect(hasMutationPermission('handover', ['handovers:create'])).toBe(true);
    expect(hasMutationPermission('handover', ['handover:create'])).toBe(true);
    expect(hasMutationPermission('handover', ['handovers:read'])).toBe(false);
  });

  const createBody = {
    siteId,
    occurredAt: '2026-11-13T06:00:00.000Z',
    outgoingEmployeeId,
    incomingEmployeeId,
    generalText: 'Schicht ohne besondere Abweichungen übergeben.',
    clientMutationId: 'handover-client-0001'
  };

  test('creates an append-only handover and binds it to the authenticated tenant and participants', async () => {
    transaction.query
      .mockResolvedValueOnce({ rows: [{ id: siteId, outgoing_exists: true, incoming_exists: true, shift_matches_site: true }] })
      .mockResolvedValueOnce({ rows: [{ id: handoverId, revision_version: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await createHandoverEndpoint(request({ body: createBody }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({ id: handoverId, created: true, revisionVersion: 1 });
    expect(transaction.query.mock.calls[0][1][0]).toBe(tenantId);
    expect(transaction.query.mock.calls[1][0]).toContain('ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING');
    expect(transaction.query.mock.calls[2][1]).toEqual([tenantId, handoverId, outgoingEmployeeId, 'handover']);
    expect(transaction.query.mock.calls[3][1]).toEqual([tenantId, handoverId, incomingEmployeeId, 'takeover']);
  });

  test('returns a conflict instead of duplicating a client ID with different content', async () => {
    const normalized = {
      siteId,
      area: null,
      shiftId: null,
      occurredAt: createBody.occurredAt,
      outgoingEmployeeId,
      incomingEmployeeId,
      generalText: createBody.generalText,
      incidents: '',
      importantNotes: '',
      safetyInformation: '',
      tasks: []
    };
    transaction.query
      .mockResolvedValueOnce({ rows: [{ id: siteId, outgoing_exists: true, incoming_exists: true, shift_matches_site: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        id: handoverId, revision_version: 2, payload_hash: computePayloadHash(normalized),
        site_id: siteId, area: null, shift_id: null, occurred_at: createBody.occurredAt,
        general_text: 'Andere Version', incidents: '', important_notes: '', safety_information: '',
        status: 'pending_handover_confirmation'
      }] });
    const res = response();

    await createHandoverEndpoint(request({ body: { ...createBody, generalText: 'Abweichender Text' } }), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
  });

  test('a confirmation is accepted only from the assigned employee identity', async () => {
    transaction.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: handoverId, status: 'pending_handover_confirmation', revision_version: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await confirmHandover(request({
      body: { clientMutationId: 'handover-confirm-0001', capturedAt: '2026-11-13T06:01:00.000Z' }
    }), res, next);

    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO handover_confirmations'))).toBe(false);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('rejects stale task edits without issuing an update', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{
      id: taskId,
      revision_version: 4,
      status: 'open',
      title: 'Prüfung',
      description: '',
      assigned_employee_id: outgoingEmployeeId,
      priority: 'normal',
      due_at: null,
      completed_at: null,
      origin_handover_id: handoverId
    }] });
    const res = response();

    await updateHandoverTaskEndpoint(request({
      params: { id: taskId },
      body: { expectedVersion: 3, status: 'done' }
    }), res, next);

    expect((next as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409 }));
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE handover_tasks'))).toBe(false);
  });
});
