import { pool, withTenantTransaction } from '../config/database';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('PostgreSQL Row-Level Security (RLS) & Multi-Tenant Isolation', () => {
  afterAll(async () => {
    await pool.end();
  });

  test('Mandant A darf NIEMALS Kunden von Mandant B sehen', async () => {
    const clientsForA = await withTenantTransaction(TENANT_A, async (client) => {
      const res = await client.query('SELECT id, company_name, tenant_id FROM clients');
      return res.rows;
    });

    // Verifikation: Alle Datensätze müssen strikt zu Mandant A gehören
    expect(clientsForA.length).toBeGreaterThan(0);
    expect(clientsForA.every((c) => c.tenant_id === TENANT_A)).toBe(true);
    expect(clientsForA.some((c) => c.tenant_id === TENANT_B)).toBe(false);
  });

  test('Mandant B sieht ausschließlich eigene Daten', async () => {
    const clientsForB = await withTenantTransaction(TENANT_B, async (client) => {
      const res = await client.query('SELECT id, company_name, tenant_id FROM clients');
      return res.rows;
    });

    expect(clientsForB.length).toBeGreaterThan(0);
    expect(clientsForB.every((c) => c.tenant_id === TENANT_B)).toBe(true);
    expect(clientsForB.some((c) => c.tenant_id === TENANT_A)).toBe(false);
  });

  test('Cross-Tenant Composite Foreign Key Rejection: Objekt in A darf Kunden in B nicht referenzieren', async () => {
    // 1. Hole ID eines Kunden aus Mandant B
    const clientBId = await withTenantTransaction(TENANT_B, async (client) => {
      const res = await client.query('SELECT id FROM clients LIMIT 1');
      return res.rows[0].id;
    });

    // 2. Versuch, in Mandant A ein Objekt anzulegen, das auf Kunde B verweist
    await expect(
      withTenantTransaction(TENANT_A, async (client) => {
        return client.query(
          `INSERT INTO sites (tenant_id, client_id, site_code, name, address)
           VALUES ($1, $2, 'OBJ-ILLEGAL-01', 'Infiltrated Site', 'Verbotene Straße 1')`,
          [TENANT_A, clientBId]
        );
      })
    ).rejects.toThrow(); // PostgreSQL foreign key constraint violation
  });
});
