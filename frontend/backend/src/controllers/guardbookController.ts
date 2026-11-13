import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';

const createGuardbookSchema = z.object({
  siteId: z.string().guid('siteId muss eine gültige UUID sein.'),
  guardId: z.string().guid('guardId muss eine gültige UUID sein.'),
  category: z.string().min(2).max(50),
  priority: z.enum(['Niedrig', 'Normal', 'Dringend', 'Kritisch']).default('Normal'),
  title: z.string().min(3).max(255),
  description: z.string().min(5),
  policeInvolved: z.boolean().default(false),
  clientMutationId: z.string().min(8).max(64).regex(/^[a-zA-Z0-9_\-]+$/, 'clientMutationId muss ein gültiger Identifier sein.').optional()
});

const revisionGuardbookSchema = z.object({
  entryId: z.string().guid('entryId muss eine gültige UUID sein.'),
  correctionNote: z.string().min(5, 'Korrekturhinweis muss mindestens 5 Zeichen enthalten.')
});

export async function listGuardbook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;

    const result = await withTenantTransaction(tenantId, async (client) => {
      return client.query(
        `SELECT g.id, g.site_id, s.name as site_name, g.guard_id, 
                concat(e.first_name, ' ', e.last_name) as guard_name,
                g.entry_timestamp, g.category, g.priority, g.stage, g.title, g.description, 
                g.police_involved, g.resolved, g.client_mutation_id
         FROM guardbook_entries g
         JOIN sites s ON g.site_id = s.id AND g.tenant_id = s.tenant_id
         JOIN employees e ON g.guard_id = e.id AND g.tenant_id = e.tenant_id
         ORDER BY g.entry_timestamp DESC LIMIT 100`
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

export async function createGuardbookEntry(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const body = createGuardbookSchema.parse(req.body);

    const result = await withTenantTransaction(tenantId, async (client) => {
      // Atomare Idempotenz via INSERT ... ON CONFLICT DO NOTHING
      if (body.clientMutationId) {
        const insertRes = await client.query(
          `INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, police_involved, client_mutation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING
           RETURNING id, title, entry_timestamp`,
          [tenantId, body.siteId, body.guardId, body.category, body.priority, body.title, body.description, body.policeInvolved, body.clientMutationId]
        );

        if (insertRes.rows.length > 0) {
          return insertRes.rows[0];
        }

        // Bei bestehendem Eintrag: Den existierenden Datensatz abrufen (idempotent, kein Duplikat)
        const existing = await client.query(
          'SELECT id, title, entry_timestamp FROM guardbook_entries WHERE tenant_id = $1 AND client_mutation_id = $2',
          [tenantId, body.clientMutationId]
        );
        return existing.rows[0];
      }

      // Ohne clientMutationId
      const insertRes = await client.query(
        `INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, police_involved)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, title, entry_timestamp`,
        [tenantId, body.siteId, body.guardId, body.category, body.priority, body.title, body.description, body.policeInvolved]
      );
      return insertRes.rows[0];
    });

    res.status(201).json({
      success: true,
      message: 'Wachbucheintrag erfasst (atomare Idempotenz gewährleistet)',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function addGuardbookRevision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const authorName = req.user!.email;
    const body = revisionGuardbookSchema.parse(req.body);

    const result = await withTenantTransaction(tenantId, async (client) => {
      // Prüfen, ob Eintrag im selben Mandanten existiert
      const entryCheck = await client.query(
        'SELECT id FROM guardbook_entries WHERE id = $1 AND tenant_id = $2',
        [body.entryId, tenantId]
      );

      if (entryCheck.rows.length === 0) {
        throw new Error('Wachbucheintrag nicht gefunden oder kein Zugriff.');
      }

      const revRes = await client.query(
        `INSERT INTO guardbook_revisions (tenant_id, entry_id, author_name, note)
         VALUES ($1, $2, $3, $4)
         RETURNING id, entry_id, author_name, note, created_at`,
        [tenantId, body.entryId, authorName, body.correctionNote]
      );

      return revRes.rows[0];
    });

    res.status(201).json({
      success: true,
      message: 'Revision erfolgreich als unlöschbare Ergänzung angehängt (Append-Only)',
      data: result
    });
  } catch (error) {
    next(error);
  }
}
