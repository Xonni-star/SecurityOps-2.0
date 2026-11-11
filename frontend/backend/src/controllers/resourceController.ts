import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';

/**
 * Tenant-scoped reference data and CRUD endpoints for the operational modules.
 * PostgreSQL/RLS remains the source of truth; the tenant always comes from the
 * authenticated JWT, never from the request body.
 */

const siteCreateSchema = z.object({
  clientId: z.string().uuid(),
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

const siteUpdateSchema = siteCreateSchema.partial();

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

const SITE_SELECT = `id, client_id, site_code, name, address, security_level,
  required_guards_day, required_guards_night, alarm_system, access_rules`;

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
                s.alarm_system, s.access_rules
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
    const id = z.string().uuid().parse(req.params.id);
    const body = siteUpdateSchema.parse(req.body);

    const entries = Object.entries(body).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      res.status(400).json({ success: false, message: 'Keine aktualisierbaren Felder übermittelt.' });
      return;
    }

    const assignments = entries.map(([key], index) => `${SITE_COLUMNS[key]} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id, tenantId);

    const result = await withTenantTransaction(tenantId, (client) =>
      client.query(
        `UPDATE sites
            SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
          RETURNING ${SITE_SELECT}`,
        values
      )
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, message: 'Objekt nicht gefunden.' });
      return;
    }

    res.json({ success: true, message: 'Objekt aktualisiert', data: result.rows[0] });
  } catch (error) {
    next(error);
  }
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
    const id = z.string().uuid().parse(req.params.id);
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
