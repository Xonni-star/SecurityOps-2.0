# SecurityOps 2.0 – Schritt 5R.2.26
## Vollständige Erkennung benutzerdefinierter PostgreSQL-Typen

**Ausgangsstand:** `main` @ `f3104918ca72e9939f1066c3a10f6d82058a4da5`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: detect standalone PostgreSQL types in empty database checks`

---

## 1. Ausgangsproblem

`findUnexpectedPublicObjects()` in `frontend/backend/src/migrations/runner.ts` erkannte im Schema `public` bereits Enums (`typtype = 'e'`) und Domains (`typtype = 'd'`). Eigenständige Composite Types (`'c'`), Range-Typen (`'r'`) und Multirange-Typen (`'m'`) blieben unentdeckt. Eine Datenbank mit ausschließlich solchen Objekten wäre fälschlich als leer eingestuft und die Migrationen 001–004 wären blind ausgeführt worden.

---

## 2. Änderung

### 2.1 Erweiterte Typabfrage

Die Typ-Erkennung in `findUnexpectedPublicObjects()` wurde erweitert:

| `typtype` | Meldung |
|---|---|
| `e` | `Enum` |
| `d` | `Domain` |
| `c` | `Zusammengesetzter Typ` |
| `r` | `Range-Typ` |
| `m` | `Multirange-Typ` |

Die Meldung enthält weiterhin Typ und Namen, z. B.:
`Unerwartetes Objekt im Schema public: Zusammengesetzter Typ "fremder_composite"`.

### 2.2 Keine doppelten Meldungen für Tabellen-Zeilentypen

PostgreSQL legt für jede Tabelle, View, Materialized View, Fremdtabelle und partitionierte Tabelle automatisch einen zusammengesetzten Zeilentyp (`typtype = 'c'`) an. Diese Zeilentypen werden **nicht** als eigenständige Typen gemeldet, da die zugehörigen Relationen bereits über die Relationsprüfung erkannt werden.

Umsetzung:
- `LEFT JOIN pg_class rel ON rel.oid = t.typrelid`
- Ein `'c'`-Typ wird nur gemeldet, wenn `rel.oid IS NULL` oder `rel.relkind = 'c'` ist.
- Zeilentypen von `r` (Tabelle), `p` (partitioniert), `v` (View), `m` (Materialized View) und `f` (Fremdtabelle) werden ausgeschlossen.
- Die Historientabelle `schema_migrations` (relkind `r`) erzeugt damit ebenfalls keine Doppelmeldung.

### 2.3 Verhalten

- Eine Datenbank mit unbekannten Typen und ohne erwartete Tabellen wird **niemals** als leer eingestuft.
- Der Runner bricht vor jeder Migration ab.
- Es werden keine Objekte oder Daten verändert.
- Die bestehende, korrekte SecurityOps-Baseline wird weiterhin akzeptiert, da die Typabfrage nur im Leer-Pfad (`existingTables.length === 0`) ausgeführt wird.

---

## 3. Tests

`frontend/backend/src/tests/migrations.test.ts` wurde von 29 auf **33 Integrationstests** erweitert.

| # | Test | Ergebnis |
|---|---|---|
| 30 | Eigenständiger Composite Type verhindert Leer-Einstufung; genau **eine** Meldung (kein Duplikat durch Tabellen-Zeilentyp); Typ bleibt erhalten | ✅ |
| 31 | Eigenständiger Range Type verhindert Leer-Einstufung; Typ bleibt erhalten | ✅ |
| 32 | Multirange Type wird unter PostgreSQL 16 automatisch angelegt (`typtype = 'm'`) und als `Multirange-Typ` gemeldet | ✅ |
| 33 | Bestehende Objekte (Composite Type + Tabelle mit Daten) bleiben nach abgelehnter Baseline unverändert; Historie bleibt leer | ✅ |

Weiterhin bestanden (bereits vorhanden, decken die geforderten Fälle ab):

- **Test 25**: tatsächlich leere Datenbank wird akzeptiert, 001–004 werden angewendet.
- **Test 7**: vollständige korrekte SecurityOps-Baseline wird akzeptiert.
- **Tests 22–24**: zusätzliche RLS-Policies werden abgelehnt.
- **Tests 26–29**: Fremdtabelle/View/Daten bei abgelehnter Leer-Erkennung.

Hinweis zu Multirange: PostgreSQL 16 erzeugt beim Anlegen eines Range-Typs automatisch einen Multirange-Typ. Bei `CREATE TYPE fremder_range AS RANGE (subtype = int4)` entsteht `fremder_multirange` mit `typtype = 'm'`. Der Test prüft sowohl die Existenz dieses Typs als auch seine Meldung durch den Runner.

---

## 4. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`), isolierte Testdatenbanken `secops_migtest_*`.

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Migrationstests | ✅ **33/33** |
| Vollständige Backend-Suite | ✅ **69/69 Tests, 5/5 Suites** |

---

## 5. GitHub Actions

Die CI/CD-Struktur wurde nicht verändert. Der Backend-Job führt den Schritt „Migrationshistorie & Baseline (Integrationstests)“ aus, nun mit 33 Tests.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | _wird ergänzt_ | Root | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Frontend | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Backend (inkl. 33 Migrationstests) | _wird ergänzt_ |
| SecurityOps 2.0 CD | _wird ergänzt_ | Release-Paket | _wird ergänzt_ |

Artefakte werden nach dem Lauf über die GitHub-API geprüft (Vorhandensein, Größe, Ablaufstatus).

---

## 6. Sicherheitsvorgaben

- ✅ Keine Änderung an SQL-Migrationen 001–004
- ✅ Keine Änderung an produktiven Daten
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Offline-Synchronisation oder Mandantenarchitektur
- ✅ Keine neuen Secrets
- ✅ Keine unnötigen Refactorings
- ✅ Keine weiteren Entwicklungsschritte begonnen
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
