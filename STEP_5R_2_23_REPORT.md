# SecurityOps 2.0 – Schritt 5R.2.23
## PostgreSQL-Baseline-Prüfung vollständig absichern

**Ausgangsstand:** `main` @ `31224b327f76b18464cea39c5f224a627dc9f65f`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: harden database migration baseline verification`

---

## 1. Ziel

Die Baseline-Erkennung aus Schritt 5R.2.22 prüfte bisher überwiegend das Vorhandensein von Objekten anhand ihrer Namen. Schritt 5R.2.23 prüft zusätzlich die **tatsächlichen Definitionen** der sicherheitsrelevanten Objekte und akzeptiert eine bestehende Datenbank nur noch bei exakter Übereinstimmung.

Geändert wurde ausschließlich:
- `frontend/backend/src/migrations/runner.ts`
- `frontend/backend/src/tests/migrations.test.ts`

Keine SQL-Migration wurde umgeschrieben. Keine Frontend-, Offline-, Mandanten- oder API-Logik wurde verändert.

---

## 2. Erweiterte Baseline-Prüfungen

### 2.1 Tabellen und Spalten
- 21 Tabellen aus Migration 001
- 15 Spalten aus Migration 002 (`revision_version` auf `shifts`/`tasks`/`keys`, `client_mutation_id` auf zehn Tabellen)

### 2.2 Constraints – Typ, Tabelle und Definition
Geprüft werden jetzt Name, Typ (`u`/`f`), zugehörige Tabelle und die tatsächliche Definition über `pg_get_constraintdef()`:

- 7 Unique-Constraints `(tenant_id, client_mutation_id)` auf `shifts`, `tasks`, `keys`, `guardbook_entries`, `guardbook_revisions`, `patrol_scans`, `shift_handovers`
- Composite-Fremdschlüssel `fk_revisions_guardbook_tenant`:
  `FOREIGN KEY (entry_id, tenant_id) REFERENCES guardbook_entries(id, tenant_id) ON DELETE CASCADE`

Whitespace wird für den Vergleich normalisiert; inhaltliche Abweichungen (z. B. vertauschte Spaltenreihenfolge) werden erkannt.

### 2.3 Trigger – Tabelle, Funktion, Status und Definition
Über `pg_trigger`, `pg_class`, `pg_proc` und `pg_get_triggerdef()`:

| Trigger | Tabelle | Funktion | Status |
|---|---|---|---|
| `trg_guardbook_entries_immutable` | `guardbook_entries` | `prevent_guardbook_tampering` | `O` (enabled) |
| `trg_guardbook_revisions_immutable` | `guardbook_revisions` | `prevent_revision_tampering` | `O` (enabled) |

Zusätzlich wird die vollständige Trigger-Definition verglichen (BEFORE DELETE OR UPDATE, FOR EACH ROW, EXECUTE FUNCTION).

### 2.4 Funktionen – Sprache, Rückgabetyp und Body
- `prevent_guardbook_tampering`: `plpgsql`, Rückgabetyp `trigger`, kein `SECURITY DEFINER`; Body-Marker für `TG_OP = 'DELETE'`, die Append-Only-Fehlermeldung, die Manipulations-Fehlermeldung und den Verweis auf `guardbook_revisions`
- `prevent_revision_tampering`: `plpgsql`, Rückgabetyp `trigger`, kein `SECURITY DEFINER`; Body-Marker der Unveränderlichkeits-Fehlermeldung

### 2.5 RLS – Aktivierung, FORCE und vollständige Policies
Für alle 14 Tabellen aus Migration 001:

- `relrowsecurity = true` und `relforcerowsecurity = true`
- Policy `tenant_isolation_permissive` mit:
  - `PERMISSIVE`
  - Rollen `{public}`
  - Kommando `ALL`
  - exaktem `USING`-Ausdruck
  - exaktem `WITH CHECK`-Ausdruck

Der erwartete Ausdruck wird whitespace-normalisiert verglichen:
`current_setting('app.current_tenant', true) IS NOT NULL AND current_setting('app.current_tenant', true) <> '' AND tenant_id = current_setting('app.current_tenant', true)::uuid`

### 2.6 Rollen und Berechtigungen
- Rolle `secops_app_user` vorhanden, `LOGIN`, **kein** `SUPERUSER`, `BYPASSRLS`, `CREATEROLE`, `CREATEDB`
- Schema `public`: `USAGE` vorhanden, `CREATE` nicht vorhanden
- Tabellenrechte vollständig geprüft:
  - `SELECT`, `INSERT`, `UPDATE` auf allen operativen Tabellen
  - `guardbook_revisions`: nur `SELECT`, `INSERT`
  - `DELETE` ausschließlich auf `shifts` und `tasks`
  - kein `DELETE` auf `guardbook_entries`, `guardbook_revisions`, `patrol_scans`, `shift_handovers` und allen übrigen Tabellen
  - kein `TRUNCATE`, `REFERENCES` oder `TRIGGER` auf irgendeiner Tabelle

### 2.7 Weitere Objekte
- Erweiterung `uuid-ossp` vorhanden

---

## 3. Exakter Baseline-Migrationssatz

Für eine Baseline müssen exakt vorhanden sein:

| Version | Dateiname |
|---|---|
| 001 | `001_initial_schema.sql` |
| 002 | `002_idempotency_and_versioning.sql` |
| 003 | `003_conflict_receipts_separation.sql` |
| 004 | `004_operational_delete_privileges.sql` |

Fehlt eine Datei, weicht die Versionskennung ab oder trägt eine Datei einen anderen Namen, bricht der Runner **vor** jeder Datenbankänderung ab. Zusätzliche Migrationen mit Version > 004 sind zulässig und werden anschließend normal angewendet.

---

## 4. Konsistenz bereits registrierter Migrationen

Pro Historieneintrag werden jetzt geprüft:

1. **Versionskennung**: `schema_migrations.version` muss exakt der Dateiversion entsprechen (`003`, nicht `3`).
2. **Dateiname**: `schema_migrations.filename` muss exakt dem Dateinamen im Repository entsprechen.
3. **SHA-256**: Inhalt muss unverändert sein.

Jede Abweichung führt zu einem Abbruch mit Nennung von Datenbankwert und Repository-Wert.

---

## 5. Fehlerverhalten

Bei jeder Abweichung bricht der Runner mit einer verständlichen Meldung ab. Die Meldung nennt bis zu acht konkrete Probleme (Tabelle, Spalte, Constraint, Trigger, Policy, Recht, Funktion) und die Gesamtzahl weiterer Abweichungen. Es wird **keine** Baseline registriert und **keine** Migration ausgeführt.

---

## 6. Tests

`frontend/backend/src/tests/migrations.test.ts` wurde von 9 auf **21 Integrationstests** erweitert. Alle Tests laufen gegen echte PostgreSQL-16-Datenbanken mit eigenen temporären Datenbanken und Migrationsverzeichnissen.

| # | Test | Ergebnis |
|---|---|---|
| 1–9 | Bestehende Tests aus 5R.2.22 (Anwendung, Wiederholung, neue Migration, Rollback, Prüfsumme, Parallelität, Baseline, unvollständige Baseline, doppelte/ungültige Versionen) | ✅ |
| 10 | Fehlende RLS-Policy verhindert Baseline | ✅ |
| 11 | Veränderte RLS-Policy verhindert Baseline | ✅ |
| 12 | Trigger an falscher Tabelle verhindert Baseline | ✅ |
| 13 | Falsche Trigger-Funktion verhindert Baseline | ✅ |
| 14 | Veränderte Constraint-Definition verhindert Baseline | ✅ |
| 15 | Fehlende Berechtigung verhindert Baseline | ✅ |
| 16 | Abweichende Berechtigung (`DELETE` auf `guardbook_entries`) verhindert Baseline | ✅ |
| 17 | Fehlende Baseline-Migrationsdatei wird nicht akzeptiert | ✅ |
| 18 | Abweichender Dateiname bei gleicher Versionsnummer wird nicht akzeptiert | ✅ |
| 19 | Bestehende Daten bleiben bei abgelehnter Baseline unverändert, Historie bleibt leer | ✅ |
| 20 | Abweichender Dateiname in der Historie wird abgelehnt | ✅ |
| 21 | Abweichende Versionskennung in der Historie wird abgelehnt | ✅ |

**Ergebnisse lokal:**

- `npm run build` (TypeScript): **Exit 0**
- Migrationstests: **21/21 bestanden**
- Gesamte Backend-Suite: **57/57 Tests, 5/5 Suites bestanden**
- Test 7 (vollständige korrekte Baseline) besteht weiterhin: Baseline wird akzeptiert, Daten bleiben erhalten.

---

## 7. GitHub Actions

Die bestehende CI/CD-Struktur wurde nicht verändert. Der Backend-Job führt weiterhin den Schritt „Migrationshistorie & Baseline (Integrationstests)“ aus, der nun alle 21 Tests umfasst.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | [`43046978656`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43046978656) | Root – npm ci, Strukturprüfung, Gesamtstart | **success** (41 s) |
| SecurityOps 2.0 CI | [`43046978656`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43046978656) | Frontend – npm ci, Vitest, Produktions-Build | **success** (11 s) |
| SecurityOps 2.0 CI | [`43046978656`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43046978656) | Backend – PostgreSQL 16, Migration, Build, Jest | **success** (1 m 21 s) |
| SecurityOps 2.0 CD | [`43047226173`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43047226173) | Release-Paket aus CI-Artefakten bauen | **success** |

Der Schritt **„Migrationshistorie & Baseline (Integrationstests)“** wurde im Backend-Job mit **success** abgeschlossen; alle 21 Migrationstests liefen gegen den isolierten PostgreSQL-16-Service. Die anschließende vollständige Jest-Suite (57 Tests) war ebenfalls erfolgreich.

CD-Artefakt: `securityops-release-40dda47e94546637ee25c1620ffa8e7b82ad3899`, 385.367 Bytes, nicht abgelaufen.

---

## 8. Sicherheitsvorgaben – Einhaltung

- ✅ Keine SQL-Migration 001–004 umgeschrieben
- ✅ Keine produktiven Daten verändert
- ✅ Keine Migration blind als ausgeführt markiert
- ✅ Keine neuen Klartext-Secrets
- ✅ Keine Änderungen an Frontend, Offline-Synchronisation oder Mandantenarchitektur
- ✅ Bestehende CI/CD-Struktur beibehalten
- ✅ Keine anderen Entwicklungsaufgaben begonnen
