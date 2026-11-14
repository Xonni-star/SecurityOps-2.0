import { login } from '../controllers/authController';
import { query } from '../config/database';
import argon2 from 'argon2';

jest.mock('../config/database', () => {
  const query = jest.fn();
  return {
    query,
    withUserContextTransaction: jest.fn((_userId: string, callback: (db: { query: typeof query }) => unknown) => callback({ query })),
    withTenantTransaction: jest.fn((_tenantId: string, callback: (db: { query: typeof query }) => unknown) => callback({ query }))
  };
});

describe('login issues opaque cookie sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(argon2, 'verify').mockResolvedValue(true);
    (query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: '11111111-1111-1111-1111-111111111111', email: 'guard@example.test', password_hash: 'argon-hash', first_name: 'Test', last_name: 'Guard', is_active: true, failed_login_attempts: 0, locked_until: null }] })
      .mockResolvedValueOnce({ rows: [{ tenant_id: '22222222-2222-2222-2222-222222222222', tenant_name: 'Tenant A', role_name: 'Operator', first_name: 'Tenant', last_name: 'Person' }] })
      .mockResolvedValueOnce({ rows: [{ code: 'logbook:read' }] })
      .mockResolvedValueOnce({ rows: [{ role_name: 'Operator' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
  });

  test('sets HttpOnly session cookie and returns no bearer token', async () => {
    const cookies: Array<[string, string, any]> = [];
    const headers: Record<string, string> = {};
    const res: any = {
      cookie: (name: string, value: string, options: any) => { cookies.push([name, value, options]); return res; },
      setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; return res; },
      json: (body: any) => { res.body = body; return res; },
      status: (code: number) => { res.statusCode = code; return res; }
    };
    const req: any = { body: { email: 'guard@example.test', password: 'a-long-password' }, headers: { 'user-agent': 'test-agent' }, ip: '127.0.0.1' };
    const next = jest.fn();
    await login(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.user.fullName).toBe('Tenant Person');
    expect(res.body.data.csrfToken).toBeTruthy();
    const sessionCookie = cookies.find(([name]) => name === 'secops_session');
    expect(sessionCookie?.[1]).toHaveLength(43);
    expect(sessionCookie?.[2]).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/api/v1' });
    expect(headers['x-csrf-token']).toBe(res.body.data.csrfToken);
    const insertCall = (query as jest.Mock).mock.calls.find(([sql]) => String(sql).includes('INSERT INTO user_sessions'));
    expect(insertCall?.[1][2]).not.toBe(sessionCookie?.[1]);
    expect(insertCall?.[1][2]).toHaveLength(64);
  });
});
