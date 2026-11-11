import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { pool, withTenantTransaction } from '../config/database';
import { env } from '../config/env';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('SecurityOps 2.0 - Phase 1 Backend & PostgreSQL Integration Tests', () => {
  afterAll(async () => {
    await pool.end();
  });

  // 1. Datenbankverbindung
  test('PostgreSQL-Pool ist erreichbar und antwortet', async () => {
    const res = await pool.query('SELECT 1 as connected');
    expect(res.rows[0].connected).toBe(1);
  });

  // 2. Passwort-Hashing mit Argon2id
  test('Passwort wird mit echtem Argon2id gehasht und verifiziert', async () => {
    const rawPass = 'SecOpsVault2025SecurePassword!';
    const hash = await argon2.hash(rawPass, { type: argon2.argon2id });
    expect(hash.startsWith('$argon2id$')).toBe(true);

    const valid = await argon2.verify(hash, rawPass);
    expect(valid).toBe(true);

    const invalid = await argon2.verify(hash, 'FalschesPasswort123!');
    expect(invalid).toBe(false);
  });

  // 3. PostgreSQL Row-Level Security: Leseisolation
  test('Mandant A darf NIEMALS Kunden von Mandant B lesen', async () => {
    const clientsForA = await withTenantTransaction(TENANT_A, async (client) => {
      const res = await client.query('SELECT id, company_name, tenant_id FROM clients');
      return res.rows;
    });

    expect(clientsForA.length).toBeGreaterThan(0);
    expect(clientsForA.every((c) => c.tenant_id === TENANT_A)).toBe(true);
    expect(clientsForA.some((c) => c.tenant_id === TENANT_B)).toBe(false);
  });

  // 4. PostgreSQL Row-Level Security: Schreibisolation
  test('Mandant A darf keine Datensätze für Mandant B manipulieren oder anlegen', async () => {
    // Versuch, als Mandant A einen Kunden für Mandant B anzulegen
    await expect(
      withTenantTransaction(TENANT_A, async (client) => {
        return client.query(
          `INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
           VALUES ($1, 'KUN-HACK-01', 'Infiltrated Client', 'Spion', 'spion@dark.net', '+49 000', 'Adresse', '2025-01-01', '2026-01-01')`,
          [TENANT_B] // Fremder Mandant!
        );
      })
    ).rejects.toThrow(); // RLS WITH CHECK policy violation
  });

  // 5. Composite Foreign Key Schutz
  test('Composite Foreign Key Rejection: Objekt in A darf Kunden in B nicht referenzieren', async () => {
    // Hole ID eines Kunden aus Mandant B
    const clientBId = await withTenantTransaction(TENANT_B, async (client) => {
      const res = await client.query('SELECT id FROM clients LIMIT 1');
      return res.rows[0].id;
    });

    // Versuch, in Mandant A ein Objekt anzulegen, das auf Kunde B verweist
    await expect(
      withTenantTransaction(TENANT_A, async (client) => {
        return client.query(
          `INSERT INTO sites (tenant_id, client_id, site_code, name, address)
           VALUES ($1, $2, 'OBJ-ILLEGAL-99', 'Infiltrated Site', 'Verbotene Straße 1')`,
          [TENANT_A, clientBId]
        );
      })
    ).rejects.toThrow(); // PostgreSQL foreign key constraint violation
  });

  // 6. Wachbuch-Idempotenz
  test('Wachbucheinträge mit identischer client_mutation_id werden idempotent behandelt', async () => {
    const mutationId = `mut-test-${Date.now()}`;

    // Hole ein echtes Objekt und Mitarbeiter aus Mandant A
    const { siteId, guardId } = await withTenantTransaction(TENANT_A, async (client) => {
      const siteRes = await client.query('SELECT id FROM sites LIMIT 1');
      const empRes = await client.query('SELECT id FROM employees LIMIT 1');
      return { siteId: siteRes.rows[0].id, guardId: empRes.rows[0].id };
    });

    // Erste Einfügung
    await withTenantTransaction(TENANT_A, async (client) => {
      return client.query(
        `INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, client_mutation_id)
         VALUES ($1, $2, $3, 'Routinemeldung', 'Normal', 'Idempotenz-Test', 'Erster Durchlauf', $4)`,
        [TENANT_A, siteId, guardId, mutationId]
      );
    });

    // Zweite Einfügung mit gleicher client_mutation_id muss durch UNIQUE Constraint abgewiesen werden
    await expect(
      withTenantTransaction(TENANT_A, async (client) => {
        return client.query(
          `INSERT INTO guardbook_entries (tenant_id, site_id, guard_id, category, priority, title, description, client_mutation_id)
           VALUES ($1, $2, $3, 'Routinemeldung', 'Normal', 'Idempotenz-Test', 'Zweiter Durchlauf', $4)`,
          [TENANT_A, siteId, guardId, mutationId]
        );
      })
    ).rejects.toThrow();
  });
});
