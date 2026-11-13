import { pool, withTenantTransaction } from '../config/database';
import { PoolClient } from 'pg';

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;

let timer: NodeJS.Timeout | null = null;
let running = false;

const CLAIM_DUE_JOBS_SQL = `
  SELECT j.id,j.alarm_incident_id,j.rule_id,j.step_id,j.attempt_count,a.status AS incident_status
  FROM alarm_escalation_jobs j
  JOIN alarm_incidents a ON a.id=j.alarm_incident_id AND a.tenant_id=j.tenant_id
  WHERE j.tenant_id=$1 AND (
    (j.status='pending' AND COALESCE(j.retry_at,j.scheduled_at)<=CURRENT_TIMESTAMP)
    OR (j.status='processing' AND j.lease_until<=CURRENT_TIMESTAMP)
  )
  ORDER BY COALESCE(j.retry_at,j.scheduled_at),j.created_at
  FOR UPDATE OF j SKIP LOCKED LIMIT $2`;

export async function claimDueAlarmEscalationJobs(
  db: PoolClient,
  tenantId: string
): Promise<any[]> {
  const result = await db.query(CLAIM_DUE_JOBS_SQL, [tenantId, BATCH_SIZE]);
  return result.rows;
}

async function deliverJob(db: PoolClient, tenantId: string, job: any): Promise<boolean> {
  const step = await db.query(
    `SELECT channel,recipient_role_id,recipient_employee_id
     FROM alarm_escalation_steps
     WHERE tenant_id=$1 AND id=$2 AND rule_id=$3`,
    [tenantId, job.step_id, job.rule_id]
  );
  if (!step.rows.length) throw new Error('Configured escalation step is missing.');
  const config = step.rows[0];
  const recipients = config.recipient_role_id
    ? await db.query(
      `SELECT DISTINCT u.id,u.email
       FROM user_roles ur
       JOIN users u ON u.id=ur.user_id
       WHERE ur.tenant_id=$1 AND ur.role_id=$2 AND u.is_active=true`,
      [tenantId, config.recipient_role_id]
    )
    : await db.query(
      `SELECT u.id,u.email
       FROM employees e JOIN users u ON lower(u.email)=lower(e.email)
       WHERE e.tenant_id=$1 AND e.id=$2 AND e.archived_at IS NULL AND u.is_active=true`,
      [tenantId, config.recipient_employee_id]
    );

  if (config.channel !== 'in_app') {
    const channelLabel = config.channel === 'email' ? 'Email' : 'Push';
    const targets = recipients.rows.length ? recipients.rows : [{ id: null, email: null }];
    for (const recipient of targets) {
      await db.query(
        `INSERT INTO alarm_notifications
          (tenant_id,escalation_job_id,alarm_incident_id,recipient_user_id,recipient_email,channel,
           delivery_status,last_error)
         VALUES ($1,$2,$3,$4,$5,$6,'not_configured',$7)
         ON CONFLICT (tenant_id,escalation_job_id,channel,recipient_user_id) DO NOTHING`,
        [tenantId, job.id, job.alarm_incident_id, recipient.id, recipient.email, config.channel,
          `${channelLabel}-Zustellung ist nicht konfiguriert.`]
      );
    }
    return false;
  }

  if (!recipients.rows.length) {
    await db.query(
      `INSERT INTO alarm_notifications
        (tenant_id,escalation_job_id,alarm_incident_id,channel,delivery_status,last_error)
       VALUES ($1,$2,$3,'in_app','not_configured','Kein aktives Benutzerkonto für den Empfänger.')
       ON CONFLICT DO NOTHING`,
      [tenantId, job.id, job.alarm_incident_id]
    );
    return false;
  }

  for (const recipient of recipients.rows) {
    await db.query(
      `INSERT INTO alarm_notifications
        (tenant_id,escalation_job_id,alarm_incident_id,recipient_user_id,recipient_email,
         channel,delivery_status,attempt_count,delivered_at)
       VALUES ($1,$2,$3,$4,$5,'in_app','delivered',1,CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id,escalation_job_id,channel,recipient_user_id) DO NOTHING`,
      [tenantId, job.id, job.alarm_incident_id, recipient.id, recipient.email]
    );
  }
  return true;
}

async function processTenant(tenantId: string): Promise<number> {
  return withTenantTransaction(tenantId, async db => {
    const jobs = await claimDueAlarmEscalationJobs(db, tenantId);
    let processed = 0;
    for (const job of jobs) {
      const attempts = job.attempt_count + 1;
      await db.query(
        `UPDATE alarm_escalation_jobs SET status='processing',attempt_count=$1,
           lease_until=CURRENT_TIMESTAMP + interval '1 minute',updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=$2 AND id=$3`,
        [attempts, tenantId, job.id]
      );
      await db.query('SAVEPOINT alarm_escalation_delivery');
      try {
        if (job.incident_status !== 'neu') {
          await db.query(
            `UPDATE alarm_escalation_jobs SET status='cancelled',lease_until=NULL,
               last_error='Alarm nicht mehr neu; Eskalation beendet.',updated_at=CURRENT_TIMESTAMP
             WHERE tenant_id=$1 AND alarm_incident_id=$2 AND status IN ('pending','processing')`,
            [tenantId, job.alarm_incident_id]
          );
          await db.query('RELEASE SAVEPOINT alarm_escalation_delivery');
          processed++;
          continue;
        }
        const delivered = await deliverJob(db, tenantId, job);
        await db.query(
          `UPDATE alarm_escalation_jobs SET status=$1,lease_until=NULL,
             last_error=$2,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$3 AND id=$4`,
          [delivered ? 'completed' : 'blocked',
            delivered ? null : 'Kein konfigurierter oder zugeordneter Empfängerkanal.',
            tenantId, job.id]
        );
        await db.query('RELEASE SAVEPOINT alarm_escalation_delivery');
        processed++;
      } catch {
        await db.query('ROLLBACK TO SAVEPOINT alarm_escalation_delivery');
        const delaySeconds = Math.min(30 * (2 ** (attempts - 1)), 300);
        await db.query(
          `UPDATE alarm_escalation_jobs SET status=$1,lease_until=NULL,retry_at=$2,
             last_error='Eskalationszustellung fehlgeschlagen; automatischer Wiederholungsversuch geplant.',
             updated_at=CURRENT_TIMESTAMP
           WHERE tenant_id=$3 AND id=$4`,
          [attempts >= MAX_ATTEMPTS ? 'blocked' : 'pending',
            attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + delaySeconds * 1000),
            tenantId, job.id]
        );
        await db.query('RELEASE SAVEPOINT alarm_escalation_delivery');
        processed++;
        console.error('[ALARM ESCALATION] Delivery attempt failed.');
      }
    }
    return processed;
  });
}

export async function processDueAlarmEscalations(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const tenants = await pool.query('SELECT id FROM tenants WHERE is_active=true');
    let count = 0;
    for (const tenant of tenants.rows) {
      try {
        count += await processTenant(tenant.id);
      } catch {
        console.error('[ALARM ESCALATION] Tenant batch failed.');
      }
    }
    return count;
  } finally {
    running = false;
  }
}

export function startAlarmEscalationWorker(): void {
  if (timer) return;
  void processDueAlarmEscalations();
  timer = setInterval(() => { void processDueAlarmEscalations(); }, POLL_INTERVAL_MS);
  timer.unref();
}

export function stopAlarmEscalationWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
