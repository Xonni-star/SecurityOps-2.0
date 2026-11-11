# SecurityOps 2.0 – Schritt 5R.2.25
## PostgreSQL-Fremdtabellen real testen

**Ausgangsstand:** `main` @ `a5331bde4b42dc86cc0f0700b63a35900f6953c8`
**Durchgeführt am:** 2026-11-11
**Commit:** `test: verify foreign table rejection in migration baseline`

---

## 1. Ziel

Die in Schritt 5R.2.24 implementierte Erkennung von PostgreSQL-Fremdtabellen (`relkind = 'f'`) wurde bisher nur über eine reguläre Tabelle und eine View getestet. Schritt 5R.2.25 ergänzt einen **echten Integrationstest mit einer Foreign Table** über einen Foreign-Data-Wrapper.

---

## 2. Verwendete PostgreSQL-Erweiterung

| Eigenschaft | Wert |
|---|---|
| Erweiterung | `file_fdw` |
| Version | 1.0 |
| Verfügbarkeit lokal | ✅ in PostgreSQL 16.15 (Docker, `postgres:16-alpine`) |
| Verfügbarkeit CI | ✅ dieselbe Image-Version `postgres:16-alpine` im Servicecontainer |
| Zusätzliche Rechte | `CREATE EXTENSION` und `COPY ... TO` erfordern die administrative Rolle; in der ephemeren Testdatenbank ist `secops_admin` Superuser |

`file_fdw` wurde gewählt, weil es ohne externen Datenbankserver auskommt und ausschließlich innerhalb der isolierten Testdatenbank bzw. des ephemeren Containers arbeitet.

---

## 3. Testbeschreibung

Neuer Test **29** in `frontend/backend/src/tests/migrations.test.ts`:

1. **Isolierte Testdatenbank** über die bestehende Hilfsfunktion `createTestDatabase()` anlegen (`secops_migtest_*`).
2. **Foreign-Data-Wrapper und Foreign Server** einrichten:
   - `CREATE EXTENSION file_fdw;`
   - `CREATE SERVER secops_file_server FOREIGN DATA WRAPPER file_fdw;`
3. **Server-seitige CSV-Datei** in `/tmp` erzeugen:
   - `COPY (SELECT 1 AS id, 'fdw-zeile' AS name) TO '/tmp/secops_fdw_<db>.csv' WITH (FORMAT csv, HEADER true);`
4. **Echte Foreign Table** im Schema `public` anlegen:
   - `CREATE FOREIGN TABLE fremde_fdw_tabelle (id INT, name TEXT) SERVER secops_file_server OPTIONS (filename ..., format 'csv', header 'true');`
5. **Vorprüfung**: `pg_class.relkind` ist tatsächlich `'f'`.
6. **Migrationsrunner aufrufen** (`runMigrations` mit der isolierten DB und dem echten Migrationsverzeichnis).
7. **Abbruch prüfen**: Der Runner muss mit einer Meldung abbrechen, die die Fremdtabelle ausdrücklich nennt:
   `Unerwartetes Objekt im Schema public: Fremdtabelle "fremde_fdw_tabelle"`.
8. **Historie prüfen**: `schema_migrations` enthält **0 Einträge** – keine Migration wurde als ausgeführt registriert.
9. **Bestand prüfen**: Die Fremdtabelle existiert weiterhin mit `relkind = 'f'` und liefert die zuvor geschriebene Zeile (`id = 1`, `name = 'fdw-zeile'`).

Der Test verwendet ausschließlich die isolierte Testdatenbank. Produktive Daten oder die produktive Datenbankstruktur werden nicht berührt. Nach dem Test wird die Datenbank über die vorhandene `afterEach`-Bereinigung gelöscht.

### Hinweis zur Testdatei
Die CSV-Datei liegt im Dateisystem des PostgreSQL-Servers (`/tmp`). Im CI-Servicecontainer ist sie mit dem Container ephemer und verschwindet mit ihm. Lokal bleibt eine kleine temporäre Datei in `/tmp` zurück; sie enthält ausschließlich die Testzeile und wird nicht versioniert. Ein Löschen über SQL ist ohne zusätzliche Admin-Erweiterung nicht möglich und wäre für den Test nicht erforderlich.

---

## 4. Testergebnisse (lokal)

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, Port 55432), `postgres:16-alpine`.

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Migrationstests (`--testPathPattern=migrations`) | ✅ **29/29** |
| Vollständige Backend-Suite | ✅ **65/65 Tests, 5/5 Suites** |
| Neuer Test 29 | ✅ bestanden (367 ms) |

Der Test bestand ohne Änderung am Migrationsrunner. Die bestehende Implementierung aus 5R.2.24 erkennt `relkind = 'f'` korrekt.

---

## 5. GitHub Actions

Die CI/CD-Struktur wurde nicht verändert. Der Backend-Job führt den Schritt „Migrationshistorie & Baseline (Integrationstests)“ aus, der nun 29 Tests umfasst.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | [`43049997086`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43049997086) | Root – npm ci, Strukturprüfung, Gesamtstart | **success** (47 s) |
| SecurityOps 2.0 CI | [`43049997086`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43049997086) | Frontend – npm ci, Vitest, Produktions-Build | **success** (14 s) |
| SecurityOps 2.0 CI | [`43049997086`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43049997086) | Backend – PostgreSQL 16, Migration, Build, Jest | **success** (1 m 30 s) |
| SecurityOps 2.0 CD | [`43050266331`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43050266331) | Release-Paket aus CI-Artefakten bauen | **success** |

Der Schritt **„Migrationshistorie & Baseline (Integrationstests)“** lief im Backend-Job mit **success**. Damit wurde der neue file_fdw-Test auch in der CI-Umgebung erfolgreich gegen den PostgreSQL-16-Servicecontainer ausgeführt. Die anschließende vollständige Jest-Suite (65 Tests) war ebenfalls erfolgreich.

Hinweis: Die CI-Verifikation belegt, dass `file_fdw` in der CI-Umgebung verfügbar ist und der Test dort tatsächlich läuft; es handelt sich nicht um eine lokale Ersatzprüfung.

---

## 6. Einschränkungen

- Der Test benötigt die administrative Rolle der ephemeren Testdatenbank, da `CREATE EXTENSION file_fdw` und `COPY ... TO` Superuser-Rechte verlangen.
- Die Foreign Table wird nicht abgefragt, um eine externe Datenquelle zu simulieren; die Funktionsfähigkeit wird nach dem Runner-Abbruch durch eine `SELECT`-Abfrage auf die CSV-Datei nachgewiesen.
- Es wurden keine Änderungen an den SQL-Migrationen 001–004, am Migrationsrunner, am Frontend, an der Offline-Synchronisation oder an der Mandantenarchitektur vorgenommen.
- Keine neuen Secrets.

---

## 7. Abgrenzung

- Ausschließlich Schritt 5R.2.25 umgesetzt.
- Keine weiteren Verbesserungen oder Refactorings begonnen.
- Keine erfundenen Testergebnisse: lokale Ergebnisse und GitHub-Actions-Ergebnisse werden getrennt ausgewiesen.
