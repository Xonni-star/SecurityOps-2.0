import { pool, withTenantTransaction } from '../config/database';
import { processDueAlarmEscalations } from '../services/alarmEscalationWorker';

jest.mock('../config/database', () => ({
  pool: { query: jest.fn() },
  withTenantTransaction: jest.fn()
}));

const tenantId = '11111111-1111-4111-8111-111111111111';
const job = {
  id: '22222222-2222-4222-8222-222222222222',
  alarm_incident_id: '33333333-3333-4333-8333-333333333333',
  rule_id: '44444444-4444-4444-8444-444444444444',
  step_id: '55555555-5555-4555-8555-555555555555',
  attempt_count: 0,
  incident_status: 'neu'
};
const db = { query: jest.fn() };
let channel: 'in_app' | 'email';
let failRecipientLookup: boolean;

beforeEach(() => {
  jest.clearAllMocks();
  channel = 'in_app';
  failRecipientLookup = false;
  (pool.query as jest.Mock).mockResolvedValue({ rows: [{ id: tenantId }] });
  (withTenantTransaction as jest.Mock).mockImplementation(
    (_tenant: string, callback: (client: typeof db) => Promise<unknown>) => callback(db)
  );
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT j.id,j.alarm_incident_id')) return { rows: [job] };
    if (sql.includes('SELECT channel,recipient_role_id')) {
      return { rows: [{ channel, recipient_role_id: null, recipient_employee_id: 'employee-id' }] };
    }
    if (sql.includes('FROM employees e JOIN users u')) {
      if (failRecipientLookup) throw new Error('recipient database unavailable');
      return { rows: [{ id: 'user-id', email: 'responder@example.test' }] };
    }
    return { rows: [] };
  });
});

describe('alarm escalation worker delivery state', () => {
  test('records an in-app notification as delivered only after resolving an active user', async () => {
    await expect(processDueAlarmEscalations()).resolves.toBe(1);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO alarm_notifications'),
      expect.arrayContaining([tenantId, job.id, job.alarm_incident_id, 'user-id', 'responder@example.test'])
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE alarm_escalation_jobs SET status=$1'),
      expect.arrayContaining(['completed', null, tenantId, job.id])
    );
  });

  test('records unconfigured email as not_configured and blocks the job without claiming delivery', async () => {
    channel = 'email';
    await expect(processDueAlarmEscalations()).resolves.toBe(1);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1,$2,$3,$4,$5,$6,'not_configured',$7)"),
      expect.arrayContaining([tenantId, job.id, job.alarm_incident_id, 'user-id', 'responder@example.test', 'email'])
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE alarm_escalation_jobs SET status=$1'),
      expect.arrayContaining(['blocked', 'Kein konfigurierter oder zugeordneter Empfängerkanal.', tenantId, job.id])
    );
  });

  test('retries a transient failure with a pending job and a scheduled retry', async () => {
    failRecipientLookup = true;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const processed = await processDueAlarmEscalations();
    const loggedErrors = errorSpy.mock.calls;
    errorSpy.mockRestore();
    expect({ processed, loggedErrors }).toEqual({
      processed: 1,
      loggedErrors: [['[ALARM ESCALATION] Delivery attempt failed.']]
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE alarm_escalation_jobs SET status=$1,lease_until=NULL,retry_at=$2'),
      expect.arrayContaining(['pending', expect.any(Date), tenantId, job.id])
    );
  });
});
