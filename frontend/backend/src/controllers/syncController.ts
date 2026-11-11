import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';

const syncMutationItemSchema = z.object({
  clientUuid: z.string().min(8).max(64).regex(/^[a-zA-Z0-9_\-]+$/, 'clientUuid muss ein valider Bezeichner sein.'),
  entityType: z.enum(['guardbook', 'shift', 'task', 'key', 'patrol', 'handover']),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']),
  clientTimestamp: z.string(),
  baseVersion: z.number().int().default(1),
  payload: z.record(z.any())
});

const syncPushBatchSchema = z.object({
  deviceId: z.string().min(4).max(128),
  mutations: z.array(syncMutationItemSchema).min(1, 'Mindestens eine Mutation muss übermittelt werden.')
});

const conflictResolveSchema = z.object({
  clientUuid: z.string().min(8).max(64),
  entityType: z.enum(['task', 'shift', 'key', 'guardbook']),
  strategy: z.enum(['USE_LOCAL', 'USE_SERVER']),
  expectedVersion: z.number().int().positive('expectedVersion muss eine positive Ganzzahl sein.'),
  localPayload: z.record(z.any()).optional()
});

export interface SyncResultItem {
  clientUuid: string;
  serverId: string;
  status: 'SYNCED' | 'CONFLICT' | 'REJECTED';
  serverVersion: number;
  conflictData?: any;
  message?: string;
}

/**
 * Kanonische, rekursive Serialisierung:
 * Sortiert alle Schlüssel verschachtelter Objekte und normalisiert Arrays deterministisch,
 * damit identische Datenstrukturen unabhängig von Key-Reihenfolgen denselben SHA-256-Hash erzeugen.
 */
export function canonicalStringify(data: any): string {
  if (data === null || typeof data !== 'object') {
    return JSON.stringify(data);
  }
  if (Array.isArray(data)) {
    return '[' + data.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(data).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(data[key])}`);
  return '{' + entries.join(',') + '}';
}

export function computePayloadHash(payload: Record<string, any>): string {
  const canonical = canonicalStringify(payload);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * POST /api/v1/sync/push
 * - PostgreSQL Transaction Advisory Lock pro Mutation-ID schützt vor Race Conditions
 * - Kanonischer SHA-256 Payload-Hash erkennt veränderte Wiederverwendungen
 * - Atomare fachliche Ausführung und Quittungsspeicherung in derselben Transaktion
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
        const payloadHash = computePayloadHash(mut.payload);

        // ----------------------------------------------------------------------
        // 0. ATOMARE TRANSACTION ADVISORY LOCKS GEGEN PARALLELE RACE CONDITIONS
        // ----------------------------------------------------------------------
        const lockKey = `${tenantId}:${mut.clientUuid}`;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

        // Prüfen, ob bereits eine fertige Quittung vorliegt (idempotente Deduplizierung)
        const receiptRes = await client.query(
          `SELECT client_mutation_id, entity_type, action, payload_hash, status, server_id, server_version, response_json
           FROM sync_idempotency_receipts
           WHERE tenant_id = $1 AND client_mutation_id = $2`,
          [tenantId, mut.clientUuid]
        );

        if (receiptRes.rows.length > 0) {
          const receipt = receiptRes.rows[0];

          if (receipt.payload_hash !== payloadHash) {
            results.push({
              clientUuid: mut.clientUuid,
              serverId: receipt.server_id,
              status: 'REJECTED',
              serverVersion: receipt.server_version,
              message: 'Integritätsverletzung: Mutation-ID wurde mit abweichendem Inhalt wiederverwendet.'
            });
            continue;
          }

          results.push(receipt.response_json as SyncResultItem);
          continue;
        }

        let itemResult: SyncResultItem;

        // ======================================================================
        // 1. GUARDBOOK (DIGITALES WACHBUCH - APPEND-ONLY)
        // ======================================================================
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

        // ======================================================================
        // 2. SHIFTS (DIENSTPLANUNG MIT ATOMAREM VERSIONSSCHUTZ)
        // ======================================================================
        else if (mut.entityType === 'shift') {
          if (mut.action === 'CREATE') {
            const insRes = await client.query(
              `INSERT INTO shifts (tenant_id, site_id, employee_id, shift_date, start_time, end_time, type, status, required_qualification, conflict_reason, client_mutation_id, revision_version)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1)
               ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
               RETURNING id`,
              [
                tenantId,
                mut.payload.siteId,
                mut.payload.employeeId || null,
                mut.payload.shiftDate || new Date().toISOString().split('T')[0],
                mut.payload.startTime || '06:00',
                mut.payload.endTime || '18:00',
                mut.payload.type || 'Tagdienst',
                mut.payload.status || 'Besetzt',
                mut.payload.requiredQualification || 'Sachkundeprüfung § 34a GewO',
                mut.payload.conflictReason || null,
                mut.clientUuid
              ]
            );

            const sId = insRes.rows.length > 0
              ? insRes.rows[0].id
              : (await client.query('SELECT id FROM shifts WHERE tenant_id = $1 AND client_mutation_id = $2', [tenantId, mut.clientUuid])).rows[0]?.id;

            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: sId || 'unknown',
              status: 'SYNCED',
              serverVersion: 1
            };
          } else if (mut.action === 'UPDATE') {
            const shiftId = mut.payload.id;

            const updateRes = await client.query(
              `UPDATE shifts 
               SET employee_id = COALESCE($1, employee_id),
                   status = COALESCE($2, status),
                   conflict_reason = $3,
                   revision_version = revision_version + 1
               WHERE id = $4 AND tenant_id = $5 AND revision_version = $6
               RETURNING id, revision_version`,
              [mut.payload.employeeId || null, mut.payload.status || null, mut.payload.conflictReason || null, shiftId, tenantId, mut.baseVersion]
            );

            if (updateRes.rows.length > 0) {
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: shiftId,
                status: 'SYNCED',
                serverVersion: updateRes.rows[0].revision_version
              };
            } else {
              const curRes = await client.query('SELECT id, revision_version, status FROM shifts WHERE id = $1 AND tenant_id = $2', [shiftId, tenantId]);
              if (curRes.rows.length > 0) {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: shiftId,
                  status: 'CONFLICT',
                  serverVersion: curRes.rows[0].revision_version,
                  conflictData: { serverStatus: curRes.rows[0].status, serverVersion: curRes.rows[0].revision_version },
                  message: 'Atomarer Versionskonflikt bei Schichtaktualisierung.'
                };
              } else {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: shiftId || 'unknown',
                  status: 'REJECTED',
                  serverVersion: mut.baseVersion,
                  message: 'Schicht nicht gefunden oder fremder Mandant.'
                };
              }
            }
          } else if (mut.action === 'DELETE') {
            const shiftId = mut.payload.id;

            const delRes = await client.query(
              'DELETE FROM shifts WHERE id = $1 AND tenant_id = $2 AND revision_version = $3 RETURNING id',
              [shiftId, tenantId, mut.baseVersion]
            );

            if (delRes.rows.length > 0) {
              itemResult = {
                clientUuid: mut.clientUuid,
                serverId: shiftId,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1,
                message: 'Schicht gelöscht'
              };
            } else {
              const curRes = await client.query('SELECT revision_version FROM shifts WHERE id = $1 AND tenant_id = $2', [shiftId, tenantId]);
              if (curRes.rows.length > 0) {
                itemResult = {
                  clientUuid: mut.clientUuid,
                  serverId: shiftId,
                  status: 'CONFLICT',
                  serverVersion: curRes.rows[0].revision_version,
                  message: 'Löschen abgewiesen: Schicht wurde zwischenzeitlich verändert.'
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

        // ======================================================================
        // 3. TASKS (AUFGABEN MIT ATOMAREM VERSIONSSCHUTZ)
        // ======================================================================
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

        // ======================================================================
        // 4. KEYS (SCHLÜSSELDEPOT MIT VERSIONIERUNG)
        // ======================================================================
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

        // ======================================================================
        // 5. PATROL (KONTROLLGANG-SCANS - UNVERÄNDERLICH)
        // ======================================================================
        else if (mut.entityType === 'patrol') {
          if (mut.action === 'CREATE') {
            const insPatrol = await client.query(
              `INSERT INTO patrol_scans (tenant_id, site_id, checkpoint_id, checkpoint_code, checkpoint_name, guard_id, scanned_at, method, verified_tag, notes, client_mutation_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
               RETURNING id`,
              [
                tenantId,
                mut.payload.siteId,
                mut.payload.checkpointId || null,
                mut.payload.checkpointCode || 'CP-01',
                mut.payload.checkpointName || 'Kontrollpunkt',
                mut.payload.guardId || userId,
                mut.payload.scannedAt || mut.clientTimestamp,
                mut.payload.method || 'QR_CODE',
                mut.payload.verifiedTag || 'RFID-TAG',
                mut.payload.notes || null,
                mut.clientUuid
              ]
            );

            const pId = insPatrol.rows.length > 0
              ? insPatrol.rows[0].id
              : (await client.query('SELECT id FROM patrol_scans WHERE tenant_id = $1 AND client_mutation_id = $2', [tenantId, mut.clientUuid])).rows[0]?.id;

            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: pId || 'unknown',
              status: 'SYNCED',
              serverVersion: 1
            };
          } else {
            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: 'Kontrollgangs-Scans sind unveränderliche Audit-Ereignisse (UPDATE/DELETE unzulässig).'
            };
          }
        }

        // ======================================================================
        // 6. HANDOVER (SCHICHTÜBERGABEN - UNVERÄNDERLICH)
        // ======================================================================
        else if (mut.entityType === 'handover') {
          if (mut.action === 'CREATE') {
            const insHandover = await client.query(
              `INSERT INTO shift_handovers (tenant_id, site_id, relieving_guard_id, relieved_guard_id, handover_time, key_register_checked, open_incidents_count, remarks, acknowledged, client_mutation_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
               RETURNING id`,
              [
                tenantId,
                mut.payload.siteId,
                mut.payload.relievingGuardId,
                mut.payload.relievedGuardId || userId,
                mut.payload.handoverTime || mut.clientTimestamp,
                mut.payload.keyRegisterChecked ?? true,
                mut.payload.openIncidentsCount || 0,
                mut.payload.remarks || null,
                mut.payload.acknowledged ?? true,
                mut.clientUuid
              ]
            );

            const hId = insHandover.rows.length > 0
              ? insHandover.rows[0].id
              : (await client.query('SELECT id FROM shift_handovers WHERE tenant_id = $1 AND client_mutation_id = $2', [tenantId, mut.clientUuid])).rows[0]?.id;

            itemResult = {
              clientUuid: mut.clientUuid,
              serverId: hId || 'unknown',
              status: 'SYNCED',
              serverVersion: 1
            };
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
        // ATOMARE PERSISTIERUNG DER IDEMPOTENZ-QUITTUNG IN DERSELBEN TRANSAKTION
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

/**
 * POST /api/v1/sync/conflicts/resolve
 * Reale Server-Auflösung von Synchronisationskonflikten:
 * - Liefert ResponseEnvelope mit data: { applied: boolean, serverState: any, clientUuid: string, entityType: string, strategy: string }
 * - USE_LOCAL: Übernimmt den lokalen Stand atomar nur nach Überprüfung von expectedVersion
 * - USE_SERVER: Liefert den tatsächlichen, vollständigen Serverstand zurück
 * - Revisionssichere Protokollierung in audit_logs.
 */
export async function resolveSyncConflict(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const userEmail = req.user!.email;
    const body = conflictResolveSchema.parse(req.body);

    let updated = false;
    let actualServerData: any = null;

    await withTenantTransaction(tenantId, async (client) => {
      // 1. ENTITY: TASK
      if (body.entityType === 'task') {
        const taskId = body.localPayload?.id || body.clientUuid;
        const taskCheck = await client.query(
          'SELECT id, title, assigned_to_name, site_name, due_date, priority, status, category, revision_version FROM tasks WHERE id = $1 AND tenant_id = $2',
          [taskId, tenantId]
        );

        if (taskCheck.rows.length === 0) {
          throw new Error('Aufgabe für Konfliktauflösung nicht gefunden oder fremder Mandant.');
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
            throw new Error(`Versionskonflikt: Server-Version (${currentTask.revision_version}) weicht von erwarteter Version (${body.expectedVersion}) ab.`);
          }

          actualServerData = updRes.rows[0];
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          actualServerData = currentTask;
          updated = true;
        }
      }

      // 2. ENTITY: SHIFT
      else if (body.entityType === 'shift') {
        const shiftId = body.localPayload?.id || body.clientUuid;
        const shiftCheck = await client.query(
          'SELECT id, site_id, employee_id, shift_date, start_time, end_time, type, status, required_qualification, conflict_reason, revision_version FROM shifts WHERE id = $1 AND tenant_id = $2',
          [shiftId, tenantId]
        );

        if (shiftCheck.rows.length === 0) {
          throw new Error('Schicht für Konfliktauflösung nicht gefunden oder fremder Mandant.');
        }

        const currentShift = shiftCheck.rows[0];

        if (body.strategy === 'USE_LOCAL') {
          const updRes = await client.query(
            `UPDATE shifts 
             SET status = COALESCE($1, status),
                 employee_id = COALESCE($2, employee_id),
                 conflict_reason = $3,
                 revision_version = revision_version + 1
             WHERE id = $4 AND tenant_id = $5 AND revision_version = $6
             RETURNING id, site_id, employee_id, shift_date, start_time, end_time, type, status, required_qualification, conflict_reason, revision_version`,
            [
              body.localPayload?.status || null,
              body.localPayload?.employeeId || null,
              body.localPayload?.conflictReason || null,
              shiftId,
              tenantId,
              body.expectedVersion
            ]
          );

          if (updRes.rows.length === 0) {
            throw new Error(`Versionskonflikt: Server-Version (${currentShift.revision_version}) weicht von erwarteter Version (${body.expectedVersion}) ab.`);
          }

          actualServerData = updRes.rows[0];
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          actualServerData = currentShift;
          updated = true;
        }
      }

      // 3. ENTITY: KEY
      else if (body.entityType === 'key') {
        const keyId = body.localPayload?.id || body.clientUuid;
        const keyCheck = await client.query(
          'SELECT id, site_id, key_number, label, type, status, current_holder_id, issued_at, expected_return, revision_version FROM keys WHERE id = $1 AND tenant_id = $2',
          [keyId, tenantId]
        );

        if (keyCheck.rows.length === 0) {
          throw new Error('Schlüssel für Konfliktauflösung nicht gefunden oder fremder Mandant.');
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
            throw new Error(`Versionskonflikt: Server-Version (${currentKey.revision_version}) weicht von erwarteter Version (${body.expectedVersion}) ab.`);
          }

          actualServerData = updRes.rows[0];
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          actualServerData = currentKey;
          updated = true;
        }
      }

      // 4. ENTITY: GUARDBOOK (DIN 77200 APPEND-ONLY MIT IDEMPOTENTER CLIENT-UUID)
      else if (body.entityType === 'guardbook') {
        const entryId = body.localPayload?.id || body.clientUuid;
        const gbCheck = await client.query(
          'SELECT id, site_id, guard_id, entry_timestamp, category, priority, stage, title, description, police_involved, resolved FROM guardbook_entries WHERE id = $1 AND tenant_id = $2',
          [entryId, tenantId]
        );

        if (gbCheck.rows.length === 0) {
          throw new Error('Wachbucheintrag nicht gefunden.');
        }

        const currentGb = gbCheck.rows[0];

        if (body.strategy === 'USE_LOCAL') {
          const note = body.localPayload?.correctionNote || 'Korrektur aus manueller Konfliktauflösung';
          await client.query(
            `INSERT INTO guardbook_revisions (tenant_id, entry_id, author_name, note, client_mutation_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING`,
            [tenantId, entryId, userEmail, note, body.clientUuid]
          );

          const revs = await client.query(
            'SELECT id, timestamp, author_name, note FROM guardbook_revisions WHERE entry_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
            [entryId, tenantId]
          );
          currentGb.revisions = revs.rows;
          actualServerData = currentGb;
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          const revs = await client.query(
            'SELECT id, timestamp, author_name, note FROM guardbook_revisions WHERE entry_id = $1 AND tenant_id = $2 ORDER BY created_at ASC',
            [entryId, tenantId]
          );
          currentGb.revisions = revs.rows;
          actualServerData = currentGb;
          updated = true;
        }
      } else {
        throw new Error(`Konfliktstrategie für Typ '${body.entityType}' nicht unterstützt.`);
      }

      // Revisionssichere Protokollierung der Konfliktentscheidung
      await client.query(
        `INSERT INTO audit_logs (tenant_id, user_email, role, action_type, severity, target_entity, details, ip_address)
         VALUES ($1, $2, 'Einsatzleitung', 'CONFLICT_RESOLVED', 'INFO', $3, $4, $5)`,
        [tenantId, userEmail, `Conflict:${body.clientUuid}`, `Konflikt aufgelöst: Strategie=${body.strategy}, Entity=${body.entityType}`, req.ip || '127.0.0.1']
      );
    });

    res.json({
      success: true,
      message: `Konflikt ${body.clientUuid} erfolgreich auf dem Server aufgelöst (${body.strategy}).`,
      data: {
        applied: updated,
        clientUuid: body.clientUuid,
        entityType: body.entityType,
        strategy: body.strategy,
        serverState: actualServerData
      }
    });
  } catch (error) {
    next(error);
  }
}
