import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { env } from '../config/env';

/**
 * Migration-Runner: Verwendet dediziert DATABASE_MIGRATION_URL mit Admin-Rechten (secops_admin),
 * um Schemaänderungen und DDL auszuführen.
 */
export async function runMigrations(): Promise<void> {
  console.log('[MIGRATION] Verbinde mit Migrations-Datenbank...');
  const migrationPool = new Pool({
    connectionString: env.DATABASE_MIGRATION_URL,
    max: 2,
    connectionTimeoutMillis: 5000
  });

  const client = await migrationPool.connect();
  try {
    const roleCheck = await client.query('SELECT current_user, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user');
    const user = roleCheck.rows[0]?.current_user;
    console.log(`[MIGRATION] Ausführender Benutzer: '${user}'`);

    const sqlPath = path.join(__dirname, '001_initial_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[MIGRATION SUCCESS] Alle Tabellen, RLS-Policies und Least-Privilege-Rechte erfolgreich angewendet.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[MIGRATION FAILED]', error);
    throw error;
  } finally {
    client.release();
    await migrationPool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
