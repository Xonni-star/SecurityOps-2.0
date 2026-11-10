import { pool, withTenantTransaction } from '../config/database';
import argon2 from 'argon2';

export const TENANT_FRANKFURT_ID = '11111111-1111-1111-1111-111111111111';
export const TENANT_BAVARIA_ID = '22222222-2222-2222-2222-222222222222';

export async function seedDatabase(): Promise<void> {
  console.log('[SEED] Befülle Datenbank mit Testmandanten und -daten...');
  const client = await pool.connect();

  try {
    // 1. Mandanten erstellen
    await client.query(`
      INSERT INTO tenants (id, name, subdomain, tax_number, license_tier, bwr_register_id, din77200_certified)
      VALUES 
        ($1, 'Securitas & Wache Frankfurt GmbH', 'ffm-sec.securityops.de', 'DE301928374', 'ENTERPRISE', 'BWR-HE-99201', true),
        ($2, 'Bavaria Schutz & Werkschutz AG', 'bavaria.securityops.de', 'DE819203948', 'PROFESSIONAL', 'BWR-BY-11029', true)
      ON CONFLICT (id) DO NOTHING;
    `, [TENANT_FRANKFURT_ID, TENANT_BAVARIA_ID]);

    // 2. Rollen anlegen
    await client.query(`
      INSERT INTO roles (name, description) VALUES
        ('Systemadministrator', 'Volle administrative Kontrolle'),
        ('Geschäftsführung', 'Unternehmensleitung und Freigaben'),
        ('Einsatzleitung', 'Operative Schichtdisposition und Wachbuch'),
        ('Objektleitung', 'Standortbezogene Steuerung'),
        ('Personalverwaltung', 'HR und BWR Qualifikationen'),
        ('Qualitätsmanagement', 'DIN 77200 QM und Anweisungen'),
        ('Wachdienstmitarbeiter', 'Wachkraft vor Ort'),
        ('Lesender Zugriff / Auditor', 'Audit und Einsicht')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 3. Benutzer anlegen (Passwort gehasht mit Argon2id)
    const passwordHash = await argon2.hash('SecOpsVault2025SecurePassword!', { type: argon2.argon2id });

    const userSchmidt = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, phone)
      VALUES ('a.schmidt@ffm-sec.de', $1, 'Alexander', 'Schmidt', '+49 171 4455881')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      RETURNING id;
    `, [passwordHash]);

    const userHuber = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, phone)
      VALUES ('m.huber@bavaria-schutz.de', $1, 'Maximilian', 'Huber', '+49 89 5544332')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      RETURNING id;
    `, [passwordHash]);

    // 4. Mandant Frankfurt Daten befüllen
    await withTenantTransaction(TENANT_FRANKFURT_ID, async (tx) => {
      // Kunde
      const custRes = await tx.query(`
        INSERT INTO clients (id, tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ('c1111111-1111-1111-1111-111111111111', $1, 'KUN-2024-001', 'MainTower Real Estate GmbH', 'Dr. Michael von Berg', 'm.vonberg@maintower-re.de', '+49 69 9820-110', 'Neue Mainzer Str. 52, 60311 Frankfurt', '2022-01-01', '2026-12-31')
        ON CONFLICT (id, tenant_id) DO NOTHING
        RETURNING id;
      `, [TENANT_FRANKFURT_ID]);

      // Objekt
      await tx.query(`
        INSERT INTO sites (id, tenant_id, client_id, site_code, name, address, security_level)
        VALUES ('s1111111-1111-1111-1111-111111111111', $1, 'c1111111-1111-1111-1111-111111111111', 'OBJ-FRA-01', 'Finanzturm Alpha (Hauptverwaltung)', 'Neue Mainzer Straße 52, 60311 Frankfurt', 'Hoch (KRITIS / BSI)')
        ON CONFLICT (id, tenant_id) DO NOTHING;
      `, [TENANT_FRANKFURT_ID]);

      // Mitarbeiter
      await tx.query(`
        INSERT INTO employees (id, tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
        VALUES ('e1111111-1111-1111-1111-111111111111', $1, 'MA-0104', 'Alexander', 'Schmidt', 'a.schmidt@ffm-sec.de', '+49 171 4455881', 'Einsatzleitung', '2020-03-01')
        ON CONFLICT (id, tenant_id) DO NOTHING;
      `, [TENANT_FRANKFURT_ID]);
    });

    // 5. Mandant Bavaria Daten befüllen
    await withTenantTransaction(TENANT_BAVARIA_ID, async (tx) => {
      await tx.query(`
        INSERT INTO clients (id, tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ('c2222222-2222-2222-2222-222222222222', $1, 'KUN-BAV-101', 'BioPharm Innovations AG (KRITIS)', 'Christian Lindner-Sachs', 'security@biopharm.eu', '+49 89 4522-890', 'Am Klopferspitz 19, 82152 Planegg', '2021-08-01', '2027-07-31')
        ON CONFLICT (id, tenant_id) DO NOTHING;
      `, [TENANT_BAVARIA_ID]);
    });

    console.log('[SEED SUCCESS] Mandanten Frankfurt und Bavaria mit isolierten Daten befüllt.');
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
