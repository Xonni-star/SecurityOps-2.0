# SecurityOps 2.0 – Schritt 5R.2.29
## Versionsabhängige Schema-Whitelist ohne Prüflücke

**Ausgangsstand:** `main` @ `601219cae34a39a07703eea66820f56577ab7d84`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: make schema validation migration-version aware`

---

## 1. Ausgangsproblem

Die Objektprüfung war an den bekannten Stand 001–004 gebunden:

```ts
if (maxAppliedVersion <= BASELINE_MAX_VERSION) {
  // vollständige Prüfung unerwarteter Objekte
}
```

Bei einer Datenbank mit einer angewendeten Migration oberhalb von 004 wurde die Prüfung vollständig übersprungen. Zusätzliche fremde Tabellen, Views, Sequenzen, Routinen oder Typen wären dort unbemerkt geblieben. Die statische Whitelist hätte zudem bei jeder neuen Migration manuell erweitert werden müssen.

---

## 2. Technische Lösung

Die erwarteten Schemaobjekte werden jetzt **aus den tatsächlich angewendeten Migrationsdateien abgeleitet**. Es gibt keine pauschale Abschaltung und keine statische Objektliste mehr.

### 2.1 Ablauf

1. Historie lesen und Prüfsummen/Dateinamen verifizieren.
2. Bei leerer Historie: bestehende Baseline-Erkennung (001–004) ausführen.
3. Erwartete Objekte ausschließlich aus den Migrationen ableiten, deren Versionen in `schema_migrations` stehen.
4. Ist-Schema gegen diese Erwartung prüfen.
5. Erst danach ausstehende Migrationen anwenden.

Noch nicht angewendete Migrationen fließen **nicht** in die Erwartung ein.

### 2.2 Parser für Migrations-SQL

Neue Funktion `extractSchemaObjects(sql)` erkennt:

- **Relationen**: `CREATE TABLE`, `CREATE FOREIGN TABLE`, `CREATE [MATERIALIZED] VIEW`, `CREATE SEQUENCE`
  - inklusive `IF NOT EXISTS`, Schema-Qualifizierung und `PARTITION BY` (→ partitionierte Tabelle)
- **Typen**: `CREATE TYPE … AS ENUM`, `… AS RANGE`, `… AS (…)`, `CREATE DOMAIN`
- **Routinen**: `CREATE [OR REPLACE] FUNCTION/PROCEDURE` inklusive Parameterliste

Vor dem Parsen werden SQL-Kommentare entfernt und Zeichenketten sowie Dollar-quoted Bodies maskiert. Dadurch werden DDL-Schlüsselwörter in Funktionsrümpfen oder Kommentaren nicht fälschlich erkannt.

### 2.3 Relationsprüfung inklusive Typ

Die Ist-Relationen werden mit `pg_class.relkind` verglichen:

| Erwartet | Akzeptiert |
|---|---|
| Tabelle | `r` |
| partitionierte Tabelle | `p` |
| View | `v` |
| Materialized View | `m` |
| Sequenz | `S` |
| Fremdtabelle | `f` |

Eine View, die denselben Namen wie eine erwartete Tabelle trägt, wird daher als Typabweichung erkannt:

`Relation "audit_logs" hat Typ "View" statt "Tabelle"`

### 2.4 Routinenprüfung inklusive Signatur

Routinen werden nicht mehr nur über den Namen, sondern über die **Identitätssignatur** verglichen:

- Erwartet: aus der Migrationsdatei extrahierte Parameterliste
- Ist: `pg_get_function_identity_arguments(p.oid)`

Typaliase (`int` → `integer`, `varchar` → `character varying`, `bool` → `boolean` usw.) werden normalisiert. Eine fremde Überladung mit gleichem Namen, aber anderer Signatur wird erkannt:

`Funktion/Prozedur "prevent_guardbook_tampering" mit Signatur "prevent_guardbook_tampering(integer)"`

### 2.5 Typenprüfung

- Eigenständige Composite Types, Enums, Domains, Range- und Multirange-Typen werden gegen die erwarteten Typen geprüft.
- Automatisch erzeugte **Multirange-Typen** eines erwarteten Range-Typs werden über `pg_range.rngmultitypid` als legitim erkannt.
- Automatische Zeilentypen von Tabellen/Views/Fremdtabellen (`pg_class.relkind r/p/v/m/f`) und Array-Typen (`typtype = 'b'`) werden nicht gemeldet.
- Erweiterungsobjekte werden über `pg_depend.deptype = 'e'` ausgeschlossen.

### 2.6 Erlaubte Systemobjekte

- `schema_migrations` (vom Runner selbst angelegt)
- automatische Zeilentypen, Array-Typen
- Erweiterungsobjekte (z. B. alle `uuid-ossp`-Funktionen)
- PostgreSQL-Systemtypen in `pg_catalog`

### 2.7 Fehlermeldungen

Bei Abweichungen bricht der Runner ab und nennt bis zu acht konkrete Probleme mit Typart und Namen bzw. Signatur. Es werden keine Objekte gelöscht oder verändert.

---

## 3. Änderungen am Migrationsrunner

- Entfernt: `maxAppliedVersion`-Sonderfall und die statische Whitelist `findUnexpectedSchemaObjects()`.
- Entfernt: die statische Routine-Namensliste.
- Neu: `extractSchemaObjects()`, `deriveExpectedSchemaObjects()`, `compareSchemaObjects()`.
- Angepasst: `runMigrations()` leitet die Erwartung aus den angewendeten Versionen ab und prüft vor dem Anwenden neuer Migrationen.
- Unverändert: Baseline-Erkennung, Prüfsummen, Advisory Lock, Transaktionen, detaillierte 001–004-Prüfungen (Spalten, Constraints, Trigger, RLS, Rechte).

---

## 4. Neue Integrationstests

`frontend/backend/src/tests/migrations.test.ts`: **50 Tests** (vorher 45).

| # | Test | Ergebnis |
|---|---|---|
| 46 | Gültige Datenbank mit zusätzlicher Migration 005 wird akzeptiert | ✅ |
| 47 | Fremdes Objekt bei Migration oberhalb 004 wird erkannt | ✅ |
| 48 | Fremde Funktion mit gleichem Namen, aber anderer Signatur wird erkannt | ✅ |
| 49 | View anstelle einer erwarteten Tabelle wird erkannt | ✅ |
| 50 | Daten und Migrationseinträge bleiben bei Objektabweichung unverändert | ✅ |

Weiterhin bestanden:

- Test 34: gültige Baseline 001–004 wird akzeptiert
- Tests 35–40: Typen, Erweiterungen, bestehende Baseline
- Tests 41–45: zusätzliche Objekte in bestehender Baseline
- Tests 1–33: Anwendung, Rollback, Prüfsummen, Parallelität, Baseline-Sicherheit

Alle Tests laufen gegen echtes PostgreSQL 16 in isolierten Datenbanken – keine Mock-Datenbanken.

---

## 5. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`).

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Migrationstests | ✅ **50/50** |
| Vollständige Backend-Suite | ✅ **86/86 Tests, 5/5 Suites** |

---

## 6. GitHub Actions

Die CI/CD-Konfiguration wurde nicht verändert. Der Backend-Job führt den Schritt „Migrationshistorie & Baseline (Integrationstests)“ aus, nun mit 50 Tests.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | _wird ergänzt_ | Root | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Frontend | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Backend (inkl. 50 Migrationstests) | _wird ergänzt_ |
| SecurityOps 2.0 CD | _wird ergänzt_ | Release-Paket | _wird ergänzt_ |

Artefaktgrößen werden nach dem Lauf über die GitHub-API geprüft.

---

## 7. Bekannte Einschränkungen

1. **Dynamisches SQL:** Objekte, die ausschließlich innerhalb von `DO`-Blöcken oder über dynamisches SQL erzeugt werden, können nicht statisch aus dem Migrations-SQL abgeleitet werden. Die aktuellen Migrationen 001–004 erzeugen ihre Tabellen/Typen/Routinen mit direktem DDL; die detaillierten 001–004-Prüfungen bleiben zusätzlich bestehen.
2. **Kurzlebige Objekte:** Ein Objekt, das innerhalb einer Migration erzeugt und wieder gelöscht wird, würde als erwartet gelten und anschließend als fehlend gemeldet. Dieser Fall kommt in 001–004 nicht vor.
3. **Parameter-Heuristik:** Die Typableitung aus Funktionsparametern normalisiert gängige Aliase. Sehr exotische Typnamen können eine manuelle Anpassung der Normalisierung erfordern.
4. **Detaillierte Baseline-Prüfungen** (Spalten, Constraints, Trigger, RLS, Rechte) bleiben statisch auf 001–004 bezogen. Neue Migrationen erweitern die Objektprüfung automatisch, nicht diese Detailprüfungen.

---

## 8. Sicherheitsvorgaben

- ✅ Keine Änderung an Migrationen 001–004
- ✅ Keine Datenverluste, keine automatische Löschung fremder Objekte
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Offline-Synchronisation oder Mandantenarchitektur
- ✅ Keine Secrets verändert
- ✅ Keine unnötigen Refactorings
- ✅ Bestehende Datenbanken werden weiterhin sicher erkannt
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
