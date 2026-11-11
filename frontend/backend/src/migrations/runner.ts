import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Client } from 'pg';
import { env } from '../config/env';

/**
 * Versionssicherer PostgreSQL-Migrationsrunner.
 *
 * - Führt Migrationen genau einmal aus und protokolliert sie in `schema_migrations`.
 * - Prüft SHA-256-Prüfsummen bereits ausgeführter Migrationen.
 * - Führt jede Migration in einer eigenen Transaktion aus.
 * - Serialisiert konkurrierende Runner über einen PostgreSQL Advisory Lock.
 * - Erkennt bestehende Datenbanken (001–004) und übernimmt sie als Baseline,
 *   ohne die Migrationen erneut auszuführen.
 */

const HISTORY_TABLE = 'schema_migrations';
const ADVISORY_LOCK_KEY = 2026111101;
const BASELINE_MAX_VERSION = 4;

const MIGRATION_FILE_PATTERN = /^(\d+)_([A-Za-z0-9][A-Za-z0-9._-]*)\.sql$/;

export interface MigrationFile {
  version: string;
  numericVersion: number;
  filename: string;
  filePath: string;
  checksum: string;
  sql: string;
}

export interface MigrationRunnerOptions {
  connectionString?: string;
  migrationsDir?: string;
  logger?: (message: string) => void;
}

export interface MigrationRunResult {
  applied: string[];
  baselined: string[];
  skipped: string[];
}

const DEFAULT_EXPECTED_TABLES = [
  'tenants',
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'user_sessions',
  'clients',
  'sites',
  'employees',
  'employee_qualifications',
  'shifts',
  'guardbook_entries',
  'guardbook_revisions',
  'keys',
  'tasks',
  'patrol_scans',
  'shift_handovers',
  'sync_idempotency_receipts',
  'sync_conflict_resolution_receipts',
  'audit_logs'
];

const EXPECTED_COLUMNS: Array<[string, string]> = [
  ['shifts', 'revision_version'],
  ['tasks', 'revision_version'],
  ['keys', 'revision_version'],
  ['clients', 'client_mutation_id'],
  ['sites', 'client_mutation_id'],
  ['employees', 'client_mutation_id'],
  ['shifts', 'client_mutation_id'],
  ['guardbook_entries', 'client_mutation_id'],
  ['guardbook_revisions', 'client_mutation_id'],
  ['keys', 'client_mutation_id'],
  ['tasks', 'client_mutation_id'],
  ['patrol_scans', 'client_mutation_id'],
  ['shift_handovers', 'client_mutation_id'],
  ['sync_idempotency_receipts', 'client_mutation_id'],
  ['sync_conflict_resolution_receipts', 'client_mutation_id']
];

const EXPECTED_CONSTRAINTS = [
  'uq_shifts_client_mutation',
  'uq_tasks_client_mutation',
  'uq_keys_client_mutation',
  'uq_guardbook_client_mutation',
  'uq_revisions_client_mutation',
  'uq_patrol_client_mutation',
  'uq_handover_client_mutation'
];

const EXPECTED_FUNCTIONS = ['prevent_guardbook_tampering', 'prevent_revision_tampering'];

const EXPECTED_TRIGGERS = ['trg_guardbook_entries_immutable', 'trg_guardbook_revisions_immutable'];

const EXPECTED_RLS_TABLES = [
  'clients',
  'sites',
  'employees',
  'employee_qualifications',
  'shifts',
  'guardbook_entries',
  'guardbook_revisions',
  'keys',
  'tasks',
  'patrol_scans',
  'shift_handovers',
  'sync_idempotency_receipts',
  'sync_conflict_resolution_receipts',
  'audit_logs'
];

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function loadMigrations(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrationsverzeichnis existiert nicht: ${migrationsDir}`);
  }

  const filenames = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (filenames.length === 0) {
    throw new Error(`Keine Migrationsdateien in ${migrationsDir} gefunden.`);
  }

  const migrations: MigrationFile[] = [];
  const seenVersions = new Map<number, string>();

  for (const filename of filenames) {
    const match = filename.match(MIGRATION_FILE_PATTERN);
    if (!match) {
      throw new Error(
        `Ungültiger Migrationsdateiname: "${filename}". Erwartet wird "<Version>_<Name>.sql", z. B. "005_neue_tabelle.sql".`
      );
    }

    const numericVersion = parseInt(match[1], 10);
    if (!Number.isSafeInteger(numericVersion) || numericVersion <= 0) {
      throw new Error(`Ungültige Migrationsversion in "${filename}".`);
    }

    const duplicate = seenVersions.get(numericVersion);
    if (duplicate) {
      throw new Error(
        `Doppelte Migrationsversion ${match[1]}: "${duplicate}" und "${filename}" beanspruchen dieselbe Version.`
      );
    }
    seenVersions.set(numericVersion, filename);

    const filePath = path.join(migrationsDir, filename);
    const content = fs.readFileSync(filePath);

    migrations.push({
      version: match[1],
      numericVersion,
      filename,
      filePath,
      checksum: sha256(content),
      sql: content.toString('utf8')
    });
  }

  return migrations.sort((a, b) => a.numericVersion - b.numericVersion);
}

async function ensureHistoryTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

interface AppliedMigrationRow {
  version: string;
  filename: string;
  checksum: string;
}

async function readAppliedMigrations(client: Client): Promise<AppliedMigrationRow[]> {
  const result = await client.query<AppliedMigrationRow>(
    `SELECT version, filename, checksum FROM ${HISTORY_TABLE} ORDER BY version`
  );
  return result.rows;
}

function verifyAppliedMigrations(applied: AppliedMigrationRow[], migrations: MigrationFile[]): void {
  const byVersion = new Map(migrations.map((migration) => [migration.numericVersion, migration]));

  for (const row of applied) {
    const numericVersion = parseInt(row.version, 10);
    const migration = byVersion.get(numericVersion);

    if (!migration) {
      throw new Error(
        `Die Datenbank enthält die bereits angewendete Migration "${row.version}" (${row.filename}), ` +
          `die im Repository nicht mehr vorhanden ist. Abbruch, um inkonsistente Zustände zu vermeiden.`
      );
    }

    if (migration.checksum !== row.checksum) {
      throw new Error(
        `Migration ${migration.filename} wurde nachträglich verändert. ` +
          `Erwartete SHA-256: ${migration.checksum}, gespeichert: ${row.checksum}. ` +
          `Bereits ausgeführte Migrationen dürfen nicht umgeschrieben werden.`
      );
    }
  }
}

interface SchemaInspection {
  existingTables: string[];
  missingTables: string[];
  missingColumns: string[];
  missingConstraints: string[];
  missingFunctions: string[];
  missingTriggers: string[];
  missingRls: string[];
  privilegeProblems: string[];
}

async function inspectSchema(client: Client): Promise<SchemaInspection> {
  const tableResult = await client.query<{ name: string; present: boolean }>(
    `SELECT t AS name, to_regclass('public.' || quote_ident(t)) IS NOT NULL AS present
       FROM unnest($1::text[]) AS t`,
    [DEFAULT_EXPECTED_TABLES]
  );
  const existingTables = tableResult.rows.filter((row) => row.present).map((row) => row.name);
  const missingTables = tableResult.rows.filter((row) => !row.present).map((row) => row.name);

  const columnResult = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`
  );
  const existingColumns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = EXPECTED_COLUMNS.filter(([table, column]) => !existingColumns.has(`${table}.${column}`)).map(
    ([table, column]) => `${table}.${column}`
  );

  const constraintResult = await client.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`,
    [EXPECTED_CONSTRAINTS]
  );
  const existingConstraints = new Set(constraintResult.rows.map((row) => row.conname));
  const missingConstraints = EXPECTED_CONSTRAINTS.filter((name) => !existingConstraints.has(name));

  const functionResult = await client.query<{ proname: string }>(
    `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
    [EXPECTED_FUNCTIONS]
  );
  const existingFunctions = new Set(functionResult.rows.map((row) => row.proname));
  const missingFunctions = EXPECTED_FUNCTIONS.filter((name) => !existingFunctions.has(name));

  const triggerResult = await client.query<{ tgname: string }>(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($1::text[])`,
    [EXPECTED_TRIGGERS]
  );
  const existingTriggers = new Set(triggerResult.rows.map((row) => row.tgname));
  const missingTriggers = EXPECTED_TRIGGERS.filter((name) => !existingTriggers.has(name));

  const rlsResult = await client.query<{ relname: string; relrowsecurity: boolean }>(
    `SELECT c.relname, c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [EXPECTED_RLS_TABLES]
  );
  const rlsEnabled = new Set(rlsResult.rows.filter((row) => row.relrowsecurity).map((row) => row.relname));
  const missingRls = EXPECTED_RLS_TABLES.filter((name) => !rlsEnabled.has(name));

  const privilegeProblems: string[] = [];
  const roleResult = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'secops_app_user'`);
  if (roleResult.rowCount === 0) {
    privilegeProblems.push('Rolle secops_app_user fehlt');
  } else if (missingTables.length === 0) {
    // has_table_privilege() wirft, wenn die Tabelle nicht existiert.
    // Bei fehlenden Tabellen ist der Zustand ohnehin unvollständig.
    const privilegeResult = await client.query<{
      shifts_delete: boolean;
      tasks_delete: boolean;
      guardbook_delete: boolean;
      guardbook_select: boolean;
    }>(`
      SELECT
        has_table_privilege('secops_app_user', 'public.shifts', 'DELETE') AS shifts_delete,
        has_table_privilege('secops_app_user', 'public.tasks', 'DELETE') AS tasks_delete,
        has_table_privilege('secops_app_user', 'public.guardbook_entries', 'DELETE') AS guardbook_delete,
        has_table_privilege('secops_app_user', 'public.guardbook_entries', 'SELECT') AS guardbook_select
    `);

    const row = privilegeResult.rows[0];
    if (!row.shifts_delete) privilegeProblems.push('DELETE auf shifts fehlt');
    if (!row.tasks_delete) privilegeProblems.push('DELETE auf tasks fehlt');
    if (row.guardbook_delete) privilegeProblems.push('DELETE auf guardbook_entries darf nicht vergeben sein');
    if (!row.guardbook_select) privilegeProblems.push('SELECT auf guardbook_entries fehlt');
  }

  return {
    existingTables,
    missingTables,
    missingColumns,
    missingConstraints,
    missingFunctions,
    missingTriggers,
    missingRls,
    privilegeProblems
  };
}

async function executeMigrationInTransaction(client: Client, migration: MigrationFile): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO ${HISTORY_TABLE} (version, filename, checksum) VALUES ($1, $2, $3)`,
      [migration.version, migration.filename, migration.checksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback-Fehler dürfen den ursprünglichen Fehler nicht verdecken.
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration ${migration.filename} ist fehlgeschlagen und wurde zurückgerollt: ${reason}`);
  }
}

function describeInspection(inspection: SchemaInspection): string {
  const parts: string[] = [];
  if (inspection.missingTables.length > 0) parts.push(`fehlende Tabellen: ${inspection.missingTables.join(', ')}`);
  if (inspection.missingColumns.length > 0) parts.push(`fehlende Spalten: ${inspection.missingColumns.join(', ')}`);
  if (inspection.missingConstraints.length > 0)
    parts.push(`fehlende Constraints: ${inspection.missingConstraints.join(', ')}`);
  if (inspection.missingFunctions.length > 0)
    parts.push(`fehlende Funktionen: ${inspection.missingFunctions.join(', ')}`);
  if (inspection.missingTriggers.length > 0) parts.push(`fehlende Trigger: ${inspection.missingTriggers.join(', ')}`);
  if (inspection.missingRls.length > 0) parts.push(`RLS nicht aktiv: ${inspection.missingRls.join(', ')}`);
  if (inspection.privilegeProblems.length > 0)
    parts.push(`Rechteprobleme: ${inspection.privilegeProblems.join(', ')}`);
  return parts.join('; ');
}

export async function runMigrations(options: MigrationRunnerOptions = {}): Promise<MigrationRunResult> {
  const logger = options.logger ?? ((message: string) => console.log(message));
  const migrationsDir = options.migrationsDir ?? __dirname;
  const connectionString = options.connectionString ?? env.DATABASE_MIGRATION_URL;

  const migrations = loadMigrations(migrationsDir);
  const client = new Client({ connectionString });

  const applied: string[] = [];
  const baselined: string[] = [];
  const skipped: string[] = [];

  await client.connect();
  try {
    logger('[MIGRATION] Warte auf exklusiven Advisory Lock…');
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    logger('[MIGRATION] Advisory Lock erhalten.');

    await ensureHistoryTable(client);

    const appliedRows = await readAppliedMigrations(client);
    verifyAppliedMigrations(appliedRows, migrations);

    const appliedVersions = new Set(appliedRows.map((row) => parseInt(row.version, 10)));

    if (appliedRows.length === 0) {
      const inspection = await inspectSchema(client);

      if (inspection.existingTables.length === 0) {
        logger('[MIGRATION] Leere Datenbank erkannt – alle Migrationen werden angewendet.');
      } else {
        const complete = describeInspection(inspection) === '';

        if (!complete) {
          throw new Error(
            'Bestehende Datenbank ist nicht eindeutig als Stand nach Migration 004 erkennbar. ' +
              `Gefundene Objekte: ${inspection.existingTables.length} von ${DEFAULT_EXPECTED_TABLES.length} Tabellen. ` +
              `Details: ${describeInspection(inspection)}. ` +
              'Abbruch, um Migrationen nicht blind als ausgeführt zu markieren.'
          );
        }

        const baselineMigrations = migrations.filter(
          (migration) => migration.numericVersion <= BASELINE_MAX_VERSION
        );

        if (baselineMigrations.length === 0) {
          throw new Error('Keine Baseline-Migrationen (001–004) im Repository gefunden.');
        }

        await client.query('BEGIN');
        try {
          for (const migration of baselineMigrations) {
            await client.query(
              `INSERT INTO ${HISTORY_TABLE} (version, filename, checksum) VALUES ($1, $2, $3)`,
              [migration.version, migration.filename, migration.checksum]
            );
            appliedVersions.add(migration.numericVersion);
            baselined.push(migration.version);
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`Baseline-Übernahme fehlgeschlagen: ${reason}`);
        }

        logger(
          `[MIGRATION] Bestehende Datenbank erkannt. Migrationen 001–004 als Baseline übernommen: ${baselined.join(', ')}`
        );
      }
    }

    for (const migration of migrations) {
      if (appliedVersions.has(migration.numericVersion)) {
        skipped.push(migration.version);
        continue;
      }

      logger(`[MIGRATION] Führe ${migration.filename} aus…`);
      await executeMigrationInTransaction(client, migration);
      applied.push(migration.version);
      appliedVersions.add(migration.numericVersion);
      logger(`[MIGRATION] ${migration.filename} erfolgreich angewendet.`);
    }

    if (baselined.length === 0 && applied.length === 0) {
      logger('[MIGRATION] Datenbank ist bereits aktuell. Keine Migration ausgeführt.');
    }

    return { applied, baselined, skipped };
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      // Verbindung kann bereits geschlossen sein.
    }
    await client.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then((result) => {
      console.log(
        `[MIGRATION SUCCESS] Angewendet: ${result.applied.length}, Baseline: ${result.baselined.length}, Übersprungen: ${result.skipped.length}`
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error('[MIGRATION FAILED]', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
