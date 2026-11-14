import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { pool, withTenantTransaction } from '../config/database';
import { computePayloadHash } from './syncHash';

const POLL_INTERVAL_MS = 30_000;
const PATROL_SYNC_GRACE_MS = 24 * 60 * 60 * 1000 + 5 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function materializePatrolOccurrences(
  db: PoolClient,
  tenantId: string,
  now: Date,
  daysBehind = 0,
  daysAhead = 7
): Promise<number> {
  const inserted = await db.query(
    `WITH active_versions AS (
       SELECT r.id AS route_id,r.site_id,r.tenant_id,r.current_version,
              v.schedule_timezone,v.schedule_anchor_date,v.time_window_start,v.time_window_end,
              v.recurrence_frequency,v.recurrence_interval,v.recurrence_days,
              v.target_duration_minutes,v.late_tolerance_minutes
         FROM patrol_routes r
         JOIN patrol_route_versions v
           ON v.tenant_id=r.tenant_id AND v.route_id=r.id AND v.version=r.current_version
        WHERE r.tenant_id=$1 AND r.active=true AND r.archived_at IS NULL
          AND v.recurrence_frequency IN ('daily','weekly')
          AND v.time_window_start IS NOT NULL AND v.time_window_end IS NOT NULL
     ), candidate_days AS (
       SELECT v.*,(schedule_day.day)::date AS local_day
         FROM active_versions v
         CROSS JOIN LATERAL generate_series(
           GREATEST(
             v.schedule_anchor_date,
             (($2::timestamptz AT TIME ZONE v.schedule_timezone)::date - $3::integer)::date
           )::timestamp,
           ((($2::timestamptz AT TIME ZONE v.schedule_timezone)::date + $4::integer)::date)::timestamp,
           interval '1 day'
         ) AS schedule_day(day)
     ), eligible AS (
       SELECT *,((local_day + time_window_start) AT TIME ZONE schedule_timezone) AS scheduled_at,
         ((local_day + time_window_end
           + CASE WHEN time_window_end <= time_window_start THEN interval '1 day' ELSE interval '0' END)
           AT TIME ZONE schedule_timezone) AS window_ends_at
         FROM candidate_days
        WHERE local_day >= schedule_anchor_date
          AND (
            (recurrence_frequency='daily'
              AND (local_day - schedule_anchor_date) % recurrence_interval = 0)
            OR
            (recurrence_frequency='weekly'
              AND EXTRACT(DOW FROM local_day)::smallint = ANY(recurrence_days)
              AND ((local_day - date_trunc('week', schedule_anchor_date)::date) / 7) % recurrence_interval = 0)
          )
     ), inserted AS (
       INSERT INTO patrol_schedule_occurrences
         (tenant_id,site_id,route_id,route_version,scheduled_at,window_ends_at,deadline_at)
       SELECT tenant_id,site_id,route_id,current_version,scheduled_at,window_ends_at,
              GREATEST(window_ends_at,scheduled_at + make_interval(mins => target_duration_minutes))
                + make_interval(mins => late_tolerance_minutes)
         FROM eligible
       ON CONFLICT (tenant_id,route_id,route_version,scheduled_at) DO NOTHING
       RETURNING id,tenant_id,route_id,scheduled_at
     )
     SELECT id,tenant_id,route_id,scheduled_at FROM inserted`,
    [tenantId, now.toISOString(), daysBehind, daysAhead]
  );
  if (!inserted.rows.length) return 0;

  const eventRows = inserted.rows.map((occurrence: {
    id: string;
    route_id: string;
    scheduled_at: string;
  }) => ({
    id: occurrence.id,
    details: {
      routeId: occurrence.route_id,
      scheduledAt: occurrence.scheduled_at
    }
  }));
  await db.query(
    `INSERT INTO patrol_schedule_occurrence_events
       (tenant_id,occurrence_id,actor_type,action,details)
     SELECT $1,(event->>'id')::uuid,'system','materialized',event->'details'
       FROM jsonb_array_elements($2::jsonb) AS event`,
    [tenantId, JSON.stringify(eventRows)]
  );
  return inserted.rowCount ?? 0;
}

function systemMutationId(occurrenceId: string, category: string): string {
  const hash = createHash('sha256').update(`${occurrenceId}:${category}`, 'utf8').digest('hex');
  return `auto_${hash.slice(0, 59)}`;
}

async function writeSystemDeviation(
  db: PoolClient,
  tenantId: string,
  occurrence: { id: string; site_id: string; round_id: string | null; scheduled_at: string },
  category: 'missed_round' | 'abandoned_round',
  description: string,
  occurredAt: Date
): Promise<void> {
  const mutationId = systemMutationId(occurrence.id, category);
  const capturedAt = new Date(occurrence.scheduled_at).toISOString();
  const payload = {
    siteId: occurrence.site_id,
    roundId: occurrence.round_id ?? undefined,
    category,
    severity: 'high',
    description,
    capturedAt
  };
  await db.query(
    `INSERT INTO patrol_exceptions
       (tenant_id,site_id,round_id,category,severity,description,client_mutation_id,payload_hash,
        client_captured_at,server_received_at,created_by_user_id,created_by_type,created_at)
     VALUES ($1,$2,$3,$4,'high',$5,$6,$7,$8,$9,NULL,'system',$9)
     ON CONFLICT (tenant_id,client_mutation_id) DO NOTHING`,
    [tenantId, occurrence.site_id, occurrence.round_id, category, description, mutationId,
      computePayloadHash(payload), capturedAt, occurredAt.toISOString()]
  );
}

async function writeOccurrenceEvent(
  db: PoolClient,
  tenantId: string,
  occurrenceId: string,
  action: 'round_missed' | 'round_abandoned',
  details: Record<string, unknown>,
  occurredAt: Date
): Promise<void> {
  await db.query(
    `INSERT INTO patrol_schedule_occurrence_events
       (tenant_id,occurrence_id,actor_type,action,details,occurred_at)
     VALUES ($1,$2,'system',$3,$4,$5)`,
    [tenantId, occurrenceId, action, details, occurredAt.toISOString()]
  );
}

export async function processTenantPatrolSchedules(
  db: PoolClient,
  tenantId: string,
  now = new Date()
): Promise<{ materialized: number; missed: number; abandoned: number }> {
  const materialized = await materializePatrolOccurrences(db, tenantId, now, 7, 7);
  const terminalizationCutoff = new Date(now.getTime() - PATROL_SYNC_GRACE_MS).toISOString();
  const missed = await db.query(
    `UPDATE patrol_schedule_occurrences
        SET status='missed',resolved_at=$2,updated_at=$2
      WHERE tenant_id=$1 AND status='scheduled' AND deadline_at <= $3
      RETURNING id,site_id,route_id,route_version,round_id,scheduled_at`,
    [tenantId, now.toISOString(), terminalizationCutoff]
  );
  for (const occurrence of missed.rows) {
    await writeSystemDeviation(
      db, tenantId, occurrence, 'missed_round',
      'Der geplante Kontrollgang wurde nicht innerhalb seines Zeitfensters gestartet.',
      now
    );
    await writeOccurrenceEvent(db, tenantId, occurrence.id, 'round_missed', {
      routeId: occurrence.route_id,
      routeVersion: occurrence.route_version,
      scheduledAt: occurrence.scheduled_at
    }, now);
  }

  const stale = await db.query(
    `SELECT o.id,o.site_id,o.route_id,o.route_version,o.round_id,o.scheduled_at,
            r.guard_user_id
       FROM patrol_schedule_occurrences o
       JOIN patrol_rounds r ON r.tenant_id=o.tenant_id AND r.id=o.round_id
      WHERE o.tenant_id=$1 AND o.status='in_progress' AND o.deadline_at <= $2
        AND r.status='in_progress'
      FOR UPDATE OF o,r SKIP LOCKED`,
    [tenantId, terminalizationCutoff]
  );
  for (const occurrence of stale.rows) {
    const changed = await db.query(
      `UPDATE patrol_rounds
          SET status='abandoned',completed_at=$1,completion_server_received_at=$1,
              completion_notes='Automatisch als abgebrochen markiert, da das geplante Zeitfenster abgelaufen ist.'
        WHERE tenant_id=$2 AND id=$3 AND status='in_progress'
        RETURNING id`,
      [now.toISOString(), tenantId, occurrence.round_id]
    );
    if (!changed.rows.length) continue;
    await db.query(
      `UPDATE patrol_schedule_occurrences
          SET status='abandoned',resolved_at=$1,updated_at=$1
        WHERE tenant_id=$2 AND id=$3 AND status='in_progress'`,
      [now.toISOString(), tenantId, occurrence.id]
    );
    await writeSystemDeviation(
      db, tenantId, occurrence, 'abandoned_round',
      'Der begonnene Kontrollgang wurde nicht bis zum Ende des geplanten Zeitfensters abgeschlossen.',
      now
    );
    await writeOccurrenceEvent(db, tenantId, occurrence.id, 'round_abandoned', {
      routeId: occurrence.route_id,
      routeVersion: occurrence.route_version,
      roundId: occurrence.round_id,
      assignedUserId: occurrence.guard_user_id
    }, now);
  }
  return { materialized, missed: missed.rowCount ?? 0, abandoned: stale.rowCount ?? 0 };
}

export async function processDuePatrolSchedules(now = new Date()): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const tenants = await pool.query('SELECT id FROM tenants WHERE is_active=true');
    let processed = 0;
    for (const tenant of tenants.rows) {
      try {
        await withTenantTransaction(tenant.id, async db => {
          const result = await processTenantPatrolSchedules(db, tenant.id, now);
          processed += result.materialized + result.missed + result.abandoned;
        });
      } catch {
        console.error('[PATROL SCHEDULE] Tenant processing failed.');
      }
    }
    return processed;
  } catch {
    console.error('[PATROL SCHEDULE] Tenant enumeration failed.');
    return 0;
  } finally {
    running = false;
  }
}

export function startPatrolScheduleWorker(): void {
  if (timer) return;
  void processDuePatrolSchedules().catch(() => {
    console.error('[PATROL SCHEDULE] Worker poll failed.');
  });
  timer = setInterval(() => {
    void processDuePatrolSchedules().catch(() => {
      console.error('[PATROL SCHEDULE] Worker poll failed.');
    });
  }, POLL_INTERVAL_MS);
  timer.unref();
}

export function stopPatrolScheduleWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
