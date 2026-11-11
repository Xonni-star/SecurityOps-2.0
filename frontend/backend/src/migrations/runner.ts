import fs from 'fs';
import path from 'path';
import { migrationPool } from '../config/database';

/**
 * Führt alle DDL-Migrationen in aufsteigender Dateireihenfolge
 * AUSSCHLIESSLICH über die administrative Verbindung (DATABASE_MIGRATION_URL) aus.
 */
export async function runMigrations(): Promise<void> {
  console.log('[MIGRATION] Starte PostgreSQL 16+ DDL Migrationen via secops_admin...');
  const migrationsDir = path.join(__dirname);
  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = await migrationPool.connect();
  try {
    for (const file of files) {
      console.log(`[MIGRATION] Führe ${file} aus...`);
      const sqlPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query(sql);
    }
    console.log('[MIGRATION SUCCESS] Alle Migrationen erfolgreich angewendet.');
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
