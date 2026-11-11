# SecurityOps 2.0 – Schritt 5R.2.31
## Gequotete und schemaqualifizierte Routinen-Parametertypen korrigieren

**Ausgangsstand:** `main` @ `bcd6acc48ef0c092e04ab37da9e952c717b327cc`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: handle quoted schema-qualified routine parameter types`

---

## 1. Fehlerursache

In `parseParameter()` wurde ein doppelt gequoteter erster Token pauschal als Parametername behandelt, sofern der zweite Token kein `[` war:

```ts
if (first.type === 'quoted_ident') {
  if (!isPunct(second, '[')) {
    work = work.slice(1);
  }
}
```

Damit wurde aus:

```sql
"MeinSchema"."MeinTyp"
```

fälschlich der Typ `. "MeinTyp"` – der Schemateil ging verloren. Betroffen waren insbesondere:

- `"MeinSchema"."MeinTyp"`
- `"Parametername" "MeinSchema"."MeinTyp"` (nach Entfernen des Namens wurde der Typ nicht erneut geprüft)
- Quoted Typen mit Typmodifikator `"MeinTyp"(…)`

Zusätzlich wurde eine Folge aus bekanntem Typwort und weiterem Bezeichner (z. B. `integer text`) stillschweigend als Typ akzeptiert, obwohl sie auch als Parametername + Typ interpretierbar ist.

---

## 2. Konkrete Codeänderung

In `frontend/backend/src/migrations/runner.ts`, Funktion `parseParameter()`:

### 2.1 Gequoteter erster Bezeichner

Die Entscheidung erfolgt jetzt anhand der vollständigen Tokenfolge. Ein gequoteter erster Token bleibt Teil des Typs, wenn der zweite Token

- `.` (Schemaqualifikation),
- `[` (Array-Suffix) oder
- `(` (Typmodifikator)

ist. Andernfalls ist er ein Parametername und wird entfernt.

Damit gilt:

| Eingabe | Erkannt als |
|---|---|
| `"MeinSchema"."MeinTyp"` | Typ `"MeinSchema"."MeinTyp"` |
| `"MeinTyp"[]` | Typ `"MeinTyp"[]` |
| `"Parametername" "MeinSchema"."MeinTyp"` | Name entfernt → Typ `"MeinSchema"."MeinTyp"` |
| `"Parametername" public."MeinTyp"` | Name entfernt → Typ `public."MeinTyp"` |
| `"Parametername" integer` | Name entfernt → Typ `integer` |

### 2.2 Word-basierter erster Bezeichner

Zusätzlich wird ein bekannter Typwort-Start nur noch dann ohne Namensprüfung akzeptiert, wenn

- eine Schemaqualifikation (`.`),
- ein Array-Suffix (`[`),
- ein Typmodifikator (`(`) oder
- ein bekannter Mehrwort-Typ (`double precision`, `timestamp with time zone`, `character varying`, …)

vorliegt. Folgt auf ein bekanntes Typwort direkt ein weiterer Bezeichner ohne diese Muster, bricht der Parser mit

`Parameter "…" ist nicht eindeutig analysierbar`

ab. Damit wird `integer text` nicht mehr stillschweigend als Typ akzeptiert.

### 2.3 Unverändert

- Unquotierte Parameternamen vor Typen (`x integer`, `x "MeinTyp"[]`) werden weiterhin korrekt entfernt.
- `DEFAULT`/`=`, `IN/OUT/INOUT/VARIADIC`, Typmodifikatoren und Array-Typen bleiben unverändert unterstützt.
- Der Vergleich der Routinen erfolgt weiterhin über `to_regprocedure()` und `oid::regprocedure::text`.

---

## 3. Neue Tests

### 3.1 Parser-Unit-Tests (`migrationParser.test.ts`)

| # | Test |
|---|---|
| 13 | Alle geforderten Varianten: `"MeinSchema"."MeinTyp"`, `public."MeinTyp"`, `"MeinTyp"[]`, `"Parametername" "MeinSchema"."MeinTyp"`, `"Parametername" public."MeinTyp"`, `"Parametername" integer`, `integer[]`, `numeric(10,2)` |
| 14 | Unquotierte Parameternamen vor schemaqualifizierten/quoted Typen (`p "MeinSchema"."MeinTyp"` usw.) |
| 15 | Mehrdeutige (`integer text`) und fehlerhafte (`CREATE FUNCTION f("MeinTyp"`) Signaturen führen zum Abbruch |
| 16 | Überladungen mit quoted/schemaqualifizierten Typen werden als getrennte Signaturen erkannt |

### 3.2 PostgreSQL-16-Integrationstest (`migrations.test.ts`, Test 55)

Legt in einer isolierten Datenbank an:

- Schema `"MeinSchema"` und Typ `"MeinSchema"."MeinTyp"` (Enum)
- öffentlichen Typ `public."OeffentlicherTyp"` (Enum)
- Funktionen mit quoted/schemaqualifizierten Parametern, quoted Parameternamen, `integer[]`, `numeric(10,2)`
- zwei Überladungen von `overload_fn` mit unterschiedlichen quoted/schemaqualifizierten Typen

Der Test weist nach:

1. Die Migration wird angewendet.
2. Ein zweiter Lauf akzeptiert alle Signaturen.
3. Eine nachträglich angelegte, nicht deklarierte Überladung `quoted_fn(integer)` wird erkannt.

---

## 4. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`).

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Parser- und Migrationstests | ✅ **71/71** (16 Unit + 55 Integration) |
| Vollständige Backend-Suite | ✅ **107/107 Tests, 6/6 Suites** |

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

1. `integer text` wird bewusst als mehrdeutig abgelehnt, obwohl PostgreSQL es als Parametername `integer` mit Typ `text` akzeptieren könnte. Das ist gewolltes Fail-Closed-Verhalten.
2. Dynamisches SQL in `DO`-Blöcken wird weiterhin nicht statisch analysiert.
3. Nicht unterstützte `CREATE`-Formen (Index, Extension, Schema, Trigger, Policy) erzeugen keine Erwartungen.
4. Die detaillierten 001–004-Prüfungen (Spalten, Constraints, Trigger, RLS, Rechte) bleiben unverändert.

---

## 7. Sicherheitsvorgaben

- ✅ Keine Änderung an Migrationen 001–004
- ✅ Keine Änderung an bestehenden Datenbankdaten
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Mandantenfähigkeit oder Offline-Synchronisation
- ✅ Keine Änderungen an CI/CD-Konfiguration oder Secrets
- ✅ Keine unnötigen Refactorings
- ✅ Bestehende Parser- und Migrationstests bleiben erfolgreich
- ✅ Keine weiteren Entwicklungsschritte begonnen
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
