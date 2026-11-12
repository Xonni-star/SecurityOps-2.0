import argon2 from 'argon2';
import { pool, withTenantTransaction } from '../config/database';

export const TENANT_FRANKFURT_ID = '11111111-1111-1111-1111-111111111111';
export const TENANT_BAVARIA_ID = '22222222-2222-2222-2222-222222222222';

export async function seedDatabase(): Promise<void> {
  console.log('[SEED] Starte Datenbankbefüllung mit Testmandanten und isolierten Daten...');
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
    const roles = [
      'Systemadministrator',
      'Geschäftsführung',
      'Einsatzleitung',
      'Objektleitung',
      'Personalverwaltung',
      'Qualitätsmanagement',
      'Wachdienstmitarbeiter',
      'Auditor'
    ];

    for (const r of roles) {
      await client.query(
        'INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING;',
        [r, `Rolle ${r}`]
      );
    }

    // 3. Granulare Berechtigungen anlegen
    const permissions = [
      { code: 'customers:read', module: 'customers' },
      { code: 'customers:create', module: 'customers' },
      { code: 'customers:update', module: 'customers' },
      { code: 'customers:archive', module: 'customers' },
      { code: 'sites:read', module: 'sites' },
      { code: 'sites:create', module: 'sites' },
      { code: 'sites:update', module: 'sites' },
      { code: 'sites:archive', module: 'sites' },
      { code: 'sites:restore', module: 'sites' },
      { code: 'employees:read', module: 'employees' },
      { code: 'employees:manage', module: 'employees' },
      { code: 'employees:create', module: 'employees' },
      { code: 'employees:update', module: 'employees' },
      { code: 'employees:archive', module: 'employees' },
      { code: 'employees:restore', module: 'employees' },
      { code: 'qualifications:manage', module: 'employees' },
      { code: 'employees:absence:manage', module: 'employees' },
      { code: 'employees:absence:approve', module: 'employees' },
      { code: 'keys:read', module: 'keys' },
      { code: 'keys:manage', module: 'keys' },
      { code: 'tasks:read', module: 'tasks' },
      { code: 'tasks:manage', module: 'tasks' },
      { code: 'logbook:read', module: 'logbook' },
      { code: 'logbook:create', module: 'logbook' },
      { code: 'patrol:create', module: 'patrol' },
      { code: 'handover:create', module: 'handover' },
      { code: 'shifts:read', module: 'shifts' },
      { code: 'shifts:manage', module: 'shifts' },
      { code: 'documents:read', module: 'documents' },
      { code: 'documents:create', module: 'documents' },
      { code: 'documents:update', module: 'documents' },
      { code: 'documents:download', module: 'documents' },
      { code: 'documents:archive', module: 'documents' },
      { code: 'documents:restore', module: 'documents' },
      { code: 'documents:manage', module: 'documents' },
      { code: 'documents:approve', module: 'documents' },
      { code: 'sop:read', module: 'sop' },
      { code: 'sop:create', module: 'sop' },
      { code: 'sop:update', module: 'sop' },
      { code: 'sop:submit', module: 'sop' },
      { code: 'sop:review', module: 'sop' },
      { code: 'sop:approve', module: 'sop' },
      { code: 'sop:publish', module: 'sop' },
      { code: 'sop:assign', module: 'sop' },
      { code: 'sop:acknowledge', module: 'sop' },
      { code: 'sop:archive', module: 'sop' },
      { code: 'sop:manage', module: 'sop' },
      { code: 'alarm:read', module: 'alarm' },
      { code: 'alarm:manage', module: 'alarm' },
      { code: 'alarm:report', module: 'alarm' },
      { code: 'alarm:respond', module: 'alarm' }
    ];

    for (const p of permissions) {
      await client.query(
        'INSERT INTO permissions (code, module, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING;',
        [p.code, p.module, `Erlaubt ${p.code}`]
      );
    }

    // Berechtigungen der Rolle Einsatzleitung zuordnen
    const einsatzRole = await client.query("SELECT id FROM roles WHERE name = 'Einsatzleitung'");
    if (einsatzRole.rows.length > 0) {
      const eRoleId = einsatzRole.rows[0].id;
      for (const p of permissions) {
        const permRes = await client.query('SELECT id FROM permissions WHERE code = $1', [p.code]);
        if (permRes.rows.length > 0) {
          await client.query(
            'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;',
            [eRoleId, permRes.rows[0].id]
          );
        }
      }
    }

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      JOIN permissions p ON
        (r.name IN ('Systemadministrator', 'Geschäftsführung') AND p.code LIKE 'documents:%')
        OR (r.name = 'Qualitätsmanagement' AND p.code LIKE 'documents:%')
        OR (r.name = 'Personalverwaltung' AND p.code IN (
          'documents:read', 'documents:create', 'documents:update', 'documents:download',
          'documents:archive', 'documents:restore'
        ))
        OR (r.name IN ('Objektleitung', 'Wachdienstmitarbeiter', 'Auditor') AND p.code IN (
          'documents:read', 'documents:download'
        ))
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      JOIN permissions p ON
        (r.name IN ('Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Qualitätsmanagement')
          AND p.code LIKE 'alarm:%')
        OR (r.name IN ('Objektleitung', 'Wachdienstmitarbeiter')
          AND p.code IN ('alarm:read', 'alarm:report', 'alarm:respond'))
        OR (r.name = 'Auditor' AND p.code = 'alarm:read')
      ON CONFLICT DO NOTHING;
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      JOIN permissions p ON
        (r.name IN ('Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Qualitätsmanagement')
          AND p.code LIKE 'sop:%')
        OR (r.name = 'Personalverwaltung' AND p.code IN (
          'sop:read', 'sop:create', 'sop:update', 'sop:submit', 'sop:assign', 'sop:manage'
        ))
        OR (r.name IN ('Objektleitung', 'Wachdienstmitarbeiter') AND p.code IN (
          'sop:read', 'sop:acknowledge'
        ))
        OR (r.name = 'Auditor' AND p.code = 'sop:read')
      ON CONFLICT DO NOTHING;
    `);

    // 4. Testbenutzer mit echtem Argon2id Hash anlegen
    const testPassword = 'SecOpsVault2025SecurePassword!';
    const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });

    const userRes = await client.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, phone)
      VALUES ('a.schmidt@ffm-sec.de', $1, 'Alexander', 'Schmidt', '+49 171 4455881')
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      RETURNING id;
    `, [passwordHash]);

    const userId = userRes.rows[0].id;

    // Benutzer Mandant Frankfurt mit Rolle Einsatzleitung zuordnen
    if (einsatzRole.rows.length > 0) {
      await client.query(`
        INSERT INTO user_roles (user_id, role_id, tenant_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING;
      `, [userId, einsatzRole.rows[0].id, TENANT_FRANKFURT_ID]);
    }

    // 5. Daten für Mandant Frankfurt (Tenant A) innerhalb geschützter RLS-Transaktion anlegen
    await withTenantTransaction(TENANT_FRANKFURT_ID, async (tx) => {
      // Kunde
      await tx.query(`
        INSERT INTO clients (id, tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ('c1111111-1111-1111-1111-111111111111', $1, 'KUN-2024-001', 'MainTower Real Estate GmbH', 'Dr. Michael von Berg', 'm.vonberg@maintower-re.de', '+49 69 9820-110', 'Neue Mainzer Str. 52, 60311 Frankfurt', '2022-01-01', '2026-12-31')
        ON CONFLICT (id, tenant_id) DO NOTHING;
      `, [TENANT_FRANKFURT_ID]);

      // Objekt
      await tx.query(`
        INSERT INTO sites (id, tenant_id, client_id, site_code, name, address, security_level)
        VALUES ('b1111111-1111-1111-1111-111111111111', $1, 'c1111111-1111-1111-1111-111111111111', 'OBJ-FRA-01', 'Finanzturm Alpha (Hauptverwaltung)', 'Neue Mainzer Straße 52, 60311 Frankfurt', 'Hoch (KRITIS / BSI)')
        ON CONFLICT (id, tenant_id) DO NOTHING;
      `, [TENANT_FRANKFURT_ID]);

      // Mitarbeiter
      await tx.query(`
        INSERT INTO employees (id, tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
        VALUES ('e1111111-1111-1111-1111-111111111111', $1, 'MA-0104', 'Alexander', 'Schmidt', 'a.schmidt@ffm-sec.de', '+49 171 4455881', 'Einsatzleitung', '2020-03-01')
        ON CONFLICT (id, tenant_id) DO NOTHING;
      `, [TENANT_FRANKFURT_ID]);
    });

    // 6. Daten für Mandant Bavaria (Tenant B) innerhalb geschützter RLS-Transaktion anlegen
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
    .catch(() => {
      // Do not emit database errors that can contain data or connection details.
      console.error('[SEED FAILED] Seed process aborted; exception details were suppressed.');
      process.exit(1);
    });
}
