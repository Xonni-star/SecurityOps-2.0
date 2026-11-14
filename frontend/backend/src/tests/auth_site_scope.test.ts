import { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/auth';

const siteA = '11111111-1111-4111-8111-111111111111';
const siteB = '22222222-2222-4222-8222-222222222222';
const grant = { code: 'employees:read', siteId: siteA };
const createGrant = { code: 'handovers:create', siteId: siteA };

function runPermissionCheck(
  method: string,
  path: string,
  permissionCode: string,
  options: {
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
    body?: Record<string, unknown>;
    permissions?: string[];
    sitePermissions?: Array<{ code: string; siteId: string }>;
    ownPermissions?: string[];
  } = {}
) {
  const req = {
    method,
    path,
    query: options.query ?? {},
    params: options.params ?? {},
    body: options.body ?? {},
    user: {
      userId: '33333333-3333-4333-8333-333333333333',
      email: 'site-user@example.test',
      tenantId: '44444444-4444-4444-8444-444444444444',
      role: 'Object lead',
      permissions: options.permissions ?? [],
      sitePermissions: options.sitePermissions ?? [grant, createGrant],
      ownPermissions: options.ownPermissions ?? [],
      sessionHash: 'opaque-session-hash'
    }
  } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  } as unknown as Response;
  const next = jest.fn() as NextFunction;

  requirePermission(permissionCode)(req, res, next);
  return { next, res };
}

describe('site-scoped authorization', () => {
  test('allows the scoped permission and delegates row filtering to PostgreSQL RLS', () => {
    const allowed = runPermissionCheck('GET', '/api/v1/employees', grant.code, { query: { siteId: siteA } });
    expect(allowed.next).toHaveBeenCalledTimes(1);

    const unfiltered = runPermissionCheck('GET', '/api/v1/employees', grant.code);
    expect(unfiltered.next).toHaveBeenCalledTimes(1);

    const otherSite = runPermissionCheck('GET', '/api/v1/employees', grant.code, { query: { siteId: siteB } });
    expect(otherSite.next).toHaveBeenCalledTimes(1);
  });

  test('allows site-scoped customer reads and delegates customer scope to PostgreSQL RLS', () => {
    const result = runPermissionCheck('GET', '/api/v1/customers', 'customers:read', {
      query: { siteId: siteA },
      sitePermissions: [{ code: 'customers:read', siteId: siteA }]
    });
    expect(result.next).toHaveBeenCalledTimes(1);
  });

  test('allows site-scoped writes to reach PostgreSQL RLS for row-specific enforcement', () => {
    const allowed = runPermissionCheck('POST', '/api/v1/handovers', 'handovers:create', {
      body: { siteId: siteA }
    });
    expect(allowed.next).toHaveBeenCalledTimes(1);

    const wrongSite = runPermissionCheck('POST', '/api/v1/handovers', 'handovers:create', {
      body: { siteId: siteB }
    });
    expect(wrongSite.next).toHaveBeenCalledTimes(1);

    const unscoped = runPermissionCheck('POST', '/api/v1/handovers', 'handovers:create');
    expect(unscoped.next).toHaveBeenCalledTimes(1);
  });

  test('tenant-wide permission remains explicit and independent of site filters', () => {
    const result = runPermissionCheck('GET', '/api/v1/planning/shifts', 'planning:read', {
      query: { siteId: siteB },
      permissions: ['planning:read']
    });
    expect(result.next).toHaveBeenCalledTimes(1);
  });

  test('allows OWN only for implemented owner-scoped permissions', () => {
    const ownRead = runPermissionCheck('GET', '/api/v1/employees', 'employees:read', {
      ownPermissions: ['employees:read']
    });
    expect(ownRead.next).toHaveBeenCalledTimes(1);

    const ownWrite = runPermissionCheck('PATCH', '/api/v1/employees/employee-id', 'employees:update', {
      ownPermissions: ['employees:update']
    });
    expect(ownWrite.next).not.toHaveBeenCalled();
    expect(ownWrite.res.status).toHaveBeenCalledWith(403);
  });

  test('a site-scoped user read grant is limited to the supported filtered list route', () => {
    const userGrant = { code: 'users:read', siteId: siteA };
    const allowed = runPermissionCheck('GET', '/api/v1/admin/users', 'users:read', {
      query: { siteId: siteA },
      sitePermissions: [userGrant]
    });
    expect(allowed.next).toHaveBeenCalledTimes(1);

    const wrongSite = runPermissionCheck('GET', '/api/v1/admin/users', 'users:read', {
      query: { siteId: siteB },
      sitePermissions: [userGrant]
    });
    expect(wrongSite.next).not.toHaveBeenCalled();

    const detail = runPermissionCheck('GET', '/api/v1/admin/users/user-id', 'users:read', {
      sitePermissions: [userGrant]
    });
    expect(detail.next).not.toHaveBeenCalled();
  });
});
