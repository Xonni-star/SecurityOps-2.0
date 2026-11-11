import fs from 'fs';
import path from 'path';
import {
  extractSchemaObjects,
  deriveExpectedSchemaObjects,
  MigrationFile
} from '../migrations/runner';

jest.setTimeout(60000);

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function migrationFromFile(filename: string): MigrationFile {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const content = fs.readFileSync(filePath);
  return {
    version: filename.slice(0, 3),
    numericVersion: parseInt(filename.slice(0, 3), 10),
    filename,
    filePath,
    checksum: '',
    sql: content.toString('utf8')
  };
}

describe('SQL-Migrationsparser – lexikalische Härtung', () => {
  test('1. Kommentarzeichen innerhalb von SQL-Zeichenketten', () => {
    const result = extractSchemaObjects(
      `CREATE TABLE kommentar_tabelle (note TEXT DEFAULT '-- kein Kommentar /* auch nicht */');`,
      'test.sql'
    );

    expect([...result.relations.keys()]).toEqual(['kommentar_tabelle']);
  });

  test('2. SQL-Kommentare und Fake-DDL in Dollar-quoted Funktionskörpern', () => {
    const sql = `
      CREATE FUNCTION body_fn() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        -- CREATE TABLE fake_table (id int);
        /* CREATE TABLE fake_table2 (id int); */
        RAISE NOTICE 'CREATE TABLE fake_table3 (id int)';
      END
      $$;
    `;

    const result = extractSchemaObjects(sql, 'test.sql');

    expect(result.relations.size).toBe(0);
    expect(result.routines).toEqual([{ name: 'body_fn', args: [] }]);
  });

  test('3. Verschiedene Dollar-Quote-Tags', () => {
    const sql = `
      CREATE FUNCTION tag_fn() RETURNS void LANGUAGE plpgsql AS $body$ BEGIN NULL; END $body$;
      CREATE FUNCTION tag_fn2() RETURNS integer LANGUAGE sql AS $fn_1$ SELECT 1 $fn_1$;
    `;

    const result = extractSchemaObjects(sql, 'test.sql');

    expect(result.routines.map((routine) => routine.name).sort()).toEqual(['tag_fn', 'tag_fn2']);
  });

  test('4. Doppelt gequotete Bezeichner mit Großbuchstaben', () => {
    const result = extractSchemaObjects(
      `CREATE TABLE "Tasks" (id INT); CREATE TABLE Tasks (id INT);`,
      'test.sql'
    );

    expect([...result.relations.keys()].sort()).toEqual(['Tasks', 'tasks']);
  });

  test('5. Schemaqualifizierte Objekte', () => {
    const sql = `
      CREATE TABLE public.pub_table (id INT);
      CREATE TABLE other.priv_table (id INT);
      CREATE TABLE "Public".quoted_schema (id INT);
    `;

    const result = extractSchemaObjects(sql, 'test.sql');

    expect([...result.relations.keys()]).toEqual(['pub_table']);
  });

  test('6. Verschachtelte Parameterlisten und Typmodifikatoren', () => {
    const result = extractSchemaObjects(
      `CREATE FUNCTION nested(a numeric(10,2), b text) RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
      'test.sql'
    );

    expect(result.routines[0].args).toEqual(['numeric(10, 2)', 'text']);
  });

  test('7. DEFAULT-Parameter', () => {
    const result = extractSchemaObjects(
      `CREATE FUNCTION def_fn(x integer DEFAULT 5) RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
      'test.sql'
    );

    expect(result.routines[0].args).toEqual(['integer']);
  });

  test('8. VARIADIC-Parameter', () => {
    const result = extractSchemaObjects(
      `CREATE FUNCTION var_fn(VARIADIC x integer[]) RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
      'test.sql'
    );

    expect(result.routines[0].args).toEqual(['integer[]']);
  });

  test('9. Benutzerdefinierte und schemaqualifizierte Parametertypen', () => {
    const result = extractSchemaObjects(
      `CREATE FUNCTION custom_fn(x my_type, y public.other_type) RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
      'test.sql'
    );

    expect(result.routines[0].args).toEqual(['my_type', 'public.other_type']);
  });

  test('10. Überladene Funktionen gleichen Namens', () => {
    const result = extractSchemaObjects(
      `
        CREATE FUNCTION over_fn(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION over_fn(x text) RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `,
      'test.sql'
    );

    expect(result.routines).toEqual([
      { name: 'over_fn', args: ['integer'] },
      { name: 'over_fn', args: ['text'] }
    ]);
  });

  test('11. Ungültige oder nicht eindeutig analysierbare DDL', () => {
    expect(() => extractSchemaObjects('CREATE TABLE ;', 'test.sql')).toThrow(
      /Objektname fehlt|Bezeichner erwartet/
    );
    expect(() => extractSchemaObjects('CREATE FUNCTION broken(', 'test.sql')).toThrow(
      /nicht geschlossene Parameterliste/
    );
    expect(() => extractSchemaObjects('CREATE TYPE weird AS SOMETHING;', 'test.sql')).toThrow(
      /nicht unterstützte Form/
    );
    expect(() =>
      extractSchemaObjects(`CREATE TABLE x (note TEXT DEFAULT 'unterminated);`, 'test.sql')
    ).toThrow(/nicht terminierte Zeichenkette/);
  });

  test('12. Migrationen 001–004 werden vollständig erkannt', () => {
    const files = [
      '001_initial_schema.sql',
      '002_idempotency_and_versioning.sql',
      '003_conflict_receipts_separation.sql',
      '004_operational_delete_privileges.sql'
    ];

    const expected = deriveExpectedSchemaObjects(files.map(migrationFromFile));

    expect(expected.relations.size).toBe(21);
    expect(expected.types.size).toBe(0);
    expect(expected.routines.map((routine) => routine.name).sort()).toEqual([
      'prevent_guardbook_tampering',
      'prevent_revision_tampering'
    ]);
  });
});
