import { pool, migrationPool, withTenantTransaction, withSystemTransaction } from '../config/database';
import { cleanupTestData } from './testUtils';

describe('PostgreSQL Row-Level Security (RLS) & Multi-Tenant Isolation', () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const tA = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('RLS Test Mandant A', $1, 'DE-RLS-A', 'BWR-RLS-A') RETURNING id;
    `, [`rls-a-${Date.now()}`]);
    tenantA = tA.rows[0].id;

    const tB = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('RLS Test Mandant B', $1, 'DE-RLS-B', 'BWR-RLS-B') RETURNING id;
    `, [`rls-b-${Date.now()}`]);
    tenantB = tB.rows[0].id;

    await withTenantTransaction(tenantA, async (tx) => {
      await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'K-A-1', 'A GmbH', 'Hr. A', 'a@a.de', '01', 'Adr A', '2025-01-01', '2026-01-01');
      `, [tenantA]);
    });

    await withTenantTransaction(tenantB, async (tx) => {
      await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'K-B-1', 'B GmbH', 'Hr. B', 'b@b.de', '02', 'Adr B', '2025-01-01', '2026-01-01');
      `, [tenantB]);
    });
  });

  afterAll(async () => {
    // Administrative Bereinigung inkl. Append-Only-Trigger (nur Testdatenbank).
    await cleanupTestData([tenantA, tenantB]);
    await pool.end();
    await migrationPool.end();
  });

  test('Mandant A sieht keine Daten von Mandant B', async () => {
    const res = await withTenantTransaction(tenantA, async (tx) => {
      return (await tx.query('SELECT * FROM clients')).rows;
    });

    expect(res.length).toBeGreaterThan(0);
    expect(res.every((c) => c.tenant_id === tenantA)).toBe(true);
    expect(res.some((c) => c.tenant_id === tenantB)).toBe(false);
  });

  test('Systemabfrage ohne Tenant-Kontext liefert 0 mandantenspezifische Datensätze', async () => {
    const res = await withSystemTransaction(async (tx) => {
      return (await tx.query('SELECT * FROM clients')).rows;
    });
    expect(res.length).toBe(0);
  });
});
