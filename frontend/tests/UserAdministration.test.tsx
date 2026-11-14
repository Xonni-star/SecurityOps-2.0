import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthUser } from '../store';

import { UserAdministration } from '../components/UserAdministration';

const user: AuthUser = {
  id: 'user-1', email: 'admin@example.test', fullName: 'Tenant Admin',
  role: 'Mandantenadministrator', tenantId: 'tenant-a', tenantName: 'Tenant A',
  permissions: ['users:read', 'roles:read']
};
const listedUser = {
  id: 'user-2', email: 'guard@example.test', first_name: 'Erika', last_name: 'Muster',
  phone: null, is_active: true, is_locked: false, last_login_at: null, roles: []
};
const requests: string[] = [];
const roleFixtures = [{
  id: 'role-1',
  name: 'Mixed scope role',
  description: null,
  is_system_role: false,
  permissions: [
    { code: 'employees:read', site_id: 'site-1', data_scope: 'SITE' },
    { code: 'employees:read', site_id: 'site-2', data_scope: 'SITE' },
    { code: 'users:read', site_id: null, data_scope: 'TENANT' }
  ]
}];

function apiResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ success: true, data })
  } as Response;
}

describe('UserAdministration API integration', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let includeRoleFixtures: boolean;
  let rolePatchBody: Record<string, unknown> | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requests.length = 0;
    includeRoleFixtures = false;
    rolePatchBody = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url === '/api/v1/admin/roles/role-1' && init?.method === 'PATCH') {
        rolePatchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return apiResponse({ id: 'role-1' });
      }
      if (url.includes('/admin/roles')) return apiResponse(includeRoleFixtures ? roleFixtures : []);
      if (url.includes('/admin/permissions')) return apiResponse([
        { code: 'employees:read', module: 'employees', description: 'Mitarbeiter lesen' },
        { code: 'users:read', module: 'users', description: 'Benutzer lesen' }
      ]);
      if (url.includes('/admin/sites')) return apiResponse([
        { id: 'site-1', name: 'Hauptwache', site_code: 'HW-1' },
        { id: 'site-2', name: 'Nebenwache', site_code: 'NW-2' }
      ]);
      if (url.includes('/admin/users')) return apiResponse([listedUser]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  test('loads users from the tenant administration API and applies the selected site filter', async () => {
    await act(async () => {
      root.render(<UserAdministration authUser={user} />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('Erika Muster');
    expect(container.textContent).toContain('guard@example.test');

    const siteFilter = container.querySelector<HTMLSelectElement>('select[aria-label="Objekt filtern"]');
    expect(siteFilter).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(siteFilter, 'site-1');
      siteFilter?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const filterButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Filtern');
    await act(async () => {
      filterButton?.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(requests.some(url => url.includes('/admin/users?siteId=site-1'))).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  test('preserves independent tenant and multi-site grants when editing a role', async () => {
    includeRoleFixtures = true;
    const roleAdmin: AuthUser = {
      ...user,
      permissions: ['users:read', 'roles:read', 'roles:manage', 'employees:read']
    };
    await act(async () => {
      root.render(<UserAdministration authUser={roleAdmin} />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Rollen & Rechte'))?.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Mixed scope role'))?.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const siteGrant = container.querySelector<HTMLSelectElement>('select[aria-label="Objekte für employees:read"]');
    expect(siteGrant?.multiple).toBe(true);
    expect(Array.from(siteGrant?.selectedOptions ?? [], option => option.value)).toEqual(['site-1', 'site-2']);

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find(button => button.textContent?.trim() === 'Rolle speichern')?.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(rolePatchBody?.permissions).toEqual([
      { code: 'employees:read', siteId: 'site-1', dataScope: 'SITE', canDelegate: false },
      { code: 'employees:read', siteId: 'site-2', dataScope: 'SITE', canDelegate: false },
      { code: 'users:read', siteId: null, dataScope: 'TENANT', canDelegate: false }
    ]);
  });
});
