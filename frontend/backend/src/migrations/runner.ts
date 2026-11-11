import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Client } from 'pg';
import { env } from '../config/env';

/**
 * Versionssicherer PostgreSQL-Migrationsrunner.
 *
 * - Führt Migrationen genau einmal aus und protokolliert sie in `schema_migrations`.
 * - Prüft Versionskennung, Dateiname und SHA-256-Prüfsumme bereits ausgeführter Migrationen.
 * - Führt jede Migration in einer eigenen Transaktion aus.
 * - Serialisiert konkurrierende Runner über einen PostgreSQL Advisory Lock.
 * - Erkennt bestehende Datenbanken (001–004) und übernimmt sie nur dann als Baseline,
 *   wenn Tabellen, Spalten, Constraints, Trigger, Funktionen, RLS-Policies,
 *   Rollen und Berechtigungen exakt dem erwarteten Stand entsprechen.
 */

const HISTORY_TABLE = 'schema_migrations';
const ADVISORY_LOCK_KEY = Number('2026111101');
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

/** Exakt erwartete Baseline-Migrationsdateien. */
const BASELINE_FILES: Array<{ version: string; numericVersion: number; filename: string }> = [
  { version: '001', numericVersion: 1, filename: '001_initial_schema.sql' },
  { version: '002', numericVersion: 2, filename: '002_idempotency_and_versioning.sql' },
  { version: '003', numericVersion: 3, filename: '003_conflict_receipts_separation.sql' },
  { version: '004', numericVersion: 4, filename: '004_operational_delete_privileges.sql' }
];

const EXPECTED_TABLES = [
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

/** Constraints inklusive Typ, Tabelle und tatsächlicher Definition. */
const EXPECTED_CONSTRAINTS: Array<{
  name: string;
  table: string;
  type: 'u' | 'f';
  definition: string;
}> = [
  { name: 'uq_shifts_client_mutation', table: 'shifts', type: 'u', definition: 'UNIQUE (tenant_id, client_mutation_id)' },
  { name: 'uq_tasks_client_mutation', table: 'tasks', type: 'u', definition: 'UNIQUE (tenant_id, client_mutation_id)' },
  { name: 'uq_keys_client_mutation', table: 'keys', type: 'u', definition: 'UNIQUE (tenant_id, client_mutation_id)' },
  {
    name: 'uq_guardbook_client_mutation',
    table: 'guardbook_entries',
    type: 'u',
    definition: 'UNIQUE (tenant_id, client_mutation_id)'
  },
  {
    name: 'uq_revisions_client_mutation',
    table: 'guardbook_revisions',
    type: 'u',
    definition: 'UNIQUE (tenant_id, client_mutation_id)'
  },
  { name: 'uq_patrol_client_mutation', table: 'patrol_scans', type: 'u', definition: 'UNIQUE (tenant_id, client_mutation_id)' },
  {
    name: 'uq_handover_client_mutation',
    table: 'shift_handovers',
    type: 'u',
    definition: 'UNIQUE (tenant_id, client_mutation_id)'
  },
  {
    name: 'fk_revisions_guardbook_tenant',
    table: 'guardbook_revisions',
    type: 'f',
    definition:
      'FOREIGN KEY (entry_id, tenant_id) REFERENCES guardbook_entries(id, tenant_id) ON DELETE CASCADE'
  }
];

/** Trigger inklusive Tabelle, Funktion, Aktivierungsstatus und Definition. */
const EXPECTED_TRIGGERS: Array<{
  name: string;
  table: string;
  function: string;
  definition: string;
}> = [
  {
    name: 'trg_guardbook_entries_immutable',
    table: 'guardbook_entries',
    function: 'prevent_guardbook_tampering',
    definition:
      'CREATE TRIGGER trg_guardbook_entries_immutable BEFORE DELETE OR UPDATE ON public.guardbook_entries FOR EACH ROW EXECUTE FUNCTION prevent_guardbook_tampering()'
  },
  {
    name: 'trg_guardbook_revisions_immutable',
    table: 'guardbook_revisions',
    function: 'prevent_revision_tampering',
    definition:
      'CREATE TRIGGER trg_guardbook_revisions_immutable BEFORE DELETE OR UPDATE ON public.guardbook_revisions FOR EACH ROW EXECUTE FUNCTION prevent_revision_tampering()'
  }
];

/** Funktionen inklusive Sprache, Rückgabetyp und sicherheitsrelevanter Body-Marker. */
const EXPECTED_FUNCTIONS: Array<{ name: string; markers: string[] }> = [
  {
    name: 'prevent_guardbook_tampering',
    markers: [
      "TG_OP = 'DELETE'",
      'Löschen von Einträgen in guardbook_entries',
      'Nachträgliche Manipulation von Kernfeldern',
      'guardbook_revisions'
    ]
  },
  {
    name: 'prevent_revision_tampering',
    markers: ['Revisionen in guardbook_revisions sind unveränderlich und unlöschbar']
  }
];

const EXPECTED_RLS_POLICY_NAME = 'tenant_isolation_permissive';
const EXPECTED_RLS_EXPRESSION =
  "((current_setting('app.current_tenant'::text, true) IS NOT NULL) AND " +
  "(current_setting('app.current_tenant'::text, true) <> ''::text) AND " +
  '(tenant_id = (current_setting(\'app.current_tenant\'::text, true))::uuid))';

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

/** Erwartete Tabellenrechte des unprivilegierten Anwendungsbenutzers. */
const EXPECTED_TABLE_PRIVILEGES: Record<string, { select: boolean; insert: boolean; update: boolean; delete: boolean }> =
  {};
for (const table of EXPECTED_TABLES) {
  EXPECTED_TABLE_PRIVILEGES[table] = {
    select: true,
    insert: true,
    update: table !== 'guardbook_revisions',
    delete: table === 'shifts' || table === 'tasks'
  };
}

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Entfernt sämtliche Whitespaces – für den exakten Vergleich von DDL-Definitionen. */
function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

/** Normalisiert Whitespace zu einem einzelnen Leerzeichen – für Body-Marker. */
function spaced(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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

/**
 * Stellt sicher, dass die Baseline-Migrationen exakt in Version und Dateiname
 * vorhanden sind. Fehlende oder abweichend nummerierte Baseline-Dateien
 * werden nicht stillschweigend akzeptiert.
 */
export function assertBaselineMigrationSet(migrations: MigrationFile[]): void {
  for (const expected of BASELINE_FILES) {
    const migration = migrations.find((item) => item.numericVersion === expected.numericVersion);

    if (!migration) {
      throw new Error(
        `Baseline-Migration ${expected.version} (${expected.filename}) fehlt im Migrationsverzeichnis. ` +
          'Eine Baseline darf nur mit vollständigem 001–004-Satz gebildet werden.'
      );
    }

    if (migration.version !== expected.version) {
      throw new Error(
        `Baseline-Migration ${expected.version} besitzt die abweichende Versionskennung "${migration.version}" (${migration.filename}).`
      );
    }

    if (migration.filename !== expected.filename) {
      throw new Error(
        `Baseline-Migration ${expected.version} hat den erwarteten Dateinamen "${expected.filename}" nicht ` +
          `(gefunden: "${migration.filename}").`
      );
    }
  }

  const unexpected = migrations.filter(
    (migration) =>
      migration.numericVersion <= BASELINE_MAX_VERSION &&
      !BASELINE_FILES.some((expected) => expected.numericVersion === migration.numericVersion)
  );

  if (unexpected.length > 0) {
    throw new Error(
      `Unerwartete Baseline-Migrationsversion(en): ${unexpected.map((item) => item.filename).join(', ')}. ` +
        'Für Baseline 001–004 sind ausschließlich die bekannten vier Dateien zulässig.'
    );
  }
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

    if (row.version !== migration.version) {
      throw new Error(
        `Inkonsistente Versionskennung: Datenbank meldet "${row.version}", die Datei heißt "${migration.filename}" ` +
          `mit Version "${migration.version}".`
      );
    }

    if (row.filename !== migration.filename) {
      throw new Error(
        `Inkonsistenter Dateiname für Version ${migration.version}: Datenbank speichert "${row.filename}", ` +
          `im Repository liegt "${migration.filename}".`
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
  problems: string[];
}

interface PolicyRow {
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

type RelationKind = 'r' | 'p' | 'v' | 'm' | 'S' | 'f';
type CustomTypeKind = 'c' | 'e' | 'd' | 'r' | 'm';

interface ExpectedRoutine {
  /** SQL-Identifier inklusive Anführungszeichen, falls der Name gequotet war. */
  name: string;
  /** Parametertypen in SQL-Form (ohne Namen, Modes, DEFAULT). */
  args: string[];
}

interface ExpectedSchemaObjects {
  relations: Map<string, RelationKind>;
  routines: ExpectedRoutine[];
  types: Map<string, CustomTypeKind>;
}

const RELATION_KIND_LABELS: Record<string, string> = {
  r: 'Tabelle',
  p: 'partitionierte Tabelle',
  v: 'View',
  m: 'Materialized View',
  S: 'Sequenz',
  f: 'Fremdtabelle'
};

const TYPE_KIND_LABELS: Record<string, string> = {
  c: 'Zusammengesetzter Typ',
  e: 'Enum',
  d: 'Domain',
  r: 'Range-Typ',
  m: 'Multirange-Typ'
};

type TokenType = 'word' | 'quoted_ident' | 'string' | 'dollar' | 'number' | 'punct' | 'operator';

interface SqlToken {
  type: TokenType;
  value: string;
  raw: string;
  position: number;
}

function lexSql(sql: string, source: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++;
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth !== 0) {
        throw new Error(`${source}: nicht terminierter Blockkommentar ab Position ${start}`);
      }
      continue;
    }

    const isEscapeString =
      (ch === 'e' || ch === 'E') && sql[i + 1] === "'";

    if (ch === "'" || isEscapeString) {
      const start = i;
      i += isEscapeString ? 2 : 1;
      let value = '';
      let closed = false;

      while (i < sql.length) {
        if (isEscapeString && sql[i] === '\\') {
          value += sql[i] + (sql[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += sql[i];
        i++;
      }

      if (!closed) {
        throw new Error(`${source}: nicht terminierte Zeichenkette ab Position ${start}`);
      }

      tokens.push({ type: 'string', value, raw: sql.slice(start, i), position: start });
      continue;
    }

    if (ch === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        const start = i;
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          throw new Error(`${source}: nicht terminierter Dollar-quoted String ab Position ${start}`);
        }
        tokens.push({
          type: 'dollar',
          value: sql.slice(i, end),
          raw: sql.slice(start, end + tag.length),
          position: start
        });
        i = end + tag.length;
        continue;
      }
    }

    if (ch === '"') {
      const start = i;
      i++;
      let value = '';
      let closed = false;

      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += sql[i];
        i++;
      }

      if (!closed) {
        throw new Error(`${source}: nicht terminierter Bezeichner ab Position ${start}`);
      }

      tokens.push({ type: 'quoted_ident', value, raw: sql.slice(start, i), position: start });
      continue;
    }

    if (/[A-Za-z_\u0080-\uFFFF]/.test(ch)) {
      const start = i;
      i++;
      while (i < sql.length && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(sql[i])) i++;
      tokens.push({ type: 'word', value: sql.slice(start, i), raw: sql.slice(start, i), position: start });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      i++;
      while (i < sql.length && /[0-9.]/.test(sql[i])) i++;
      tokens.push({ type: 'number', value: sql.slice(start, i), raw: sql.slice(start, i), position: start });
      continue;
    }

    if ('(),.;[]'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, raw: ch, position: i });
      i++;
      continue;
    }

    tokens.push({ type: 'operator', value: ch, raw: ch, position: i });
    i++;
  }

  return tokens;
}

function isWord(token: SqlToken | undefined, value: string): boolean {
  return !!token && token.type === 'word' && token.value.toLowerCase() === value;
}

function isPunct(token: SqlToken | undefined, value: string): boolean {
  return !!token && token.type === 'punct' && token.value === value;
}

interface ParsedName {
  schema: string | null;
  /** Exakter Katalogname (unquoted kleingeschrieben, quoted unverändert). */
  key: string;
  /** SQL-Identifier für Signatur-Auflösung (quoted mit Anführungszeichen). */
  sql: string;
  quoted: boolean;
}

function identifierFromToken(token: SqlToken, source: string): { key: string; sql: string; quoted: boolean } {
  if (token.type === 'quoted_ident') {
    return {
      key: token.value,
      sql: `"${token.value.replace(/"/g, '""')}"`,
      quoted: true
    };
  }
  if (token.type === 'word') {
    return { key: token.value.toLowerCase(), sql: token.value.toLowerCase(), quoted: false };
  }
  throw new Error(`${source}: Bezeichner erwartet, gefunden "${token.raw}"`);
}

function parseQualifiedName(
  tokens: SqlToken[],
  index: number,
  source: string
): { name: ParsedName; next: number } {
  if (!tokens[index]) {
    throw new Error(`${source}: Objektname fehlt`);
  }

  const parts: Array<{ key: string; sql: string; quoted: boolean }> = [];
  parts.push(identifierFromToken(tokens[index], source));
  let i = index + 1;

  while (
    i + 1 < tokens.length &&
    isPunct(tokens[i], '.') &&
    (tokens[i + 1].type === 'word' || tokens[i + 1].type === 'quoted_ident')
  ) {
    parts.push(identifierFromToken(tokens[i + 1], source));
    i += 2;
  }

  if (parts.length > 2) {
    throw new Error(`${source}: dreiteilige Objektnamen werden nicht unterstützt`);
  }

  const namePart = parts[parts.length - 1];
  const schemaPart = parts.length === 2 ? parts[0] : null;

  return {
    name: {
      schema: schemaPart ? schemaPart.key : null,
      key: namePart.key,
      sql: namePart.sql,
      quoted: namePart.quoted
    },
    next: i
  };
}

function isPublicName(name: ParsedName): boolean {
  return name.schema === null || name.schema === 'public';
}

const KNOWN_TYPE_STARTS = new Set([
  'integer',
  'int',
  'int4',
  'bigint',
  'int8',
  'smallint',
  'int2',
  'text',
  'varchar',
  'character',
  'char',
  'boolean',
  'bool',
  'numeric',
  'decimal',
  'real',
  'float',
  'float4',
  'float8',
  'double',
  'timestamp',
  'timestamptz',
  'date',
  'time',
  'timetz',
  'uuid',
  'json',
  'jsonb',
  'bytea',
  'interval',
  'record',
  'trigger',
  'void',
  'anyelement',
  'anyarray',
  'anynonarray',
  'regclass',
  'regtype',
  'public'
]);

const MULTIWORD_TYPE_PREFIXES: string[][] = [
  ['double', 'precision'],
  ['timestamp', 'with', 'time', 'zone'],
  ['timestamp', 'without', 'time', 'zone'],
  ['time', 'with', 'time', 'zone'],
  ['time', 'without', 'time', 'zone'],
  ['character', 'varying'],
  ['bit', 'varying'],
  ['national', 'character'],
  ['interval', 'year'],
  ['interval', 'month'],
  ['interval', 'day'],
  ['interval', 'hour'],
  ['interval', 'minute'],
  ['interval', 'second']
];

function startsMultiwordType(tokens: SqlToken[]): boolean {
  const words = tokens
    .filter((token) => token.type === 'word')
    .slice(0, 4)
    .map((token) => token.value.toLowerCase());

  return MULTIWORD_TYPE_PREFIXES.some(
    (prefix) => prefix.length <= words.length && prefix.every((word, index) => words[index] === word)
  );
}

function tokensToTypeText(tokens: SqlToken[]): string {
  const pieces = tokens.map((token) => {
    if (token.type === 'quoted_ident') {
      return `"${token.value.replace(/"/g, '""')}"`;
    }
    if (token.type === 'word') {
      return token.value.toLowerCase();
    }
    return token.raw;
  });

  let result = '';
  for (const piece of pieces) {
    if (result.length === 0) {
      result = piece;
      continue;
    }

    const previous = result[result.length - 1];
    const noSpaceBefore = ['(', '[', ')', ']', ',', '.'].includes(piece);
    const noSpaceAfter = ['(', '[', '.'].includes(previous);

    result += noSpaceBefore || noSpaceAfter ? piece : ` ${piece}`;
  }

  return result.trim();
}

function splitTokensByComma(tokens: SqlToken[]): SqlToken[][] {
  const parts: SqlToken[][] = [];
  let current: SqlToken[] = [];
  let depth = 0;

  for (const token of tokens) {
    if (token.type === 'punct' && (token.value === '(' || token.value === '[')) depth++;
    if (token.type === 'punct' && (token.value === ')' || token.value === ']')) depth--;

    if (depth === 0 && token.type === 'punct' && token.value === ',') {
      parts.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }

  parts.push(current);
  return parts;
}

interface ParsedParameter {
  mode: 'IN' | 'OUT' | 'INOUT' | 'VARIADIC';
  typeText: string;
}

function parseParameter(tokens: SqlToken[], source: string): ParsedParameter | null {
  let work = tokens.slice();

  // DEFAULT bzw. "=" auf oberster Ebene abschneiden.
  let depth = 0;
  for (let i = 0; i < work.length; i++) {
    const token = work[i];
    if (token.type === 'punct' && (token.value === '(' || token.value === '[')) depth++;
    if (token.type === 'punct' && (token.value === ')' || token.value === ']')) depth--;
    if (depth !== 0) continue;
    if (isWord(token, 'default') || (token.type === 'operator' && token.value === '=')) {
      work = work.slice(0, i);
      break;
    }
  }

  let mode: ParsedParameter['mode'] = 'IN';
  while (work.length > 0 && work[0].type === 'word') {
    const keyword = work[0].value.toLowerCase();
    if (keyword === 'in') {
      mode = 'IN';
      work = work.slice(1);
    } else if (keyword === 'out') {
      mode = 'OUT';
      work = work.slice(1);
    } else if (keyword === 'inout') {
      mode = 'INOUT';
      work = work.slice(1);
    } else if (keyword === 'variadic') {
      mode = 'VARIADIC';
      work = work.slice(1);
    } else {
      break;
    }
  }

  if (work.length === 0) {
    return null;
  }

  // Optionalen Parameternamen entfernen. Die Entscheidung hängt von der
  // vollständigen Tokenfolge ab: Ein gequoteter erster Bezeichner kann sowohl
  // Parametername als auch Teil eines Typnamens sein.
  if (work.length > 1) {
    const first = work[0];
    const second = work[1];

    if (first.type === 'quoted_ident') {
      const typeContinuation =
        isPunct(second, '.') || isPunct(second, '[') || isPunct(second, '(');

      if (!typeContinuation) {
        work = work.slice(1);
      }
    } else if (first.type === 'word') {
      const firstLower = first.value.toLowerCase();
      const schemaQualified = isPunct(second, '.');
      const arraySuffix = isPunct(second, '[');
      const typeModifier = isPunct(second, '(');
      const multiwordType = startsMultiwordType(work);

      if (
        KNOWN_TYPE_STARTS.has(firstLower) ||
        schemaQualified ||
        arraySuffix ||
        typeModifier ||
        multiwordType
      ) {
        // Erster Token gehört zum Typ. Zwei aufeinanderfolgende Typwörter ohne
        // bekannten Mehrwort-Typ sind nicht eindeutig (Name vs. Typ).
        if (
          KNOWN_TYPE_STARTS.has(firstLower) &&
          !schemaQualified &&
          !arraySuffix &&
          !typeModifier &&
          !multiwordType &&
          (second.type === 'word' || second.type === 'quoted_ident')
        ) {
          throw new Error(
            `${source}: Parameter "${tokensToTypeText(work)}" ist nicht eindeutig analysierbar`
          );
        }
      } else if (second.type === 'word' || second.type === 'quoted_ident') {
        // Erster Token ist ein Parametername.
        work = work.slice(1);
      } else {
        throw new Error(`${source}: Parameter "${tokensToTypeText(work)}" ist nicht eindeutig analysierbar`);
      }
    }
  }

  if (work.length === 0) {
    throw new Error(`${source}: Parameter ohne Typangabe`);
  }

  return { mode, typeText: tokensToTypeText(work) };
}

function parseRoutineArguments(tokens: SqlToken[], source: string): string[] {
  if (tokens.length === 0) return [];

  const args: string[] = [];
  for (const part of splitTokensByComma(tokens)) {
    if (part.length === 0) {
      throw new Error(`${source}: leerer Parameter in Routine`);
    }
    const parameter = parseParameter(part, source);
    if (!parameter) continue;
    if (parameter.mode === 'OUT') continue;
    args.push(parameter.typeText);
  }

  return args;
}

function findMatchingParen(tokens: SqlToken[], openIndex: number, source: string): number {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (isPunct(tokens[i], '(')) depth++;
    if (isPunct(tokens[i], ')')) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`${source}: nicht geschlossene Parameterliste`);
}

function skipIfNotExists(tokens: SqlToken[], index: number): number {
  if (isWord(tokens[index], 'if') && isWord(tokens[index + 1], 'not') && isWord(tokens[index + 2], 'exists')) {
    return index + 3;
  }
  return index;
}

function determineTableKind(tokens: SqlToken[], start: number): RelationKind {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'punct' && (token.value === '(' || token.value === '[')) depth++;
    if (token.type === 'punct' && (token.value === ')' || token.value === ']')) depth--;
    if (depth === 0 && isPunct(token, ';')) break;
    if (depth === 0 && isWord(token, 'partition') && isWord(tokens[i + 1], 'by')) {
      return 'p';
    }
  }
  return 'r';
}

export function extractSchemaObjects(sql: string, source = 'Migration'): ExpectedSchemaObjects {
  const tokens = lexSql(sql, source);
  const relations = new Map<string, RelationKind>();
  const routines: ExpectedRoutine[] = [];
  const types = new Map<string, CustomTypeKind>();

  let i = 0;
  while (i < tokens.length) {
    if (!isWord(tokens[i], 'create')) {
      i++;
      continue;
    }

    let j = i + 1;
    if (isWord(tokens[j], 'or') && isWord(tokens[j + 1], 'replace')) {
      j += 2;
    }

    if (isWord(tokens[j], 'unlogged') || isWord(tokens[j], 'temp') || isWord(tokens[j], 'temporary')) {
      j++;
    }

    if (isWord(tokens[j], 'foreign') && isWord(tokens[j + 1], 'table')) {
      j += 2;
      j = skipIfNotExists(tokens, j);
      const parsed = parseQualifiedName(tokens, j, source);
      if (isPublicName(parsed.name)) relations.set(parsed.name.key, 'f');
      i = parsed.next;
      continue;
    }

    if (isWord(tokens[j], 'table')) {
      j++;
      j = skipIfNotExists(tokens, j);
      const parsed = parseQualifiedName(tokens, j, source);
      if (isPublicName(parsed.name)) relations.set(parsed.name.key, determineTableKind(tokens, parsed.next));
      i = parsed.next;
      continue;
    }

    if (isWord(tokens[j], 'materialized') && isWord(tokens[j + 1], 'view')) {
      j += 2;
      j = skipIfNotExists(tokens, j);
      const parsed = parseQualifiedName(tokens, j, source);
      if (isPublicName(parsed.name)) relations.set(parsed.name.key, 'm');
      i = parsed.next;
      continue;
    }

    if (isWord(tokens[j], 'view')) {
      j++;
      j = skipIfNotExists(tokens, j);
      const parsed = parseQualifiedName(tokens, j, source);
      if (isPublicName(parsed.name)) relations.set(parsed.name.key, 'v');
      i = parsed.next;
      continue;
    }

    if (isWord(tokens[j], 'sequence')) {
      j++;
      j = skipIfNotExists(tokens, j);
      const parsed = parseQualifiedName(tokens, j, source);
      if (isPublicName(parsed.name)) relations.set(parsed.name.key, 'S');
      i = parsed.next;
      continue;
    }

    if (isWord(tokens[j], 'type')) {
      j++;
      const parsed = parseQualifiedName(tokens, j, source);
      if (!isWord(tokens[parsed.next], 'as')) {
        throw new Error(`${source}: CREATE TYPE ${parsed.name.key} ohne AS ist nicht sicher analysierbar`);
      }

      const afterAs = parsed.next + 1;
      let kind: CustomTypeKind | null = null;
      if (isWord(tokens[afterAs], 'enum')) kind = 'e';
      else if (isWord(tokens[afterAs], 'range')) kind = 'r';
      else if (isPunct(tokens[afterAs], '(')) kind = 'c';

      if (!kind) {
        throw new Error(`${source}: CREATE TYPE ${parsed.name.key} hat eine nicht unterstützte Form`);
      }

      if (isPublicName(parsed.name)) types.set(parsed.name.key, kind);
      i = afterAs;
      continue;
    }

    if (isWord(tokens[j], 'domain')) {
      j++;
      const parsed = parseQualifiedName(tokens, j, source);
      if (isPublicName(parsed.name)) types.set(parsed.name.key, 'd');
      i = parsed.next;
      continue;
    }

    if (isWord(tokens[j], 'function') || isWord(tokens[j], 'procedure')) {
      j++;
      const parsed = parseQualifiedName(tokens, j, source);
      if (!isPunct(tokens[parsed.next], '(')) {
        throw new Error(`${source}: Routine ${parsed.name.key} ohne Parameterliste`);
      }

      const close = findMatchingParen(tokens, parsed.next, source);
      const args = parseRoutineArguments(tokens.slice(parsed.next + 1, close), source);

      if (isPublicName(parsed.name)) {
        const existing = routines.find((routine) => routine.name === parsed.name.sql);
        if (existing) {
          const signature = args.join(',');
          const existingSignature = existing.args.join(',');
          if (signature !== existingSignature) {
            // Überladung: gleicher Name, andere Signatur ist zulässig.
            routines.push({ name: parsed.name.sql, args });
          }
        } else {
          routines.push({ name: parsed.name.sql, args });
        }
      }

      i = close + 1;
      continue;
    }

    i = j;
  }

  return { relations, routines, types };
}

export function deriveExpectedSchemaObjects(migrations: MigrationFile[]): ExpectedSchemaObjects {
  const result: ExpectedSchemaObjects = {
    relations: new Map(),
    routines: [],
    types: new Map()
  };

  for (const migration of migrations) {
    const extracted = extractSchemaObjects(migration.sql, migration.filename);
    for (const [name, kind] of extracted.relations) result.relations.set(name, kind);
    for (const routine of extracted.routines) {
      if (!result.routines.some((existing) => existing.name === routine.name && existing.args.join(',') === routine.args.join(','))) {
        result.routines.push(routine);
      }
    }
    for (const [name, kind] of extracted.types) result.types.set(name, kind);
  }

  return result;
}

const TYPE_ALIASES: Record<string, string> = {
  int: 'integer',
  int4: 'integer',
  int2: 'smallint',
  int8: 'bigint',
  bool: 'boolean',
  varchar: 'character varying',
  char: 'character',
  float4: 'real',
  float8: 'double precision',
  decimal: 'numeric',
  timestamptz: 'timestamp with time zone',
  timestamp: 'timestamp without time zone',
  timetz: 'time with time zone',
  time: 'time without time zone'
};

/**
 * Entfernt Typmodifikatoren tokenbasiert, ohne gequotete Bezeichner,
 * Schemaqualifikationen oder Array-Suffixe zu beschädigen.
 *
 * Beispiele:
 *   numeric(10,2)                    -> numeric
 *   varchar(255)                     -> character varying
 *   "MeinTyp"(10)                    -> "MeinTyp"
 *   "MeinSchema"."MeinTyp"(10)      -> "MeinSchema"."MeinTyp"
 *   public."MeinTyp"(10)            -> public."MeinTyp"
 *   numeric(10,2)[]                  -> numeric[]
 *   "MeinSchema"."MeinTyp"[]        -> "MeinSchema"."MeinTyp"[]
 */
export function stripTypeModifiers(typeText: string): string {
  const tokens = lexSql(typeText, 'Typnormalisierung');
  const result: SqlToken[] = [];
  let removed = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens.at(i)!;

    if (!removed && isPunct(token, '(')) {
      let depth = 1;
      let j = i + 1;

      while (j < tokens.length && depth > 0) {
        if (isPunct(tokens[j], '(')) depth++;
        else if (isPunct(tokens[j], ')')) depth--;
        j++;
      }

      if (depth !== 0) {
        throw new Error('Typnormalisierung: nicht geschlossener Typmodifikator');
      }

      i = j - 1;
      removed = true;
      continue;
    }

    result.push(token);
  }

  const firstBracket = result.findIndex((token) => isPunct(token, '['));
  const baseTokens = firstBracket === -1 ? result : result.slice(0, firstBracket);
  const arrayTokens = firstBracket === -1 ? [] : result.slice(firstBracket);

  let baseText: string;
  if (baseTokens.length === 1 && baseTokens[0].type === 'word') {
    const baseName = baseTokens[0].value.toLowerCase();
    baseText = TYPE_ALIASES[baseName] ?? tokensToTypeText(baseTokens);
  } else {
    baseText = tokensToTypeText(baseTokens);
  }

  const arrayText = tokensToTypeText(arrayTokens);
  return `${baseText}${arrayText}`;
}

interface ActualRelationRow {
  name: string;
  kind: string;
  extension_owned: boolean;
}

interface ActualTypeRow {
  name: string;
  kind: string;
  extension_owned: boolean;
}

interface RangeRow {
  range_name: string;
  multirange_name: string;
}

async function compareSchemaObjects(client: Client, expected: ExpectedSchemaObjects): Promise<string[]> {
  const problems: string[] = [];

  // Relationen inklusive Typvergleich
  const relationResult = await client.query<ActualRelationRow>(`
    SELECT c.relname AS name, c.relkind AS kind,
           EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass
                AND d.objid = c.oid
                AND d.deptype = 'e'
           ) AS extension_owned
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  `);

  const actualRelations = new Map<string, string>();
  for (const row of relationResult.rows) {
    if (row.name === HISTORY_TABLE || row.extension_owned) continue;
    actualRelations.set(row.name, row.kind);

    const expectedKind = expected.relations.get(row.name);
    if (!expectedKind) {
      problems.push(
        `Unerwartetes Objekt im Schema public: ${RELATION_KIND_LABELS[row.kind] ?? row.kind} "${row.name}"`
      );
    } else if (expectedKind !== row.kind) {
      problems.push(
        `Relation "${row.name}" hat Typ "${RELATION_KIND_LABELS[row.kind] ?? row.kind}" statt ` +
          `"${RELATION_KIND_LABELS[expectedKind] ?? expectedKind}"`
      );
    }
  }

  for (const [name, kind] of expected.relations) {
    if (!actualRelations.has(name)) {
      problems.push(`Erwartete Relation fehlt: ${RELATION_KIND_LABELS[kind] ?? kind} "${name}"`);
    }
  }

  // Routinen über PostgreSQLs eigene Identitätsauflösung vergleichen.
  const routineResult = await client.query<{ signature: string; extension_owned: boolean }>(`
    SELECT p.oid::regprocedure::text AS signature,
           EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_proc'::regclass
                AND d.objid = p.oid
                AND d.deptype = 'e'
           ) AS extension_owned
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  `);

  const actualRoutines = new Set<string>();
  for (const row of routineResult.rows) {
    if (!row.extension_owned) actualRoutines.add(row.signature);
  }

  const expectedSignatures = new Set<string>();
  for (const routine of expected.routines) {
    const candidate = `${routine.name}(${routine.args.map(stripTypeModifiers).join(',')})`;
    const resolved = await client.query<{ oid: string | null }>(
      `SELECT to_regprocedure($1)::oid::text AS oid`,
      [candidate]
    );

    const oid = resolved.rows[0]?.oid ?? null;
    if (!oid) {
      problems.push(`Erwartete Routine nicht eindeutig auflösbar oder fehlend: ${candidate}`);
      continue;
    }

    const canonical = await client.query<{ signature: string }>(
      `SELECT $1::oid::regprocedure::text AS signature`,
      [oid]
    );
    expectedSignatures.add(canonical.rows[0].signature);
  }

  for (const signature of actualRoutines) {
    if (!expectedSignatures.has(signature)) {
      const name = signature.slice(0, signature.indexOf('('));
      problems.push(
        `Unerwartetes Objekt im Schema public: Funktion/Prozedur "${name}" mit Signatur "${signature}"`
      );
    }
  }

  for (const signature of expectedSignatures) {
    if (!actualRoutines.has(signature)) {
      problems.push(`Erwartete Routine fehlt: ${signature}`);
    }
  }

  // Typen inklusive automatischer Multirange-Typen
  const rangeResult = await client.query<RangeRow>(`
    SELECT r.rngtypid::regtype::text AS range_name,
           r.rngmultitypid::regtype::text AS multirange_name
      FROM pg_range r
  `);

  const allowedMultiranges = new Set<string>();
  for (const row of rangeResult.rows) {
    const rangeName = row.range_name.split('.').pop() ?? row.range_name;
    if (expected.types.get(rangeName) === 'r') {
      allowedMultiranges.add(row.multirange_name.split('.').pop() ?? row.multirange_name);
    }
  }

  const typeResult = await client.query<ActualTypeRow>(`
    SELECT t.typname AS name, t.typtype AS kind,
           EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.classid = 'pg_type'::regclass
                AND d.objid = t.oid
                AND d.deptype = 'e'
           ) AS extension_owned
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      LEFT JOIN pg_class rel ON rel.oid = t.typrelid
     WHERE n.nspname = 'public'
       AND (
         t.typtype IN ('e', 'd', 'r', 'm')
         OR (t.typtype = 'c' AND (rel.oid IS NULL OR rel.relkind = 'c'))
       )
  `);

  const actualTypes = new Map<string, string>();
  for (const row of typeResult.rows) {
    if (row.extension_owned) continue;
    if (row.kind === 'm' && allowedMultiranges.has(row.name)) continue;

    actualTypes.set(row.name, row.kind);

    const expectedKind = expected.types.get(row.name);
    if (!expectedKind) {
      problems.push(
        `Unerwartetes Objekt im Schema public: ${TYPE_KIND_LABELS[row.kind] ?? row.kind} "${row.name}"`
      );
    } else if (expectedKind !== row.kind) {
      problems.push(
        `Typ "${row.name}" hat Typ "${TYPE_KIND_LABELS[row.kind] ?? row.kind}" statt ` +
          `"${TYPE_KIND_LABELS[expectedKind] ?? expectedKind}"`
      );
    }
  }

  for (const [name, kind] of expected.types) {
    if (!actualTypes.has(name)) {
      problems.push(`Erwarteter Typ fehlt: ${TYPE_KIND_LABELS[kind] ?? kind} "${name}"`);
    }
  }

  return problems;
}

async function inspectSchema(client: Client): Promise<SchemaInspection> {
  const problems: string[] = [];

  const tableResult = await client.query<{ name: string; present: boolean }>(
    `SELECT t AS name, to_regclass('public.' || quote_ident(t)) IS NOT NULL AS present
       FROM unnest($1::text[]) AS t`,
    [EXPECTED_TABLES]
  );
  const existingTables = tableResult.rows.filter((row) => row.present).map((row) => row.name);
  const missingTables = tableResult.rows.filter((row) => !row.present).map((row) => row.name);

  // Unerwartete Objekte (Relationen, Routinen, Typen) wurden bereits vor der
  // Pfadentscheidung in runMigrations() geprüft.
  if (existingTables.length === 0) {
    return { existingTables, problems: [] };
  }

  for (const table of missingTables) {
    problems.push(`Tabelle fehlt: ${table}`);
  }

  // Spalten
  const columnResult = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`
  );
  const existingColumns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const [table, column] of EXPECTED_COLUMNS) {
    if (!existingColumns.has(`${table}.${column}`)) {
      problems.push(`Spalte fehlt: ${table}.${column}`);
    }
  }

  // Constraints: Typ, Tabelle und tatsächliche Definition
  const constraintResult = await client.query<{
    conname: string;
    contype: string;
    table_name: string;
    definition: string;
  }>(
    `SELECT conname, contype, conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conname = ANY($1::text[])`,
    [EXPECTED_CONSTRAINTS.map((constraint) => constraint.name)]
  );
  const constraintsByName = new Map(constraintResult.rows.map((row) => [row.conname, row]));

  for (const expected of EXPECTED_CONSTRAINTS) {
    const row = constraintsByName.get(expected.name);
    if (!row) {
      problems.push(`Constraint fehlt: ${expected.name}`);
      continue;
    }

    const table = row.table_name.replace(/^public\./, '');
    if (row.contype !== expected.type) {
      problems.push(`Constraint ${expected.name}: Typ "${row.contype}" statt "${expected.type}"`);
    }
    if (table !== expected.table) {
      problems.push(`Constraint ${expected.name}: Tabelle "${table}" statt "${expected.table}"`);
    }
    if (compact(row.definition) !== compact(expected.definition)) {
      problems.push(`Constraint ${expected.name}: Definition weicht ab (${row.definition})`);
    }
  }

  // Funktionen: Sprache, Rückgabetyp, SECURITY DEFINER und sicherheitsrelevante Body-Marker
  const functionResult = await client.query<{
    proname: string;
    lanname: string;
    return_type: string;
    prosecdef: boolean;
    prosrc: string;
  }>(
    `SELECT p.proname, l.lanname, p.prorettype::regtype::text AS return_type, p.prosecdef, p.prosrc
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
    [EXPECTED_FUNCTIONS.map((fn) => fn.name)]
  );
  const functionsByName = new Map(functionResult.rows.map((row) => [row.proname, row]));

  for (const expected of EXPECTED_FUNCTIONS) {
    const row = functionsByName.get(expected.name);
    if (!row) {
      problems.push(`Funktion fehlt: ${expected.name}`);
      continue;
    }
    if (row.lanname !== 'plpgsql') {
      problems.push(`Funktion ${expected.name}: Sprache "${row.lanname}" statt "plpgsql"`);
    }
    if (row.return_type !== 'trigger') {
      problems.push(`Funktion ${expected.name}: Rückgabetyp "${row.return_type}" statt "trigger"`);
    }
    if (row.prosecdef) {
      problems.push(`Funktion ${expected.name}: unerwartetes SECURITY DEFINER`);
    }

    const body = spaced(row.prosrc);
    for (const marker of expected.markers) {
      if (!body.includes(marker)) {
        problems.push(`Funktion ${expected.name}: erwarteter Body-Marker fehlt (${marker})`);
      }
    }
  }

  // Trigger: Tabelle, Funktion, Aktivierungsstatus, Definition
  const triggerResult = await client.query<{
    tgname: string;
    table_name: string;
    function_name: string;
    tgenabled: string;
    definition: string;
  }>(
    `SELECT t.tgname, c.relname AS table_name, p.proname AS function_name, t.tgenabled,
            pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND t.tgname = ANY($1::text[])`,
    [EXPECTED_TRIGGERS.map((trigger) => trigger.name)]
  );
  const triggersByName = new Map(triggerResult.rows.map((row) => [row.tgname, row]));

  for (const expected of EXPECTED_TRIGGERS) {
    const row = triggersByName.get(expected.name);
    if (!row) {
      problems.push(`Trigger fehlt: ${expected.name}`);
      continue;
    }
    if (row.table_name !== expected.table) {
      problems.push(`Trigger ${expected.name}: Tabelle "${row.table_name}" statt "${expected.table}"`);
    }
    if (row.function_name !== expected.function) {
      problems.push(`Trigger ${expected.name}: Funktion "${row.function_name}" statt "${expected.function}"`);
    }
    if (row.tgenabled !== 'O') {
      problems.push(`Trigger ${expected.name}: Aktivierungsstatus "${row.tgenabled}" statt "O" (enabled)`);
    }
    if (compact(row.definition) !== compact(expected.definition)) {
      problems.push(`Trigger ${expected.name}: Definition weicht ab (${row.definition})`);
    }
  }

  // RLS: Aktivierung, FORCE und vollständige Policy-Definition
  const rlsResult = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [EXPECTED_RLS_TABLES]
  );
  const rlsByTable = new Map(rlsResult.rows.map((row) => [row.relname, row]));

  const policyResult = await client.query<PolicyRow>(
    `SELECT tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
       FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [EXPECTED_RLS_TABLES]
  );

  // Alle Policies je Tabelle sammeln – nicht nur die letzte. Mehrere Policies
  // auf derselben Tabelle dürfen nicht durch eine Map überschrieben werden.
  const policiesByTable = new Map<string, PolicyRow[]>();
  for (const row of policyResult.rows) {
    const rows = policiesByTable.get(row.tablename) ?? [];
    rows.push(row);
    policiesByTable.set(row.tablename, rows);
  }

  for (const table of EXPECTED_RLS_TABLES) {
    const rls = rlsByTable.get(table);
    if (!rls) {
      problems.push(`RLS-Tabelle fehlt: ${table}`);
      continue;
    }
    if (!rls.relrowsecurity) {
      problems.push(`RLS nicht aktiviert: ${table}`);
    }
    if (!rls.relforcerowsecurity) {
      problems.push(`RLS nicht erzwungen (FORCE): ${table}`);
    }

    const policies = policiesByTable.get(table) ?? [];
    if (policies.length === 0) {
      problems.push(`RLS-Policy fehlt: ${table}.${EXPECTED_RLS_POLICY_NAME}`);
      continue;
    }

    if (policies.length > 1) {
      const summary = policies
        .map((policy) => `${policy.policyname} (${policy.permissive}, ${policy.cmd})`)
        .join(', ');
      problems.push(
        `RLS-Policy ${table}: ${policies.length} Policies gefunden (${summary}); erwartet wird genau eine Policy "${EXPECTED_RLS_POLICY_NAME}". ` +
          'Zusätzliche permissive Policies werden von PostgreSQL mit ODER verknüpft und können die Mandantentrennung aufweichen.'
      );
      continue;
    }

    const policy = policies[0];

    if (policy.policyname !== EXPECTED_RLS_POLICY_NAME) {
      problems.push(`RLS-Policy ${table}: Name "${policy.policyname}" statt "${EXPECTED_RLS_POLICY_NAME}"`);
    }
    if (policy.permissive !== 'PERMISSIVE') {
      problems.push(`RLS-Policy ${table}: Modus "${policy.permissive}" statt "PERMISSIVE"`);
    }
    if (policy.roles !== '{public}') {
      problems.push(`RLS-Policy ${table}: Rollen "${policy.roles}" statt "{public}"`);
    }
    if (policy.cmd !== 'ALL') {
      problems.push(`RLS-Policy ${table}: Kommando "${policy.cmd}" statt "ALL"`);
    }
    if (!policy.qual || compact(policy.qual) !== compact(EXPECTED_RLS_EXPRESSION)) {
      problems.push(`RLS-Policy ${table}: USING-Ausdruck weicht ab (${policy.qual ?? 'NULL'})`);
    }
    if (!policy.with_check || compact(policy.with_check) !== compact(EXPECTED_RLS_EXPRESSION)) {
      problems.push(`RLS-Policy ${table}: WITH-CHECK-Ausdruck weicht ab (${policy.with_check ?? 'NULL'})`);
    }
  }

  // Rollen, Schema- und Tabellenrechte
  const roleResult = await client.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    rolcanlogin: boolean;
  }>(
    `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
       FROM pg_roles WHERE rolname = 'secops_app_user'`
  );

  if (roleResult.rows.length === 0) {
    problems.push('Rolle fehlt: secops_app_user');
  } else {
    const role = roleResult.rows[0];
    if (role.rolsuper) problems.push('Rolle secops_app_user: unerwartet SUPERUSER');
    if (role.rolbypassrls) problems.push('Rolle secops_app_user: unerwartet BYPASSRLS');
    if (role.rolcreaterole) problems.push('Rolle secops_app_user: unerwartet CREATEROLE');
    if (role.rolcreatedb) problems.push('Rolle secops_app_user: unerwartet CREATEDB');
    if (!role.rolcanlogin) problems.push('Rolle secops_app_user: LOGIN fehlt');

    const schemaResult = await client.query<{ usage: boolean; create: boolean }>(
      `SELECT has_schema_privilege('secops_app_user', 'public', 'USAGE') AS usage,
              has_schema_privilege('secops_app_user', 'public', 'CREATE') AS create`
    );
    if (!schemaResult.rows[0].usage) problems.push('Schema-Recht fehlt: USAGE auf public');
    if (schemaResult.rows[0].create) problems.push('Schema-Recht unerwartet: CREATE auf public');

    const privilegeResult = await client.query<{
      table_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
      can_references: boolean;
      can_trigger: boolean;
    }>(
      `SELECT t AS table_name,
              has_table_privilege('secops_app_user', 'public.' || quote_ident(t), 'SELECT')     AS can_select,
              has_table_privilege('secops_app_user', 'public.' || quote_ident(t), 'INSERT')     AS can_insert,
              has_table_privilege('secops_app_user', 'public.' || quote_ident(t), 'UPDATE')     AS can_update,
              has_table_privilege('secops_app_user', 'public.' || quote_ident(t), 'DELETE')     AS can_delete,
              has_table_privilege('secops_app_user', 'public.' || quote_ident(t), 'TRUNCATE')   AS can_truncate,
              has_table_privilege('secops_app_user', 'public.' || quote_ident(t), 'REFERENCES') AS can_references,
              has_table_privilege('secops_app_user', 'public.' || quote_ident(t), 'TRIGGER')    AS can_trigger
         FROM unnest($1::text[]) AS t`,
      [existingTables]
    );

    for (const row of privilegeResult.rows) {
      const expected = EXPECTED_TABLE_PRIVILEGES[row.table_name];
      if (!expected) continue;

      if (row.can_select !== expected.select)
        problems.push(`Recht SELECT auf ${row.table_name}: ${row.can_select} statt ${expected.select}`);
      if (row.can_insert !== expected.insert)
        problems.push(`Recht INSERT auf ${row.table_name}: ${row.can_insert} statt ${expected.insert}`);
      if (row.can_update !== expected.update)
        problems.push(`Recht UPDATE auf ${row.table_name}: ${row.can_update} statt ${expected.update}`);
      if (row.can_delete !== expected.delete)
        problems.push(`Recht DELETE auf ${row.table_name}: ${row.can_delete} statt ${expected.delete}`);
      if (row.can_truncate) problems.push(`Unerwartetes Recht TRUNCATE auf ${row.table_name}`);
      if (row.can_references) problems.push(`Unerwartetes Recht REFERENCES auf ${row.table_name}`);
      if (row.can_trigger) problems.push(`Unerwartetes Recht TRIGGER auf ${row.table_name}`);
    }
  }

  // Erweiterung, die von Migration 001 benötigt wird
  const extensionResult = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'`);
  if (extensionResult.rowCount === 0) {
    problems.push('Erweiterung fehlt: uuid-ossp');
  }

  return { existingTables, problems };
}

function describeProblems(problems: string[]): string {
  if (problems.length <= 8) {
    return problems.join('; ');
  }
  return `${problems.slice(0, 8).join('; ')}; … (${problems.length - 8} weitere Abweichungen)`;
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

export async function runMigrations(options: MigrationRunnerOptions = {}): Promise<MigrationRunResult> {
  const logger = options.logger ?? ((message: string) => console.log(message));
  const migrationsDir = options.migrationsDir ?? __dirname;
  const connectionString = options.connectionString ?? env.DATABASE_MIGRATION_URL;

  const migrations = loadMigrations(migrationsDir);
  assertBaselineMigrationSet(migrations);

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
      const isTrulyEmpty = inspection.existingTables.length === 0 && inspection.problems.length === 0;

      if (isTrulyEmpty) {
        logger('[MIGRATION] Leere Datenbank erkannt – alle Migrationen werden angewendet.');
      } else {
        if (inspection.problems.length > 0) {
          throw new Error(
            'Bestehende Datenbank entspricht nicht exakt dem erwarteten Stand nach Migration 004. ' +
              `Gefundene erwartete Tabellen: ${inspection.existingTables.length} von ${EXPECTED_TABLES.length}. ` +
              `Details: ${describeProblems(inspection.problems)}. ` +
              'Abbruch, um Migrationen nicht blind als ausgeführt zu markieren.'
          );
        }

        const baselineMigrations = migrations.filter((migration) => migration.numericVersion <= BASELINE_MAX_VERSION);

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
          `[MIGRATION] Bestehende Datenbank vollständig verifiziert. Migrationen 001–004 als Baseline übernommen: ${baselined.join(', ')}`
        );
      }
    }

    // Erwartete Schemaobjekte ausschließlich aus den tatsächlich angewendeten
    // Migrationen ableiten. Noch nicht angewendete Migrationen werden nicht
    // als vorhanden vorausgesetzt.
    const appliedMigrationsForObjects = migrations.filter((migration) =>
      appliedVersions.has(migration.numericVersion)
    );
    const expectedObjects = deriveExpectedSchemaObjects(appliedMigrationsForObjects);
    const objectProblems = await compareSchemaObjects(client, expectedObjects);

    if (objectProblems.length > 0) {
      throw new Error(
        'Bestehende Datenbank enthält unerwartete oder fehlende Schemaobjekte. ' +
          `${describeProblems(objectProblems)}. ` +
          'Abbruch, um keine Migrationen auf einem unbekannten Schema auszuführen.'
      );
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
