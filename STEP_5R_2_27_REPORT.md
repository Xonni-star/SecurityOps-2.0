# SecurityOps 2.0 – Schritt 5R.2.27
## Benutzerdefinierte Typen auch bei bestehender Datenbank-Baseline prüfen

**Ausgangsstand:** `main` @ `313bc3b2d7c3bd3496bec7823f23203b019796b9`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: verify custom types in existing database baselines`

---

## 1. Ausgangsproblem

In Schritt 5R.2.26 wurde die Typ-Erkennung für den **Leer-Datenbank-Pfad** erweitert. Die vollständige Schema-Prüfung (`inspectSchema`) wurde jedoch nur ausgeführt, wenn `schema_migrations` leer war. Bei einer bestehenden SecurityOps-Datenbank mit vorhandener Historie übersprang der Runner die Baseline-Prüfung vollständig und führte lediglich Checksummen- und Dateinamenprüfungen aus. Ein zusätzlicher Composite-, Range- oder Multirange-Typ in einer bereits migrierten Datenbank blieb dadurch unentdeckt.

---

## 2. Analyse der legitimen Typen

Nach Migrationen 001–004 und der Erweiterung `uuid-ossp` existieren im Schema `public`:

- **21 Tabellen-Zeilentypen** (`typtype = 'c'`, `pg_class.relkind = 'r'`) – automatisch erzeugt
- **Array-Typen** (`typtype = 'b'`) – automatisch erzeugt
- **keine eigenständigen Composite-, Enum-, Domain-, Range- oder Multirange-Typen**
- `uuid-ossp` legt in `public` **keine Typen** an (nur Funktionen)

PostgreSQL-Systemtypen liegen in `pg_catalog`, nicht in `public`. Erweiterungsobjekte sind über `pg_depend` mit `deptype = 'e'` gekennzeichnet.

Daraus folgt: Im SecurityOps-Schema `public` sind **keine eigenständigen benutzerdefinierten Typen** zu erwarten. Jeder solche Typ ist eine Abweichung.

---

## 3. Implementierung

### 3.1 Neue Funktion `findUnexpectedCustomTypes()`

Ermittelt unerwartete Typen im Schema `public`:

| `typtype` | Meldung |
|---|---|
| `e` | `Enum` |
| `d` | `Domain` |
| `c` | `Zusammengesetzter Typ` |
| `r` | `Range-Typ` |
| `m` | `Multirange-Typ` |

**Ausgeschlossen (keine Fehlalarme):**

1. **Automatische Zeilentypen** von Tabellen, partitionierten Tabellen, Views, Materialized Views und Fremdtabellen:
   `LEFT JOIN pg_class rel ON rel.oid = t.typrelid`; ein `'c'`-Typ wird nur gemeldet, wenn `rel.relkind = 'c'` oder `rel.oid IS NULL` ist. `r`, `p`, `v`, `m`, `f` werden ignoriert.
2. **Array-Typen** (`typtype = 'b'`) werden nicht abgefragt.
3. **Erweiterungstypen** werden über
   `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')`
   ausgeschlossen.
4. Die Historientabelle `schema_migrations` erzeugt einen Zeilentyp mit `relkind = 'r'` und wird dadurch ebenfalls nicht gemeldet.

### 3.2 Prüfung unabhängig vom Pfad

Die Typ-Prüfung wurde aus `inspectSchema()` heraus in `runMigrations()` **vor** die Entscheidung „leer vs. bestehende Baseline“ gezogen:

```
Historie lesen → Prüfsummen prüfen → unerwartete Typen prüfen → Pfadentscheidung
```

Damit gilt sie für:
- leere Datenbanken,
- bestehende Datenbanken ohne Historie (Baseline),
- bestehende Datenbanken **mit** Historie.

Bei Fund bricht der Runner mit einer verständlichen Meldung ab:

```
Unerwartete benutzerdefinierte Typen im Schema public:
Zusammengesetzter Typ "zusatz_composite", Range-Typ "zusatz_range", …
Abbruch, um keine Migrationen auf einem unbekannten Schema auszuführen.
```

Es werden keine Tabellen, Typen oder Daten verändert.

### 3.3 Erlaubte Typen

- Alle Typen in `pg_catalog` (Systemtypen) – nicht im geprüften Schema
- Automatische Zeilentypen der erwarteten Tabellen/Views/Fremdtabellen
- Automatische Array-Typen
- Typen, die zu einer installierten Erweiterung gehören

---

## 4. Tests

`frontend/backend/src/tests/migrations.test.ts` wurde von 33 auf **40 Integrationstests** erweitert.

| # | Test | Ergebnis |
|---|---|---|
| 34 | Korrekte bestehende SecurityOps-Baseline wird weiterhin akzeptiert | ✅ |
| 35 | Zusätzlicher Composite Type in gültiger Baseline wird erkannt; Typ bleibt erhalten; Historie bleibt 4 Einträge | ✅ |
| 36 | Zusätzlicher Range Type in gültiger Baseline wird erkannt (inkl. automatischem Multirange) | ✅ |
| 37 | Zusätzlicher Multirange Type (`typtype = 'm'`) wird erkannt | ✅ |
| 38 | Daten (Mandant) und Typ bleiben nach Ablehnung unverändert; Historie unverändert | ✅ |
| 39 | Genau **eine** Meldung für den Fremdtyp; keine Meldung für Tabellen-Zeilentypen oder `schema_migrations` | ✅ |
| 40 | Erweiterungstyp (`citext`) erzeugt keinen Fehlalarm; Baseline bleibt gültig | ✅ |

Die Tests 1–33 aus den vorherigen Schritten bleiben unverändert und erfolgreich.

---

## 5. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`), isolierte Testdatenbanken `secops_migtest_*`.

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Migrationstests | ✅ **40/40** |
| Vollständige Backend-Suite | ✅ **76/76 Tests, 5/5 Suites** |

---

## 6. GitHub Actions

Die CI/CD-Struktur wurde nicht verändert. Der Backend-Job führt den Schritt „Migrationshistorie & Baseline (Integrationstests)“ aus, nun mit 40 Tests.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | [`43052862901`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43052862901) | Root – npm ci, Strukturprüfung, Gesamtstart | **success** (42 s) |
| SecurityOps 2.0 CI | [`43052862901`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43052862901) | Frontend – npm ci, Vitest, Produktions-Build | **success** (17 s) |
| SecurityOps 2.0 CI | [`43052862901`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43052862901) | Backend – PostgreSQL 16, Migration, Build, Jest | **success** (1 m 27 s) |
| SecurityOps 2.0 CD | [`43053123814`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43053123814) | Release-Paket aus CI-Artefakten bauen | **success** |

Der Schritt **„Migrationshistorie & Baseline (Integrationstests)“** wurde im Backend-Job mit **success** abgeschlossen. Damit liefen alle 40 Migrationstests – einschließlich der neuen Baseline-Typ-Tests – tatsächlich gegen den PostgreSQL-16-Servicecontainer.

### Artefakte (über GitHub-API geprüft)

| Run | Artefakt | Größe | Status |
|---|---|---|---|
| CI `43052862901` | `frontend-dist` | 337.989 Bytes | vorhanden, nicht abgelaufen |
| CI `43052862901` | `backend-dist` | 50.268 Bytes | vorhanden, nicht abgelaufen |
| CD `43053123814` | `securityops-release-532c9f375d6b97573f1f89aae6b1cdc76685bd9e` | 388.815 Bytes | vorhanden, nicht abgelaufen |

---

## 7. Sicherheitsvorgaben

- ✅ Keine Änderung an SQL-Migrationen 001–004
- ✅ Keine Änderung an produktiven Daten
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Offline-Synchronisation oder Mandantenarchitektur
- ✅ Keine Änderungen an Secrets oder CI/CD-Struktur
- ✅ Keine unnötigen Refactorings
- ✅ Keine weiteren Entwicklungsschritte begonnen
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
