import { Request, Response, NextFunction } from 'express';
import { withTenantTransaction } from '../config/database';

/**
 * Tenant-scoped read endpoints for reference data used by the operational
 * modules. PostgreSQL/RLS remains the source of truth; no mock data is served.
 */

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
      client.query(
        `SELECT id, personnel_number, first_name, last_name, email, phone,
                role, status, weekly_hours, hourly_rate, date_of_joining
           FROM employees
          ORDER BY last_name, first_name`
      )
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}
