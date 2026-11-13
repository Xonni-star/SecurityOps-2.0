import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import { createHandover, handoverCreateSchema, HandoverConflictError } from '../services/handoverService';
import { computePayloadHash } from '../services/syncHash';
import { storePlanningFindings, validateShiftCandidate } from '../services/planningService';
import {
  recordPatrolException,
  recordPatrolRoundCompletion,
  recordPatrolRoundStart,
  recordPatrolScan,
  recordPatrolScanAttempt
} from './patrolController';

export { canonicalStringify, computePayloadHash } from '../services/syncHash';

export class ConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

const syncMutationItemSchema = z.object({
  clientUuid: z.string().min(8).max(64).regex(/^[a-zA-Z0-9_\-]+$/, 'clientUuid muss ein valider Bezeichner sein.'),
  entityType: z.enum(['guardbook', 'shift', 'task', 'key', 'patrol', 'handover']),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']),
  clientTimestamp: z.string(),
  baseVersion: z.number().int().default(1),
  payload: z.record(z.string(), z.any())
});

const syncPushBatchSchema = z.object({
  deviceId: z.string().min(4).max(128),
  mutations: z.array(syncMutationItemSchema).min(1, 'Mindestens eine Mutation muss übermittelt werden.')
});

const conflictResolveSchema = z.object({
  clientUuid: z.string().min(8).max(64),
  entityType: z.enum(['task', 'shift', 'key', 'guardbook', 'patrol']),
  strategy: z.enum(['USE_LOCAL', 'USE_SERVER', 'RECORD_AS_EXCEPTION']),
  expectedVersion: z.number().int().positive('expectedVersion muss eine positive Ganzzahl sein.'),
  localPayload: z.record(z.string(), z.any()).optional()
}).superRefine((value, ctx) => {
  if (value.entityType === 'patrol' && value.strategy === 'USE_LOCAL') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['strategy'],
      message: 'Patrol-Ereignisse sind append-only; lokale Daten können nur als neue Abweichung dokumentiert werden.'
    });
  }
  if (value.entityType !== 'patrol' && value.strategy === 'RECORD_AS_EXCEPTION') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['strategy'],
      message: 'Diese Auflösungsstrategie ist nur für Kontrollgangskonflikte zulässig.'
    });
  }
});

export interface SyncResultItem {
  clientUuid: string;
  serverId: string;
  status: 'SYNCED' | 'CONFLICT' | 'REJECTED';
  serverVersion: number;
  conflictData?: any;
  message?: string;
}

export function hasMutationPermission(
  entityType: z.infer<typeof syncMutationItemSchema>['entityType'],
  permissions: string[]
): boolean {
  const permissionByEntity = {
    guardbook: 'logbook:create',
    shift: 'shifts:manage',
    task: 'tasks:manage',
    key: 'keys:manage',
    patrol: 'patrol:create',
    handover: 'handovers:create'
  } as const;
  return permissions.includes(permissionByEntity[entityType]) ||
    (entityType === 'handover' && permissions.includes('handover:create'));
}

function hasPatrolMutationPermission(recordType: unknown, permissions: string[]): boolean {
  const specificPermission = recordType === 'round_start'
    ? 'patrol:round:start'
    : recordType === 'round_complete'
      ? 'patrol:round:complete'
      : recordType === 'exception'
        ? 'patrol:exception:create'
        : 'patrol:round:perform';
  return permissions.includes(specificPermission) || permissions.includes('patrol:create');
}

/**
 * Kanonische, rekursive Serialisierung:
 * Sortiert alle Schlüssel verschachtelter Objekte und normalisiert Arrays deterministisch,
 * damit identische Datenstrukturen unabhängig von Key-Reihenfolgen denselben SHA-256-Hash erzeugen.
 */
/**
 * POST /api/v1/sync/push
 * Verarbeitet Push-Mutationen und speichert Quittungen in sync_idempotency_receipts
 */
export async function pushSyncMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;
    const userEmail = req.user!.email;
    const body = syncPushBatchSchema.parse(req.body);

    const results: SyncResultItem[] = [];

    await withTenantTransaction(tenantId, async (client) => {
      for (const mut of body.mutations) {
        const hasPermission = mut.entityType === 'patrol'
          ? hasPatrolMutationPermission(mut.payload.recordType, req.user!.permissions)
          : hasMutationPermission(mut.entityType, req.user!.permissions);
        if (!hasPermission) {
          results.push({
            clientUuid: mut.clientUuid,
            serverId: 'none',
            status: 'REJECTED',
            serverVersion: mut.baseVersion,
            message: 'Mutation abgewiesen: fehlende Berechtigung für diesen Vorgang.'
          });
          continue;
        }

        const payloadHash = computePayloadHash(mut.payload);

        // Transaction Advisory Lock zur Verhinderung paralleler Race Conditions
        const lockKey = `${tenantId}:push:${mut.clientUuid}`;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

        // Prüfen auf bereits vorhandene Push-Quittung
        const receiptRes = await client.query(
          `SELECT client_mutation_id, entity_type, action, payload_hash, status, server_id, server_version, response_json
           FROM sync_idempotency_receipts
           WHERE tenant_id = $1 AND client_mutation_id = $2`,
          [tenantId, mut.clientUuid]
        );

        if (receiptRes.rows.length > 0) {
          const receipt = receiptRes.rows[0];

          if (
            receipt.entity_type !== mut.entityType ||
            receipt.action !== mut.action ||
            receipt.payload_hash !== payloadHash
          ) {
            const serverPayload = mut.entityType === 'handover' && /^[0-9a-f-]{36}$/i.test(receipt.server_id)
              ? (await client.query(
                `SELECT id,site_id,area,shift_id,occurred_at,general_text,incidents,important_notes,
                        safety_information,status,revision_version
                 FROM handovers WHERE tenant_id=$1 AND id=$2`,
                [tenantId, receipt.server_id]
              )).rows[0]
              : receipt.response_json;
            results.push({
              clientUuid: mut.clientUuid,
              serverId: receipt.server_id,
              status: mut.entityType === 'handover' ? 'CONFLICT' : 'REJECTED',
              serverVersion: receipt.server_version,
              conflictData: mut.entityType === 'handover' ? {
                serverVersion: receipt.server_version,
                clientVersion: mut.baseVersion,
                serverPayload,
                clientPayload: mut.payload
              } : undefined,
              message: 'Integritätsverletzung: Mutation-ID wurde mit abweichendem Inhalt oder Vorgang wiederverwendet.'
            });
            continue;
          }

          results.push(receipt.response_json as SyncResultItem);
          continue;
        }

        let itemResult: SyncResultItem;

        // 1. GUARDBOOK
        if (mut.entityType === 'guardbook') {
          if (mut.action === 'DELETE') {
            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: 'Löschen von Wachbucheinträgen ist nach DIN 77200 verboten (Append-Only Integrität).'
            };
          } else if (mut.action === 'CREATE') {
            const siteId = mut.payload.siteId;
            const guardId = mut.payload.guardId || userId;
            const category = mut.payload.category || 'Vorkommnis';
            const priority = mut.payload.priority || 'Normal';
            const title = mut.payload.title || 'Offline erfasster Vorfall';
            const description = mut.payload.description || '';
            const policeInvolved = Boolean(mut.payload.policeInvolved);

            const insertRes = await client.query(
              `INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, police_involved, client_mutation_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
               RETURNING id, title`,
              [tenantId, siteId, guardId, category, priority, title, description, policeInvolved, mut.clientUuid]
            );

            if (insertRes.rows.length > 0) {
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: insertRes.rows[0].id,
                status: 'SYNCED',
                serverVersion: 1
              };
            } else {
              const existingRes = await client.query(
                'SELECT id FROM guardbook_entries WHERE tenant_id = $1 AND client_mutation_id = $2',
                [tenantId, mut.clientUuid]
              );
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: existingRes.rows[0]?.id || 'unknown',
                status: 'SYNCED',
                serverVersion: 1,
                message: 'Bereits vorhanden (idempotent bestätigt)'
              };
            }
          } else if (mut.action === 'UPDATE') {
            const targetEntryId = mut.payload.entryId;

            if (!targetEntryId) {
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: 'none',
                status: 'REJECTED',
                serverVersion: mut.baseVersion,
                message: 'Wachbuch-Korrektur erfordert die ursprüngliche entryId in payload.entryId.'
              };
            } else {
              const entryCheck = await client.query(
                'SELECT id, stage FROM guardbook_entries WHERE id = $1 AND tenant_id = $2',
                [targetEntryId, tenantId]
              );

              if (entryCheck.rows.length === 0) {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: targetEntryId,
                  status: 'REJECTED',
                  serverVersion: mut.baseVersion,
                  message: 'Ursprünglicher Wachbucheintrag für Korrektur nicht gefunden oder fremder Mandant.'
                };
              } else {
                const note = mut.payload.correctionNote || 'Korrektur aus Offline-Synchronisation';

                await client.query(
                  `INSERT INTO guardbook_revisions (tenant_id, entry_id, author_name, note, client_mutation_id)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING`,
                  [tenantId, targetEntryId, userEmail, note, mut.clientUuid]
                );

                if (mut.payload.stage) {
                  await client.query(
                    'UPDATE guardbook_entries SET stage = $1 WHERE id = $2 AND tenant_id = $3',
                    [mut.payload.stage, targetEntryId, tenantId]
                  );
                }

                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: targetEntryId,
                  status: 'SYNCED',
                  serverVersion: mut.baseVersion + 1,
                  message: 'Revision erfolgreich angehängt'
                };
              }
            }
          } else {
            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: `Aktion '${mut.action}' für Wachbuch unzulässig.`
            };
          }
        }

        // 2. SHIFTS
        else if (mut.entityType === 'shift') {
          if (mut.action === 'CREATE') {
            const input = z.object({
              siteId: z.string().guid(),
              employeeId: z.string().guid().nullable().optional(),
              shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
              startTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
              endTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
              startOffsetMinutes: z.number().int().min(-840).max(840).optional(),
              endOffsetMinutes: z.number().int().min(-840).max(840).optional(),
              breakMinutes: z.number().int().min(0).max(1440).default(0),
              type: z.enum(['Tagdienst', 'Nachtdienst', 'Revierdienst', 'Sonderposten']).default('Tagdienst'),
              status: z.enum(['Besetzt', 'Offen', 'Konflikt', 'Abgeschlossen']).optional(),
              requiredQualification: z.string().min(2).max(100),
              conflictReason: z.string().max(500).nullable().optional()
            }).strict().safeParse({
              ...mut.payload,
              date: mut.payload.shiftDate ?? mut.payload.date,
              status: mut.payload.status ?? 'Offen'
            });
            if (!input.success) {
              itemResult = {
                clientUuid: mut.clientUuid, serverId: 'none', status: 'REJECTED',
                serverVersion: mut.baseVersion, message: 'Ungültige Schichtdaten oder erforderliche Zeiten/Qualifikation fehlen.'
              };
            } else {
              const value = input.data;
              const validation = await validateShiftCandidate(client, {
                tenantId, siteId: value.siteId, employeeId: value.employeeId ?? null,
                date: value.date!, startTime: value.startTime, endTime: value.endTime,
                startOffsetMinutes: value.startOffsetMinutes, endOffsetMinutes: value.endOffsetMinutes,
                breakMinutes: value.breakMinutes, requiredQualification: value.requiredQualification
              });
              if (validation.findings.some(finding => finding.severity === 'blocking')) {
                const stored = await storePlanningFindings(client, tenantId, validation.findings, {
                  employeeId: value.employeeId ?? undefined, profileVersionId: validation.profileVersionId
                });
                itemResult = {
                  clientUuid: mut.clientUuid, serverId: 'none', status: 'REJECTED',
                  serverVersion: mut.baseVersion, message: 'Serverseitige Dienstplanprüfung abgelehnt.',
                  conflictData: { validationRunId: stored.runId, findings: stored.findings }
                };
              } else {
                const inserted = await client.query(
                  `INSERT INTO shifts
                    (tenant_id,site_id,employee_id,shift_date,start_time,end_time,starts_at,ends_at,time_zone,
                     break_minutes,type,status,planning_status,required_qualification,conflict_reason,
                     client_mutation_id,revision_version)
                   VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13,$14,1)
                   ON CONFLICT (tenant_id,client_mutation_id) DO NOTHING
                   RETURNING id,revision_version`,
                  [tenantId, value.siteId, value.date, value.startTime, value.endTime,
                    validation.resolved.startsAt, validation.resolved.endsAt, validation.resolved.timeZone,
                    value.breakMinutes, value.type, value.employeeId ? value.status : 'Offen',
                    value.requiredQualification, value.conflictReason ?? null, mut.clientUuid]
                );
                const shift = inserted.rows[0] ?? (await client.query(
                  'SELECT id,revision_version FROM shifts WHERE tenant_id=$1 AND client_mutation_id=$2',
                  [tenantId, mut.clientUuid]
                )).rows[0];
                if (!shift) throw new Error('Idempotente Schichtanlage konnte nicht aufgelöst werden.');
                if (value.employeeId && inserted.rows.length) {
                  await client.query(
                    `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
                     VALUES ($1,$2,$3,$4)`,
                    [tenantId, shift.id, value.employeeId, userId]
                  );
                  await client.query('UPDATE shifts SET employee_id=$1 WHERE tenant_id=$2 AND id=$3', [value.employeeId, tenantId, shift.id]);
                }
                const stored = await storePlanningFindings(client, tenantId, validation.findings, {
                  shiftId: shift.id, employeeId: value.employeeId ?? undefined,
                  profileVersionId: validation.profileVersionId
                });
                await client.query(
                  `INSERT INTO planning_audit_events
                    (tenant_id,actor_user_id,event_type,entity_type,entity_id,details)
                   VALUES ($1,$2,'shift.synced','shift',$3,$4::jsonb)`,
                  [tenantId, userId, shift.id, JSON.stringify({ mutationId: mut.clientUuid, validationRunId: stored.runId })]
                );
                itemResult = {
                  clientUuid: mut.clientUuid, serverId: shift.id, status: 'SYNCED',
                  serverVersion: shift.revision_version, message: 'Entwurf serverseitig geprüft; Veröffentlichung bleibt separat.'
                };
              }
            }
          } else if (mut.action === 'UPDATE') {
            const shiftId = z.string().guid().safeParse(mut.payload.id);
            if (!shiftId.success) {
              itemResult = { clientUuid: mut.clientUuid, serverId: 'none', status: 'REJECTED', serverVersion: mut.baseVersion, message: 'Ungültige Schicht-ID.' };
            } else {
              const current = await client.query(
                `SELECT id,site_id,employee_id,shift_date,start_time,end_time,starts_at,ends_at,time_zone,
                        break_minutes,type,status,planning_status,required_qualification,conflict_reason,revision_version
                   FROM shifts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
                [tenantId, shiftId.data]
              );
              if (!current.rows.length) {
                itemResult = { clientUuid: mut.clientUuid, serverId: shiftId.data, status: 'REJECTED', serverVersion: mut.baseVersion, message: 'Schicht nicht gefunden oder fremder Mandant.' };
              } else if (Number(current.rows[0].revision_version) !== mut.baseVersion) {
                itemResult = {
                  clientUuid: mut.clientUuid, serverId: shiftId.data, status: 'CONFLICT',
                  serverVersion: current.rows[0].revision_version,
                  conflictData: { serverStatus: current.rows[0].status, serverVersion: current.rows[0].revision_version },
                  message: 'Atomarer Versionskonflikt bei Schichtaktualisierung.'
                };
              } else if (current.rows[0].planning_status === 'published') {
                itemResult = {
                  clientUuid: mut.clientUuid, serverId: shiftId.data, status: 'CONFLICT',
                  serverVersion: current.rows[0].revision_version,
                  message: 'Veröffentlichte Schichten müssen über einen neuen Dienstplanvorgang geändert werden.'
                };
              } else {
                const old = current.rows[0];
                const updateSchema = z.object({
                  siteId: z.string().guid().optional(),
                  employeeId: z.string().guid().nullable().optional(),
                  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
                  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
                  startTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
                  endTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
                  startOffsetMinutes: z.number().int().min(-840).max(840).optional(),
                  endOffsetMinutes: z.number().int().min(-840).max(840).optional(),
                  breakMinutes: z.number().int().min(0).max(1440).optional(),
                  type: z.enum(['Tagdienst', 'Nachtdienst', 'Revierdienst', 'Sonderposten']).optional(),
                  status: z.enum(['Besetzt', 'Offen', 'Konflikt', 'Abgeschlossen']).optional(),
                  requiredQualification: z.string().min(2).max(100).optional(),
                  conflictReason: z.string().max(500).nullable().optional()
                }).strict().safeParse(mut.payload);
                if (!updateSchema.success) {
                  itemResult = { clientUuid: mut.clientUuid, serverId: shiftId.data, status: 'REJECTED', serverVersion: mut.baseVersion, message: 'Ungültige Schichtdaten.' };
                } else {
                  const value = updateSchema.data;
                  const employeeId = value.employeeId === undefined ? old.employee_id : value.employeeId;
                  const validation = await validateShiftCandidate(client, {
                    tenantId, siteId: value.siteId ?? old.site_id, employeeId,
                    date: value.shiftDate ?? value.date ?? String(old.shift_date).slice(0, 10),
                    startTime: value.startTime ?? String(old.start_time).slice(0, 8),
                    endTime: value.endTime ?? String(old.end_time).slice(0, 8),
                    startOffsetMinutes: value.startOffsetMinutes,
                    endOffsetMinutes: value.endOffsetMinutes,
                    breakMinutes: value.breakMinutes ?? old.break_minutes,
                    requiredQualification: value.requiredQualification ?? old.required_qualification,
                    excludeShiftId: shiftId.data
                  });
                  if (validation.findings.some(finding => finding.severity === 'blocking')) {
                    const stored = await storePlanningFindings(client, tenantId, validation.findings, {
                      shiftId: shiftId.data, employeeId: employeeId ?? undefined,
                      profileVersionId: validation.profileVersionId
                    });
                    itemResult = {
                      clientUuid: mut.clientUuid, serverId: shiftId.data, status: 'REJECTED',
                      serverVersion: old.revision_version, message: 'Serverseitige Dienstplanprüfung abgelehnt.',
                      conflictData: { validationRunId: stored.runId, findings: stored.findings }
                    };
                  } else {
                    const rawFields: Array<[string, unknown, string]> = [
                      ['siteId', value.siteId, 'site_id'], ['employeeId', value.employeeId, 'employee_id'],
                      ['shiftDate', value.shiftDate ?? value.date, 'shift_date'], ['startTime', value.startTime, 'start_time'],
                      ['endTime', value.endTime, 'end_time'], ['type', value.type, 'type'],
                      ['status', value.status, 'status'], ['requiredQualification', value.requiredQualification, 'required_qualification'],
                      ['conflictReason', value.conflictReason, 'conflict_reason'], ['breakMinutes', value.breakMinutes, 'break_minutes']
                    ];
                    const fields = rawFields.filter((field): field is [string, unknown, string] => field[1] !== undefined);
                    const sets = fields.map((field, index) => `${field[2]}=$${index + 1}`);
                    const values: unknown[] = fields.map(field => field[1]);
                    sets.push(`starts_at=$${values.length + 1}`, `ends_at=$${values.length + 2}`,
                      `time_zone=$${values.length + 3}`, "planning_status='draft'",
                      'revision_version=revision_version+1', 'updated_at=CURRENT_TIMESTAMP');
                    values.push(validation.resolved.startsAt, validation.resolved.endsAt, validation.resolved.timeZone);
                    values.push(shiftId.data, tenantId, mut.baseVersion);
                    const updated = await client.query(
                      `UPDATE shifts SET ${sets.join(', ')}
                        WHERE id=$${values.length - 2} AND tenant_id=$${values.length - 1}
                          AND revision_version=$${values.length}
                        RETURNING id,revision_version`,
                      values
                    );
                    if (value.employeeId !== undefined && value.employeeId !== old.employee_id) {
                      await client.query(
                        `UPDATE shift_staffing_assignments SET status='released',released_at=CURRENT_TIMESTAMP,
                            revision_version=revision_version+1
                          WHERE tenant_id=$1 AND shift_id=$2 AND status='assigned'`,
                        [tenantId, shiftId.data]
                      );
                      if (value.employeeId) {
                        await client.query(
                          `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
                           VALUES ($1,$2,$3,$4)
                           ON CONFLICT (tenant_id,shift_id,employee_id)
                           DO UPDATE SET status='assigned',released_at=NULL,assigned_at=CURRENT_TIMESTAMP,
                             assigned_by=EXCLUDED.assigned_by,
                             revision_version=shift_staffing_assignments.revision_version+1`,
                          [tenantId, shiftId.data, value.employeeId, userId]
                        );
                      }
                    }
                    const stored = await storePlanningFindings(client, tenantId, validation.findings, {
                      shiftId: shiftId.data, employeeId: employeeId ?? undefined,
                      profileVersionId: validation.profileVersionId
                    });
                    await client.query(
                      `INSERT INTO planning_audit_events
                        (tenant_id,actor_user_id,event_type,entity_type,entity_id,details)
                       VALUES ($1,$2,'shift.synced','shift',$3,$4::jsonb)`,
                      [tenantId, userId, shiftId.data, JSON.stringify({ mutationId: mut.clientUuid, validationRunId: stored.runId })]
                    );
                    itemResult = {
                      clientUuid: mut.clientUuid, serverId: shiftId.data, status: 'SYNCED',
                      serverVersion: updated.rows[0]?.revision_version ?? old.revision_version,
                      message: 'Entwurf serverseitig geprüft; Veröffentlichung bleibt separat.'
                    };
                  }
                }
              }
            }
          } else if (mut.action === 'DELETE') {
            const shiftId = mut.payload.id;

            const delRes = await client.query(
              `DELETE FROM shifts WHERE id = $1 AND tenant_id = $2 AND revision_version = $3
                 AND planning_status <> 'published' RETURNING id`,
              [shiftId, tenantId, mut.baseVersion]
            );

            if (delRes.rows.length > 0) {
              await client.query(
                `INSERT INTO planning_audit_events
                  (tenant_id,actor_user_id,event_type,entity_type,entity_id,details)
                 VALUES ($1,$2,'shift.deleted','shift',$3,$4::jsonb)`,
                [tenantId, userId, shiftId, JSON.stringify({ mutationId: mut.clientUuid, baseVersion: mut.baseVersion })]
              );
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: shiftId,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1,
                message: 'Schicht gelöscht'
              };
            } else {
              const curRes = await client.query(
                'SELECT revision_version,planning_status FROM shifts WHERE id = $1 AND tenant_id = $2',
                [shiftId, tenantId]
              );
              if (curRes.rows.length > 0) {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: shiftId,
                  status: 'CONFLICT',
                  serverVersion: curRes.rows[0].revision_version,
                  message: curRes.rows[0].planning_status === 'published'
                    ? 'Veröffentlichte Schichten können nicht offline gelöscht werden.'
                    : 'Löschen abgewiesen: Schicht wurde zwischenzeitlich verändert.'
                };
              } else {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: shiftId || 'unknown',
                  status: 'REJECTED',
                  serverVersion: mut.baseVersion,
                  message: 'Schicht zum Löschen nicht gefunden.'
                };
              }
            }
          } else {
            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: `Aktion '${mut.action}' für Schichten nicht unterstützt.`
            };
          }
        }

        // 3. TASKS
        else if (mut.entityType === 'task') {
          if (mut.action === 'CREATE') {
            const insTask = await client.query(
              `INSERT INTO tasks (tenant_id, title, assigned_to_name, site_name, due_date, priority, status, category, client_mutation_id, revision_version)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
               ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
               RETURNING id`,
              [
                tenantId,
                mut.payload.title,
                mut.payload.assignedToName || 'Einsatzleitung',
                mut.payload.siteName || null,
                mut.payload.dueDate || new Date().toISOString().split('T')[0],
                mut.payload.priority || 'Mittel',
                mut.payload.status || 'Offen',
                mut.payload.category || 'Audit',
                mut.clientUuid
              ]
            );

            const tId = insTask.rows.length > 0
              ? insTask.rows[0].id
              : (await client.query('SELECT id FROM tasks WHERE tenant_id = $1 AND client_mutation_id = $2', [tenantId, mut.clientUuid])).rows[0]?.id;

            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: tId || 'unknown',
              status: 'SYNCED',
              serverVersion: 1
            };
          } else if (mut.action === 'UPDATE') {
            const taskId = mut.payload.id;

            const updateRes = await client.query(
              `UPDATE tasks 
               SET status = $1, revision_version = revision_version + 1
               WHERE id = $2 AND tenant_id = $3 AND revision_version = $4
               RETURNING id, revision_version, status`,
              [mut.payload.status, taskId, tenantId, mut.baseVersion]
            );

            if (updateRes.rows.length > 0) {
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: taskId,
                status: 'SYNCED',
                serverVersion: updateRes.rows[0].revision_version
              };
            } else {
              const taskCheck = await client.query(
                'SELECT id, status, revision_version FROM tasks WHERE id = $1 AND tenant_id = $2',
                [taskId, tenantId]
              );

              if (taskCheck.rows.length > 0) {
                const serverTask = taskCheck.rows[0];
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: taskId,
                  status: 'CONFLICT',
                  serverVersion: serverTask.revision_version,
                  conflictData: {
                    serverStatus: serverTask.status,
                    serverVersion: serverTask.revision_version,
                    clientStatus: mut.payload.status,
                    clientVersion: mut.baseVersion
                  },
                  message: 'Atomarer Versionskonflikt: Aufgabe wurde zwischenzeitlich verändert.'
                };
              } else {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: taskId || 'unknown',
                  status: 'REJECTED',
                  serverVersion: mut.baseVersion,
                  message: 'Aufgabe nicht gefunden.'
                };
              }
            }
          } else if (mut.action === 'DELETE') {
            const taskId = mut.payload.id;
            const delRes = await client.query(
              'DELETE FROM tasks WHERE id = $1 AND tenant_id = $2 AND revision_version = $3 RETURNING id',
              [taskId, tenantId, mut.baseVersion]
            );

            if (delRes.rows.length > 0) {
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: taskId,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1,
                message: 'Aufgabe gelöscht'
              };
            } else {
              const curRes = await client.query('SELECT revision_version FROM tasks WHERE id = $1 AND tenant_id = $2', [taskId, tenantId]);
              if (curRes.rows.length > 0) {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: taskId,
                  status: 'CONFLICT',
                  serverVersion: curRes.rows[0].revision_version,
                  message: 'Löschen abgewiesen: Aufgabe wurde zwischenzeitlich verändert.'
                };
              } else {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: taskId || 'unknown',
                  status: 'REJECTED',
                  serverVersion: mut.baseVersion,
                  message: 'Aufgabe zum Löschen nicht gefunden.'
                };
              }
            }
          } else {
            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: `Aktion '${mut.action}' für Aufgaben nicht unterstützt.`
            };
          }
        }

        // 4. KEYS
        else if (mut.entityType === 'key') {
          const keyId = mut.payload.id;

          if (mut.action === 'UPDATE') {
            const keyRes = await client.query(
              `UPDATE keys 
               SET status = $1,
                   current_holder_id = $2,
                   issued_at = $3,
                   expected_return = $4,
                   revision_version = revision_version + 1
               WHERE id = $5 AND tenant_id = $6 AND revision_version = $7
               RETURNING id, key_number, status, revision_version`,
              [
                mut.payload.status,
                mut.payload.currentHolderId || null,
                mut.payload.issuedAt || null,
                mut.payload.expectedReturn || null,
                keyId,
                tenantId,
                mut.baseVersion
              ]
            );

            if (keyRes.rows.length > 0) {
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: keyId,
                status: 'SYNCED',
                serverVersion: keyRes.rows[0].revision_version
              };
            } else {
              const curRes = await client.query('SELECT revision_version, status FROM keys WHERE id = $1 AND tenant_id = $2', [keyId, tenantId]);
              if (curRes.rows.length > 0) {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: keyId,
                  status: 'CONFLICT',
                  serverVersion: curRes.rows[0].revision_version,
                  conflictData: { serverStatus: curRes.rows[0].status, serverVersion: curRes.rows[0].revision_version },
                  message: 'Schlüssel wurde zwischenzeitlich verändert (z. B. bereits zurückgenommen).'
                };
              } else {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: keyId || 'unknown',
                  status: 'REJECTED',
                  serverVersion: mut.baseVersion,
                  message: 'Schlüssel nicht gefunden oder fremder Mandant.'
                };
              }
            }
          } else {
            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: keyId || 'unknown',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: `Aktion '${mut.action}' für Schlüssel via Offline-Sync unzulässig.`
            };
          }
        }

        // 5. PATROL
        else if (mut.entityType === 'patrol') {
          if (mut.payload.recordType === 'round_start' && mut.action === 'CREATE') {
            try {
              const { recordType: _recordType, ...roundPayload } = mut.payload;
              const round = await recordPatrolRoundStart(
                client, tenantId, userId, mut.clientUuid, roundPayload, payloadHash
              );
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: round.id,
                status: 'SYNCED',
                serverVersion: 1,
                message: round.idempotent ? 'Kontrollgangsstart bereits idempotent bestätigt.' : undefined
              };
            } catch (error) {
              const statusCode = Number((error as any)?.statusCode);
              if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode >= 500) throw error;
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: 'none',
                status: statusCode === 409 ? 'CONFLICT' : 'REJECTED',
                serverVersion: mut.baseVersion,
                conflictData: statusCode === 409 ? {
                  serverVersion: mut.baseVersion,
                  clientVersion: mut.baseVersion,
                  reason: (error as Error).message
                } : undefined,
                message: (error as Error).message
              };
            }
          } else if (mut.payload.recordType === 'round_complete' && mut.action === 'UPDATE') {
            try {
              const { recordType: _recordType, ...completionPayload } = mut.payload;
              const completion = await recordPatrolRoundCompletion(
                client, tenantId, userId, mut.clientUuid, completionPayload, payloadHash
              );
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: completion.id,
                status: 'SYNCED',
                serverVersion: 1,
                message: completion.idempotent ? 'Kontrollgangsabschluss bereits idempotent bestätigt.' : undefined
              };
            } catch (error) {
              const statusCode = Number((error as any)?.statusCode);
              if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode >= 500) throw error;
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: 'none',
                status: statusCode === 409 ? 'CONFLICT' : 'REJECTED',
                serverVersion: mut.baseVersion,
                conflictData: statusCode === 409 ? {
                  serverVersion: mut.baseVersion,
                  clientVersion: mut.baseVersion,
                  reason: (error as Error).message
                } : undefined,
                message: (error as Error).message
              };
            }
          } else if (mut.action === 'CREATE') {
            try {
              if (mut.payload.recordType === 'exception') {
                const { recordType: _recordType, ...exceptionPayload } = mut.payload;
                const exception = await recordPatrolException(
                  client, tenantId, userId, mut.clientUuid, exceptionPayload, mut.clientTimestamp, payloadHash
                );
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: exception.id,
                  status: 'SYNCED',
                  serverVersion: 1
                };
              } else {
                const scan = await recordPatrolScan(
                  client, tenantId, userId, mut.clientUuid, mut.payload, mut.clientTimestamp, payloadHash
                );
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: scan.id,
                  status: 'SYNCED',
                  serverVersion: 1,
                  message: scan.verificationStatus === 'manual' ? 'Manuelle Erfassung; Kontrollpunkt-Token wurde nicht verifiziert.' : undefined
                };
              }
            } catch (error) {
              const statusCode = Number((error as any)?.statusCode);
              if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode >= 500) throw error;
              const attemptReason = (error as { patrolScanAttemptCode?: Parameters<typeof recordPatrolScanAttempt>[7] })
                .patrolScanAttemptCode;
              if (attemptReason) {
                await recordPatrolScanAttempt(
                  client, tenantId, userId, mut.clientUuid, mut.payload, mut.clientTimestamp, payloadHash, attemptReason
                );
              }
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: 'none',
                status: statusCode === 409 ? 'CONFLICT' : 'REJECTED',
                serverVersion: mut.baseVersion,
                conflictData: statusCode === 409 ? {
                  serverVersion: mut.baseVersion,
                  clientVersion: mut.baseVersion,
                  reason: (error as Error).message
                } : undefined,
                message: (error as Error).message
              };
            }
          } else {
            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: 'Nicht unterstützte Kontrollgangsmutation; nur Starts, Abschlüsse, Scans und Abweichungen sind zulässig.'
            };
          }
        }

        // 6. HANDOVER
        else if (mut.entityType === 'handover') {
          if (mut.action === 'CREATE') {
            const legacy = mut.payload.outgoingEmployeeId
              ? mut.payload
              : {
                siteId: mut.payload.siteId,
                occurredAt: mut.payload.handoverTime || mut.clientTimestamp,
                outgoingEmployeeId: mut.payload.relievedGuardId,
                incomingEmployeeId: mut.payload.relievingGuardId,
                generalText: mut.payload.remarks || '',
                incidents: `Offene Vorkommnisse: ${mut.payload.openIncidentsCount || 0}`,
                importantNotes: '',
                safetyInformation: mut.payload.keyRegisterChecked === false
                  ? 'Schlüsselregister wurde nicht bestätigt.'
                  : 'Schlüsselregister wurde geprüft.'
              };
            try {
              const input = handoverCreateSchema.parse({
                ...legacy,
                clientMutationId: mut.clientUuid,
                capturedAt: mut.payload.capturedAt || mut.clientTimestamp
              });
              const created = await createHandover(client, tenantId, userId, input);
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: created.id,
                status: 'SYNCED',
                serverVersion: created.revisionVersion,
                message: created.created ? undefined : 'Bereits vorhanden (idempotent bestätigt)'
              };
            } catch (error) {
              if (error instanceof HandoverConflictError) {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: 'none',
                  status: 'CONFLICT',
                  serverVersion: error.serverVersion,
                  conflictData: {
                    serverVersion: error.serverVersion,
                    clientVersion: mut.baseVersion,
                    serverPayload: error.serverPayload,
                    clientPayload: mut.payload
                  },
                  message: error.message
                };
              } else if (error instanceof z.ZodError || (error as any)?.statusCode >= 400 && (error as any)?.statusCode < 500) {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: 'none',
                  status: 'REJECTED',
                  serverVersion: mut.baseVersion,
                  message: error instanceof z.ZodError ? 'Übergabedaten sind ungültig.' : (error as Error).message
                };
              } else {
                throw error;
              }
            }
          } else {
            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: 'Schichtübergabeprotokolle sind unveränderliche Dokumente (UPDATE/DELETE unzulässig).'
            };
          }
        } else {
          itemResult = {
            clientUuid: mut.clientUuid,
            serverId: 'none',
            status: 'REJECTED',
            serverVersion: mut.baseVersion,
            message: `Nicht unterstützter Mutationstyp: '${mut.entityType}'.`
          };
        }

        // ----------------------------------------------------------------------
        // ATOMARE PERSISTIERUNG IN sync_idempotency_receipts
        // ----------------------------------------------------------------------
        await client.query(
          `INSERT INTO sync_idempotency_receipts (tenant_id, client_mutation_id, entity_type, action, payload_hash, status, server_id, server_version, response_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id, client_mutation_id) DO UPDATE
           SET status = EXCLUDED.status,
               server_version = EXCLUDED.server_version,
               response_json = EXCLUDED.response_json`,
          [
            tenantId,
            mut.clientUuid,
            mut.entityType,
            mut.action,
            payloadHash,
            itemResult.status,
            itemResult.serverId,
            itemResult.serverVersion,
            JSON.stringify(itemResult)
          ]
        );

        results.push(itemResult);
      }
    });

    res.json({
      success: true,
      message: `${results.length} Synchronisationsoperation(en) verarbeitet`,
      data: results
    });
  } catch (error) {
    next(error);
  }
}

export async function pushHandoverMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = syncPushBatchSchema.parse(req.body);
    if (body.mutations.some(mutation => mutation.entityType !== 'handover')) {
      throw Object.assign(new Error('Dieser Endpunkt akzeptiert ausschließlich Übergabemutationen.'), { statusCode: 400 });
    }
    req.body = body;
    return pushSyncMutations(req, res, next);
  } catch (error) {
    next(error);
  }
}

export async function pushPatrolMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = syncPushBatchSchema.parse(req.body);
    if (body.mutations.some(mutation => mutation.entityType !== 'patrol')) {
      throw Object.assign(new Error('Dieser Endpunkt akzeptiert ausschließlich Kontrollgangsmutationen.'), { statusCode: 400 });
    }
    req.body = body;
    return pushSyncMutations(req, res, next);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/sync/conflicts/resolve
 * Reale, vollständig idempotente Server-Auflösung von Synchronisationskonflikten:
 * - WICHTIG (Schritt 5R.2.7): Verwendet eine DEDIZIERTE Tabelle `sync_conflict_resolution_receipts`.
 *   Dadurch blockiert eine vorangegangene Push-Quittung (Status: CONFLICT) NIEMALS die nachfolgende,
 *   legitime Konfliktauflösung derselben client_mutation_id!
 * - Nutzt PostgreSQL Transaction Advisory Lock `${tenantId}:conflict_resolve:${body.clientUuid}`
 * - Bei wiederholtem Aufruf: Gibt reproduzierbar dasselbe Ergebnis zurück OHNE neue Revision oder Audit-Eintrag!
 * - Bei veränderter Payload mit gleicher ID: Abweisung mit HTTP 409
 * - Liefert ResponseEnvelope mit data: { applied, clientUuid, entityType, strategy, serverState }
 */
export async function resolveSyncConflict(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const userEmail = req.user!.email;
    const userId = req.user!.userId;
    const body = conflictResolveSchema.parse(req.body);
    const permissionByEntity = {
      guardbook: 'logbook:create',
      shift: 'shifts:manage',
      task: 'tasks:manage',
      key: 'keys:manage'
    } as const;
    const canResolve = body.entityType === 'patrol'
      ? body.strategy === 'RECORD_AS_EXCEPTION'
        ? req.user!.permissions.includes('patrol:exception:create') || req.user!.permissions.includes('patrol:manage')
        : hasPatrolMutationPermission(body.localPayload?.recordType, req.user!.permissions)
      : req.user!.permissions.includes(permissionByEntity[body.entityType]);
    if (!canResolve) {
      res.status(403).json({ success: false, message: 'Zugriff verweigert: fehlende Berechtigung für diese Konfliktauflösung.' });
      return;
    }

    const payloadHash = computePayloadHash({
      clientUuid: body.clientUuid,
      entityType: body.entityType,
      strategy: body.strategy,
      expectedVersion: body.expectedVersion,
      localPayload: body.localPayload || {}
    });

    let conflictResponseData: any = null;

    await withTenantTransaction(tenantId, async (client) => {
      // 1. Transaction Advisory Lock zur Serialisierung paralleler Anfragen
      const lockKey = `${tenantId}:conflict_resolve:${body.clientUuid}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

      // 2. Idempotenzprüfung in der DEDIZIERTEN Konflikt-Quittungstabelle
      const receiptRes = await client.query(
        `SELECT client_mutation_id, entity_type, strategy, payload_hash, server_id, server_version, response_json
         FROM sync_conflict_resolution_receipts
         WHERE tenant_id = $1 AND client_mutation_id = $2`,
        [tenantId, body.clientUuid]
      );

      if (receiptRes.rows.length > 0) {
        const receipt = receiptRes.rows[0];

        // Falls dieselbe UUID mit verändertem Inhalt gesendet wurde -> REJECT!
        if (receipt.payload_hash !== payloadHash) {
          throw new ConflictError('Integritätsverletzung: Konfliktauflösungs-ID wurde mit abweichendem Inhalt wiederverwendet.');
        }

        // Reproduzierbare Quittung zurückgeben OHNE erneute Revision oder erneutes Audit-Log!
        conflictResponseData = receipt.response_json;
        return;
      }

      let updated = false;
      let actualServerData: any = null;

      if (body.entityType === 'patrol') {
        const conflictReceipt = await client.query(
          `SELECT client_mutation_id FROM sync_idempotency_receipts
            WHERE tenant_id=$1 AND client_mutation_id=$2
              AND entity_type='patrol' AND status='CONFLICT'`,
          [tenantId, body.clientUuid]
        );
        if (!conflictReceipt.rows.length) {
          throw new ConflictError('Für diese Mutation liegt kein offener Kontrollgangskonflikt vor.');
        }

        const local = body.localPayload || {};
        const recordType = typeof local.recordType === 'string' ? local.recordType : 'unknown';
        if (body.strategy === 'RECORD_AS_EXCEPTION') {
          let siteId = local.siteId;
          if (!siteId && local.roundId) {
            const round = await client.query(
              'SELECT site_id FROM patrol_rounds WHERE tenant_id=$1 AND id=$2',
              [tenantId, local.roundId]
            );
            siteId = round.rows[0]?.site_id;
          }
          const localNote = [local.notes, local.description]
            .find(value => typeof value === 'string' && value.trim().length > 0);
          const description = [
            `Offline-Ereignis '${recordType}' (Mutation ${body.clientUuid}) konnte nicht automatisch synchronisiert werden.`,
            typeof localNote === 'string' ? `Erfasste Notiz: ${localNote.trim().slice(0, 3500)}` : ''
          ].filter(Boolean).join(' ');
          const capturedAt = local.capturedAt || local.scannedAt || local.startedAt || local.completedAt;
          if (typeof capturedAt !== 'string' || !siteId) {
            throw new ConflictError('Das lokale Ereignis enthält keinen gültigen Objekt- oder Erfassungszeitpunkt und kann nicht als Abweichung dokumentiert werden.');
          }
          const exceptionPayload = {
            siteId,
            ...(typeof local.roundId === 'string' ? { roundId: local.roundId } : {}),
            ...(typeof local.checkpointId === 'string' ? { checkpointId: local.checkpointId } : {}),
            category: 'other',
            severity: 'high',
            description,
            capturedAt
          };
          const resolutionMutationId = `pc_${createHash('sha256')
            .update(`${tenantId}:${body.clientUuid}`, 'utf8').digest('hex').slice(0, 61)}`;
          const exception = await recordPatrolException(
            client,
            tenantId,
            userId,
            resolutionMutationId,
            exceptionPayload,
            capturedAt,
            computePayloadHash(exceptionPayload)
          );
          actualServerData = {
            id: exception.id,
            site_id: siteId,
            round_id: exceptionPayload.roundId || null,
            category: 'other',
            description,
            idempotent: exception.idempotent
          };
        } else {
          const roundId = typeof local.roundId === 'string' ? local.roundId : local.roundId?.toString();
          if (roundId) {
            const round = await client.query(
              `SELECT id,site_id,route_id,status,started_at,completed_at
                 FROM patrol_rounds WHERE tenant_id=$1 AND id=$2`,
              [tenantId, roundId]
            );
            actualServerData = round.rows[0] || { id: roundId, status: 'not_recorded' };
          } else {
            actualServerData = { id: body.clientUuid, status: 'not_recorded' };
          }
        }
        updated = true;
      }

      // 3. Fachliche Durchführung je Entitätstyp
      // A. TASK
      if (body.entityType === 'task') {
        const taskId = body.localPayload?.id || body.clientUuid;
        const taskCheck = await client.query(
          'SELECT id, title, assigned_to_name, site_name, due_date, priority, status, category, revision_version FROM tasks WHERE id = $1 AND tenant_id = $2',
          [taskId, tenantId]
        );

        if (taskCheck.rows.length === 0) {
          throw new ConflictError('Aufgabe für Konfliktauflösung nicht gefunden oder fremder Mandant.');
        }

        const currentTask = taskCheck.rows[0];

        if (body.strategy === 'USE_LOCAL') {
          const updRes = await client.query(
            `UPDATE tasks 
             SET status = COALESCE($1, status),
                 title = COALESCE($2, title),
                 due_date = COALESCE($3, due_date),
                 priority = COALESCE($4, priority),
                 revision_version = revision_version + 1
             WHERE id = $5 AND tenant_id = $6 AND revision_version = $7
             RETURNING id, title, assigned_to_name, site_name, due_date, priority, status, category, revision_version`,
            [
              body.localPayload?.status || null,
              body.localPayload?.title || null,
              body.localPayload?.dueDate || null,
              body.localPayload?.priority || null,
              taskId,
              tenantId,
              body.expectedVersion
            ]
          );

          if (updRes.rows.length === 0) {
            throw new ConflictError(`Versionskonflikt: Server-Version (${currentTask.revision_version}) weicht von erwarteter Version (${body.expectedVersion}) ab.`);
          }

          actualServerData = updRes.rows[0];
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          actualServerData = currentTask;
          updated = true;
        }
      }

      // B. SHIFT
      else if (body.entityType === 'shift') {
        const shiftId = z.string().guid().parse(body.localPayload?.id || body.clientUuid);
        const shiftCheck = await client.query(
          `SELECT id,site_id,employee_id,shift_date,start_time,end_time,starts_at,ends_at,time_zone,
                  break_minutes,type,status,required_qualification,conflict_reason,revision_version
             FROM shifts WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
          [shiftId, tenantId]
        );

        if (shiftCheck.rows.length === 0) {
          throw new ConflictError('Schicht für Konfliktauflösung nicht gefunden oder fremder Mandant.');
        }

        const currentShift = shiftCheck.rows[0];

        if (body.strategy === 'USE_LOCAL') {
          if (Number(currentShift.revision_version) !== body.expectedVersion) {
            throw new ConflictError(`Versionskonflikt: Server-Version (${currentShift.revision_version}) weicht von erwarteter Version (${body.expectedVersion}) ab.`);
          }
          const local = z.object({
            employeeId: z.string().guid().nullable().optional(),
            status: z.enum(['Besetzt', 'Offen', 'Konflikt', 'Abgeschlossen']).optional(),
            conflictReason: z.string().max(500).nullable().optional(),
            shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            startTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
            endTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
            startOffsetMinutes: z.number().int().min(-840).max(840).optional(),
            endOffsetMinutes: z.number().int().min(-840).max(840).optional(),
            breakMinutes: z.number().int().min(0).max(1440).optional(),
            requiredQualification: z.string().min(2).max(100).optional()
          }).strict().parse(body.localPayload ?? {});
          const employeeId = local.employeeId === undefined ? currentShift.employee_id : local.employeeId;
          const validation = await validateShiftCandidate(client, {
            tenantId, siteId: currentShift.site_id, employeeId,
            date: local.shiftDate ?? local.date ?? String(currentShift.shift_date).slice(0, 10),
            startTime: local.startTime ?? String(currentShift.start_time).slice(0, 8),
            endTime: local.endTime ?? String(currentShift.end_time).slice(0, 8),
            startOffsetMinutes: local.startOffsetMinutes,
            endOffsetMinutes: local.endOffsetMinutes,
            breakMinutes: local.breakMinutes ?? currentShift.break_minutes,
            requiredQualification: local.requiredQualification ?? currentShift.required_qualification,
            excludeShiftId: shiftId
          });
          if (validation.findings.some(finding => finding.severity === 'blocking')) {
            const stored = await storePlanningFindings(client, tenantId, validation.findings, {
              shiftId, employeeId: employeeId ?? undefined, profileVersionId: validation.profileVersionId
            });
            conflictResponseData = {
              applied: false,
              code: 'PLANNING_VALIDATION_FAILED',
              clientUuid: body.clientUuid,
              entityType: body.entityType,
              strategy: body.strategy,
              serverState: currentShift,
              validationRunId: stored.runId,
              findings: stored.findings
            };
            return;
          }
          const updRes = await client.query(
            `UPDATE shifts
                SET employee_id=$1,status=COALESCE($2,status),conflict_reason=$3,
                    shift_date=$4,start_time=$5,end_time=$6,starts_at=$7,ends_at=$8,time_zone=$9,
                    break_minutes=$10,required_qualification=$11,planning_status='draft',
                    revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP
              WHERE id=$12 AND tenant_id=$13 AND revision_version=$14
              RETURNING id,site_id,employee_id,shift_date,start_time,end_time,starts_at,ends_at,
                        time_zone,break_minutes,type,status,planning_status,required_qualification,
                        conflict_reason,revision_version`,
            [employeeId, local.status ?? null, local.conflictReason ?? null,
              local.shiftDate ?? local.date ?? currentShift.shift_date,
              local.startTime ?? currentShift.start_time, local.endTime ?? currentShift.end_time,
              validation.resolved.startsAt, validation.resolved.endsAt, validation.resolved.timeZone,
              local.breakMinutes ?? currentShift.break_minutes,
              local.requiredQualification ?? currentShift.required_qualification,
              shiftId, tenantId, body.expectedVersion]
          );

          if (updRes.rows.length === 0) {
            throw new ConflictError(`Versionskonflikt: Server-Version (${currentShift.revision_version}) weicht von erwarteter Version (${body.expectedVersion}) ab.`);
          }

          if (employeeId !== currentShift.employee_id) {
            await client.query(
              `UPDATE shift_staffing_assignments SET status='released',released_at=CURRENT_TIMESTAMP,
                  revision_version=revision_version+1
                WHERE tenant_id=$1 AND shift_id=$2 AND status='assigned'`,
              [tenantId, shiftId]
            );
            if (employeeId) {
              await client.query(
                `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (tenant_id,shift_id,employee_id)
                 DO UPDATE SET status='assigned',released_at=NULL,assigned_at=CURRENT_TIMESTAMP,
                   assigned_by=EXCLUDED.assigned_by,
                   revision_version=shift_staffing_assignments.revision_version+1`,
                [tenantId, shiftId, employeeId, userId]
              );
            }
          }
          const stored = await storePlanningFindings(client, tenantId, validation.findings, {
            shiftId, employeeId: employeeId ?? undefined, profileVersionId: validation.profileVersionId
          });
          await client.query(
            `INSERT INTO planning_audit_events
              (tenant_id,actor_user_id,event_type,entity_type,entity_id,details)
             VALUES ($1,$2,'shift.conflict_resolution','shift',$3,$4::jsonb)`,
            [tenantId, userId, shiftId, JSON.stringify({ clientUuid: body.clientUuid, validationRunId: stored.runId })]
          );
          actualServerData = updRes.rows[0];
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          actualServerData = currentShift;
          updated = true;
        }
      }

      // C. KEY
      else if (body.entityType === 'key') {
        const keyId = body.localPayload?.id || body.clientUuid;
        const keyCheck = await client.query(
          'SELECT id, site_id, key_number, label, type, status, current_holder_id, issued_at, expected_return, revision_version FROM keys WHERE id = $1 AND tenant_id = $2',
          [keyId, tenantId]
        );

        if (keyCheck.rows.length === 0) {
          throw new ConflictError('Schlüssel für Konfliktauflösung nicht gefunden oder fremder Mandant.');
        }

        const currentKey = keyCheck.rows[0];

        if (body.strategy === 'USE_LOCAL') {
          const updRes = await client.query(
            `UPDATE keys 
             SET status = $1,
                 current_holder_id = $2,
                 issued_at = $3,
                 expected_return = $4,
                 revision_version = revision_version + 1
             WHERE id = $5 AND tenant_id = $6 AND revision_version = $7
             RETURNING id, site_id, key_number, label, type, status, current_holder_id, issued_at, expected_return, revision_version`,
            [
              body.localPayload?.status || currentKey.status,
              body.localPayload?.currentHolderId || null,
              body.localPayload?.issuedAt || null,
              body.localPayload?.expectedReturn || null,
              keyId,
              tenantId,
              body.expectedVersion
            ]
          );

          if (updRes.rows.length === 0) {
            throw new ConflictError(`Versionskonflikt: Server-Version (${currentKey.revision_version}) weicht von erwarteter Version (${body.expectedVersion}) ab.`);
          }

          actualServerData = updRes.rows[0];
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          actualServerData = currentKey;
          updated = true;
        }
      }

      // D. GUARDBOOK (DIN 77200 APPEND-ONLY MIT DEDIZIERTEM REVISIONS-BEZEICHNER)
      else if (body.entityType === 'guardbook') {
        const entryId = body.localPayload?.id || body.clientUuid;
        const gbCheck = await client.query(
          'SELECT id, site_id, guard_id, entry_timestamp, category, priority, stage, title, description, police_involved, resolved FROM guardbook_entries WHERE id = $1 AND tenant_id = $2',
          [entryId, tenantId]
        );

        if (gbCheck.rows.length === 0) {
          throw new ConflictError('Wachbucheintrag nicht gefunden oder fremder Mandant.');
        }

        const currentGb = gbCheck.rows[0];

        if (body.strategy === 'USE_LOCAL') {
          const note = body.localPayload?.correctionNote || 'Korrektur aus manueller Konfliktauflösung';
          // Eindeutiger Revisions-Key gebunden an die Konflikt-Mutation-ID
          const revisionMutationId = `rev-${body.clientUuid}`;
          await client.query(
            `INSERT INTO guardbook_revisions (tenant_id, entry_id, author_name, note, client_mutation_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING`,
            [tenantId, entryId, userEmail, note, revisionMutationId]
          );

          const revs = await client.query(
            'SELECT id, created_at AS timestamp, author_name, note FROM guardbook_revisions WHERE entry_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
            [entryId, tenantId]
          );
          currentGb.revisions = revs.rows;
          actualServerData = currentGb;
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          const revs = await client.query(
            'SELECT id, created_at AS timestamp, author_name, note FROM guardbook_revisions WHERE entry_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
            [entryId, tenantId]
          );
          currentGb.revisions = revs.rows;
          actualServerData = currentGb;
          updated = true;
        }
      } else if (body.entityType !== 'patrol') {
        throw new ConflictError(`Konfliktstrategie für Typ '${body.entityType}' nicht unterstützt.`);
      }

      // 4. Revisionssichere Protokollierung der Konfliktentscheidung (nur beim ERSTEN Mal!)
      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_email, role, action_type, severity, target_entity, details, ip_address)
         VALUES ($1, $2, $3, 'CONFLICT_RESOLVED', 'INFO', $4, $5, $6)`,
        [tenantId, userEmail, req.user!.role, `Conflict:${body.clientUuid}`,
          `Konflikt aufgelöst: Strategie=${body.strategy}, Entity=${body.entityType}`, req.ip || '127.0.0.1']
      );

      conflictResponseData = {
        applied: updated,
        clientUuid: body.clientUuid,
        entityType: body.entityType,
        strategy: body.strategy,
        serverState: actualServerData
      };

      // 5. Quittung atomar in der DEDIZIERTEN Konflikt-Tabelle speichern
      await client.query(
        `INSERT INTO sync_conflict_resolution_receipts (tenant_id, client_mutation_id, entity_type, strategy, payload_hash, server_id, server_version, response_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING`,
        [
          tenantId,
          body.clientUuid,
          body.entityType,
          body.strategy,
          payloadHash,
          String(actualServerData?.id || body.clientUuid),
          Number(actualServerData?.revision_version || 1),
          JSON.stringify(conflictResponseData)
        ]
      );
    });

    if (conflictResponseData?.applied === false) {
    res.status(422).json({ success: false, ...conflictResponseData });
    return;
    }

    res.json({
      success: true,
      message: `Konflikt ${body.clientUuid} erfolgreich auf dem Server aufgelöst (${body.strategy}).`,
      data: conflictResponseData
    });
  } catch (error) {
    next(error);
  }
}
