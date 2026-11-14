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
  options: { query?: Record<string, unknown>; params?: Record<string, unknown>; body?: Record<string, unknown>; permissions?: string[] } = {}
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
      sitePermissions: [grant, createGrant],
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
  test('allows a site grant only for an explicitly filtered supported read', () => {
    const allowed = runPermissionCheck('GET', '/api/v1/employees', grant.code, { query: { siteId: siteA } });
    expect(allowed.next).toHaveBeenCalledTimes(1);

    const unfiltered = runPermissionCheck('GET', '/api/v1/employees', grant.code);
    expect(unfiltered.next).not.toHaveBeenCalled();
    expect(unfiltered.res.status).toHaveBeenCalledWith(403);

    const otherSite = runPermissionCheck('GET', '/api/v1/employees', grant.code, { query: { siteId: siteB } });
    expect(otherSite.next).not.toHaveBeenCalled();
    expect(otherSite.res.status).toHaveBeenCalledWith(403);
  });

  test('does not treat a site filter on unsupported reads as authorization', () => {
    const result = runPermissionCheck('GET', '/api/v1/planning/shifts', grant.code, { query: { siteId: siteA } });
    expect(result.next).not.toHaveBeenCalled();
    expect(result.res.status).toHaveBeenCalledWith(403);
  });

  test('allows a site-scoped create only for the granted site and denies unscoped writes', () => {
    const allowed = runPermissionCheck('POST', '/api/v1/handovers', 'handovers:create', {
      body: { siteId: siteA }
    });
    expect(allowed.next).toHaveBeenCalledTimes(1);

    const wrongSite = runPermissionCheck('POST', '/api/v1/handovers', 'handovers:create', {
      body: { siteId: siteB }
    });
    expect(wrongSite.next).not.toHaveBeenCalled();

    const unscoped = runPermissionCheck('POST', '/api/v1/handovers', 'handovers:create');
    expect(unscoped.next).not.toHaveBeenCalled();
  });

  test('tenant-wide permission remains explicit and independent of site filters', () => {
    const result = runPermissionCheck('GET', '/api/v1/planning/shifts', 'planning:read', {
      query: { siteId: siteB },
      permissions: ['planning:read']
    });
    expect(result.next).toHaveBeenCalledTimes(1);
  });
});
