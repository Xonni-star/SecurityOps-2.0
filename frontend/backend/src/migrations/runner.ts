import fs from 'fs';
import path from 'path';
import { pool } from '../config/database';

export async function runMigrations(): Promise<void> {
  console.log('[MIGRATION] Starte PostgreSQL 16+ DDL Migration...');
  const sqlPath = path.join(__dirname, '001_initial_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('[MIGRATION SUCCESS] Alle 24 Tabellen und RLS-Policies erfolgreich angelegt.');
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
