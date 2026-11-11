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

export interface SyncResultItem {
  clientUuid: string;
  serverId: string;
  status: 'SYNCED' | 'CONFLICT' | 'REJECTED';
  serverVersion: number;
  conflictData?: any;
  message?: string;
}

/**
 * Echter Backend-Endpunkt POST /api/v1/sync/push:
 * Verarbeitet ausstehende Mutationen idempotent gegen PostgreSQL.
 * Der Mandantenkontext und die Benutzeridentität stammen strikt aus req.user.
 */
export async function pushSyncMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;
    const body = syncPushBatchSchema.parse(req.body);

    const results: SyncResultItem[] = [];

    await withTenantTransaction(tenantId, async (client) => {
      for (const mut of body.mutations) {
        if (mut.entityType === 'guardbook') {
          // Idempotenzprüfung über client_mutation_id
          const existingRes = await client.query(
            'SELECT id, title, description, stage FROM guardbook_entries WHERE tenant_id = $1 AND client_mutation_id = $2',
            [tenantId, mut.clientUuid]
          );

          if (existingRes.rows.length > 0) {
            const existing = existingRes.rows[0];

            if (mut.action === 'UPDATE') {
              // Append-Only Korrektur: Fügt eine unlöschbare Revision an!
              const correctionNote = mut.payload.correctionNote || 'Korrektur aus Offline-Synchronisation';
              await client.query(
                `INSERT INTO guardbook_revisions (tenant_id, entry_id, author_name, note)
                 VALUES ($1, $2, $3, $4)`,
                [tenantId, existing.id, req.user!.email, correctionNote]
              );

              // Status (stage) kontrolliert aktualisieren
              if (mut.payload.stage) {
                await client.query(
                  'UPDATE guardbook_entries SET stage = $1 WHERE id = $2 AND tenant_id = $3',
                  [mut.payload.stage, existing.id, tenantId]
                );
              }

              results.push({
                clientUuid: mut.clientUuid,
                serverId: existing.id,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1,
                message: 'Revision erfolgreich angehängt'
              });
            } else {
              // Idempotente Bestätigung: Bereits synchronisiert, kein Duplikat
              results.push({
                clientUuid: mut.clientUuid,
                serverId: existing.id,
                status: 'SYNCED',
                serverVersion: 1,
                message: 'Bereits vorhanden (idempotent bestätigt)'
              });
            }
          } else {
            // Neuer Eintrag: Atomar mit ON CONFLICT DO NOTHING einfügen
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
               RETURNING id, title, entry_timestamp`,
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
              // Bei Race Condition: Idempotent bestehenden Eintrag zurückgeben
              const raceCheck = await client.query(
                'SELECT id FROM guardbook_entries WHERE tenant_id = $1 AND client_mutation_id = $2',
                [tenantId, mut.clientUuid]
              );
              results.push({
                clientUuid: mut.clientUuid,
                serverId: raceCheck.rows[0]?.id || 'unknown',
                status: 'SYNCED',
                serverVersion: 1
              });
            }
          }
        } else if (mut.entityType === 'task') {
          // Aufgabenkonflikterkennung
          const taskId = mut.payload.id;
          if (taskId) {
            const taskRes = await client.query(
              'SELECT id, title, status FROM tasks WHERE id = $1 AND tenant_id = $2',
              [taskId, tenantId]
            );

            if (taskRes.rows.length > 0) {
              const serverTask = taskRes.rows[0];
              // Kollisionsprüfung bei paralleler Statusänderung
              if (serverTask.status !== mut.payload.expectedBaseStatus && mut.payload.expectedBaseStatus) {
                results.push({
                  clientUuid: mut.clientUuid,
                  serverId: taskId,
                  status: 'CONFLICT',
                  serverVersion: 2,
                  conflictData: { serverStatus: serverTask.status, clientStatus: mut.payload.status },
                  message: 'Parallele Bearbeitung auf Server festgestellt.'
                });
                continue;
              }

              await client.query(
                'UPDATE tasks SET status = $1 WHERE id = $2 AND tenant_id = $3',
                [mut.payload.status, taskId, tenantId]
              );

              results.push({
                clientUuid: mut.clientUuid,
                serverId: taskId,
                status: 'SYNCED',
                serverVersion: mut.baseVersion + 1
              });
              continue;
            }
          }

          // Neue Aufgabe
          const insTask = await client.query(
            `INSERT INTO tasks (tenant_id, title, assigned_to_name, site_name, due_date, priority, status, category)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [tenantId, mut.payload.title, mut.payload.assignedToName || 'Einsatzleitung', mut.payload.siteName || null, mut.payload.dueDate || new Date().toISOString().split('T')[0], mut.payload.priority || 'Mittel', mut.payload.status || 'Offen', mut.payload.category || 'Audit']
          );

          results.push({
            clientUuid: mut.clientUuid,
            serverId: insTask.rows[0].id,
            status: 'SYNCED',
            serverVersion: 1
          });
        }
      }
    });

    res.json({
      success: true,
      message: `${results.length} Synchronisationsoperation(en) serverseitig verarbeitet`,
      data: results
    });
  } catch (error) {
    next(error);
  }
}
