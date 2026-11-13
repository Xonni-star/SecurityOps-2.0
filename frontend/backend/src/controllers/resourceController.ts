import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import crypto from 'crypto';

/**
 * Tenant-scoped reference data and CRUD endpoints for the operational modules.
 * PostgreSQL/RLS remains the source of truth; the tenant always comes from the
 * authenticated JWT, never from the request body.
 */

const siteCreateSchema = z.object({
  clientId: z.string().guid(),
  siteCode: z.string().min(2).max(50),
  name: z.string().min(2).max(200),
  address: z.string().min(3),
  securityLevel: z
    .enum(['Niedrig', 'Mittel', 'Hoch (KRITIS / BSI)', 'Höchste Sicherheitsstufe'])
    .default('Hoch (KRITIS / BSI)'),
  requiredGuardsDay: z.number().int().min(0).max(50).default(1),
  requiredGuardsNight: z.number().int().min(0).max(50).default(1),
  alarmSystem: z.string().max(150).optional().default(''),
  accessRules: z.string().optional().default('')
});

const siteUpdateSchema = siteCreateSchema.partial().extend({ revisionVersion: z.number().int().positive() }).strict();

const employeeCreateSchema = z.object({
  personnelNumber: z.string().min(2).max(50),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(3).max(50),
  role: z.string().min(2).max(50).default('Wachdienstmitarbeiter'),
  status: z.enum(['Aktiv', 'Urlaub', 'Krank', 'Freigestellt']).default('Aktiv'),
  weeklyHours: z.number().min(0).max(80).default(40),
  hourlyRate: z.number().min(0).max(1000).default(18.5),
  dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfJoining muss YYYY-MM-DD sein.')
});

const employeeUpdateSchema = employeeCreateSchema.partial();

const SITE_COLUMNS: Record<string, string> = {
  clientId: 'client_id',
  siteCode: 'site_code',
  name: 'name',
  address: 'address',
  securityLevel: 'security_level',
  requiredGuardsDay: 'required_guards_day',
  requiredGuardsNight: 'required_guards_night',
  alarmSystem: 'alarm_system',
  accessRules: 'access_rules'
};

const EMPLOYEE_COLUMNS: Record<string, string> = {
  personnelNumber: 'personnel_number',
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  role: 'role',
  status: 'status',
  weeklyHours: 'weekly_hours',
  hourlyRate: 'hourly_rate',
  dateOfJoining: 'date_of_joining'
};

const SITE_SELECT = `id, tenant_id, client_id, site_code, name, address, security_level,
  required_guards_day, required_guards_night, alarm_system, access_rules, archived_at, revision_version`;

const EMPLOYEE_SELECT = `id, personnel_number, first_name, last_name, email, phone,
  role, status, weekly_hours, hourly_rate, date_of_joining`;

export async function listSites(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `SELECT s.id, s.client_id, c.company_name AS client_name,
                s.site_code, s.name, s.address, s.security_level,
                s.required_guards_day, s.required_guards_night,
                s.alarm_system, s.access_rules, s.archived_at, s.revision_version
           FROM sites s
           JOIN clients c ON c.id = s.client_id AND c.tenant_id = s.tenant_id
          ORDER BY s.name`
      )
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function listEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(`SELECT ${EMPLOYEE_SELECT} FROM employees ORDER BY last_name, first_name`)
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function createSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const body = siteCreateSchema.parse(req.body);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `INSERT INTO sites
           (tenant_id, client_id, site_code, name, address, security_level,
            required_guards_day, required_guards_night, alarm_system, access_rules)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${SITE_SELECT}`,
        [
          tenantId,
          body.clientId,
          body.siteCode,
          body.name,
          body.address,
          body.securityLevel,
          body.requiredGuardsDay,
          body.requiredGuardsNight,
          body.alarmSystem,
          body.accessRules
        ]
      )
    );

    res.status(201).json({ success: true, message: 'Objekt erfolgreich angelegt', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function updateSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);
    const body = siteUpdateSchema.parse(req.body);

    const { revisionVersion, ...changes } = body;
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      res.status(400).json({ success: false, message: 'Keine aktualisierbaren Felder übermittelt.' });
      return;
    }

    const assignments = entries.map(([key], index) => `${SITE_COLUMNS[key]} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id, tenantId, revisionVersion);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `UPDATE sites
            SET ${assignments.join(', ')}, revision_version = revision_version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${values.length - 2} AND tenant_id = $${values.length - 1}
            AND archived_at IS NULL AND revision_version = $${values.length}
          RETURNING ${SITE_SELECT}`,
        values
      )
    );

    if (result.rows.length === 0) {
      const current = await withTenantTransaction(tenantId, (client) => client.query('SELECT revision_version, archived_at FROM sites WHERE id=$1 AND tenant_id=$2', [id, tenantId]));
      res.status(current.rows.length ? 409 : 404).json({ success: false, message: current.rows.length ? 'Objekt wurde zwischenzeitlich geändert oder archiviert.' : 'Objekt nicht gefunden.', data: current.rows[0] });
      return;
    }

    res.json({ success: true, message: 'Objekt aktualisiert', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function archiveSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);
    const { revisionVersion } = z.object({ revisionVersion: z.number().int().positive() }).strict().parse(req.body);
    const result = await withTenantTransaction(tenantId, (db) => db.query(
      `UPDATE sites SET archived_at=CURRENT_TIMESTAMP, revision_version=revision_version+1, updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL AND revision_version=$3 RETURNING id, archived_at, revision_version`, [id, tenantId, revisionVersion]
    ));
    if (!result.rows.length) {
      const current = await withTenantTransaction(tenantId, (db) => db.query('SELECT revision_version, archived_at FROM sites WHERE id=$1 AND tenant_id=$2', [id, tenantId]));
      res.status(current.rows.length ? 409 : 404).json({ success: false, message: current.rows.length ? 'Objekt wurde geändert oder ist bereits archiviert.' : 'Objekt nicht gefunden.', data: current.rows[0] }); return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

export async function restoreSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);
    const { revisionVersion } = z.object({ revisionVersion: z.number().int().positive() }).strict().parse(req.body);
    const result = await withTenantTransaction(tenantId, (db) => db.query(
      `UPDATE sites SET archived_at=NULL, revision_version=revision_version+1, updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND tenant_id=$2 AND archived_at IS NOT NULL AND revision_version=$3 RETURNING id, archived_at, revision_version`, [id, tenantId, revisionVersion]
    ));
    if (!result.rows.length) {
      const current = await withTenantTransaction(tenantId, (db) => db.query('SELECT revision_version, archived_at FROM sites WHERE id=$1 AND tenant_id=$2', [id, tenantId]));
      res.status(current.rows.length ? 409 : 404).json({ success: false, message: current.rows.length ? 'Objekt wurde geändert oder ist bereits aktiv.' : 'Objekt nicht gefunden.', data: current.rows[0] }); return;
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
}

const siteSyncSchema = z.object({
  deviceId: z.string().min(4).max(128).optional(),
  mutations: z.array(z.object({ clientUuid: z.string().min(8).max(64), action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'RESTORE']), baseVersion: z.number().int().positive(), payload: z.record(z.string(), z.any()) }).strict()).min(1).max(100)
}).strict();

export async function syncSiteMutations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId; const permissions = req.user!.permissions;
    const body = siteSyncSchema.parse(req.body);
    const results = await withTenantTransaction(tenantId, async db => {
      const outputs: any[] = [];
      for (const mutation of body.mutations) {
        const permission = mutation.action === 'CREATE' ? 'sites:create' : mutation.action === 'UPDATE' ? 'sites:update' : mutation.action === 'RESTORE' ? 'sites:restore' : 'sites:archive';
        if (!permissions.includes(permission)) { outputs.push({ clientUuid: mutation.clientUuid, status: 'REJECTED', message: `Fehlende Berechtigung '${permission}'` }); continue; }
        const hash = crypto.createHash('sha256').update(JSON.stringify({ action: mutation.action, baseVersion: mutation.baseVersion, payload: mutation.payload })).digest('hex');
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:site:${mutation.clientUuid}`]);
        const prior = await db.query('SELECT payload_hash,response_json FROM sync_idempotency_receipts WHERE tenant_id=$1 AND client_mutation_id=$2', [tenantId, mutation.clientUuid]);
        if (prior.rows.length) { outputs.push(prior.rows[0].payload_hash === hash ? prior.rows[0].response_json : { clientUuid: mutation.clientUuid, status: 'REJECTED', message: 'Mutation-ID mit abweichendem Inhalt wiederverwendet.' }); continue; }
        let result: any;
        {
          const p = mutation.payload; const id = z.string().guid().safeParse(p.id);
          if (mutation.action === 'CREATE') {
            const data = siteCreateSchema.safeParse(p);
            if (!id.success || !data.success) result = { clientUuid: mutation.clientUuid, status: 'REJECTED', message: 'Ungültige Standortdaten.' };
            else {
              const d = data.data;
              const inserted = await db.query(`INSERT INTO sites (id,tenant_id,client_id,site_code,name,address,security_level,required_guards_day,required_guards_night,alarm_system,access_rules,client_mutation_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tenant_id,client_mutation_id) DO NOTHING RETURNING id,revision_version`,
                [id.data,tenantId,d.clientId,d.siteCode,d.name,d.address,d.securityLevel,d.requiredGuardsDay,d.requiredGuardsNight,d.alarmSystem,d.accessRules,mutation.clientUuid]);
              const row = inserted.rows[0] || (await db.query('SELECT id,revision_version FROM sites WHERE tenant_id=$1 AND client_mutation_id=$2',[tenantId,mutation.clientUuid])).rows[0];
              result = { clientUuid: mutation.clientUuid, serverId: row.id, status: 'SYNCED', serverVersion: row.revision_version };
            }
          } else if (!id.success) result = { clientUuid: mutation.clientUuid, status: 'REJECTED', message: 'Ungültige Standort-ID.' };
          else if (mutation.action === 'UPDATE') {
            const { id: _id, ...changes } = p; const v = siteUpdateSchema.safeParse({ ...changes, revisionVersion: mutation.baseVersion });
            if (!v.success || !Object.keys(changes).length) result = { clientUuid: mutation.clientUuid, serverId: id.data, status: 'REJECTED', message: 'Ungültige Standortdaten.' };
            else {
              const { revisionVersion, ...fields } = v.data; const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
              const values: any[] = entries.map(([,value])=>value); const setSql = entries.map(([key],i)=>`${SITE_COLUMNS[key]}=$${i+1}`);
              values.push(id.data,tenantId,revisionVersion);
              const updated = await db.query(`UPDATE sites SET ${setSql.join(',')},revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$${values.length-2} AND tenant_id=$${values.length-1} AND archived_at IS NULL AND revision_version=$${values.length} RETURNING revision_version`,values);
              result = updated.rows.length ? { clientUuid: mutation.clientUuid, serverId: id.data, status: 'SYNCED', serverVersion: updated.rows[0].revision_version } : await siteSyncConflict(db, tenantId, id.data, mutation.clientUuid, mutation.baseVersion, p);
            }
          } else {
            const restoring = mutation.action === 'RESTORE';
            const changed = await db.query(`UPDATE sites SET archived_at=${restoring ? 'NULL' : 'CURRENT_TIMESTAMP'},revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2 AND archived_at IS ${restoring ? 'NOT NULL' : 'NULL'} AND revision_version=$3 RETURNING revision_version`, [id.data,tenantId,mutation.baseVersion]);
            result = changed.rows.length ? { clientUuid: mutation.clientUuid, serverId: id.data, status: 'SYNCED', serverVersion: changed.rows[0].revision_version } : await siteSyncConflict(db,tenantId,id.data,mutation.clientUuid,mutation.baseVersion,p);
          }
        }
        const status = result.status || 'REJECTED';
        await db.query(`INSERT INTO sync_idempotency_receipts (tenant_id,client_mutation_id,entity_type,action,payload_hash,status,server_id,server_version,response_json) VALUES ($1,$2,'site',$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [tenantId,mutation.clientUuid,mutation.action,hash,status,result.serverId||null,result.serverVersion||mutation.baseVersion,JSON.stringify(result)]);
        outputs.push(result);
      }
      return outputs;
    });
    res.json({ success: true, data: results });
  } catch (error) { next(error); }
}

async function siteSyncConflict(db: any, tenantId: string, id: string, clientUuid: string, baseVersion: number, payload: any): Promise<any> {
  const current = await db.query('SELECT revision_version,archived_at FROM sites WHERE id=$1 AND tenant_id=$2',[id,tenantId]);
  return current.rows.length ? { clientUuid,serverId:id,status:'CONFLICT',serverVersion:current.rows[0].revision_version,conflictData:{serverVersion:current.rows[0].revision_version,clientVersion:baseVersion,clientPayload:payload,archivedAt:current.rows[0].archived_at} } : { clientUuid,serverId:id,status:'REJECTED',message:'Standort nicht gefunden.' };
}

export async function createEmployee(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const body = employeeCreateSchema.parse(req.body);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `INSERT INTO employees
           (tenant_id, personnel_number, first_name, last_name, email, phone,
            role, status, weekly_hours, hourly_rate, date_of_joining)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${EMPLOYEE_SELECT}`,
        [
          tenantId,
          body.personnelNumber,
          body.firstName,
          body.lastName,
          body.email,
          body.phone,
          body.role,
          body.status,
          body.weeklyHours,
          body.hourlyRate,
          body.dateOfJoining
        ]
      )
    );

    res.status(201).json({ success: true, message: 'Mitarbeiter erfolgreich angelegt', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function updateEmployee(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);
    const body = employeeUpdateSchema.parse(req.body);

    const entries = Object.entries(body).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      res.status(400).json({ success: false, message: 'Keine aktualisierbaren Felder übermittelt.' });
      return;
    }

    const assignments = entries.map(([key], index) => `${EMPLOYEE_COLUMNS[key]} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id, tenantId);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `UPDATE employees
            SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
          RETURNING ${EMPLOYEE_SELECT}`,
        values
      )
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Mitarbeiter nicht gefunden.' });
      return;
    }

    res.json({ success: true, message: 'Mitarbeiter aktualisiert', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Dienstplanung, Schlüsselverwaltung und Aufgaben
// ---------------------------------------------------------------------------

const shiftCreateSchema = z.object({
  siteId: z.string().guid(),
  employeeId: z.string().guid().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date muss YYYY-MM-DD sein.'),
  startTime: z.string().min(3).max(10),
  endTime: z.string().min(3).max(10),
  type: z.enum(['Tagdienst', 'Nachtdienst', 'Revierdienst', 'Sonderposten']).default('Tagdienst'),
  status: z.enum(['Besetzt', 'Offen', 'Konflikt', 'Abgeschlossen']).default('Offen'),
  requiredQualification: z.string().min(2).max(100),
  conflictReason: z.string().max(500).nullable().optional()
});

const shiftUpdateSchema = shiftCreateSchema.partial();

const keyCreateSchema = z.object({
  siteId: z.string().guid(),
  keyNumber: z.string().min(1).max(50),
  label: z.string().min(1).max(150),
  type: z.enum(['Master-Schlüssel', 'Transponder', 'Buntbart', 'Schrankenschlüssel']).default('Master-Schlüssel'),
  status: z.enum(['Im Tresor', 'Ausgegeben', 'Verlustmeldung']).default('Im Tresor'),
  currentHolderId: z.string().guid().nullable().optional(),
  issuedAt: z.string().min(8).nullable().optional(),
  expectedReturn: z.string().min(8).nullable().optional()
});

const keyUpdateSchema = keyCreateSchema.partial();

const taskCreateSchema = z.object({
  title: z.string().min(2).max(255),
  assignedToName: z.string().min(2).max(100),
  siteName: z.string().max(200).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate muss YYYY-MM-DD sein.'),
  priority: z.enum(['Niedrig', 'Mittel', 'Hoch']).default('Mittel'),
  status: z.enum(['Offen', 'In Bearbeitung', 'Erledigt']).default('Offen'),
  category: z
    .enum(['Audit', 'Wartung', 'Nachschulung', 'Kundenanforderung', 'Vorfallsbearbeitung'])
    .default('Audit')
});

const taskUpdateSchema = taskCreateSchema.partial();

const SHIFT_COLUMNS: Record<string, string> = {
  siteId: 'site_id',
  employeeId: 'employee_id',
  date: 'shift_date',
  startTime: 'start_time',
  endTime: 'end_time',
  type: 'type',
  status: 'status',
  requiredQualification: 'required_qualification',
  conflictReason: 'conflict_reason'
};

const KEY_COLUMNS: Record<string, string> = {
  siteId: 'site_id',
  keyNumber: 'key_number',
  label: 'label',
  type: 'type',
  status: 'status',
  currentHolderId: 'current_holder_id',
  issuedAt: 'issued_at',
  expectedReturn: 'expected_return'
};

const TASK_COLUMNS: Record<string, string> = {
  title: 'title',
  assignedToName: 'assigned_to_name',
  siteName: 'site_name',
  dueDate: 'due_date',
  priority: 'priority',
  status: 'status',
  category: 'category'
};

const SHIFT_SELECT = `s.id, s.site_id, st.name AS site_name, s.employee_id,
  NULLIF(concat(e.first_name, ' ', e.last_name), ' ') AS employee_name,
  s.shift_date, s.start_time, s.end_time, s.type, s.status,
  s.required_qualification, s.conflict_reason, s.revision_version`;

const KEY_SELECT = `k.id, k.site_id, st.name AS site_name, k.key_number, k.label,
  k.type, k.status, k.current_holder_id,
  NULLIF(concat(e.first_name, ' ', e.last_name), ' ') AS current_holder_name,
  k.issued_at, k.expected_return, k.revision_version`;

const TASK_SELECT = `id, title, assigned_to_name, site_name, due_date,
  priority, status, category, revision_version`;

export async function listShifts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `SELECT ${SHIFT_SELECT}
           FROM shifts s
           JOIN sites st ON st.id = s.site_id AND st.tenant_id = s.tenant_id
           LEFT JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
          ORDER BY s.shift_date DESC, s.start_time`
      )
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function createShift(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const body = shiftCreateSchema.parse(req.body);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `INSERT INTO shifts
           (tenant_id, site_id, employee_id, shift_date, start_time, end_time,
            type, status, required_qualification, conflict_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, site_id, employee_id, shift_date, start_time, end_time,
                   type, status, required_qualification, conflict_reason, revision_version`,
        [
          tenantId,
          body.siteId,
          body.employeeId ?? null,
          body.date,
          body.startTime,
          body.endTime,
          body.type,
          body.status,
          body.requiredQualification,
          body.conflictReason ?? null
        ]
      )
    );

    res.status(201).json({ success: true, message: 'Schicht erfolgreich angelegt', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function updateShift(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);
    const body = shiftUpdateSchema.parse(req.body);
    const entries = Object.entries(body).filter(([, value]) => value !== undefined);

    if (entries.length === 0) {
      res.status(400).json({ success: false, message: 'Keine aktualisierbaren Felder übermittelt.' });
      return;
    }

    const assignments = entries.map(([key], index) => `${SHIFT_COLUMNS[key]} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id, tenantId);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `UPDATE shifts
            SET ${assignments.join(', ')},
                revision_version = revision_version + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
          RETURNING id, site_id, employee_id, shift_date, start_time, end_time,
                    type, status, required_qualification, conflict_reason, revision_version`,
        values
      )
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Schicht nicht gefunden.' });
      return;
    }

    res.json({ success: true, message: 'Schicht aktualisiert', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function deleteShift(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query('DELETE FROM shifts WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tenantId])
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Schicht nicht gefunden.' });
      return;
    }

    res.json({ success: true, message: 'Schicht gelöscht', data: { id } });
  } catch (error) {
    next(error);
  }
}

export async function listKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `SELECT ${KEY_SELECT}
           FROM keys k
           JOIN sites st ON st.id = k.site_id AND st.tenant_id = k.tenant_id
           LEFT JOIN employees e ON e.id = k.current_holder_id AND e.tenant_id = k.tenant_id
          ORDER BY k.key_number`
      )
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function createKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const body = keyCreateSchema.parse(req.body);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `INSERT INTO keys
           (tenant_id, site_id, key_number, label, type, status,
            current_holder_id, issued_at, expected_return)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, site_id, key_number, label, type, status,
                   current_holder_id, issued_at, expected_return, revision_version`,
        [
          tenantId,
          body.siteId,
          body.keyNumber,
          body.label,
          body.type,
          body.status,
          body.currentHolderId ?? null,
          body.issuedAt ?? null,
          body.expectedReturn ?? null
        ]
      )
    );

    res.status(201).json({ success: true, message: 'Schlüssel erfolgreich angelegt', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function updateKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);
    const body = keyUpdateSchema.parse(req.body);
    const entries = Object.entries(body).filter(([, value]) => value !== undefined);

    if (entries.length === 0) {
      res.status(400).json({ success: false, message: 'Keine aktualisierbaren Felder übermittelt.' });
      return;
    }

    const assignments = entries.map(([key], index) => `${KEY_COLUMNS[key]} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id, tenantId);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `UPDATE keys
            SET ${assignments.join(', ')},
                revision_version = revision_version + 1
          WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
          RETURNING id, site_id, key_number, label, type, status,
                    current_holder_id, issued_at, expected_return, revision_version`,
        values
      )
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Schlüssel nicht gefunden.' });
      return;
    }

    res.json({ success: true, message: 'Schlüssel aktualisiert', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function deleteKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query('DELETE FROM keys WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tenantId])
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Schlüssel nicht gefunden.' });
      return;
    }

    res.json({ success: true, message: 'Schlüssel gelöscht', data: { id } });
  } catch (error) {
    next(error);
  }
}

export async function listTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(`SELECT ${TASK_SELECT} FROM tasks ORDER BY due_date, created_at`)
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function createTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const body = taskCreateSchema.parse(req.body);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `INSERT INTO tasks
           (tenant_id, title, assigned_to_name, site_name, due_date, priority, status, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${TASK_SELECT}`,
        [
          tenantId,
          body.title,
          body.assignedToName,
          body.siteName ?? null,
          body.dueDate,
          body.priority,
          body.status,
          body.category
        ]
      )
    );

    res.status(201).json({ success: true, message: 'Aufgabe erfolgreich angelegt', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function updateTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);
    const body = taskUpdateSchema.parse(req.body);
    const entries = Object.entries(body).filter(([, value]) => value !== undefined);

    if (entries.length === 0) {
      res.status(400).json({ success: false, message: 'Keine aktualisierbaren Felder übermittelt.' });
      return;
    }

    const assignments = entries.map(([key], index) => `${TASK_COLUMNS[key]} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id, tenantId);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `UPDATE tasks
            SET ${assignments.join(', ')}, revision_version = revision_version + 1
          WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
          RETURNING ${TASK_SELECT}`,
        values
      )
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Aufgabe nicht gefunden.' });
      return;
    }

    res.json({ success: true, message: 'Aufgabe aktualisiert', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

export async function deleteTask(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const id = z.string().guid().parse(req.params.id);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query('DELETE FROM tasks WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tenantId])
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Aufgabe nicht gefunden.' });
      return;
    }

    res.json({ success: true, message: 'Aufgabe gelöscht', data: { id } });
  } catch (error) {
    next(error);
  }
}
