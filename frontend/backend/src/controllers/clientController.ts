import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';

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

export async function listClients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;

    const result = await withTenantTransaction(tenantId, async (client) => {
      // RLS Policy greift automatisch über app.current_tenant
      return client.query(
        'SELECT id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end, sla_level, billing_status FROM clients ORDER BY company_name'
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
