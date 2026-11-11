import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import crypto from 'crypto';

const createClientSchema = z.object({
  clientNumber: z.string().min(2),
  companyName: z.string().min(2),
  contactPerson: z.string().min(2),
  email: z.string().email(),
  phone: z.string(),
  address: z.string(),
  contractStart: z.string(),
  contractEnd: z.string(),
  slaLevel: z.string().default('Gold (24/7 Vor-Ort)')
});

const updateClientSchema = createClientSchema.partial().extend({
  revisionVersion: z.number().int().positive()
}).strict();

export async function listClients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;

    const result = await withTenantTransaction(tenantId, async (client) => {
      // RLS Policy greift automatisch über app.current_tenant
      return client.query(
        'SELECT id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end, sla_level, billing_status, revision_version FROM clients WHERE archived_at IS NULL ORDER BY company_name'
      );
    });

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
}

export async function createClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const body = createClientSchema.parse(req.body);

    const result = await withTenantTransaction(tenantId, async (client) => {
      return client.query(
        `INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end, sla_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, client_number, company_name`,
        [tenantId, body.clientNumber, body.companyName, body.contactPerson, body.email, body.phone, body.address, body.contractStart, body.contractEnd, body.slaLevel]
      );
    });

    res.status(201).json({
      success: true,
      message: 'Kunde erfolgreich angelegt',
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
}

export async function updateClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const body = updateClientSchema.parse(req.body);
    const id = z.string().uuid().parse(req.params.id);
    const result = await withTenantTransaction(tenantId, async (client) => client.query(
      `UPDATE clients SET client_number = COALESCE($1, client_number), company_name = COALESCE($2, company_name),
       contact_person = COALESCE($3, contact_person), email = COALESCE($4, email), phone = COALESCE($5, phone),
       address = COALESCE($6, address), contract_start = COALESCE($7, contract_start), contract_end = COALESCE($8, contract_end),
       sla_level = COALESCE($9, sla_level), revision_version = revision_version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $10 AND tenant_id = $11 AND archived_at IS NULL AND revision_version = $12
       RETURNING id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end, sla_level, billing_status, revision_version`,
      [body.clientNumber ?? null, body.companyName ?? null, body.contactPerson ?? null, body.email ?? null, body.phone ?? null,
       body.address ?? null, body.contractStart ?? null, body.contractEnd ?? null, body.slaLevel ?? null, id, tenantId, body.revisionVersion]
    ));
    if (!result.rows.length) {
      const current = await withTenantTransaction(tenantId, (client) => client.query(
        'SELECT id, revision_version, archived_at FROM clients WHERE id = $1 AND tenant_id = $2', [id, tenantId]
      ));
      res.status(current.rows.length ? 409 : 404).json({ success: false, message: current.rows.length ? 'Kunde wurde zwischenzeitlich geändert oder archiviert.' : 'Kunde nicht gefunden.' , data: current.rows[0] });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

export async function archiveClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ revisionVersion: z.number().int().positive() }).strict().parse(req.body);
    const result = await withTenantTransaction(tenantId, (client) => client.query(
      `UPDATE clients SET archived_at = CURRENT_TIMESTAMP, revision_version = revision_version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL AND revision_version = $3
       RETURNING id, archived_at, revision_version`, [id, tenantId, body.revisionVersion]
    ));
    if (!result.rows.length) {
      const current = await withTenantTransaction(tenantId, (client) => client.query(
        'SELECT id, revision_version, archived_at FROM clients WHERE id = $1 AND tenant_id = $2', [id, tenantId]
      ));
      res.status(current.rows.length ? 409 : 404).json({ success: false, message: current.rows.length ? 'Kunde ist bereits archiviert oder wurde geändert.' : 'Kunde nicht gefunden.', data: current.rows[0] });
      return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

const clientSyncSchema = z.object({
  deviceId: z.string().min(4).max(128).optional(),
  mutations: z.array(z.object({ clientUuid: z.string().min(8).max(64), action: z.enum(['CREATE', 'UPDATE', 'DELETE']), baseVersion: z.number().int().positive(), payload: z.record(z.any()) })).min(1).max(100)
}).strict();

export async function syncClientMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const body = clientSyncSchema.parse(req.body);
    const results = await withTenantTransaction(tenantId, async (db) => {
      const output: any[] = [];
      for (const mutation of body.mutations) {
        const required = 'customers:create';
        if (!user.permissions.includes(required)) {
          output.push({ clientUuid: mutation.clientUuid, status: 'REJECTED', message: `Fehlende Berechtigung '${required}'` });
          continue;
        }
        const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ action: mutation.action, baseVersion: mutation.baseVersion, payload: mutation.payload })).digest('hex');
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:push:${mutation.clientUuid}`]);
        const prior = await db.query('SELECT payload_hash, response_json FROM sync_idempotency_receipts WHERE tenant_id=$1 AND client_mutation_id=$2', [tenantId, mutation.clientUuid]);
        if (prior.rows.length) {
          output.push(prior.rows[0].payload_hash === payloadHash ? prior.rows[0].response_json : { clientUuid: mutation.clientUuid, status: 'REJECTED', message: 'Mutation-ID mit abweichendem Inhalt wiederverwendet.' });
          continue;
        }
        let result: any;
        const p = mutation.payload;
        if (mutation.action === 'CREATE') {
          const data = createClientSchema.safeParse(p);
          const id = z.string().uuid().safeParse(p.id);
          if (!data.success || !id.success) result = { clientUuid: mutation.clientUuid, status: 'REJECTED', message: 'Ungültige Kundendaten.' };
          else {
            const inserted = await db.query(`INSERT INTO clients (id, tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end, sla_level, client_mutation_id)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING RETURNING id, revision_version`,
              [id.data, tenantId, data.data.clientNumber, data.data.companyName, data.data.contactPerson, data.data.email, data.data.phone, data.data.address, data.data.contractStart, data.data.contractEnd, data.data.slaLevel, mutation.clientUuid]);
            const existing = inserted.rows[0] || (await db.query('SELECT id, revision_version FROM clients WHERE tenant_id=$1 AND client_mutation_id=$2', [tenantId, mutation.clientUuid])).rows[0];
            result = { clientUuid: mutation.clientUuid, serverId: existing.id, status: 'SYNCED', serverVersion: existing.revision_version };
          }
        } else {
          const id = z.string().uuid().safeParse(p.id);
          if (!id.success) result = { clientUuid: mutation.clientUuid, status: 'REJECTED', message: 'Ungültige Kunden-ID.' };
          else if (mutation.action === 'UPDATE') {
            const changes = { ...p };
            delete changes.id;
            const validated = updateClientSchema.safeParse({ ...changes, revisionVersion: mutation.baseVersion });
            if (!validated.success) result = { clientUuid: mutation.clientUuid, serverId: id.data, status: 'REJECTED', message: 'Ungültige Kundendaten.' };
            else {
              const v = validated.data;
              const updated = await db.query(`UPDATE clients SET client_number=COALESCE($1,client_number), company_name=COALESCE($2,company_name), contact_person=COALESCE($3,contact_person), email=COALESCE($4,email), phone=COALESCE($5,phone), address=COALESCE($6,address), contract_start=COALESCE($7,contract_start), contract_end=COALESCE($8,contract_end), sla_level=COALESCE($9,sla_level), revision_version=revision_version+1, updated_at=CURRENT_TIMESTAMP WHERE id=$10 AND tenant_id=$11 AND archived_at IS NULL AND revision_version=$12 RETURNING id, revision_version`,
                [v.clientNumber ?? null, v.companyName ?? null, v.contactPerson ?? null, v.email ?? null, v.phone ?? null, v.address ?? null, v.contractStart ?? null, v.contractEnd ?? null, v.slaLevel ?? null, id.data, tenantId, mutation.baseVersion]);
              if (updated.rows.length) result = { clientUuid: mutation.clientUuid, serverId: id.data, status: 'SYNCED', serverVersion: updated.rows[0].revision_version };
              else {
                const current = await db.query('SELECT revision_version FROM clients WHERE id=$1 AND tenant_id=$2', [id.data, tenantId]);
                result = current.rows.length ? { clientUuid: mutation.clientUuid, serverId: id.data, status: 'CONFLICT', serverVersion: current.rows[0].revision_version, conflictData: { serverVersion: current.rows[0].revision_version, clientVersion: mutation.baseVersion, clientPayload: changes } } : { clientUuid: mutation.clientUuid, serverId: id.data, status: 'REJECTED', message: 'Kunde nicht gefunden.' };
              }
            }
          }
          else {
            const updated = await db.query(`UPDATE clients SET archived_at=CURRENT_TIMESTAMP, revision_version=revision_version+1, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL AND revision_version=$3 RETURNING id, revision_version`, [id.data, tenantId, mutation.baseVersion]);
            if (updated.rows.length) result = { clientUuid: mutation.clientUuid, serverId: id.data, status: 'SYNCED', serverVersion: updated.rows[0].revision_version };
            else {
              const current = await db.query('SELECT revision_version FROM clients WHERE id=$1 AND tenant_id=$2', [id.data, tenantId]);
              result = current.rows.length ? { clientUuid: mutation.clientUuid, serverId: id.data, status: 'CONFLICT', serverVersion: current.rows[0].revision_version, conflictData: { serverVersion: current.rows[0].revision_version, clientVersion: mutation.baseVersion, clientPayload: p } } : { clientUuid: mutation.clientUuid, serverId: id.data, status: 'REJECTED', message: 'Kunde nicht gefunden.' };
            }
          }
        }
        const status = result.status || 'REJECTED';
        await db.query(`INSERT INTO sync_idempotency_receipts (tenant_id, client_mutation_id, entity_type, action, payload_hash, status, server_id, server_version, response_json)
          VALUES ($1,$2,'client',$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id,client_mutation_id) DO NOTHING`,
          [tenantId, mutation.clientUuid, mutation.action, payloadHash, status, result.serverId || null, result.serverVersion || mutation.baseVersion, JSON.stringify(result)]);
        output.push(result);
      }
      return output;
    });
    res.json({ success: true, data: results });
  } catch (error) { next(error); }
}
