# SecurityOps 2.0 – Schritt 5R.2.28
## Unerwartete Schemaobjekte auch bei bestehender Migrationstabelle erkennen

**Ausgangsstand:** `main` @ `54743b0d1512bab1db161cf30fe60ec1449a07c1`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: validate unexpected schema objects in existing databases`

---

## 1. Ausgangsproblem

Die Prüfung auf unerwartete Objekte war unvollständig aufgeteilt:

| Funktion | Bisheriger Ausführungszeitpunkt | Lücke |
|---|---|---|
| `findUnexpectedPublicObjects()` | nur im Leer-Datenbank-Pfad (`inspectSchema`, `existingTables.length === 0`) | Fremde Tabellen, Views, Sequenzen und Funktionen in bestehenden Datenbanken blieben unentdeckt |
| `findUnexpectedCustomTypes()` | global vor der Pfadentscheidung (seit 5R.2.27) | Typen waren abgedeckt, Relationen und Routinen nicht |
| `inspectSchema()` | nur wenn `schema_migrations` leer war | Bei vorhandener Historie wurde die Schema-Prüfung vollständig übersprungen |

Eine bereits migrierte SecurityOps-Datenbank mit vier Migrationseinträgen konnte daher zusätzliche Tabellen, Views, Sequenzen oder Funktionen enthalten, ohne dass der Runner dies bemerkte.

---

## 2. Analysierte Objektarten

Geprüft werden jetzt im Schema `public`:

- Tabellen (`relkind = 'r'`) und partitionierte Tabellen (`'p'`)
- Views (`'v'`) und Materialized Views (`'m'`)
- Fremdtabellen (`'f'`)
- Sequenzen (`'S'`)
- Funktionen und Prozeduren (`pg_proc`)
- eigenständige Composite Types (`typtype = 'c'`)
- Enums (`'e'`), Domains (`'d'`), Range- (`'r'`) und Multirange-Typen (`'m'`)

---

## 3. Implementierung

### 3.1 Neue zentrale Funktion `findUnexpectedSchemaObjects()`

Führt drei Katalogabfragen zusammen:

1. **Relationen** – `pg_class` mit `relkind IN ('r','p','v','m','S','f')`
2. **Routinen** – `pg_proc` im Schema `public`
3. **Typen** – bestehende Funktion `findUnexpectedCustomTypes()`

Ergebnis: eine sortierte Liste aus Typart und Name.

### 3.2 Erlaubte Objekte (Whitelist)

**Tabellen/Relationen:**
- exakt die 21 durch Migrationen 001–004 erzeugten Tabellen
- die Historientabelle `schema_migrations`

**Routinen:**
- `prevent_guardbook_tampering`
- `prevent_revision_tampering`

**Typen:**
- automatisch erzeugte Zeilentypen der Tabellen/Views/Fremdtabellen (`relkind r/p/v/m/f`)
- automatische Array-Typen (`typtype = 'b'`)
- keine eigenständigen benutzerdefinierten Typen

**Erweiterungsobjekte:**
- Relationen, Routinen und Typen mit `pg_depend.deptype = 'e'` werden ausgeschlossen.
- Damit erzeugen `uuid-ossp` (11 Funktionen in `public`) und andere Erweiterungen keine Fehlalarme.

### 3.3 Ausführungszeitpunkt

Die Prüfung läuft nach dem Einlesen und Verifizieren der Historie und **vor** der Anwendung ausstehender Migrationen. Sie ist damit unabhängig davon, ob eine Historie existiert.

Bei Fund bricht der Runner ab:

```
Bestehende Datenbank enthält unerwartete Schemaobjekte.
Unerwartetes Objekt im Schema public: Tabelle "fremde_tabelle";
Unerwartetes Objekt im Schema public: View "fremde_view";
…
Abbruch, um keine Migrationen auf einem unbekannten Schema auszuführen.
```

Es werden keine Objekte oder Daten verändert.

### 3.4 Bekannte Grenze

Die statische Whitelist beschreibt exakt den Stand nach Migration 004. Sind bereits **neuere, diesem Runner unbekannte Migrationen** angewendet (`maxAppliedVersion > 004`), würden deren Objekte fälschlich als fremd gelten. Für diesen Fall wird die Whitelist-Prüfung übersprungen; Versionskennung, Dateiname und SHA-256 der angewendeten Migrationen werden weiterhin geprüft. Diese Grenze betrifft ausschließlich zukünftige Migrationen, nicht den hier relevanten Stand 001–004.

---

## 4. Neue Integrationstests

`frontend/backend/src/tests/migrations.test.ts` wurde von 40 auf **45 Tests** erweitert. Alle Tests laufen gegen eine gültige SecurityOps-Datenbank mit vier Migrationseinträgen.

| # | Test | Ergebnis |
|---|---|---|
| 41 | Zusätzliche Tabelle wird erkannt; Historie bleibt 4 Einträge | ✅ |
| 42 | Zusätzliche View wird erkannt | ✅ |
| 43 | Zusätzliche Sequenz wird erkannt | ✅ |
| 44 | Zusätzliche Funktion wird erkannt | ✅ |
| 45 | Vorhandene Daten (Mandant, Tabellenzeile) und Migrationseinträge bleiben nach Ablehnung unverändert | ✅ |

Weiterhin erfolgreich:

- Test 34: gültige SecurityOps-Baseline wird akzeptiert
- Tests 35–39: Typabweichungen in bestehender Baseline
- Test 40: Erweiterungstypen ohne Fehlalarm
- Tests 1–33 aus den vorherigen Schritten

---

## 5. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`), isolierte Testdatenbanken `secops_migtest_*`.

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Migrationstests | ✅ **45/45** |
| Vollständige Backend-Suite | ✅ **81/81 Tests, 5/5 Suites** |

---

## 6. GitHub Actions

Die CI/CD-Konfiguration wurde nicht verändert. Der Backend-Job führt den Schritt „Migrationshistorie & Baseline (Integrationstests)“ aus, nun mit 45 Tests.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | [`43054655988`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43054655988) | Root – npm ci, Strukturprüfung, Gesamtstart | **success** (42 s) |
| SecurityOps 2.0 CI | [`43054655988`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43054655988) | Frontend – npm ci, Vitest, Produktions-Build | **success** (17 s) |
| SecurityOps 2.0 CI | [`43054655988`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43054655988) | Backend – PostgreSQL 16, Migration, Build, Jest | **success** (1 m 26 s) |
| SecurityOps 2.0 CD | [`43054924502`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43054924502) | Release-Paket aus CI-Artefakten bauen | **success** |

Der Schritt **„Migrationshistorie & Baseline (Integrationstests)“** wurde im Backend-Job mit **success** abgeschlossen. Damit liefen alle 45 Migrationstests tatsächlich gegen den PostgreSQL-16-Servicecontainer.

### Artefakte (über GitHub-API geprüft)

| Run | Artefakt | Größe | Status |
|---|---|---|---|
| CI `43054655988` | `frontend-dist` | 337.989 Bytes | vorhanden, nicht abgelaufen |
| CI `43054655988` | `backend-dist` | 50.715 Bytes | vorhanden, nicht abgelaufen |
| CD `43054924502` | `securityops-release-683dc66ec2ccbe5ec41ddd2c7800f24bfb8c7e9f` | 389.263 Bytes | vorhanden, nicht abgelaufen |

---

## 7. Sicherheitsvorgaben

- ✅ Keine Änderung an Migrationen 001–004
- ✅ Keine Änderung an produktiven Daten
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Offline-Synchronisation oder Mandantenarchitektur
- ✅ Keine Änderungen an Secrets oder CI/CD-Konfiguration
- ✅ Keine unnötigen Refactorings
- ✅ Bestehende Datenbankkompatibilität erhalten
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
