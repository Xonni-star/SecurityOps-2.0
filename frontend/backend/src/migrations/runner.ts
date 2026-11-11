import fs from 'fs';
import path from 'path';
import { migrationPool } from '../config/database';

/**
 * Führt Schema-Migrationen AUSSCHLIESSLICH über die administrative Verbindung aus.
 * Verwendet DATABASE_MIGRATION_URL (secops_admin).
 */
export async function runMigrations(): Promise<void> {
  console.log('[MIGRATION] Starte PostgreSQL 16+ DDL Migration via secops_admin...');
  const sqlPath = path.join(__dirname, '001_initial_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = await migrationPool.connect();
  try {
    await client.query(sql);
    console.log('[MIGRATION SUCCESS] Alle 24 Tabellen, Trigger und RLS-Policies erfolgreich angelegt.');
  } catch (error) {
    console.error('[MIGRATION FAILED]', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
