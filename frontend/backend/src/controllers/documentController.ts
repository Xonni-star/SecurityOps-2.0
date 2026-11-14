import { randomUUID, createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import { detectDocumentContent, maxDocumentUploadBytes, persistDocumentBlob, readDocumentBlob, removeDocumentBlob, sanitizeOriginalFilename } from '../services/documentFiles';
import { env } from '../config/env';
import { documentScanner, DocumentScannerUnavailableError } from '../services/documentScanner';

const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(2000).optional()
}).strict();

const folderSchema = z.object({
  name: z.string().trim().min(1).max(150),
  parentId: z.string().guid().nullable().optional()
}).strict();

const relationshipSchema = z.object({
  type: z.enum(['customer', 'site', 'employee', 'shift', 'incident']).nullable(),
  id: z.string().guid().nullable()
}).strict().refine((value) => (value.type === null) === (value.id === null), {
  message: 'Beziehungstyp und ID müssen gemeinsam gesetzt oder entfernt werden.'
});

const uploadMetadataSchema = z.object({
  title: z.string().trim().min(1).max(255),
  categoryId: z.string().guid(),
  folderId: z.string().guid().optional(),
  description: z.string().max(10000).default(''),
  documentNumber: z.string().trim().max(100).optional(),
  validFrom: z.string().date().optional(),
  validUntil: z.string().date().optional(),
  responsibleUserId: z.string().guid().optional(),
  relationshipType: z.enum(['customer', 'site', 'employee', 'shift', 'incident']).optional(),
  relationshipId: z.string().guid().optional()
}).strict().refine((value) => Boolean(value.relationshipType) === Boolean(value.relationshipId), {
  message: 'Beziehungstyp und ID müssen gemeinsam gesetzt werden.'
}).refine((value) => !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom, {
  message: 'Das Gültigkeitsende darf nicht vor dem Gültigkeitsbeginn liegen.'
});

const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  categoryId: z.string().guid().optional(),
  folderId: z.string().guid().nullable().optional(),
  status: z.enum(['Entwurf', 'In Prüfung', 'Freigegeben', 'Veröffentlicht', 'Abgelaufen']).optional(),
  description: z.string().max(10000).optional(),
  documentNumber: z.string().trim().max(100).nullable().optional(),
  validFrom: z.string().date().nullable().optional(),
  validUntil: z.string().date().nullable().optional(),
  responsibleUserId: z.string().guid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  relationship: relationshipSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Mindestens ein Feld muss geändert werden.'
}).refine((value) => value.validFrom == null || value.validUntil == null || value.validUntil >= value.validFrom, {
  message: 'Das Gültigkeitsende darf nicht vor dem Gültigkeitsbeginn liegen.'
});

const defaults = [
  'Verträge', 'Dienstanweisungen', 'Arbeitsanweisungen', 'Objektunterlagen',
  'Mitarbeiterunterlagen', 'Qualifikationsnachweise', 'Schulungsunterlagen',
  'Einsatzberichte', 'Alarmpläne', 'Notfallpläne', 'Kundenunterlagen',
  'Rechnungen', 'Sonstige Dokumente'
];

const relationTargets = {
  customer: { table: 'clients', column: 'customer_id' },
  site: { table: 'sites', column: 'site_id' },
  employee: { table: 'employees', column: 'employee_id' },
  shift: { table: 'shifts', column: 'shift_id' },
  incident: { table: 'guardbook_entries', column: 'incident_id' }
} as const;

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function assertTenantCategory(db: PoolClient, tenantId: string, categoryId: string): Promise<void> {
  const result = await db.query(
    'SELECT 1 FROM document_categories WHERE id=$1 AND tenant_id=$2 AND NOT is_archived',
    [categoryId, tenantId]
  );
  if (!result.rows.length) throw httpError(400, 'Kategorie ist nicht vorhanden oder archiviert.');
}

async function assertTenantFolder(db: PoolClient, tenantId: string, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const result = await db.query(
    'SELECT 1 FROM document_folders WHERE id=$1 AND tenant_id=$2 AND NOT is_archived',
    [folderId, tenantId]
  );
  if (!result.rows.length) throw httpError(400, 'Ordner ist nicht vorhanden oder archiviert.');
}

async function assertTenantUser(db: PoolClient, tenantId: string, userId: string | null): Promise<void> {
  if (!userId) return;
  const result = await db.query(
    'SELECT 1 FROM tenant_memberships WHERE user_id=$1 AND tenant_id=$2 AND is_active=true AND is_locked=false',
    [userId, tenantId]
  );
  if (!result.rows.length) throw httpError(400, 'Verantwortlicher gehört nicht zu diesem Mandanten.');
}

function uuid(value: string): string {
  return z.string().guid().parse(value);
}

function requireFile(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw httpError(400, 'Es wurde keine Datei übertragen.');
  }
  if (req.body.length > maxDocumentUploadBytes()) {
    throw httpError(413, 'Die Datei überschreitet die konfigurierte Maximalgröße.');
  }
  return req.body;
}

function parseFilename(req: Request): string {
  const raw = req.get('x-file-name');
  if (!raw) throw httpError(400, 'Der Originaldateiname fehlt.');
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw httpError(400, 'Der Originaldateiname ist ungültig kodiert.');
  }
  return sanitizeOriginalFilename(decoded);
}

async function ensureDefaultCategories(db: PoolClient, tenantId: string, userId: string): Promise<void> {
  for (const name of defaults) {
    await db.query(
      `INSERT INTO document_categories (tenant_id, name, created_by)
       VALUES ($1, $2, $3) ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, name, userId]
    );
  }
}

async function audit(
  db: PoolClient,
  tenantId: string,
  documentId: string,
  userId: string,
  action: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO document_audit_events (tenant_id, document_id, actor_user_id, action, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, documentId, userId, action, JSON.stringify(details)]
  );
}

async function setRelationship(
  db: PoolClient,
  tenantId: string,
  documentId: string,
  type: keyof typeof relationTargets | null,
  targetId: string | null
): Promise<void> {
  await db.query('DELETE FROM document_relationships WHERE tenant_id = $1 AND document_id = $2', [tenantId, documentId]);
  if (!type || !targetId) {
    await db.query('UPDATE documents SET site_id=NULL WHERE tenant_id=$1 AND id=$2', [tenantId, documentId]);
    return;
  }
  const target = relationTargets[type];
  const existing = await db.query(
    `SELECT 1 FROM ${target.table} WHERE id = $1 AND tenant_id = $2`,
    [targetId, tenantId]
  );
  if (!existing.rows.length) throw httpError(400, 'Der verknüpfte Datensatz ist nicht vorhanden oder gehört zu einem anderen Mandanten.');
  await db.query(
    `INSERT INTO document_relationships (tenant_id, document_id, relationship_type, ${target.column})
     VALUES ($1, $2, $3, $4)`,
    [tenantId, documentId, type, targetId]
  );
  await db.query(
    'UPDATE documents SET site_id=$1 WHERE tenant_id=$2 AND id=$3',
    [type === 'site' ? targetId : null, tenantId, documentId]
  );
}

async function setTags(db: PoolClient, tenantId: string, documentId: string, tags: string[]): Promise<void> {
  const uniqueNames = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  await db.query('DELETE FROM document_tag_assignments WHERE tenant_id = $1 AND document_id = $2', [tenantId, documentId]);
  for (const name of uniqueNames) {
    const tag = await db.query(
      `INSERT INTO document_tags (tenant_id, name) VALUES ($1, $2)
       ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tenantId, name]
    );
    await db.query(
      `INSERT INTO document_tag_assignments (tenant_id, document_id, tag_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [tenantId, documentId, tag.rows[0].id]
    );
  }
}

const documentSelect = `
  SELECT d.id, d.tenant_id, d.site_id, d.title, d.category_id, c.name AS category_name,
         d.folder_id, f.name AS folder_name,
         CASE WHEN d.archived_at IS NOT NULL THEN 'Archiviert'
              WHEN d.valid_until < CURRENT_DATE THEN 'Abgelaufen'
              ELSE d.status END AS status,
         d.description, d.document_number, d.valid_from, d.valid_until,
         d.responsible_user_id, d.approved_by, d.approved_at, d.current_version,
         d.archived_at, d.created_at, d.updated_at,
         v.original_filename, v.content_type, v.size_bytes::int AS size_bytes, v.sha256_hash,
         v.scan_status, v.created_by AS version_created_by, v.created_at AS version_created_at,
         (v.released_at IS NOT NULL AND v.storage_deleted_at IS NULL) AS file_released,
         v.scan_error_code, v.storage_deleted_at,
         COALESCE(rel.relationship_type, 'general') AS linked_entity_type,
         COALESCE(rel.customer_id, rel.site_id, rel.employee_id, rel.shift_id, rel.incident_id) AS linked_entity_id,
         COALESCE(cl.company_name, si.name, concat(e.first_name, ' ', e.last_name), sh.type, gb.title) AS linked_entity_name,
         COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY lower(t.name))
                   FROM document_tag_assignments a JOIN document_tags t
                     ON t.id = a.tag_id AND t.tenant_id = a.tenant_id
                   WHERE a.document_id = d.id AND a.tenant_id = d.tenant_id), '[]'::json) AS tags
  FROM documents d
  JOIN document_categories c ON c.id = d.category_id AND c.tenant_id = d.tenant_id
  LEFT JOIN document_folders f ON f.id = d.folder_id AND f.tenant_id = d.tenant_id
  LEFT JOIN document_versions v ON v.document_id = d.id AND v.tenant_id = d.tenant_id
    AND v.version_number = d.current_version
  LEFT JOIN document_relationships rel ON rel.document_id = d.id AND rel.tenant_id = d.tenant_id
  LEFT JOIN clients cl ON cl.id = rel.customer_id AND cl.tenant_id = rel.tenant_id
  LEFT JOIN sites si ON si.id = rel.site_id AND si.tenant_id = rel.tenant_id
  LEFT JOIN employees e ON e.id = rel.employee_id AND e.tenant_id = rel.tenant_id
  LEFT JOIN shifts sh ON sh.id = rel.shift_id AND sh.tenant_id = rel.tenant_id
  LEFT JOIN guardbook_entries gb ON gb.id = rel.incident_id AND gb.tenant_id = rel.tenant_id`;

async function finalizeDocumentScan(
  tenantId: string,
  documentId: string,
  versionNumber: number,
  bytes: Buffer,
  userId: string
): Promise<string> {
  let scanStatus: 'clean' | 'infected' | 'unavailable' | 'error' | 'not_scanned';
  let scanErrorCode: string | null = null;
  if (!env.DMS_SCAN_REQUIRED && env.DMS_SCANNER_PROVIDER === 'none') {
    scanStatus = 'not_scanned';
  } else {
    try {
      scanStatus = await documentScanner.scan(bytes);
    } catch (error) {
      if (error instanceof DocumentScannerUnavailableError) {
        scanStatus = 'unavailable';
        scanErrorCode = 'provider_unavailable';
      } else {
        scanStatus = 'error';
        scanErrorCode = 'scanner_error';
      }
      console.error('[DMS SCAN] File remains quarantined.', { status: scanStatus });
    }
  }

  const release = scanStatus === 'clean' || (scanStatus === 'not_scanned' && !env.DMS_SCAN_REQUIRED);
  const action = ({
    clean: 'scan_clean',
    infected: 'scan_infected',
    unavailable: 'scan_unavailable',
    error: 'scan_error',
    not_scanned: 'scan_not_configured'
  } as const)[scanStatus];
  await withTenantTransaction(tenantId, async (db) => {
    const updated = await db.query(
      `UPDATE document_versions
          SET scan_status=$1::varchar(20),
              scanned_at=CASE WHEN $1::varchar(20) IN ('clean','infected') THEN CURRENT_TIMESTAMP ELSE NULL END,
              scan_error_code=$2, released_at=CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END
        WHERE tenant_id=$4 AND document_id=$5 AND version_number=$6
          AND storage_deleted_at IS NULL AND storage_deletion_pending_at IS NULL
        RETURNING id`,
      [scanStatus, scanErrorCode, release, tenantId, documentId, versionNumber]
    );
    if (!updated.rows.length) throw httpError(409, 'Die Version wird gelöscht und kann nicht freigegeben werden.');
    await audit(db, tenantId, documentId, userId, action, {
      version: versionNumber,
      released: release,
      ...(scanErrorCode ? { errorCode: scanErrorCode } : {})
    });
  });
  return scanStatus;
}

export async function rescanDocumentVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const versionNumber = z.coerce.number().int().positive().parse(req.params.version);
    const source = await withTenantTransaction(tenantId, async (db) => {
      const result = await db.query(
        `SELECT version.storage_key, version.size_bytes, version.sha256_hash,
                version.released_at, version.storage_deleted_at, version.storage_deletion_pending_at
           FROM documents document
           JOIN document_versions version
             ON version.document_id=document.id AND version.tenant_id=document.tenant_id
          WHERE document.id=$1 AND document.tenant_id=$2 AND version.version_number=$3
          FOR UPDATE OF version`,
        [documentId, tenantId, versionNumber]
      );
      if (!result.rows.length) throw httpError(404, 'Dokumentversion nicht gefunden.');
      const version = result.rows[0];
      if (version.storage_deleted_at || version.storage_deletion_pending_at) {
        throw httpError(409, 'Eine gelöschte oder zur Löschung vorgemerkte Version kann nicht geprüft werden.');
      }
      if (version.released_at) throw httpError(409, 'Die Version ist bereits freigegeben.');
      await db.query(
        `UPDATE document_versions
            SET scan_status='pending', scanned_at=NULL, scan_error_code=NULL, released_at=NULL
          WHERE tenant_id=$1 AND document_id=$2 AND version_number=$3`,
        [tenantId, documentId, versionNumber]
      );
      await audit(db, tenantId, documentId, user.userId, 'scan_retry_started', {
        version: versionNumber
      });
      return version;
    });

    let scanStatus: 'clean' | 'infected' | 'unavailable' | 'error';
    let scanErrorCode: string | null = null;
    try {
      const bytes = await readDocumentBlob(source.storage_key);
      if (bytes.length !== Number(source.size_bytes) ||
          createHash('sha256').update(bytes).digest('hex') !== source.sha256_hash.trim()) {
        throw new Error('Stored document integrity check failed.');
      }
      scanStatus = await documentScanner.scan(bytes);
    } catch (error) {
      if (error instanceof DocumentScannerUnavailableError) {
        scanStatus = 'unavailable';
        scanErrorCode = 'provider_unavailable';
      } else {
        scanStatus = 'error';
        scanErrorCode = 'stored_object_or_scanner_error';
      }
      console.error('[DMS RESCAN] Quarantined version remains blocked.', { status: scanStatus });
    }

    const released = scanStatus === 'clean';
    const action = ({
      clean: 'scan_clean',
      infected: 'scan_infected',
      unavailable: 'scan_unavailable',
      error: 'scan_error'
    } as const)[scanStatus];
    const updated = await withTenantTransaction(tenantId, async (db) => {
      const result = await db.query(
        `UPDATE document_versions
            SET scan_status=$1::varchar(20),
                scanned_at=CASE WHEN $1::varchar(20) IN ('clean','infected') THEN CURRENT_TIMESTAMP ELSE NULL END,
                scan_error_code=$2, released_at=CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END
          WHERE tenant_id=$4 AND document_id=$5 AND version_number=$6
            AND storage_deleted_at IS NULL AND storage_deletion_pending_at IS NULL
          RETURNING id`,
        [scanStatus, scanErrorCode, released, tenantId, documentId, versionNumber]
      );
      if (!result.rows.length) throw httpError(409, 'Die Version wurde während der Prüfung zur Löschung vorgemerkt.');
      await audit(db, tenantId, documentId, user.userId, action, {
        version: versionNumber,
        retry: true,
        released,
        ...(scanErrorCode ? { errorCode: scanErrorCode } : {})
      });
      return result.rows[0];
    });
    res.status(scanStatus === 'clean' ? 200 : 202).json({
      success: true,
      data: { id: updated.id, version_number: versionNumber, scan_status: scanStatus, released }
    });
  } catch (error) {
    next(error);
  }
}

export async function listDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const querySchema = z.object({
      search: z.string().trim().max(200).optional(),
      categoryId: z.string().guid().optional(),
      folderId: z.string().guid().optional(),
      root: z.enum(['true', 'false']).optional(),
      status: z.enum(['Entwurf', 'In Prüfung', 'Freigegeben', 'Veröffentlicht', 'Abgelaufen', 'Archiviert']).optional(),
      archived: z.enum(['true', 'false']).default('false'),
      sort: z.enum(['title', 'created_at', 'updated_at', 'valid_until']).default('updated_at'),
      direction: z.enum(['asc', 'desc']).default('desc'),
      limit: z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).max(100000).default(0)
    }).strict();
    const filters = querySchema.parse(req.query);
    const values: unknown[] = [tenantId];
    const where = ['d.tenant_id = $1'];
    if (filters.archived === 'true') where.push('d.archived_at IS NOT NULL');
    else where.push('d.archived_at IS NULL');
    if (filters.search) {
      values.push(`%${filters.search}%`);
      where.push(`(d.title ILIKE $${values.length} OR v.original_filename ILIKE $${values.length}
        OR c.name ILIKE $${values.length} OR EXISTS (
          SELECT 1 FROM document_tag_assignments a JOIN document_tags t
            ON t.id = a.tag_id AND t.tenant_id = a.tenant_id
          WHERE a.document_id = d.id AND a.tenant_id = d.tenant_id AND t.name ILIKE $${values.length}
        ))`);
    }
    if (filters.categoryId) {
      values.push(filters.categoryId);
      where.push(`d.category_id = $${values.length}`);
    }
    if (filters.folderId) {
      values.push(filters.folderId);
      where.push(`d.folder_id = $${values.length}`);
    } else if (filters.root === 'true') {
      where.push('d.folder_id IS NULL');
    }
    if (filters.status) {
      if (filters.status === 'Archiviert') {
        where.push('d.archived_at IS NOT NULL');
      } else {
        values.push(filters.status);
        where.push(`d.archived_at IS NULL AND (CASE WHEN d.valid_until < CURRENT_DATE THEN 'Abgelaufen' ELSE d.status END) = $${values.length}`);
      }
    }
    values.push(filters.limit);
    const limitPlaceholder = values.length;
    values.push(filters.offset);
    const orderColumns = { title: 'd.title', created_at: 'd.created_at', updated_at: 'd.updated_at', valid_until: 'd.valid_until' };
    const result = await withTenantTransaction(tenantId, (db) => db.query(
      `${documentSelect} WHERE ${where.join(' AND ')}
       ORDER BY ${orderColumns[filters.sort]} ${filters.direction.toUpperCase()} NULLS LAST, d.id
       LIMIT $${limitPlaceholder} OFFSET $${values.length}`,
      values
    ));
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function getDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = uuid(req.params.id);
    const result = await withTenantTransaction(req.user!.tenantId, (db) =>
      db.query(`${documentSelect} WHERE d.id = $1 AND d.tenant_id = $2`, [id, req.user!.tenantId])
    );
    if (!result.rows.length) throw httpError(404, 'Dokument nicht gefunden.');
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  let storageKey: string | undefined;
  let metadataPersisted = false;
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const bytes = requireFile(req);
    const filename = parseFilename(req);
    const file = detectDocumentContent(bytes, filename);
    const metadata = uploadMetadataSchema.parse(req.query);
    const siteCreateGrants = user.sitePermissions?.filter((grant) => grant.code === 'documents:create') ?? [];
    if (!user.permissions.includes('documents:create') &&
        (metadata.relationshipType !== 'site' || !metadata.relationshipId ||
          !siteCreateGrants.some((grant) => grant.siteId === metadata.relationshipId))) {
      throw httpError(403, 'Ein site-begrenzter Upload muss einem ausdrücklich freigegebenen Objekt zugeordnet werden.');
    }
    storageKey = await persistDocumentBlob(bytes, file.contentType);
    const documentId = randomUUID();
    await withTenantTransaction(tenantId, async (db) => {
      await assertTenantCategory(db, tenantId, metadata.categoryId);
      await assertTenantFolder(db, tenantId, metadata.folderId ?? null);
      await assertTenantUser(db, tenantId, metadata.responsibleUserId ?? null);
      await db.query(
        `INSERT INTO documents (id, tenant_id, site_id, title, category_id, folder_id, description,
           document_number, valid_from, valid_until, responsible_user_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [documentId, tenantId, metadata.relationshipType === 'site' ? metadata.relationshipId : null,
          metadata.title, metadata.categoryId, metadata.folderId ?? null,
          metadata.description, metadata.documentNumber ?? null, metadata.validFrom ?? null,
          metadata.validUntil ?? null, metadata.responsibleUserId ?? null, user.userId]
      );
      await db.query(
        `INSERT INTO document_versions (tenant_id, document_id, version_number, original_filename,
           storage_key, content_type, size_bytes, sha256_hash, scan_status, created_by)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9)`,
        [tenantId, documentId, filename, storageKey, file.contentType, bytes.length,
          createHash('sha256').update(bytes).digest('hex'), 'pending', user.userId]
      );
      if (metadata.relationshipType && metadata.relationshipId) {
        await setRelationship(db, tenantId, documentId, metadata.relationshipType, metadata.relationshipId);
      }
      await audit(db, tenantId, documentId, user.userId, 'created', { title: metadata.title });
      await audit(db, tenantId, documentId, user.userId, 'uploaded', { version: 1, sizeBytes: bytes.length });
      await audit(db, tenantId, documentId, user.userId, 'scan_pending', { version: 1 });
    });
    metadataPersisted = true;
    const scanStatus = await finalizeDocumentScan(tenantId, documentId, 1, bytes, user.userId);
    const result = await withTenantTransaction(tenantId, (db) =>
      db.query(`${documentSelect} WHERE d.id = $1 AND d.tenant_id = $2`, [documentId, tenantId])
    );
    res.status(scanStatus === 'clean' || scanStatus === 'not_scanned' ? 201 : 202)
      .json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (storageKey && !metadataPersisted) {
      try {
        await removeDocumentBlob(storageKey);
      } catch {
        console.error('[DMS] Failed to remove orphaned upload blob.');
      }
    }
    next(error);
  }
}

export async function createDocumentVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  let storageKey: string | undefined;
  let metadataPersisted = false;
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const bytes = requireFile(req);
    const filename = parseFilename(req);
    const file = detectDocumentContent(bytes, filename);
    storageKey = await persistDocumentBlob(bytes, file.contentType);
    const version = await withTenantTransaction(tenantId, async (db) => {
      const document = await db.query(
        'SELECT current_version FROM documents WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL FOR UPDATE',
        [documentId, tenantId]
      );
      if (!document.rows.length) throw httpError(404, 'Aktives Dokument nicht gefunden.');
      const versionNumber = Number(document.rows[0].current_version) + 1;
      const created = await db.query(
        `INSERT INTO document_versions (tenant_id, document_id, version_number, original_filename,
           storage_key, content_type, size_bytes, sha256_hash, scan_status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, version_number, original_filename, content_type, size_bytes::int AS size_bytes, sha256_hash, scan_status, created_at, created_by`,
        [tenantId, documentId, versionNumber, filename, storageKey, file.contentType,
          bytes.length, createHash('sha256').update(bytes).digest('hex'), 'pending', user.userId]
      );
      await db.query(
        `UPDATE documents SET current_version = $1, status='In Prüfung', approved_by=NULL,
           approved_at=NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3`,
        [versionNumber, documentId, tenantId]
      );
      await audit(db, tenantId, documentId, user.userId, 'version_created', { version: versionNumber, sizeBytes: bytes.length });
      await audit(db, tenantId, documentId, user.userId, 'scan_pending', { version: versionNumber });
      return created.rows[0];
    });
    metadataPersisted = true;
    const scanStatus = await finalizeDocumentScan(tenantId, documentId, Number(version.version_number), bytes, user.userId);
    res.status(scanStatus === 'clean' || scanStatus === 'not_scanned' ? 201 : 202)
      .json({ success: true, data: { ...version, scan_status: scanStatus, released: scanStatus === 'clean' || (scanStatus === 'not_scanned' && !env.DMS_SCAN_REQUIRED) } });
  } catch (error) {
    if (storageKey && !metadataPersisted) {
      try {
        await removeDocumentBlob(storageKey);
      } catch {
        console.error('[DMS] Failed to remove orphaned version blob.');
      }
    }
    next(error);
  }
}

export async function listDocumentVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const documentId = uuid(req.params.id);
    const tenantId = req.user!.tenantId;
    const result = await withTenantTransaction(tenantId, async (db) => {
      const exists = await db.query('SELECT 1 FROM documents WHERE id=$1 AND tenant_id=$2', [documentId, tenantId]);
      if (!exists.rows.length) throw httpError(404, 'Dokument nicht gefunden.');
      return db.query(
        `SELECT id, version_number, original_filename, content_type, size_bytes::int AS size_bytes, sha256_hash,
                scan_status, (released_at IS NOT NULL AND storage_deleted_at IS NULL) AS released,
                scan_error_code, storage_deleted_at, storage_deletion_pending_at,
                created_by, created_at, restored_from_version
         FROM document_versions WHERE document_id = $1 AND tenant_id = $2 ORDER BY version_number DESC`,
        [documentId, tenantId]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function restoreDocumentVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const versionNumber = z.coerce.number().int().positive().parse(req.params.version);
    const result = await withTenantTransaction(tenantId, async (db) => {
      const doc = await db.query(
        'SELECT current_version FROM documents WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL FOR UPDATE',
        [documentId, tenantId]
      );
      if (!doc.rows.length) throw httpError(404, 'Aktives Dokument nicht gefunden.');
      const source = await db.query(
        `SELECT original_filename, storage_key, content_type, size_bytes, sha256_hash, scan_status,
                released_at, scanned_at, storage_deleted_at
         FROM document_versions WHERE document_id=$1 AND tenant_id=$2 AND version_number=$3`,
        [documentId, tenantId, versionNumber]
      );
      if (!source.rows.length) throw httpError(404, 'Dokumentversion nicht gefunden.');
      if (!source.rows[0].released_at || source.rows[0].storage_deleted_at) {
        throw httpError(409, 'Eine nicht freigegebene oder gelöschte Version kann nicht wiederhergestellt werden.');
      }
      const nextVersion = Number(doc.rows[0].current_version) + 1;
      const item = source.rows[0];
      const created = await db.query(
        `INSERT INTO document_versions (tenant_id, document_id, version_number, original_filename,
           storage_key, content_type, size_bytes, sha256_hash, scan_status, created_by,
           restored_from_version, released_at, scanned_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP,$12)
         RETURNING id, version_number, original_filename, content_type, size_bytes::int AS size_bytes, sha256_hash, scan_status, created_at, created_by, restored_from_version`,
        [tenantId, documentId, nextVersion, item.original_filename, item.storage_key, item.content_type,
          item.size_bytes, item.sha256_hash, item.scan_status, user.userId, versionNumber, item.scanned_at]
      );
      await db.query(
        'UPDATE documents SET current_version=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND tenant_id=$3',
        [nextVersion, documentId, tenantId]
      );
      await audit(db, tenantId, documentId, user.userId, 'version_restored', { sourceVersion: versionNumber, version: nextVersion });
      return created.rows[0];
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function downloadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const versionNumber = req.query.version === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.version);
    const inline = req.query.inline === 'true';
    const result = await withTenantTransaction(tenantId, async (db) => {
      const found = await db.query(
        `SELECT v.original_filename, v.storage_key, v.content_type, v.version_number,
                v.released_at, v.storage_deleted_at
         FROM documents d JOIN document_versions v
           ON v.document_id=d.id AND v.tenant_id=d.tenant_id
         WHERE d.id=$1 AND d.tenant_id=$2 AND v.version_number=COALESCE($3::integer,d.current_version)`,
        [documentId, tenantId, versionNumber ?? null]
      );
      if (!found.rows.length) throw httpError(404, 'Dokument oder Version nicht gefunden.');
      const item = found.rows[0];
      if (!item.released_at || item.storage_deleted_at) {
        throw httpError(423, 'Die Datei ist quarantänisiert oder nicht mehr verfügbar.');
      }
      let bytes: Buffer;
      try {
        bytes = await readDocumentBlob(item.storage_key);
      } catch {
        throw httpError(500, 'Die gespeicherte Dokumentdatei ist nicht verfügbar.');
      }
      await audit(db, tenantId, documentId, user.userId, 'downloaded', { version: item.version_number });
      return { item, bytes };
    });
    if (inline && !/^(application\/pdf|image\/(jpeg|png|gif|webp|bmp)|text\/(plain|csv))/.test(result.item.content_type)) {
      throw httpError(415, 'Für diesen Dateityp ist keine sichere Vorschau verfügbar.');
    }
    const filename = sanitizeOriginalFilename(result.item.original_filename);
    res.setHeader('Content-Type', result.item.content_type);
    res.setHeader('Content-Length', result.bytes.length);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (inline) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(result.bytes);
  } catch (error) {
    next(error);
  }
}

export async function updateDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const body = updateDocumentSchema.parse(req.body);
    const result = await withTenantTransaction(tenantId, async (db) => {
      const current = await db.query(
        'SELECT status, valid_from, valid_until FROM documents WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL FOR UPDATE',
        [documentId, tenantId]
      );
      if (!current.rows.length) throw httpError(404, 'Aktives Dokument nicht gefunden.');
      if ((body.status === 'Freigegeben' || body.status === 'Veröffentlicht')
          && body.status !== current.rows[0].status
          && !user.permissions.includes('documents:approve')) {
        throw httpError(403, "Fehlende Berechtigung 'documents:approve'.");
      }
      if (body.categoryId) await assertTenantCategory(db, tenantId, body.categoryId);
      if (body.folderId !== undefined) await assertTenantFolder(db, tenantId, body.folderId);
      if (body.responsibleUserId !== undefined) await assertTenantUser(db, tenantId, body.responsibleUserId);
      const dateValue = (value: string | Date | null): string | null => value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
      const validFrom = body.validFrom === undefined ? dateValue(current.rows[0].valid_from) : body.validFrom;
      const validUntil = body.validUntil === undefined ? dateValue(current.rows[0].valid_until) : body.validUntil;
      if (validFrom && validUntil && validUntil < validFrom) {
        throw httpError(400, 'Das Gültigkeitsende darf nicht vor dem Gültigkeitsbeginn liegen.');
      }
      const fields: Array<[keyof typeof body, string]> = [
        ['title', 'title'], ['categoryId', 'category_id'], ['folderId', 'folder_id'],
        ['status', 'status'], ['description', 'description'], ['documentNumber', 'document_number'],
        ['validFrom', 'valid_from'], ['validUntil', 'valid_until'], ['responsibleUserId', 'responsible_user_id']
      ];
      const assignments: string[] = [];
      const values: unknown[] = [documentId, tenantId];
      for (const [key, column] of fields) {
        if (body[key] !== undefined) {
          values.push(body[key] ?? null);
          assignments.push(`${column} = $${values.length}`);
        }
      }
      if (body.status === 'Freigegeben' || body.status === 'Veröffentlicht') {
        values.push(user.userId);
        assignments.push(`approved_by = $${values.length}`);
        assignments.push('approved_at = CURRENT_TIMESTAMP');
      }
      assignments.push('updated_at = CURRENT_TIMESTAMP');
      await db.query(`UPDATE documents SET ${assignments.join(', ')} WHERE id=$1 AND tenant_id=$2`, values);
      if (body.tags !== undefined) await setTags(db, tenantId, documentId, body.tags);
      if (body.relationship !== undefined) {
        await setRelationship(db, tenantId, documentId, body.relationship.type, body.relationship.id);
      }
      if (body.status === 'Freigegeben') await audit(db, tenantId, documentId, user.userId, 'approved');
      else if (body.status === 'Veröffentlicht') await audit(db, tenantId, documentId, user.userId, 'published');
      else await audit(db, tenantId, documentId, user.userId, 'updated', { fields: Object.keys(body) });
      const doc = await db.query(`${documentSelect} WHERE d.id=$1 AND d.tenant_id=$2`, [documentId, tenantId]);
      return doc.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function updateDocumentRelationship(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const relationship = relationshipSchema.parse(req.body);
    await withTenantTransaction(tenantId, async (db) => {
      const exists = await db.query('SELECT 1 FROM documents WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL', [documentId, tenantId]);
      if (!exists.rows.length) throw httpError(404, 'Aktives Dokument nicht gefunden.');
      await setRelationship(db, tenantId, documentId, relationship.type, relationship.id);
      await audit(db, tenantId, documentId, user.userId, 'relationship_changed', { type: relationship.type });
    });
    res.json({ success: true, data: { id: documentId, type: relationship.type, linkedId: relationship.id } });
  } catch (error) {
    next(error);
  }
}

export async function archiveDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const changed = await withTenantTransaction(tenantId, async (db) => {
      const result = await db.query(
        `UPDATE documents SET archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL RETURNING id`,
        [documentId, tenantId]
      );
      if (!result.rows.length) {
        const found = await db.query('SELECT 1 FROM documents WHERE id=$1 AND tenant_id=$2', [documentId, tenantId]);
        if (!found.rows.length) throw httpError(404, 'Dokument nicht gefunden.');
        throw httpError(409, 'Dokument ist bereits archiviert.');
      }
      await audit(db, tenantId, documentId, user.userId, 'archived');
      return result.rows[0];
    });
    res.json({ success: true, data: changed });
  } catch (error) {
    next(error);
  }
}

export async function deleteDocumentFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    await withTenantTransaction(tenantId, async (db) => {
      const document = await db.query(
        'SELECT id FROM documents WHERE id=$1 AND tenant_id=$2 AND archived_at IS NOT NULL FOR UPDATE',
        [documentId, tenantId]
      );
      if (!document.rows.length) throw httpError(409, 'Dateien können nur bei archivierten Dokumenten gelöscht werden.');
      const versions = await db.query(
        `SELECT version_number, storage_key FROM document_versions
          WHERE document_id=$1 AND tenant_id=$2 AND storage_deleted_at IS NULL`,
        [documentId, tenantId]
      );
      if (versions.rows.length) {
        await db.query(
          `UPDATE document_versions
              SET storage_deletion_pending_at=COALESCE(storage_deletion_pending_at,CURRENT_TIMESTAMP),
                  released_at=NULL
            WHERE document_id=$1 AND tenant_id=$2 AND storage_deleted_at IS NULL`,
          [documentId, tenantId]
        );
        for (const version of versions.rows) {
          await db.query(
            `INSERT INTO document_storage_deletion_outbox
              (tenant_id,document_id,version_number,storage_key,requested_by)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (tenant_id,document_id,version_number) DO NOTHING`,
            [tenantId, documentId, version.version_number, version.storage_key, user.userId]
          );
        }
        await db.query(
          `UPDATE documents SET status='In Prüfung', approved_by=NULL, approved_at=NULL,
             updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2`,
          [documentId, tenantId]
        );
        await audit(db, tenantId, documentId, user.userId, 'file_deletion_requested', {
          versions: versions.rows.map((version: { version_number: number }) => version.version_number)
        });
      }
    });
    const pending = await processDocumentStorageDeletion(tenantId, documentId, user.userId);
    res.status(pending ? 202 : 200).json({
      success: true,
      data: { id: documentId, filesDeleted: pending === 0, deletionPending: pending > 0, pendingVersions: pending }
    });
  } catch (error) {
    next(error);
  }
}

async function processDocumentStorageDeletion(
  tenantId: string,
  documentId: string,
  userId: string
): Promise<number> {
  const jobs = await withTenantTransaction(tenantId, (db) => db.query(
    `SELECT version_number, storage_key FROM document_storage_deletion_outbox
      WHERE document_id=$1 AND tenant_id=$2 AND completed_at IS NULL
      ORDER BY version_number`,
    [documentId, tenantId]
  ));

  for (const job of jobs.rows) {
    const claimed = await withTenantTransaction(tenantId, async (db) => {
      const attempt = await db.query(
        `UPDATE document_storage_deletion_outbox
            SET attempt_count=attempt_count+1, last_error_code=NULL
          WHERE tenant_id=$1 AND document_id=$2 AND version_number=$3 AND completed_at IS NULL
          RETURNING attempt_count`,
        [tenantId, documentId, job.version_number]
      );
      if (attempt.rows.length) {
        await audit(db, tenantId, documentId, userId, 'file_deletion_attempted', {
          version: job.version_number,
          attempt: attempt.rows[0].attempt_count
        });
      }
      return attempt.rows.length > 0;
    });
    if (!claimed) continue;

    try {
      await removeDocumentBlob(job.storage_key);
    } catch {
      await withTenantTransaction(tenantId, async (db) => {
        await db.query(
          `UPDATE document_storage_deletion_outbox SET last_error_code='storage_delete_failed'
            WHERE tenant_id=$1 AND document_id=$2 AND version_number=$3 AND completed_at IS NULL`,
          [tenantId, documentId, job.version_number]
        );
        await audit(db, tenantId, documentId, userId, 'file_deletion_failed', {
          version: job.version_number,
          errorCode: 'storage_delete_failed'
        });
      });
      continue;
    }

    await withTenantTransaction(tenantId, async (db) => {
      const completed = await db.query(
        `UPDATE document_storage_deletion_outbox SET completed_at=CURRENT_TIMESTAMP, last_error_code=NULL
          WHERE tenant_id=$1 AND document_id=$2 AND version_number=$3 AND completed_at IS NULL
          RETURNING version_number`,
        [tenantId, documentId, job.version_number]
      );
      if (!completed.rows.length) return;
      await db.query(
        `UPDATE document_versions
            SET storage_deleted_at=CURRENT_TIMESTAMP, storage_deletion_pending_at=NULL, released_at=NULL
          WHERE tenant_id=$1 AND document_id=$2 AND version_number=$3`,
        [tenantId, documentId, job.version_number]
      );
      await audit(db, tenantId, documentId, userId, 'file_storage_deleted', {
        version: job.version_number
      });
    });
  }

  const pending = await withTenantTransaction(tenantId, (db) => db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM document_storage_deletion_outbox
      WHERE document_id=$1 AND tenant_id=$2 AND completed_at IS NULL`,
    [documentId, tenantId]
  ));
  return Number(pending.rows[0].count);
}

export async function restoreDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const restored = await withTenantTransaction(tenantId, async (db) => {
      const result = await db.query(
        `UPDATE documents SET archived_at=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND tenant_id=$2 AND archived_at IS NOT NULL RETURNING id`,
        [documentId, tenantId]
      );
      if (!result.rows.length) {
        const found = await db.query('SELECT 1 FROM documents WHERE id=$1 AND tenant_id=$2', [documentId, tenantId]);
        if (!found.rows.length) throw httpError(404, 'Dokument nicht gefunden.');
        throw httpError(409, 'Dokument ist nicht archiviert.');
      }
      await audit(db, tenantId, documentId, user.userId, 'restored');
      return result.rows[0];
    });
    res.json({ success: true, data: restored });
  } catch (error) {
    next(error);
  }
}

export async function moveDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const user = req.user!;
    const documentId = uuid(req.params.id);
    const body = z.object({ folderId: z.string().guid().nullable() }).strict().parse(req.body);
    const result = await withTenantTransaction(tenantId, async (db) => {
      await assertTenantFolder(db, tenantId, body.folderId);
      const updated = await db.query(
        `UPDATE documents SET folder_id=$1, updated_at=CURRENT_TIMESTAMP
         WHERE id=$2 AND tenant_id=$3 AND archived_at IS NULL RETURNING id`,
        [body.folderId, documentId, tenantId]
      );
      if (!updated.rows.length) {
        const found = await db.query('SELECT 1 FROM documents WHERE id=$1 AND tenant_id=$2', [documentId, tenantId]);
        if (!found.rows.length) throw httpError(404, 'Dokument nicht gefunden.');
        throw httpError(409, 'Archivierte Dokumente können nicht verschoben werden.');
      }
      await audit(db, tenantId, documentId, user.userId, 'moved', { folderId: body.folderId });
      return updated.rows[0];
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function listDocumentAudit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const documentId = uuid(req.params.id);
    const result = await withTenantTransaction(tenantId, async (db) => {
      const exists = await db.query('SELECT 1 FROM documents WHERE id=$1 AND tenant_id=$2', [documentId, tenantId]);
      if (!exists.rows.length) throw httpError(404, 'Dokument nicht gefunden.');
      return db.query(
        `SELECT a.id, a.action, a.details, a.occurred_at, u.email AS actor
         FROM document_audit_events a JOIN users u ON u.id=a.actor_user_id
         WHERE a.document_id=$1 AND a.tenant_id=$2 ORDER BY a.occurred_at DESC`,
        [documentId, tenantId]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function listDocumentCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const result = await withTenantTransaction(tenantId, async (db) => {
      await ensureDefaultCategories(db, tenantId, req.user!.userId);
      return db.query(
        `SELECT id, name, description, is_archived, created_at, updated_at
         FROM document_categories WHERE tenant_id=$1 ORDER BY lower(name), id`,
        [tenantId]
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function createDocumentCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = categorySchema.parse(req.body);
    const result = await withTenantTransaction(req.user!.tenantId, (db) => db.query(
      `INSERT INTO document_categories (tenant_id, name, description, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id, name, description, is_archived, created_at`,
      [req.user!.tenantId, body.name, body.description ?? null, req.user!.userId]
    ));
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function updateDocumentCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = uuid(req.params.id);
    const body = categorySchema.partial().strict().refine((value) => Object.keys(value).length > 0).parse(req.body);
    const result = await withTenantTransaction(req.user!.tenantId, (db) => db.query(
      `UPDATE document_categories SET name=COALESCE($1,name), description=COALESCE($2,description),
         updated_at=CURRENT_TIMESTAMP
       WHERE id=$3 AND tenant_id=$4 RETURNING id, name, description, is_archived, updated_at`,
      [body.name ?? null, body.description ?? null, id, req.user!.tenantId]
    ));
    if (!result.rows.length) throw httpError(404, 'Kategorie nicht gefunden.');
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function listDocumentFolders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const includeArchived = z.enum(['true', 'false']).default('false').parse(req.query.archived);
    const result = await withTenantTransaction(req.user!.tenantId, (db) => db.query(
      `SELECT f.id, f.parent_id, f.name, f.is_archived, f.created_at, f.updated_at,
         (SELECT count(*)::int FROM documents d WHERE d.folder_id=f.id AND d.tenant_id=f.tenant_id AND d.archived_at IS NULL) AS document_count
       FROM document_folders f WHERE f.tenant_id=$1 AND ($2::boolean OR NOT f.is_archived)
       ORDER BY lower(f.name), f.id`,
      [req.user!.tenantId, includeArchived === 'true']
    ));
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function createDocumentFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = folderSchema.parse(req.body);
    const result = await withTenantTransaction(req.user!.tenantId, async (db) => {
      await assertTenantFolder(db, req.user!.tenantId, body.parentId ?? null);
      return db.query(
        `INSERT INTO document_folders (tenant_id, parent_id, name, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id, parent_id, name, is_archived, created_at`,
        [req.user!.tenantId, body.parentId ?? null, body.name, req.user!.userId]
      );
    });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function updateDocumentFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = uuid(req.params.id);
    const body = folderSchema.pick({ name: true }).parse(req.body);
    const result = await withTenantTransaction(req.user!.tenantId, (db) => db.query(
      `UPDATE document_folders SET name=$1, updated_at=CURRENT_TIMESTAMP
       WHERE id=$2 AND tenant_id=$3 AND NOT is_archived RETURNING id, parent_id, name, is_archived, updated_at`,
      [body.name, id, req.user!.tenantId]
    ));
    if (!result.rows.length) throw httpError(404, 'Aktiver Ordner nicht gefunden.');
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function archiveDocumentFolder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const folderId = uuid(req.params.id);
    const result = await withTenantTransaction(req.user!.tenantId, async (db) => {
      const folder = await db.query('SELECT id FROM document_folders WHERE id=$1 AND tenant_id=$2 AND NOT is_archived', [folderId, req.user!.tenantId]);
      if (!folder.rows.length) throw httpError(404, 'Aktiver Ordner nicht gefunden.');
      const contents = await db.query(
        `SELECT
           EXISTS(SELECT 1 FROM documents WHERE folder_id=$1 AND tenant_id=$2 AND archived_at IS NULL) AS has_documents,
           EXISTS(SELECT 1 FROM document_folders WHERE parent_id=$1 AND tenant_id=$2 AND NOT is_archived) AS has_children`,
        [folderId, req.user!.tenantId]
      );
      if (contents.rows[0].has_documents || contents.rows[0].has_children) {
        throw httpError(409, 'Ordner mit aktiven Dokumenten oder Unterordnern kann nicht archiviert werden.');
      }
      return db.query(
        `UPDATE document_folders SET is_archived=true, updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND tenant_id=$2 RETURNING id, is_archived`,
        [folderId, req.user!.tenantId]
      );
    });
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function listDocumentTags(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await withTenantTransaction(req.user!.tenantId, (db) => db.query(
      `SELECT t.id, t.name, count(a.document_id)::int AS document_count
       FROM document_tags t LEFT JOIN document_tag_assignments a
         ON a.tag_id=t.id AND a.tenant_id=t.tenant_id
       WHERE t.tenant_id=$1 GROUP BY t.id ORDER BY lower(t.name)`,
      [req.user!.tenantId]
    ));
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export function documentUploadBodyParserLimit(): number {
  return maxDocumentUploadBytes();
}
