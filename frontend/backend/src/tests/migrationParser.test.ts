import fs from 'fs';
import path from 'path';
import {
  extractSchemaObjects,
  deriveExpectedSchemaObjects,
  stripTypeModifiers,
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

  test('13. Gequotete und schemaqualifizierte Parametertypen bleiben erhalten', () => {
    const cases: Array<[string, string]> = [
      ['"MeinSchema"."MeinTyp"', '"MeinSchema"."MeinTyp"'],
      ['public."MeinTyp"', 'public."MeinTyp"'],
      ['"MeinTyp"[]', '"MeinTyp"[]'],
      ['"Parametername" "MeinSchema"."MeinTyp"', '"MeinSchema"."MeinTyp"'],
      ['"Parametername" public."MeinTyp"', 'public."MeinTyp"'],
      ['"Parametername" integer', 'integer'],
      ['integer[]', 'integer[]'],
      ['numeric(10,2)', 'numeric(10, 2)']
    ];

    for (const [parameter, expected] of cases) {
      const result = extractSchemaObjects(
        `CREATE FUNCTION variant_fn(${parameter}) RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
        'test.sql'
      );

      expect(result.routines[0].args).toEqual([expected]);
    }
  });

  test('14. Unquotierte Parameternamen vor schemaqualifizierten Typen', () => {
    const cases: Array<[string, string]> = [
      ['p "MeinSchema"."MeinTyp"', '"MeinSchema"."MeinTyp"'],
      ['p public."MeinTyp"', 'public."MeinTyp"'],
      ['p "MeinTyp"[]', '"MeinTyp"[]']
    ];

    for (const [parameter, expected] of cases) {
      const result = extractSchemaObjects(
        `CREATE FUNCTION unquoted_fn(${parameter}) RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
        'test.sql'
      );

      expect(result.routines[0].args).toEqual([expected]);
    }
  });

  test('15. Mehrdeutige und fehlerhafte Signaturen führen zum Abbruch', () => {
    expect(() =>
      extractSchemaObjects(
        `CREATE FUNCTION ambiguous_fn(integer text) RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
        'test.sql'
      )
    ).toThrow(/nicht eindeutig analysierbar/);

    expect(() => extractSchemaObjects('CREATE FUNCTION broken_fn("MeinTyp"', 'test.sql')).toThrow(
      /nicht geschlossene Parameterliste/
    );
  });

  test('16. Überladungen mit gequoteten und schemaqualifizierten Typen', () => {
    const result = extractSchemaObjects(
      `
        CREATE FUNCTION overload_q("MeinSchema"."MeinTyp") RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_q(public."MeinTyp") RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_q(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `,
      'test.sql'
    );

    expect(result.routines.map((routine) => routine.args[0])).toEqual([
      '"MeinSchema"."MeinTyp"',
      'public."MeinTyp"',
      'integer'
    ]);
  });

  test('17. Typmodifikatoren werden tokenbasiert entfernt', () => {
    const cases: Array<[string, string]> = [
      ['numeric(10,2)', 'numeric'],
      ['varchar(255)', 'character varying'],
      ['"MeinTyp"(10)', '"MeinTyp"'],
      ['"MeinSchema"."MeinTyp"(10)', '"MeinSchema"."MeinTyp"'],
      ['public."MeinTyp"(10)', 'public."MeinTyp"'],
      ['numeric(10,2)[]', 'numeric[]'],
      ['"MeinSchema"."MeinTyp"[]', '"MeinSchema"."MeinTyp"[]']
    ];

    for (const [input, expected] of cases) {
      expect(stripTypeModifiers(input)).toBe(expected);
    }
  });

  test('18. Verschachtelte und mehrteilige Typmodifikatoren', () => {
    expect(stripTypeModifiers('geometry(Point,4326)')).toBe('geometry');
    expect(stripTypeModifiers('timestamp(3) with time zone')).toBe('timestamp with time zone');
    expect(stripTypeModifiers('character varying(10)')).toBe('character varying');
    expect(stripTypeModifiers('numeric(10,2)[]')).toBe('numeric[]');
  });

  test('19. Array-Typ-Aliase werden auf den Basistyp angewendet', () => {
    const cases: Array<[string, string]> = [
      ['int[]', 'integer[]'],
      ['int[][]', 'integer[][]'],
      ['int4[]', 'integer[]'],
      ['varchar(255)[]', 'character varying[]'],
      ['numeric(10,2)[]', 'numeric[]'],
      ['timestamp(3)[]', 'timestamp without time zone[]'],
      ['"MeinSchema"."MeinTyp"[]', '"MeinSchema"."MeinTyp"[]'],
      ['public."MeinTyp"[][]', 'public."MeinTyp"[][]'],
      ['integer[][]', 'integer[][]']
    ];

    for (const [input, expected] of cases) {
      expect(stripTypeModifiers(input)).toBe(expected);
    }
  });

  test('20. Vollständige PostgreSQL-16-Alias-Normalisierung', () => {
    const cases: Array<[string, string]> = [
      ['int', 'integer'],
      ['int4', 'integer'],
      ['int2', 'smallint'],
      ['int8', 'bigint'],
      ['bool', 'boolean'],
      ['float4', 'real'],
      ['float8', 'double precision'],
      ['float', 'double precision'],
      ['float(1)', 'real'],
      ['float(24)', 'real'],
      ['float(25)', 'double precision'],
      ['float(53)', 'double precision'],
      ['decimal', 'numeric'],
      ['dec', 'numeric'],
      ['varchar', 'character varying'],
      ['char', 'character'],
      ['bpchar', 'character'],
      ['nchar', 'character'],
      ['varbit', 'bit varying'],
      ['timestamptz', 'timestamp with time zone'],
      ['timestamp', 'timestamp without time zone'],
      ['timetz', 'time with time zone'],
      ['time', 'time without time zone'],
      ['int2[]', 'smallint[]'],
      ['int2[][]', 'smallint[][]'],
      ['varbit(10)[]', 'bit varying[]'],
      ['float(24)[][]', 'real[][]'],
      ['float(25)[]', 'double precision[]'],
      ['"float"', '"float"'],
      ['public."int"', 'public."int"'],
      ['"MeinSchema"."MeinTyp"[]', '"MeinSchema"."MeinTyp"[]']
    ];

    for (const [input, expected] of cases) {
      expect(stripTypeModifiers(input)).toBe(expected);
    }
  });

  test('21. Ungültige float-Präzisionen werden abgelehnt', () => {
    for (const value of ['float(0)', 'float(54)', 'float(2.5)', 'float()', 'float(1,2)']) {
      expect(() => stripTypeModifiers(value)).toThrow(/float-Präzision/);
    }
  });
});
