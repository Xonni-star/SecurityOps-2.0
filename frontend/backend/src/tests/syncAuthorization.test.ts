import { getMutationSiteIds, getPermissionCodeForSites, hasPermissionForSites } from '../controllers/syncController';
import { AuthenticatedUser } from '../middleware/auth';

const user: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'site.user@example.test',
  fullName: 'Site User',
  tenantId: '22222222-2222-4222-8222-222222222222',
  role: 'Site operator',
  permissions: [],
  sitePermissions: [{ code: 'shifts:manage', siteId: '33333333-3333-4333-8333-333333333333' }],
  sessionHash: 'opaque-session-hash'
};

describe('site-scoped sync authorization', () => {
  test('allows a mutation only when every stored and requested site is granted', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [{ site_id: '33333333-3333-4333-8333-333333333333' }] })
    };
    const sites = await getMutationSiteIds(
      client,
      user.tenantId,
      'shift',
      'UPDATE',
      { id: '44444444-4444-4444-8444-444444444444', siteId: '33333333-3333-4333-8333-333333333333' }
    );

    expect(sites).toEqual(['33333333-3333-4333-8333-333333333333']);
    expect(hasPermissionForSites(user, ['shifts:manage'], sites)).toBe(true);

    const moveToOtherSite = await getMutationSiteIds(
      client,
      user.tenantId,
      'shift',
      'UPDATE',
      { id: '44444444-4444-4444-8444-444444444444', siteId: '55555555-5555-4555-8555-555555555555' }
    );
    expect(moveToOtherSite).toEqual([
      '55555555-5555-4555-8555-555555555555',
      '33333333-3333-4333-8333-333333333333'
    ]);
    expect(hasPermissionForSites(user, ['shifts:manage'], moveToOtherSite)).toBe(false);
  });

  test('site grants cannot authorize a mutation with no resolvable site', () => {
    expect(hasPermissionForSites(user, ['shifts:manage'], [])).toBe(false);
  });

  test('all affected sites must share one permission code so database scope matches the grant check', () => {
    const splitGrants = {
      ...user,
      sitePermissions: [
        { code: 'shifts:manage', siteId: '33333333-3333-4333-8333-333333333333' },
        { code: 'planning:manage', siteId: '55555555-5555-4555-8555-555555555555' }
      ]
    };

    expect(getPermissionCodeForSites(
      splitGrants,
      ['shifts:manage', 'planning:manage'],
      ['33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555']
    )).toBeUndefined();
  });
});
