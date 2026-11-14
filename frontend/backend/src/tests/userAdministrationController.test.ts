import crypto from 'crypto';
import argon2 from 'argon2';
import { Request, NextFunction } from 'express';
import { withTenantTransaction } from '../config/database';
import { assignRole, completePasswordReset, createRole, createUser, listUsers, preparePasswordReset, updateUser } from '../controllers/userAdministrationController';
import { configurePasswordResetDeliveryProvider, PasswordResetEmail } from '../services/passwordResetDelivery';

jest.mock('../config/database', () => ({
  withTenantTransaction: jest.fn()
}));

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const roleId = '33333333-3333-4333-8333-333333333333';
const transaction = { query: jest.fn() };
const sentEmails: PasswordResetEmail[] = [];

function response(): any {
  const res: any = { statusCode: 200, body: undefined };
  res.status = jest.fn((status: number) => { res.statusCode = status; return res; });
  res.json = jest.fn((body: unknown) => { res.body = body; return res; });
  return res;
}

function request(userPermissions: string[], body: Record<string, unknown> = {}): Request {
  return {
    body,
    params: { id: userId },
    ip: '127.0.0.1',
    user: {
      userId, tenantId, email: 'admin@example.test', role: 'Tenant admin',
      permissions: userPermissions, sessionHash: 'session-hash'
    }
  } as unknown as Request;
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  sentEmails.length = 0;
  configurePasswordResetDeliveryProvider(null);
  (withTenantTransaction as jest.Mock).mockImplementation(
    (_tenant: string, callback: (db: typeof transaction) => unknown) => callback(transaction)
  );
});

afterEach(() => {
  configurePasswordResetDeliveryProvider(null);
});

describe('user administration security controls', () => {
  test('rejects client-selected tenant IDs before opening an administration transaction', async () => {
    const createRes = response();
    await createUser({
      ...request(['users:manage']),
      body: {
        email: 'new@example.test', firstName: 'New', lastName: 'User', roleId,
        tenantId: '99999999-9999-4999-8999-999999999999'
      }
    } as unknown as Request, createRes, next);
    expect(withTenantTransaction).not.toHaveBeenCalled();

    const listRes = response();
    await listUsers({
      ...request(['users:read']),
      query: { tenantId: '99999999-9999-4999-8999-999999999999' }
    } as unknown as Request, listRes, next);
    expect(withTenantTransaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });

  test('updates only the authenticated tenant membership profile', async () => {
    transaction.query
      .mockResolvedValueOnce({ rows: [{ user_id: userId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await updateUser({
      ...request(['users:manage'], { firstName: 'Tenant-specific name' }),
      params: { id: userId }
    } as unknown as Request, res, next);

    expect(res.body.success).toBe(true);
    const update = transaction.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE tenant_memberships'));
    expect(update?.[1]).toEqual(['Tenant-specific name', null, false, null, tenantId, userId]);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE users'))).toBe(false);
  });

  test('emails a one-time hashed reset token without returning or logging the raw token', async () => {
    configurePasswordResetDeliveryProvider({
      sendPasswordResetEmail: jest.fn(async email => { sentEmails.push(email); })
    });
    transaction.query
      .mockResolvedValueOnce({ rows: [{ email: 'person@example.test', first_name: 'Alex', last_name: 'Example', is_superadmin: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();
    const logSpies = ['log', 'warn', 'error'].map(method =>
      jest.spyOn(console, method as 'log').mockImplementation(() => undefined)
    );

    try {
      await preparePasswordReset(request(['users:manage']), res, next);

      expect(withTenantTransaction).toHaveBeenCalledWith(tenantId, expect.any(Function));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.delivery).toBe('email');
      expect(res.body.data.resetToken).toBeUndefined();
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]).toMatchObject({
        recipientEmail: 'person@example.test',
        recipientName: 'Alex Example',
        tenantId
      });
      expect(sentEmails[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const insert = transaction.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO user_password_reset_tokens'));
      expect(insert?.[1][0]).toBe(tenantId);
      expect(insert?.[1][1]).toBe(userId);
      expect(insert?.[1][2]).toBe(crypto.createHash('sha256').update(sentEmails[0].token).digest('hex'));
      expect(insert?.[1][2]).not.toBe(sentEmails[0].token);
      expect(transaction.query.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE user_password_reset_tokens SET consumed_at=CURRENT_TIMESTAMP')
      )).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(sentEmails[0].token);
      expect(logSpies.flatMap(spy => spy.mock.calls).flat().join(' ')).not.toContain(sentEmails[0].token);
      expect(transaction.query.mock.calls.some(([sql, values]) =>
        String(sql).includes('INSERT INTO audit_logs') && JSON.stringify(values).includes('PASSWORD_RESET_PREPARED')
      )).toBe(true);
      expect(next).not.toHaveBeenCalled();
    } finally {
      logSpies.forEach(spy => spy.mockRestore());
    }
  });

  test('returns a clear non-success response without creating a token when no provider is configured', async () => {
    const res = response();

    await preparePasswordReset(request(['users:manage']), res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      code: 'PASSWORD_RESET_EMAIL_NOT_CONFIGURED'
    });
    expect(res.body.message).toMatch(/E-Mail-Anbieter/);
    expect(withTenantTransaction).not.toHaveBeenCalled();
    expect(transaction.query).not.toHaveBeenCalled();
  });

  test('sends the initial password setup email without returning its token', async () => {
    configurePasswordResetDeliveryProvider({
      sendPasswordResetEmail: jest.fn(async email => { sentEmails.push(email); })
    });
    transaction.query
      .mockResolvedValueOnce({ rows: [{ id: roleId, name: 'Guard' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: userId, email: 'new@example.test', first_name: 'New', last_name: 'User', phone: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await createUser({
      ...request(['users:manage'], {
        email: 'new@example.test',
        firstName: 'New',
        lastName: 'User',
        roleId
      })
    } as unknown as Request, res, next);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.resetEmailSent).toBe(true);
    expect(res.body.data.resetToken).toBeUndefined();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].recipientEmail).toBe('new@example.test');
    expect(JSON.stringify(res.body)).not.toContain(sentEmails[0].token);
    const insert = transaction.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO user_password_reset_tokens'));
    expect(insert?.[1][2]).toBe(crypto.createHash('sha256').update(sentEmails[0].token).digest('hex'));
    expect(next).not.toHaveBeenCalled();
  });

  test('does not expose provider errors that might contain the raw token', async () => {
    const provider = {
      sendPasswordResetEmail: jest.fn(async (email: PasswordResetEmail) => {
        throw new Error(`delivery failed for ${email.token}`);
      })
    };
    configurePasswordResetDeliveryProvider(provider);
    transaction.query
      .mockResolvedValueOnce({ rows: [{ email: 'person@example.test', first_name: 'Alex', last_name: 'Example', is_superadmin: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();
    const logSpies = ['log', 'warn', 'error'].map(method =>
      jest.spyOn(console, method as 'log').mockImplementation(() => undefined)
    );

    try {
      await preparePasswordReset(request(['users:manage']), res, next);

      const token = provider.sendPasswordResetEmail.mock.calls[0][0].token;
      expect(res.statusCode).toBe(503);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain(token);
      expect(logSpies.flatMap(spy => spy.mock.calls).flat().join(' ')).not.toContain(token);
      expect(next).not.toHaveBeenCalled();
    } finally {
      logSpies.forEach(spy => spy.mockRestore());
    }
  });

  test('rejects expired, consumed, and revoked reset tokens without changing the password', async () => {
    const resetToken = crypto.randomBytes(32).toString('base64url');
    transaction.query.mockResolvedValueOnce({ rows: [] });
    const res = response();

    await completePasswordReset({
      ...request([], { tenantId, token: resetToken, newPassword: 'a-strong-password-123' })
    } as unknown as Request, res, next);

    const lookup = transaction.query.mock.calls[0];
    expect(String(lookup[0])).toContain('consumed_at IS NULL');
    expect(String(lookup[0])).toContain('expires_at>CURRENT_TIMESTAMP');
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE users SET password_hash'))).toBe(false);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE user_sessions SET revoked=true'))).toBe(false);
  });

  test('does not create a user or reveal a reset token when email delivery is unavailable', async () => {
    const res = response();

    await createUser({
      ...request(['users:manage'], {
        email: 'new@example.test',
        firstName: 'New',
        lastName: 'User',
        roleId
      })
    } as unknown as Request, res, next);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('PASSWORD_RESET_EMAIL_NOT_CONFIGURED');
    expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  test('completes reset only with the token tenant and revokes sessions across memberships', async () => {
    jest.spyOn(argon2, 'hash').mockResolvedValue('argon-hash');
    const resetToken = crypto.randomBytes(32).toString('base64url');
    transaction.query
      .mockResolvedValueOnce({ rows: [{ id: 'reset-row', user_id: userId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await completePasswordReset({
      ...request([], { tenantId, token: resetToken, newPassword: 'a-strong-password-123' })
    } as unknown as Request, res, next);

    expect(withTenantTransaction).toHaveBeenCalledWith(tenantId, expect.any(Function));
    expect(res.body.data.passwordChanged).toBe(true);
    expect(transaction.query.mock.calls[0][1]).toEqual([
      tenantId,
      crypto.createHash('sha256').update(resetToken).digest('hex')
    ]);
    expect(transaction.query.mock.calls.some(([sql, values]) =>
      String(sql).includes("set_config('app.current_user_id'") && values[0] === userId
    )).toBe(true);
    expect(transaction.query.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE user_password_reset_tokens SET consumed_at=CURRENT_TIMESTAMP')
    )).toBe(true);
    expect(transaction.query.mock.calls.some(([sql, values]) =>
      String(sql).includes('UPDATE user_sessions SET revoked=true WHERE user_id=$1') && values[0] === userId
    )).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  test('tenant admins cannot delegate administrative permissions to a new role', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [{ id: roleId, name: 'Elevated role' }] });
    const res = response();
    const req = request(['roles:manage'], {
      name: 'Elevated role',
      permissions: [{ code: 'users:manage', dataScope: 'TENANT' }]
    });

    await createRole(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_logs'))).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  test('checks every site grant before assigning a role tenant-wide', async () => {
    transaction.query
      .mockResolvedValueOnce({ rows: [{ is_superadmin: false }] })
      .mockResolvedValueOnce({ rows: [{ id: roleId }] })
      .mockResolvedValueOnce({ rows: [{ code: 'employees:read' }] });
    const res = response();
    const req = {
      ...request(['users:manage']),
      body: { roleId, siteIds: [] }
    } as unknown as Request;

    await assignRole(req, res, next);

    expect(res.statusCode).toBe(403);
    const grantQuery = transaction.query.mock.calls.find(([sql]) => String(sql).includes('SELECT p.code FROM tenant_role_permissions'));
    expect(grantQuery?.[1]).toEqual([tenantId, roleId, null]);
    expect(transaction.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO tenant_user_roles'))).toBe(false);
  });

  test('rejects unsupported owner-scoped grants rather than treating them as tenant-wide', async () => {
    const req = request(['roles:manage', 'employees:update'], {
      name: 'Own data',
      permissions: [{ code: 'employees:update', dataScope: 'OWN' }]
    });
    const res = response();

    await createRole(req, res, next);

    expect(withTenantTransaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  test('rejects site grants for permissions without a site-scoped policy', async () => {
    const req = request(['roles:manage', 'customers:create'], {
      name: 'Unsupported site scope',
      permissions: [{ code: 'customers:create', siteId: '55555555-5555-4555-8555-555555555555', dataScope: 'SITE' }]
    });
    const res = response();

    await createRole(req, res, next);

    expect(transaction.query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  test('persists OWN only for a permission backed by a direct owner relationship', async () => {
    transaction.query
      .mockResolvedValueOnce({ rows: [{ id: roleId, name: 'Personal data' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'permission-id', code: 'employees:read' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'permission-id', code: 'employees:read' }] })
      .mockResolvedValueOnce({ rows: [] });
    const req = request(['roles:manage', 'employees:read'], {
      name: 'Personal data',
      permissions: [{ code: 'employees:read', dataScope: 'OWN' }]
    });
    const res = response();

    await createRole(req, res, next);

    const insert = transaction.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO tenant_role_permissions')
    );
    expect(insert?.[1]).toEqual([tenantId, roleId, 'permission-id', null, 'OWN', false]);
    expect(res.statusCode).toBe(201);
  });

  test('site-filtered user lists omit role and site assignments from other sites', async () => {
    transaction.query.mockResolvedValueOnce({ rows: [] });
    const res = response();

    await listUsers({
      ...request(['users:read']),
      query: { siteId: '55555555-5555-4555-8555-555555555555' }
    } as unknown as Request, res, next);

    const [sql, values] = transaction.query.mock.calls[0];
    expect(values).toEqual([tenantId, '55555555-5555-4555-8555-555555555555']);
    expect(String(sql)).toContain('AND ($2::uuid IS NULL OR tur.site_id=$2::uuid)');
    expect(String(sql).match(/tur\.site_id=\$2::uuid/g)).toHaveLength(2);
  });
});
