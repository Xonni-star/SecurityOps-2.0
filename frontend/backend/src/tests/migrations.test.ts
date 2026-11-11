import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client } from 'pg';
import { runMigrations } from '../migrations/runner';
import { env } from '../config/env';

jest.setTimeout(180000);

const REAL_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const createdDatabases: string[] = [];
const tempDirs: string[] = [];
const noopLogger = () => {};

function withDatabaseName(name: string): string {
  const url = new URL(env.DATABASE_MIGRATION_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createTestDatabase(): Promise<string> {
  const name = `secops_migtest_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const admin = new Client({ connectionString: withDatabaseName('postgres') });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  createdDatabases.push(name);
  return name;
}

async function dropTestDatabase(name: string): Promise<void> {
  const admin = new Client({ connectionString: withDatabaseName('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

async function queryInDatabase<T extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = new Client({ connectionString: withDatabaseName(name) });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

function makeMigrationsDir(extraFiles: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secops-migrations-'));
  fs.cpSync(REAL_MIGRATIONS_DIR, dir, { recursive: true });
  for (const [filename, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, filename), content);
  }
  tempDirs.push(dir);
  return dir;
}

async function historyRows(dbName: string): Promise<Array<{ version: string; filename: string; checksum: string }>> {
  return queryInDatabase(dbName, 'SELECT version, filename, checksum FROM schema_migrations ORDER BY version');
}

async function tableExists(dbName: string, table: string): Promise<boolean> {
  const rows = await queryInDatabase<{ present: boolean }>(
    dbName,
    `SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL AS present`,
    [table]
  );
  return rows[0].present;
}

afterEach(async () => {
  for (const name of createdDatabases.splice(0)) {
    await dropTestDatabase(name);
  }
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SecurityOps 2.0 – Versionssicherer Migrationsrunner', () => {
  test('1. Erster Lauf wendet alle Migrationen an und protokolliert sie', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    const result = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(result.applied).toEqual(['001', '002', '003', '004']);
    expect(result.baselined).toEqual([]);

    const history = await historyRows(db);
    expect(history.map((row) => row.version)).toEqual(['001', '002', '003', '004']);
    expect(history.every((row) => /^[0-9a-f]{64}$/.test(row.checksum))).toBe(true);
    expect(await tableExists(db, 'sync_conflict_resolution_receipts')).toBe(true);
  });

  test('2. Zweiter Lauf führt keine Migration erneut aus', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    const before = await historyRows(db);

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(second.applied).toEqual([]);
    expect(second.baselined).toEqual([]);
    expect(second.skipped).toEqual(['001', '002', '003', '004']);

    const after = await historyRows(db);
    expect(after).toEqual(before);
  });

  test('3. Neue Migration wird erkannt und angewendet', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });

    fs.writeFileSync(path.join(dir, '005_neue_marker_tabelle.sql'), 'CREATE TABLE migration_marker_005 (id INT);\n');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(second.applied).toEqual(['005']);
    expect(await tableExists(db, 'migration_marker_005')).toBe(true);

    const history = await historyRows(db);
    expect(history.map((row) => row.version)).toEqual(['001', '002', '003', '004', '005']);
  });

  test('4. Fehlerhafte Migration wird nicht registriert und zurückgerollt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '005_fehlerhaft.sql': 'CREATE TABLE migration_failure_marker (id INT);\nSELECT * FROM tabelle_die_nicht_existiert;\n'
    });

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/fehlgeschlagen und wurde zurückgerollt/);

    const history = await historyRows(db);
    expect(history.map((row) => row.version)).toEqual(['001', '002', '003', '004']);
    expect(await tableExists(db, 'migration_failure_marker')).toBe(false);
  });

  test('5. Nachträglich geänderte Migration wird abgelehnt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });

    const file = path.join(dir, '001_initial_schema.sql');
    fs.appendFileSync(file, '\n-- nachträgliche Änderung\n');

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/nachträglich verändert/);
  });

  test('6. Gleichzeitige Runner werden serialisiert und wenden jede Migration einmal an', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '005_langsam.sql': 'SELECT pg_sleep(1);\nCREATE TABLE concurrency_marker (id INT);\n'
    });

    const [first, second] = await Promise.all([
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger }),
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ]);

    const appliedFive = [first, second].filter((result) => result.applied.includes('005'));
    expect(appliedFive).toHaveLength(1);

    const rows = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations WHERE version = '005'`
    );
    expect(rows[0].count).toBe('1');
    expect(await tableExists(db, 'concurrency_marker')).toBe(true);
  });

  test('7. Bestehende Datenbank mit 001–004 wird als Baseline übernommen', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });

    await queryInDatabase(
      db,
      `INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
       VALUES ('Baseline-Test', 'baseline-test', 'DE-BASE-1', 'BWR-BASE-1')`
    );
    await queryInDatabase(db, 'DROP TABLE schema_migrations');

    const result = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(result.applied).toEqual([]);
    expect(result.baselined).toEqual(['001', '002', '003', '004']);

    const tenants = await queryInDatabase<{ name: string }>(db, 'SELECT name FROM tenants');
    expect(tenants.some((row) => row.name === 'Baseline-Test')).toBe(true);

    const history = await historyRows(db);
    expect(history.map((row) => row.version)).toEqual(['001', '002', '003', '004']);
  });

  test('8. Unvollständige Baseline führt zu sicherem Abbruch', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    const sql001 = fs.readFileSync(path.join(REAL_MIGRATIONS_DIR, '001_initial_schema.sql'), 'utf8');

    await queryInDatabase(db, sql001);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/nicht exakt|nicht eindeutig|unvollständig/);

    const history = await historyRows(db);
    expect(history).toHaveLength(0);
  });

  test('9. Doppelte und ungültige Versionskennungen werden erkannt', async () => {
    const duplicateDir = makeMigrationsDir({
      '005_erste.sql': 'CREATE TABLE dup_a (id INT);',
      '005_zweite.sql': 'CREATE TABLE dup_b (id INT);'
    });

    await expect(
      runMigrations({ connectionString: withDatabaseName(await createTestDatabase()), migrationsDir: duplicateDir, logger: noopLogger })
    ).rejects.toThrow(/Doppelte Migrationsversion/);

    const invalidDir = makeMigrationsDir({ 'ungueltig.sql': 'CREATE TABLE invalid (id INT);' });

    await expect(
      runMigrations({ connectionString: withDatabaseName(await createTestDatabase()), migrationsDir: invalidDir, logger: noopLogger })
    ).rejects.toThrow(/Ungültiger Migrationsdateiname/);
  });

  async function createFullBaselineDatabase(): Promise<{ db: string; dir: string }> {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    return { db, dir };
  }

  /** Entfernt die Historie, damit der Runner den Ist-Zustand erneut als Baseline prüfen muss. */
  async function expectBaselineRejected(db: string, dir: string, pattern: RegExp): Promise<void> {
    await queryInDatabase(db, 'DROP TABLE schema_migrations');
    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(pattern);
  }

  test('10. Fehlende RLS-Policy verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'DROP POLICY tenant_isolation_permissive ON clients');

    await expectBaselineRejected(db, dir, /RLS-Policy fehlt: clients/);
  });

  test('11. Veränderte RLS-Policy verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `DROP POLICY tenant_isolation_permissive ON clients;
       CREATE POLICY tenant_isolation_permissive ON clients
         AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);`
    );

    await expectBaselineRejected(db, dir, /RLS-Policy clients: USING-Ausdruck weicht ab/);
  });

  test('12. Trigger an falscher Tabelle verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `DROP TRIGGER trg_guardbook_entries_immutable ON guardbook_entries;
       CREATE TRIGGER trg_guardbook_entries_immutable
         BEFORE DELETE OR UPDATE ON tasks
         FOR EACH ROW EXECUTE FUNCTION prevent_guardbook_tampering();`
    );

    await expectBaselineRejected(db, dir, /Trigger trg_guardbook_entries_immutable: Tabelle "tasks"/);
  });

  test('13. Falsche Trigger-Funktion verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `DROP TRIGGER trg_guardbook_entries_immutable ON guardbook_entries;
       CREATE TRIGGER trg_guardbook_entries_immutable
         BEFORE DELETE OR UPDATE ON guardbook_entries
         FOR EACH ROW EXECUTE FUNCTION prevent_revision_tampering();`
    );

    await expectBaselineRejected(db, dir, /Trigger trg_guardbook_entries_immutable: Funktion "prevent_revision_tampering"/);
  });

  test('14. Veränderte Constraint-Definition verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `ALTER TABLE tasks DROP CONSTRAINT uq_tasks_client_mutation;
       ALTER TABLE tasks ADD CONSTRAINT uq_tasks_client_mutation UNIQUE (client_mutation_id, tenant_id);`
    );

    await expectBaselineRejected(db, dir, /Constraint uq_tasks_client_mutation: Definition weicht ab/);
  });

  test('15. Fehlende Berechtigung verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'REVOKE DELETE ON shifts FROM secops_app_user');

    await expectBaselineRejected(db, dir, /Recht DELETE auf shifts: false statt true/);
  });

  test('16. Abweichende Berechtigung verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'GRANT DELETE ON guardbook_entries TO secops_app_user');

    await expectBaselineRejected(db, dir, /Recht DELETE auf guardbook_entries: true statt false/);
  });

  test('17. Fehlende Baseline-Migrationsdatei wird nicht akzeptiert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    fs.rmSync(path.join(dir, '004_operational_delete_privileges.sql'));

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Baseline-Migration 004 .* fehlt/);

    const rows = await queryInDatabase<{ tbl: string | null }>(
      db,
      `SELECT to_regclass('public.schema_migrations')::text AS tbl`
    );
    expect(rows[0].tbl).toBeNull();
  });

  test('18. Abweichender Dateiname der Baseline-Migration wird nicht akzeptiert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    fs.renameSync(
      path.join(dir, '004_operational_delete_privileges.sql'),
      path.join(dir, '004_andere_datei.sql')
    );

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Baseline-Migration 004 hat den erwarteten Dateinamen/);
  });

  test('19. Bestehende Daten bleiben bei abgelehnter Baseline unverändert', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
       VALUES ('Bestandsdaten', 'bestand', 'DE-BEST-1', 'BWR-BEST-1')`
    );
    await queryInDatabase(db, 'DROP POLICY tenant_isolation_permissive ON clients');

    await expectBaselineRejected(db, dir, /RLS-Policy fehlt: clients/);

    const tenants = await queryInDatabase<{ name: string }>(db, 'SELECT name FROM tenants');
    expect(tenants.some((row) => row.name === 'Bestandsdaten')).toBe(true);

    const count = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations`
    );
    expect(count[0].count).toBe('0');
  });

  test('20. Abweichender Dateiname in der Historie wird abgelehnt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, `UPDATE schema_migrations SET filename = '003_umbenannt.sql' WHERE version = '003'`);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Inkonsistenter Dateiname für Version 003/);
  });

  test('21. Abweichende Versionskennung in der Historie wird abgelehnt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, `UPDATE schema_migrations SET version = '3' WHERE version = '003'`);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Inkonsistente Versionskennung: Datenbank meldet "3"/);
  });

  test('22. Zusätzliche permissive RLS-Policy verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `CREATE POLICY extra_permissive ON clients
         AS PERMISSIVE FOR SELECT TO PUBLIC USING (true)`
    );

    await expectBaselineRejected(db, dir, /RLS-Policy clients: 2 Policies gefunden .*extra_permissive.*PERMISSIVE/);
  });

  test('23. Zusätzliche restrictive RLS-Policy verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `CREATE POLICY extra_restrictive ON clients
         AS RESTRICTIVE FOR SELECT TO PUBLIC USING (true)`
    );

    await expectBaselineRejected(db, dir, /RLS-Policy clients: 2 Policies gefunden .*extra_restrictive.*RESTRICTIVE/);
  });

  test('24. Mehrere zusätzliche Policies werden vollständig erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `CREATE POLICY extra_a ON clients AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);
       CREATE POLICY extra_b ON clients AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (true);`
    );

    await expectBaselineRejected(
      db,
      dir,
      /RLS-Policy clients: 3 Policies gefunden .*extra_a.*extra_b/
    );
  });

  test('25. Eine tatsächlich leere Datenbank wird weiterhin akzeptiert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    const result = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(result.applied).toEqual(['001', '002', '003', '004']);
    expect(result.baselined).toEqual([]);
    expect((await historyRows(db))).toHaveLength(4);
  });

  test('26. Fremde Tabelle verhindert die Einstufung als leere Datenbank', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, `CREATE TABLE fremde_tabelle (id INT); INSERT INTO fremde_tabelle VALUES (1);`);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Unerwartetes Objekt im Schema public: Tabelle "fremde_tabelle"/);

    const rows = await queryInDatabase<{ count: string }>(db, 'SELECT COUNT(*)::text AS count FROM fremde_tabelle');
    expect(rows[0].count).toBe('1');
  });

  test('27. Vorhandene View ohne erwartete Tabellen verhindert die Einstufung als leer', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, 'CREATE VIEW fremde_view AS SELECT 1 AS x');

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Unerwartetes Objekt im Schema public: View "fremde_view"/);
  });

  test('28. Bestehende Daten bleiben bei abgelehnter Leer-Erkennung unverändert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, `CREATE TABLE bestandsdaten (id INT, wert TEXT); INSERT INTO bestandsdaten VALUES (1, 'bleibt');`);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Unerwartetes Objekt im Schema public/);

    const rows = await queryInDatabase<{ wert: string }>(db, 'SELECT wert FROM bestandsdaten');
    expect(rows[0].wert).toBe('bleibt');

    const count = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations`
    );
    expect(count[0].count).toBe('0');
  });
});
