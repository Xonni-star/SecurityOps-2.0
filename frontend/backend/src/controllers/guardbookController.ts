import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';

const createGuardbookSchema = z.object({
  siteId: z.string().uuid(),
  guardId: z.string().uuid(),
  category: z.string(),
  priority: z.enum(['Niedrig', 'Normal', 'Dringend', 'Kritisch']).default('Normal'),
  title: z.string().min(3),
  description: z.string().min(5),
  policeInvolved: z.boolean().default(false),
  clientMutationId: z.string().optional()
});

const revisionGuardbookSchema = z.object({
  entryId: z.string().uuid(),
  correctionNote: z.string().min(5)
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

        // Falls bereits existent: Vorhandenen Eintrag abrufen ohne Neuanlage (idempotent)
        const existing = await client.query(
          'SELECT id, title, entry_timestamp FROM guardbook_entries WHERE tenant_id = $1 AND client_mutation_id = $2',
          [tenantId, body.clientMutationId]
        );
        return existing.rows[0];
      }

      // Ohne clientMutationId normal einfügen
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
      message: 'Wachbucheintrag gespeichert (atomare Idempotenz abgesichert)',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Revisionsverwaltung: Nachträgliche Korrekturen werden als unzerstörbare Ergänzung
 * in guardbook_revisions gespeichert; der Originaleintrag bleibt unangetastet.
 */
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
