# SecurityOps 2.0 – Schritt 5R.2.22
## Versionssicheren PostgreSQL-Migration-Runner implementieren

**Ausgangsstand:** `main` @ `e2ed08263d7a85c5b43c8afc516f29e68be6705d`
**Durchgeführt am:** 2026-11-11
**Commit:** `feat: add versioned transactional database migrations`

---

## 1. Ausgangsproblem

`frontend/backend/src/migrations/runner.ts` führte bei jedem Start **alle** SQL-Dateien erneut aus. Es gab keine Historie, keine Prüfsummen und keinen Schutz gegen parallele Runner. Migrationen 001–004 waren in bestehenden Datenbanken bereits angewendet, ohne dass dies irgendwo dokumentiert war.

---

## 2. Implementierung

### 2.1 Historientabelle

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  checksum    CHAR(64) NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Pro Migration werden Versionskennung (`001`), Dateiname, SHA-256-Prüfsumme und Ausführungszeitpunkt gespeichert.

### 2.2 Ablauf des Runners

1. Migrationen aus dem Verzeichnis laden, Dateinamen validieren, Duplikate erkennen, nach numerischer Version sortieren.
2. Verbindung ausschließlich über `DATABASE_MIGRATION_URL` (administrative Rolle) herstellen.
3. **Advisory Lock** `pg_advisory_lock(2026111101)` auf einer dedizierten Session erwerben – konkurrierende Runner warten, bis der erste fertig ist.
4. Historientabelle anlegen, falls sie fehlt.
5. Bereits registrierte Migrationen laden und **Prüfsummen vergleichen**.
6. Baseline-Erkennung, falls die Historie leer ist (siehe Abschnitt 3).
7. Ausstehende Migrationen in aufsteigender Reihenfolge anwenden – **jede in einer eigenen Transaktion**:
   `BEGIN` → SQL ausführen → Historieneintrag schreiben → `COMMIT`.
8. Bei Fehler: `ROLLBACK`, kein Historieneintrag, Abbruch mit verständlicher Meldung.
9. Advisory Lock freigeben, Verbindung schließen.

### 2.3 Fehlerfälle

| Fall | Verhalten |
|---|---|
| Ungültiger Dateiname | Abbruch vor jeder DB-Änderung |
| Doppelte Versionsnummer | Abbruch mit Nennung beider Dateien |
| Leeres Migrationsverzeichnis | Abbruch |
| Bereits angewendete Datei fehlt im Repository | Abbruch |
| Prüfsumme einer angewendeten Migration weicht ab | Abbruch mit erwarteter und gespeicherter SHA-256 |
| SQL-Fehler in einer Migration | Transaktion zurückgerollt, nicht registriert, Abbruch |
| Unvollständige/unklare Baseline | Abbruch, keine Migration wird blind markiert |

---

## 3. Baseline-Strategie für bestehende Datenbanken

Wenn `schema_migrations` leer ist, wird der tatsächliche Schema-Zustand **strikt** geprüft:

**Erwartete Objekte nach Migration 004:**
- 21 Tabellen (u. a. `tenants`, `users`, `sessions`, `clients`, `sites`, `shifts`, `guardbook_entries`, `guardbook_revisions`, `tasks`, `keys`, die beiden Sync-Quittungstabellen, `audit_logs`)
- 15 Spalten aus 002 (`revision_version` auf `shifts`/`tasks`/`keys`, `client_mutation_id` auf zehn Tabellen)
- 7 Unique-Constraints aus 002
- 2 Trigger-Funktionen und 2 Trigger aus 001
- RLS aktiv auf 14 Tabellen
- Rechte aus 004: `DELETE` auf `shifts` und `tasks` vorhanden, `DELETE` auf `guardbook_entries` **nicht** vorhanden, `SELECT` auf `guardbook_entries` vorhanden

**Entscheidung:**

| Zustand | Verhalten |
|---|---|
| Keine der 21 Tabellen vorhanden | Leere Datenbank → alle Migrationen werden ausgeführt |
| Alle erwarteten Objekte vorhanden | Baseline: 001–004 werden **ohne Ausführung** mit ihren Prüfsummen registriert |
| Teilweise vorhanden oder Rechte/RLS abweichend | **Abbruch** mit Auflistung der fehlenden Objekte |

Es werden keine Daten gelöscht oder überschrieben. Die Baseline schreibt ausschließlich Historieneinträge.

---

## 4. Kompatibilität der bestehenden Migrationen

Geprüft:

- Dateinamen entsprechen dem Muster `<Version>_<Name>.sql`; keine Duplikate.
- Keine nicht-transaktionalen Statements (`CREATE INDEX CONCURRENTLY`, `VACUUM`, `REINDEX CONCURRENTLY`) vorhanden.
- Idempotenz-Guards: 001 = 27, 002 = 22, 003 = 2 Vorkommen von `IF [NOT] EXISTS`; 004 besteht nur aus `GRANT`.
- 001 enthält `DROP TRIGGER IF EXISTS` / `DROP POLICY IF EXISTS` und ist damit wiederholbar, wird aber durch die Historie nicht erneut ausgeführt.
- Alle vier Migrationen wurden auf einer bestehenden Datenbank als Baseline übernommen (siehe Abschnitt 6).

---

## 5. Tests

Neue Datei: `frontend/backend/src/tests/migrations.test.ts` (9 Integrationstests, echte PostgreSQL-16-Datenbanken).

| # | Test | Ergebnis |
|---|---|---|
| 1 | Erstmalige Anwendung aller Migrationen + Protokollierung | ✅ |
| 2 | Zweiter Lauf ohne erneute Ausführung | ✅ |
| 3 | Neue Migration wird erkannt und angewendet | ✅ |
| 4 | Fehlerhafte Migration wird nicht registriert und zurückgerollt | ✅ |
| 5 | Nachträglich geänderte Migration wird abgelehnt | ✅ |
| 6 | Gleichzeitige Runner werden serialisiert, Migration genau einmal | ✅ |
| 7 | Bestehende Datenbank mit 001–004 wird als Baseline übernommen | ✅ |
| 8 | Unvollständige Baseline führt zu sicherem Abbruch | ✅ |
| 9 | Doppelte und ungültige Versionskennungen werden erkannt | ✅ |

Jeder Test verwendet eine eigene, temporäre Datenbank (`secops_migtest_*`) und ein eigenes temporäres Migrationsverzeichnis; die Datenbanken werden anschließend gelöscht.

**Gesamte Backend-Suite:** 5 Suites, **45/45 Tests bestanden** (36 bestehende + 9 neue).

---

## 6. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, Port 55432), Datenbank `securityops_v2` mit bereits angewendeten Migrationen 001–004 und **ohne** Historientabelle.

```bash
npm run migrate
```

Ausgabe:

```
[MIGRATION] Warte auf exklusiven Advisory Lock…
[MIGRATION] Advisory Lock erhalten.
[MIGRATION] Bestehende Datenbank erkannt. Migrationen 001–004 als Baseline übernommen: 001, 002, 003, 004
[MIGRATION SUCCESS] Angewendet: 0, Baseline: 4, Übersprungen: 4
```

Zweiter Lauf:

```
[MIGRATION] Datenbank ist bereits aktuell. Keine Migration ausgeführt.
[MIGRATION SUCCESS] Angewendet: 0, Baseline: 0, Übersprungen: 4
```

Historie:

| version | filename | checksum (Anfang) |
|---|---|---|
| 001 | 001_initial_schema.sql | `944da143b60a…` |
| 002 | 002_idempotency_and_versioning.sql | `4b8f6c209582…` |
| 003 | 003_conflict_receipts_separation.sql | `9c932a6e1157…` |
| 004 | 004_operational_delete_privileges.sql | `2f05e55dbbff…` |

Bestandsdaten (Testmandanten, Benutzer, Wachbuch) blieben unverändert.

---

## 7. GitHub-CI

Die bestehende CI wurde um einen expliziten Schritt im Backend-Job erweitert:

```yaml
- name: Migrationshistorie & Baseline (Integrationstests)
  run: npm test -- --runInBand --testPathPattern=migrations
```

Der Schritt läuft nach Migration und Seed gegen den isolierten PostgreSQL-16-Service und vor der vollständigen Jest-Suite.

### Ergebnisse

Commit `745cbc9`:

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | [`43045151216`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43045151216) | Root – npm ci, Strukturprüfung, Gesamtstart | **success** (48 s) |
| SecurityOps 2.0 CI | [`43045151216`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43045151216) | Frontend – npm ci, Vitest, Produktions-Build | **success** (11 s) |
| SecurityOps 2.0 CI | [`43045151216`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43045151216) | Backend – PostgreSQL 16, Migration, Build, Jest | **success** (1 m 19 s) |
| SecurityOps 2.0 CD | [`43045394364`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43045394364) | Release-Paket aus CI-Artefakten bauen | **success** |

Der Schritt **„Migrationshistorie & Baseline (Integrationstests)“** wurde im Backend-Job ausgeführt und mit **success** abgeschlossen (9 Migrationstests gegen den isolierten PostgreSQL-16-Service). Die vollständige Jest-Suite desselben Jobs lief anschließend ebenfalls erfolgreich.

---

## 8. Abgrenzung

- Keine neuen Fachmodule.
- Keine Änderungen an Frontend-Funktionen.
- Keine Änderungen an Mandantenarchitektur, Offline-Synchronisation oder API-Verträgen.
- Keine bestehende Migration wurde umgeschrieben.
- Keine produktiven Daten verändert.
- Keine Klartext-Secrets.
- Keine erfundenen Testergebnisse.
