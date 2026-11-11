# SecurityOps 2.0 – Schritt 5R.2.32
## Typmodifikatoren bei gequoteten PostgreSQL-Typen korrekt normalisieren

**Ausgangsstand:** `main` @ `149cc1fbd06199a2a7942b344d6b8a9b044bec68`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: normalize typmods for quoted PostgreSQL types`

---

## 1. Fehlerursache

`stripTypeModifiers()` in `frontend/backend/src/migrations/runner.ts` arbeitete mit einem regulären Ausdruck:

```ts
const match = typeText.match(/^([^()]+)\(([^()]*)\)(.*)$/);
if (match && !match[1].trim().endsWith('"')) {
  return `${match[1]}${match[3]}`.trim();
}
return typeText;
```

Die Bedingung `!match[1].trim().endsWith('"')` sollte gequotete Typnamen schützen, führte aber dazu, dass Typmodifikatoren bei **allen** Typen, deren Basisname mit `"` endet, nicht entfernt wurden:

- `"MeinTyp"(10)`
- `"MeinSchema"."MeinTyp"(10)`
- `public."MeinTyp"(10)`

Zusätzlich war die Regex nicht robust gegen verschachtelte Klammern und array-spezifische Suffixe.

---

## 2. Implementierung

### 2.1 Tokenbasierte Entfernung

Die neue Implementierung nutzt den vorhandenen SQL-Lexer und den Token-zu-Text-Renderer:

1. Typausdruck tokenisieren (`lexSql`), dabei gequotete Bezeichner, Schemaqualifikationen und Array-Klammern korrekt erhalten.
2. Die **erste** Klammergruppe auf oberster Ebene suchen und inklusive verschachtelter Klammern entfernen.
3. Restliche Tokens wieder rendern – Array-Suffixe (`[]`) und mehrteilige Typen (`with time zone`) bleiben erhalten.
4. Einzelne unquotierte Basistyp-Aliase normalisieren.

Nicht entfernt werden Klammern innerhalb gequoteter Bezeichner, da diese vom Lexer als ein Token behandelt werden.

### 2.2 Alias-Normalisierung

Nach dem Entfernen des Typmodifikators werden einfache, unquotierte Basistypen normalisiert:

| Alias | Normalisiert |
|---|---|
| `int`, `int4` | `integer` |
| `int2` | `smallint` |
| `int8` | `bigint` |
| `bool` | `boolean` |
| `varchar` | `character varying` |
| `char` | `character` |
| `float4` | `real` |
| `float8` | `double precision` |
| `decimal` | `numeric` |
| `timestamptz` | `timestamp with time zone` |
| `timestamp` | `timestamp without time zone` |
| `timetz` | `time with time zone` |
| `time` | `time without time zone` |

Quotierte, schemaqualifizierte und Array-Typen werden nicht umgeschrieben.

### 2.3 Ergebnisse

| Eingabe | Ergebnis |
|---|---|
| `numeric(10,2)` | `numeric` |
| `varchar(255)` | `character varying` |
| `"MeinTyp"(10)` | `"MeinTyp"` |
| `"MeinSchema"."MeinTyp"(10)` | `"MeinSchema"."MeinTyp"` |
| `public."MeinTyp"(10)` | `public."MeinTyp"` |
| `numeric(10,2)[]` | `numeric[]` |
| `"MeinSchema"."MeinTyp"[]` | `"MeinSchema"."MeinTyp"[]` |
| `geometry(Point,4326)` | `geometry` |
| `timestamp(3) with time zone` | `timestamp with time zone` |
| `character varying(10)` | `character varying` |

Die Funktion ist für Unit-Tests exportiert (`stripTypeModifiers`).

---

## 3. Tests

### 3.1 Parser-Unit-Tests (`migrationParser.test.ts`)

| # | Test |
|---|---|
| 17 | Alle geforderten Typmodifikator-Varianten inkl. gequoteter, schemaqualifizierter und Array-Typen |
| 18 | Verschachtelte Typmodifikatoren (`geometry(Point,4326)`), mehrteilige Typen (`timestamp(3) with time zone`, `character varying(10)`) |

### 3.2 PostgreSQL-16-Integrationstest (`migrations.test.ts`, Test 56)

Legt in einer isolierten Datenbank an:

- eigenes Schema `"MeinSchema"`
- gequoteten benutzerdefinierten Typ `"MeinSchema"."MeinTyp"`
- öffentlichen gequoteten Typ `public."OeffentlicherTyp"`
- Funktionen mit `numeric(10,2)`, `varchar(255)`, `numeric(10,2)[]`, `integer[]`
- schemaqualifizierte/quoted Parametertypen
- zwei Überladungen von `overload_mod` mit `numeric(10,2)` und `integer`

Nachweis:

1. Migration wird erfolgreich ausgeführt.
2. Zweiter Lauf akzeptiert das Schema (Typ- und Signaturprüfung).
3. Eine nachträglich angelegte, nicht deklarierte Überladung `mod_fn(integer)` wird erkannt.

---

## 4. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`).

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Parser- und Migrationstests | ✅ **74/74** (18 Unit + 56 Integration) |
| Vollständige Backend-Suite | ✅ **110/110 Tests, 6/6 Suites** |

---

## 5. GitHub Actions

Die CI/CD-Konfiguration wurde nicht verändert.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | _wird ergänzt_ | Root | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Frontend | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Backend (PostgreSQL 16) | _wird ergänzt_ |
| SecurityOps 2.0 CD | _wird ergänzt_ | Release-Paket | _wird ergänzt_ |

Artefaktgrößen und Status werden nach dem Lauf über die GitHub-API geprüft.

---

## 6. Bekannte Einschränkungen

1. Nur der **erste** Typmodifikator auf oberster Ebene wird entfernt. Mehrfache Typmodifikatoren sind in PostgreSQL-Typausdrücken nicht üblich und würden als ungültige Signatur sicher abgelehnt.
2. Die Alias-Normalisierung greift nur bei einfachen, unquotierten Basistypen. Quotierte oder schemaqualifizierte Typen bleiben unverändert.
3. Dynamisches SQL in `DO`-Blöcken wird weiterhin nicht statisch analysiert.
4. Die detaillierten 001–004-Prüfungen bleiben unverändert.

---

## 7. Sicherheitsvorgaben

- ✅ Keine Änderung an Migrationen 001–004
- ✅ Keine Änderung an bestehenden Daten
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Mandantenfähigkeit oder Offline-Synchronisation
- ✅ Keine Änderungen an CI/CD-Konfiguration oder Secrets
- ✅ Keine unnötigen Refactorings
- ✅ Nur Schritt 5R.2.32 umgesetzt
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
