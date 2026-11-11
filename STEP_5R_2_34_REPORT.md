# SecurityOps 2.0 – Entwicklungsschritt 5R.2.34
## PostgreSQL-16-Typ-Aliase vollständig normalisieren

**Ausgangsstand:** `main` @ `d61917933994fdfb6b676778125f91da1f3caf29`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: complete PostgreSQL type alias normalization`

---

## 1. Ausgangsproblem

Die bestehende `TYPE_ALIASES`-Tabelle deckte nur einen Teil der PostgreSQL-16-Aliase ab. Insbesondere fehlten:

- `dec` (Alias für `numeric`)
- `bpchar` und `nchar` (Aliase für `character`)
- `varbit` (Alias für `bit varying`)
- `float` ohne Präzision (Alias für `double precision`)
- `float(p)` mit Präzisionsvarianten:
  - `p = 1…24` → `real`
  - `p = 25…53` → `double precision`

Zusätzlich musste die bereits in 5R.2.33 eingeführte Array-Behandlung erhalten bleiben: Aliase werden nur auf den Basistyp angewendet, Array-Suffixe bleiben unverändert.

---

## 2. Geänderte Dateien

| Datei | Änderung |
|---|---|
| `frontend/backend/src/migrations/runner.ts` | `TYPE_ALIASES` ergänzt; `stripTypeModifiers()` um `float`/`float(p)`-Auswertung erweitert |
| `frontend/backend/src/tests/migrationParser.test.ts` | Unit-Tests 20 (vollständige Aliase) und 21 (ungültige float-Präzisionen) |
| `frontend/backend/src/tests/migrations.test.ts` | Integrationstest 58 (Alias/Kanonisch, Überladungen, Idempotenz, Extra-Signatur) |
| `STEP_5R_2_34_REPORT.md` | Dieser Bericht |

Keine Änderungen an Migrationen 001–004, Daten, Frontend/API, Mandantenfähigkeit, Offline-Synchronisation, CI/CD oder Secrets.

---

## 3. Ergänzte Alias-Normalisierungen

### 3.1 Tabelle

Neu ergänzt:

| Alias | Normalisiert |
|---|---|
| `dec` | `numeric` |
| `bpchar` | `character` |
| `nchar` | `character` |
| `varbit` | `bit varying` |

Bereits vorhanden und weiterhin aktiv:

`int`/`int4` → `integer`, `int2` → `smallint`, `int8` → `bigint`, `bool` → `boolean`, `varchar` → `character varying`, `char` → `character`, `float4` → `real`, `float8` → `double precision`, `decimal` → `numeric`, `timestamptz` → `timestamp with time zone`, `timestamp` → `timestamp without time zone`, `timetz` → `time with time zone`, `time` → `time without time zone`.

### 3.2 `float` und Präzisionsvarianten

Vor dem Entfernen des Typmodifikators wird eine führende `float`-Basis mit Klammerpräzision ausgewertet:

- `float` (ohne Präzision) → `double precision`
- `float(1)` … `float(24)` → `real`
- `float(25)` … `float(53)` → `double precision`

Ungültige Präzisionen (`float(0)`, `float(54)`, `float(2.5)`, `float()`, `float(1,2)`) führen zu einem klaren Fehler. Die Auswertung erfolgt tokenbasiert; einfache Regex-Ersetzungen werden nicht verwendet.

### 3.3 Arrays

Die in 5R.2.33 eingeführte Trennung von Basis und Array-Suffix bleibt bestehen:

- `int2[]` → `smallint[]`
- `int2[][]` → `smallint[][]`
- `varbit(10)[]` → `bit varying[]`
- `float(24)[][]` → `real[][]`
- `float(25)[]` → `double precision[]`

### 3.4 Gequotete und schemaqualifizierte Typen

Unverändert:

- `"float"` bleibt `"float"`
- `public."int"` bleibt `public."int"`
- `"MeinSchema"."MeinTyp"[]` bleibt unverändert

Die Normalisierung greift nur bei einem einzelnen unquotierten Basiswort.

---

## 4. Unit-Tests

`frontend/backend/src/tests/migrationParser.test.ts`:

| # | Test | Ergebnis |
|---|---|---|
| 20 | Vollständige Alias-Tabelle inkl. `dec`, `bpchar`, `nchar`, `varbit`, `float`, `float(1..53)`, Arrays und unveränderte quoted/schemaqualifizierte Typen | ✅ |
| 21 | Ungültige `float`-Präzisionen führen zum Abbruch | ✅ |

Gesamte Parser-Unit-Tests: **21/21**.

---

## 5. PostgreSQL-16-Integrationstest

`frontend/backend/src/tests/migrations.test.ts`, Test 58:

Migration 005 legt an:

- `alias_canonical_fn` mit 18 Parametern in Alias- und kanonischer Schreibweise:
  `int`/`integer`, `int2`/`smallint`, `int8`/`bigint`, `float(24)`/`real`, `float`/`double precision`, `varchar(10)`/`character varying(20)`, `varbit(5)`, `bpchar`, `timestamptz`/`timestamp with time zone`, `timetz`/`time with time zone`
- vier Überladungen von `overload_alias_fn` (`int`, `bigint`, `varchar(10)`, `text`)

Nachweis:

1. Migration wird erfolgreich angewendet.
2. Zweiter Lauf ist idempotent (`applied: []`).
3. Alias- und kanonische Signaturen werden von PostgreSQL als identisch erkannt.
4. Überladungen werden korrekt unterschieden.
5. Eine zusätzliche, nicht deklarierte Signatur `alias_canonical_fn(bigint)` wird erkannt.

---

## 6. Lokale Ergebnisse

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`).

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Parser- und Migrationstests | ✅ **79/79** (21 Unit + 58 Integration) |
| Vollständige Backend-Suite | ✅ **115/115 Tests, 6/6 Suites** |

Alle bestehenden Tests aus 5R.2.1 bis 5R.2.33 bleiben erfolgreich.

---

## 7. GitHub Actions

Die CI/CD-Konfiguration wurde nicht verändert.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | _wird ergänzt_ | Root | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Frontend | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Backend (PostgreSQL 16) | _wird ergänzt_ |
| SecurityOps 2.0 CD | _wird ergänzt_ | Release-Paket | _wird ergänzt_ |

Artefaktgrößen und Status werden nach dem Lauf über die GitHub-API geprüft.

---

## 8. Bekannte Einschränkungen

1. `float(p)` wird nur als einzelner unquotierter Basistyp ausgewertet. Schemaqualifizierte oder gequotete Varianten bleiben unverändert.
2. Aliase werden nur auf einen einzelnen unquotierten Basiswort-Token angewendet. Mehrteilige Typen (`national character`, `double precision`) werden unverändert gerendert und von PostgreSQL kanonisiert.
3. `nvarchar` ist kein gültiger PostgreSQL-16-Typ und wird nicht normalisiert.
4. Dynamisches SQL in `DO`-Blöcken wird weiterhin nicht statisch analysiert.
5. Die detaillierten 001–004-Prüfungen bleiben unverändert.

---

## 9. Sicherheitsvorgaben

- ✅ Keine Änderung an Migrationen 001–004
- ✅ Keine Änderung an vorhandenen Daten
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Mandantenfähigkeit oder Offline-Synchronisation
- ✅ Keine Änderungen an CI/CD-Konfiguration oder Secrets
- ✅ Keine unnötigen Refactorings
- ✅ Ausschließlich Schritt 5R.2.34 umgesetzt
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
