import { Request, Response, NextFunction } from 'express';
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
 * POST /api/v1/sync/push
 * Verarbeitet alle 6 Mutationstypen mit CREATE, UPDATE und DELETE:
 * - guardbook: Append-only, keine Löschung, UPDATE erzeugt Revision
 * - shift: CREATE / UPDATE mit Validierung, DELETE mit Mandantensperre
 * - task: Versionierte Kollisionserkennung (baseVersion vs revision_version)
 * - key: Statusänderungen (Ausgabe/Rücknahme), DELETE abgewiesen
 * - patrol: Unveränderliche Scans, UPDATE und DELETE abgewiesen
 * - handover: Unveränderliche Übergabeprotokolle, UPDATE und DELETE abgewiesen
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
        // ======================================================================
        // 1. GUARDBOOK (DIGITALES WACHBUCH - APPEND-ONLY)
        // ======================================================================
        if (mut.entityType === 'guardbook') {
          if (mut.action === 'DELETE') {
            results.push({
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: 'Löschen von Wachbucheinträgen ist nach DIN 77200 verboten (Append-Only Integrität).'
            });
            continue;
          }

          if (mut.action === 'CREATE') {
            // Idempotente Neuanlage mit atomarem ON CONFLICT
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
              results.push({
                clientUuid: mut.clientUuid,
                serverId: insertRes.rows[0].id,
                status: 'SYNCED',
                serverVersion: 1
              });
            } else {
              // Bereits idempotent vorhanden
              const existingRes = await client.query(
                'SELECT id FROM guardbook_entries WHERE tenant_id = $1 AND client_mutation_id = $2',
                [tenantId, mut.clientUuid]
              );
              results.push({
                clientUuid: mut.clientUuid,
                serverId: existingRes.rows[0]?.id || 'unknown',
                status: 'SYNCED',
                serverVersion: 1,
                message: 'Bereits vorhanden (idempotent bestätigt)'
              });
            }
          } else if (mut.action === 'UPDATE') {
            // Revisionssichere Korrektur: Fügt unlöschbare Revision an!
            const entryRes = await client.query(
              'SELECT id FROM guardbook_entries WHERE tenant_id = $1 AND client_mutation_id = $2',
              [tenantId, mut.clientUuid]
            );

            if (entryRes.rows.length === 0) {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: 'none',
                status: 'REJECTED',
                serverVersion: mut.baseVersion,
                message: 'Zu korrigierender Wachbucheintrag nicht gefunden.'
              });
              continue;
            }

            const entryId = entryRes.rows[0].id;
            const note = mut.payload.correctionNote || 'Korrektur aus Offline-Synchronisation';

            await client.query(
              `INSERT INTO guardbook_revisions (tenant_id, entry_id, author_name, note)
               VALUES ($1, $2, $3, $4)`,
              [tenantId, entryId, userEmail, note]
            );

            if (mut.payload.stage) {
              await client.query(
                'UPDATE guardbook_entries SET stage = $1 WHERE id = $2 AND tenant_id = $3',
                [mut.payload.stage, entryId, tenantId]
              );
            }

            results.push({
              clientUuid: mut.clientUuid,
              serverId: entryId,
              status: 'SYNCED',
              serverVersion: mut.baseVersion + 1,
              message: 'Revision erfolgreich angehängt'
            });
          }
        }

        // ======================================================================
        // 2. SHIFTS (DIENSTPLANUNG)
        // ======================================================================
        else if (mut.entityType === 'shift') {
          if (mut.action === 'CREATE') {
            const insRes = await client.query(
              `INSERT INTO shifts (tenant_id, site_id, employee_id, shift_date, start_time, end_time, type, status, required_qualification, conflict_reason, client_mutation_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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

            results.push({
              clientUuid: mut.clientUuid,
              serverId: sId || 'unknown',
              status: 'SYNCED',
              serverVersion: 1
            });
          } else if (mut.action === 'UPDATE') {
            const shiftId = mut.payload.id;
            const updateRes = await client.query(
              `UPDATE shifts 
               SET employee_id = COALESCE($1, employee_id),
                   status = COALESCE($2, status),
                   conflict_reason = $3
               WHERE id = $4 AND tenant_id = $5
               RETURNING id`,
              [mut.payload.employeeId || null, mut.payload.status || null, mut.payload.conflictReason || null, shiftId, tenantId]
            );

            if (updateRes.rows.length === 0) {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: shiftId || 'unknown',
                status: 'REJECTED',
                serverVersion: mut.baseVersion,
                message: 'Schicht nicht gefunden oder fremder Mandant.'
              });
            } else {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: shiftId,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1
              });
            }
          } else if (mut.action === 'DELETE') {
            const shiftId = mut.payload.id;
            const delRes = await client.query(
              'DELETE FROM shifts WHERE id = $1 AND tenant_id = $2 RETURNING id',
              [shiftId, tenantId]
            );
            if (delRes.rows.length === 0) {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: shiftId || 'unknown',
                status: 'REJECTED',
                serverVersion: mut.baseVersion,
                message: 'Schicht zum Löschen nicht gefunden.'
              });
            } else {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: shiftId,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1,
                message: 'Schicht gelöscht'
              });
            }
          }
        }

        // ======================================================================
        // 3. TASKS (AUFGABEN & MASSNAHMEN MIT VERSIONSKONFLIKT-SCHUTZ)
        // ======================================================================
        else if (mut.entityType === 'task') {
          if (mut.action === 'CREATE') {
            const insTask = await client.query(
              `INSERT INTO tasks (tenant_id, title, assigned_to_name, site_name, due_date, priority, status, category, client_mutation_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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

            results.push({
              clientUuid: mut.clientUuid,
              serverId: tId || 'unknown',
              status: 'SYNCED',
              serverVersion: 1
            });
          } else if (mut.action === 'UPDATE') {
            const taskId = mut.payload.id;
            const taskRes = await client.query(
              'SELECT id, title, status, revision_version FROM tasks WHERE id = $1 AND tenant_id = $2',
              [taskId, tenantId]
            );

            if (taskRes.rows.length === 0) {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: taskId || 'unknown',
                status: 'REJECTED',
                serverVersion: mut.baseVersion,
                message: 'Aufgabe nicht gefunden.'
              });
              continue;
            }

            const serverTask = taskRes.rows[0];

            // Paralleler Änderungskonflikt: Server-Version ist bereits weiter als baseVersion des Clients
            if (serverTask.revision_version > mut.baseVersion) {
              results.push({
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
                message: 'Parallele Bearbeitung festgestellt. Manuelle Auflösung erforderlich.'
              });
              continue;
            }

            // Atomares Update mit Versionserhöhung
            await client.query(
              'UPDATE tasks SET status = $1, revision_version = revision_version + 1 WHERE id = $2 AND tenant_id = $3',
              [mut.payload.status, taskId, tenantId]
            );

            results.push({
              clientUuid: mut.clientUuid,
              serverId: taskId,
              status: 'SYNCED',
              serverVersion: serverTask.revision_version + 1
            });
          } else if (mut.action === 'DELETE') {
            const taskId = mut.payload.id;
            const delRes = await client.query('DELETE FROM tasks WHERE id = $1 AND tenant_id = $2 RETURNING id', [taskId, tenantId]);
            if (delRes.rows.length === 0) {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: taskId || 'unknown',
                status: 'REJECTED',
                serverVersion: mut.baseVersion,
                message: 'Aufgabe zum Löschen nicht gefunden.'
              });
            } else {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: taskId,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1,
                message: 'Aufgabe gelöscht'
              });
            }
          }
        }

        // ======================================================================
        // 4. KEYS (SCHLÜSSELDEPOT)
        // ======================================================================
        else if (mut.entityType === 'key') {
          const keyId = mut.payload.id;

          if (mut.action === 'UPDATE') {
            const keyRes = await client.query(
              `UPDATE keys 
               SET status = $1,
                   current_holder_id = $2,
                   issued_at = $3,
                   expected_return = $4
               WHERE id = $5 AND tenant_id = $6
               RETURNING id, key_number, status`,
              [
                mut.payload.status,
                mut.payload.currentHolderId || null,
                mut.payload.issuedAt || null,
                mut.payload.expectedReturn || null,
                keyId,
                tenantId
              ]
            );

            if (keyRes.rows.length === 0) {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: keyId || 'unknown',
                status: 'REJECTED',
                serverVersion: mut.baseVersion,
                message: 'Schlüssel nicht gefunden oder kein Mandantenzugriff.'
              });
            } else {
              results.push({
                clientUuid: mut.clientUuid,
                serverId: keyId,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1
              });
            }
          } else {
            results.push({
              clientUuid: mut.clientUuid,
              serverId: keyId || 'unknown',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: `Aktion '${mut.action}' für Schlüssel via Offline-Sync unzulässig.`
            });
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

            results.push({
              clientUuid: mut.clientUuid,
              serverId: pId || 'unknown',
              status: 'SYNCED',
              serverVersion: 1
            });
          } else {
            // Kontrollgangs-Scans dürfen niemals geändert oder gelöscht werden!
            results.push({
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: 'Kontrollgangs-Scans sind unveränderliche Audit-Ereignisse (UPDATE/DELETE unzulässig).'
            });
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

            results.push({
              clientUuid: mut.clientUuid,
              serverId: hId || 'unknown',
              status: 'SYNCED',
              serverVersion: 1
            });
          } else {
            results.push({
              clientUuid: mut.clientUuid,
              serverId: 'none',
              status: 'REJECTED',
              serverVersion: mut.baseVersion,
              message: 'Schichtübergabeprotokolle sind unveränderliche Dokumente (UPDATE/DELETE unzulässig).'
            });
          }
        }

        // ======================================================================
        // UNBEKANNTER ENTITY TYPE -> EXPLIZIT REJECTED
        // ======================================================================
        else {
          results.push({
            clientUuid: mut.clientUuid,
            serverId: 'none',
            status: 'REJECTED',
            serverVersion: mut.baseVersion,
            message: `Nicht unterstützter Mutationstyp: '${mut.entityType}'.`
          });
        }
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
 * Echte Server-Auflösung von Synchronisationskonflikten:
 * - USE_LOCAL: Übernimmt den lokalen Stand atomar und erhöht revision_version
 * - USE_SERVER: Bestätigt den Serverstand verbindlich
 * Unbekannte Typen/Strategien werden ausdrücklich als REJECTED zurückgewiesen.
 */
export async function resolveSyncConflict(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const userEmail = req.user!.email;
    const body = conflictResolveSchema.parse(req.body);

    let updated = false;

    await withTenantTransaction(tenantId, async (client) => {
      if (body.entityType === 'task') {
        const taskId = body.localPayload?.id || body.clientUuid;
        const taskCheck = await client.query('SELECT id, status FROM tasks WHERE id = $1 AND tenant_id = $2', [taskId, tenantId]);

        if (taskCheck.rows.length === 0) {
          throw new Error('Aufgabe für Konfliktauflösung nicht gefunden.');
        }

        if (body.strategy === 'USE_LOCAL' && body.localPayload?.status) {
          await client.query(
            `UPDATE tasks 
             SET status = $1, revision_version = revision_version + 1
             WHERE id = $2 AND tenant_id = $3`,
            [body.localPayload.status, taskId, tenantId]
          );
          updated = true;
        } else if (body.strategy === 'USE_SERVER') {
          // Serverstand verbindlich beibehalten
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
      applied: updated
    });
  } catch (error) {
    next(error);
  }
}
