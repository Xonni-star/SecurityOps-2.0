# SecurityOps 2.0 – Schritt 5R.2.30
## SQL-Migrationsparser sicher und robust machen

**Ausgangsstand:** `main` @ `034a344a90b99bf09a0c0c25cfb93c8cb8459bba`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: harden SQL migration schema parser`

---

## 1. Ziel

Die in Schritt 5R.2.29 eingeführte versionsabhängige Schema-Prüfung stützte sich auf reguläre Ausdrücke und eine Vorab-Entfernung von Kommentaren und Literalen. Das war für komplexere SQL-Migrationsdateien nicht ausreichend robust. Schritt 5R.2.30 ersetzt diese Verarbeitung durch einen echten SQL-Lexer und einen tokenbasierten DDL-Scanner.

---

## 2. Analysierte Schwachstellen der bisherigen Implementierung

| Stelle | Problem |
|---|---|
| `stripSqlComments()` | Entfernte `--` und `/* */` **vor** dem Maskieren von Zeichenketten. Kommentarzeichen innerhalb von Strings oder Dollar-quoted Funktionskörpern wurden fälschlich als Kommentar behandelt. |
| `maskSqlLiterals()` | Regex-basiert; verschachtelte oder getaggte Dollar-Quotes und Escape-Strings (`E'...'`) nicht zuverlässig. |
| `normalizeIdentifier()` | Entfernte Anführungszeichen und wandelte **alle** Namen in Kleinbuchstaben um. PostgreSQL quotet Bezeichner aber case-sensitiv; `"Tasks"` und `tasks` sind verschieden. |
| Schemaqualifikation | Der letzte Namensbestandteil wurde verwendet. `anderesschema.tasks` wäre fälschlich als `public.tasks` behandelt worden. |
| `normalizeTypeName()` / `normalizeArgumentList()` | Heuristisch; verschachtelte Typausdrücke, Typmodifikatoren, DEFAULT-Werte, VARIADIC, benutzerdefinierte und schemaqualifizierte Typen waren nicht sicher abgedeckt. |
| `extractParenthesized()` | Klammerzählung ohne Berücksichtigung von Strings/Kommentaren; nach dem fehlerhaften Vorab-Strippen zusätzlich fragil. |
| Signaturen | Vergleich nur über den Routine-Namen; Überladungen mit gleichem Namen wären nicht unterscheidbar gewesen. |

---

## 3. Neue Parserarchitektur

### 3.1 Lexer (`lexSql`)

Erzeugt Token für:

- unquotierte Wörter/Bezeichner (Folding nach Kleinbuchstaben)
- doppelt gequotete Bezeichner inkl. `""`-Escape (Case bleibt erhalten)
- einfach gequotete Zeichenketten inkl. `''`-Escape
- `E'...'`-Strings mit Backslash-Escapes
- Dollar-quoted Strings mit beliebigem Tag (`$$`, `$body$`, `$fn_1$`) inkl. korrekter Suche nach dem passenden End-Tag
- Zahlen, Satzzeichen, Operatoren
- Zeilenkommentare (`--`) und **verschachtelte** Blockkommentare (`/* ... /* ... */ ... */`)

Kommentare werden nur im Code-Kontext übersprungen. Innerhalb von Zeichenketten und Dollar-quoted Körpern bleiben sie unangetastet. Nicht terminierte Strings, Bezeichner, Dollar-Quotes oder Blockkommentare führen zu einem klaren Fehler.

### 3.2 Tokenbasierter DDL-Scanner (`extractSchemaObjects`)

Erkennt am Statement-Anfang:

- `CREATE [OR REPLACE] [UNLOGGED|TEMP|TEMPORARY] TABLE [IF NOT EXISTS] …`
- `CREATE FOREIGN TABLE …`
- `CREATE [OR REPLACE] [MATERIALIZED] VIEW …`
- `CREATE [UNLOGGED] SEQUENCE …`
- `CREATE TYPE … AS ENUM|RANGE|(…)`
- `CREATE DOMAIN …`
- `CREATE [OR REPLACE] FUNCTION|PROCEDURE … ( … )`

`PARTITION BY` wird auf oberster Statement-Ebene erkannt (→ partitionierte Tabelle). Andere `CREATE`-Formen (INDEX, EXTENSION, SCHEMA, TRIGGER, POLICY, …) werden ignoriert.

### 3.3 Bezeichner und Schemaqualifikation

- Unquotiert → PostgreSQL-Folding nach Kleinbuchstaben.
- Quotiert → exakte Schreibweise inklusive Groß-/Kleinschreibung.
- Schema wird separat geparst. Nur unqualifizierte Namen und `public` fließen in die Erwartung für `public` ein.
- `anderesschema.x` und `"Public".x` werden **nicht** als `public.x` behandelt.
- Dreiteilige Namen werden als nicht unterstützt abgelehnt.

### 3.4 Routinen und Signaturen

Parameter werden tokenbasiert verarbeitet:

- verschachtelte Klammern und Typmodifikatoren (`numeric(10,2)`)
- `IN`, `OUT`, `INOUT`, `VARIADIC`
- `DEFAULT` und `=`
- optionale Parameternamen (auch gequotet)
- mehrteilige Typnamen (`double precision`, `timestamp with time zone`, `character varying`)
- Array-Typen (`integer[]`)
- benutzerdefinierte und schemaqualifizierte Typen

`OUT`-Parameter zählen nicht zur Identitätssignatur und werden entfernt. Bei nicht eindeutig analysierbaren Parametern bricht der Parser mit einem Fehler ab – die Signatur gilt nicht stillschweigend als korrekt.

Für den eigentlichen Vergleich wird PostgreSQL selbst genutzt:

- Erwartete Signatur → `to_regprocedure(...)`
- Ist-Signatur → `p.oid::regprocedure::text`

Damit werden Typaliase, Typmodifikatoren, Suchpfad und Überladungen durch PostgreSQL kanonisiert. Nicht auflösbare erwartete Signaturen werden als Problem gemeldet.

---

## 4. Fail-Closed-Verhalten

Der Parser bricht mit einer klaren Meldung ab bei:

- nicht termierten Strings, Bezeichnern, Dollar-Quotes oder Blockkommentaren
- fehlendem Objektnamen
- nicht geschlossener Parameterliste
- nicht unterstützter `CREATE TYPE`-Form
- mehrdeutigen Parametern
- dreiteiligen Objektnamen

Es werden keine Objekte oder Daten verändert.

---

## 5. Tests

### 5.1 Neue Parser-Unit-Tests (`migrationParser.test.ts`, 12 Tests)

| # | Test |
|---|---|
| 1 | Kommentarzeichen innerhalb von SQL-Zeichenketten |
| 2 | SQL-Kommentare/Fake-DDL in Dollar-quoted Funktionskörpern |
| 3 | Verschiedene Dollar-Quote-Tags |
| 4 | Doppelt gequotete Bezeichner mit Großbuchstaben |
| 5 | Schemaqualifizierte Objekte (public vs. anderes Schema) |
| 6 | Verschachtelte Parameterlisten und Typmodifikatoren |
| 7 | DEFAULT-Parameter |
| 8 | VARIADIC-Parameter |
| 9 | Benutzerdefinierte/schemaqualifizierte Parametertypen |
| 10 | Überladene Funktionen gleichen Namens |
| 11 | Ungültige/nicht analysierbare DDL |
| 12 | Vollständige Erkennung von 001–004 (21 Relationen, 2 Routinen, 0 Typen) |

### 5.2 Neue Integrationstests (`migrations.test.ts`, Tests 51–54)

| # | Test |
|---|---|
| 51 | Migration mit Kommentarzeichen in Zeichenketten wird angewendet und erneut akzeptiert |
| 52 | Dollar-quoted Funktionskörper mit Fake-DDL erzeugt keine falschen Erwartungen |
| 53 | Gequotete und schemaqualifizierte Objekte werden korrekt zugeordnet |
| 54 | DEFAULT-, VARIADIC-, benutzerdefinierte und verschachtelte Parametertypen werden korrekt verglichen; zusätzliche Überladung wird erkannt |

Alle Tests laufen gegen echtes PostgreSQL 16 in isolierten Testdatenbanken.

---

## 6. Lokale Ergebnisse

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`).

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Parser- und Migrationstests | ✅ **66/66** (12 Unit + 54 Integration) |
| Vollständige Backend-Suite | ✅ **102/102 Tests, 6/6 Suites** |

---

## 7. GitHub Actions

Die CI/CD-Konfiguration wurde nicht verändert. Der Backend-Job führt den Schritt „Migrationshistorie & Baseline (Integrationstests)“ aus (54 Tests); die Parser-Unit-Tests laufen in der vollständigen Jest-Suite.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | [`43059581251`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43059581251) | Root – npm ci, Strukturprüfung, Gesamtstart | **success** (45 s) |
| SecurityOps 2.0 CI | [`43059581251`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43059581251) | Frontend – npm ci, Vitest, Produktions-Build | **success** (13 s) |
| SecurityOps 2.0 CI | [`43059581251`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43059581251) | Backend – PostgreSQL 16, Migration, Build, Jest | **success** (1 m 28 s) |
| SecurityOps 2.0 CD | [`43059858470`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43059858470) | Release-Paket aus CI-Artefakten bauen | **success** |

Der Schritt **„Migrationshistorie & Baseline (Integrationstests)“** wurde im Backend-Job mit **success** abgeschlossen; die vollständige Jest-Suite (102 Tests) lief ebenfalls erfolgreich.

### Artefakte (über GitHub-API geprüft)

| Run | Artefakt | Größe | Status |
|---|---|---|---|
| CI `43059581251` | `frontend-dist` | 337.989 Bytes | vorhanden, nicht abgelaufen |
| CI `43059581251` | `backend-dist` | 57.761 Bytes | vorhanden, nicht abgelaufen |
| CD `43059858470` | `securityops-release-cc6d8840edf836c36609c3e09a83caada6e84950` | 396.323 Bytes | vorhanden, nicht abgelaufen |

---

## 8. Bekannte Einschränkungen

1. **Dynamisches SQL:** Objekte, die ausschließlich in `DO`-Blöcken oder über dynamisches SQL erzeugt werden, können statisch nicht abgeleitet werden.
2. **Nicht unterstützte `CREATE`-Formen** werden ignoriert (z. B. `CREATE INDEX`, `CREATE EXTENSION`). Sie erzeugen keine Erwartungen für Tabellen/Views/Sequenzen/Routinen/Typen.
3. **Dreiteilige Objektnamen** werden bewusst abgelehnt, da sie für Migrations-DDL unüblich und nicht eindeutig auf `public` abbildbar sind.
4. **Typmodifikatoren** werden für die Signaturauflösung entfernt (`numeric(10,2)` → `numeric`), da sie nicht Teil der Routineidentität sind.
5. **Detaillierte 001–004-Prüfungen** (Spalten, Constraints, Trigger, RLS, Rechte) bleiben unverändert bestehen.

---

## 9. Sicherheitsvorgaben

- ✅ Keine Änderung an Migrationen 001–004
- ✅ Keine Datenverluste, keine automatische Entfernung von Objekten
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Offline-Synchronisation oder Mandantenarchitektur
- ✅ Keine Änderungen an CI/CD-Konfiguration oder Secrets
- ✅ Keine unnötigen Refactorings
- ✅ Bestehende Migrationen bleiben kompatibel
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
