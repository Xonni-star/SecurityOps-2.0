# SecurityOps 2.0 – Schritt 5R.2.18
## GitHub-Actions-CI aktivieren und technische Prüfungen vereinheitlichen

**Ausgangsstand:** `main` @ `4d53d4c` (Schritt 5R.2.17)
**Durchgeführt am:** 2026-11-11
**CI-Commit:** `50aa109` – `ci: activate unified frontend and backend verification`

---

## 1. Zusammenfassung

Die Pipeline ist aktiv und lief erstmals vollständig durch:

| Job | Ergebnis | Laufzeit |
|---|---|---|
| Frontend – npm ci, Vitest, Produktions-Build | **success** | ca. 16 s |
| Backend – PostgreSQL 16, Migration, Build, Jest | **success** | ca. 71 s |

GitHub-Run: `43040321884`, Event `push`, Branch `main`, SHA `50aa109199527dc7c4d2b34a5a5adb9a2cca01f2`, gestartet `2026-11-11T14:37:52Z`, Gesamtdauer **1 m 14 s**.

Tatsächlich verwendete Laufzeitumgebung im Runner: **Node.js v24.22.2**, **npm 11.19.1**.

---

## 2. Workflows

Die bisherigen Dateien unter `frontend/.github/workflows/` wurden nach `.github/workflows/` verschoben und vollständig ersetzt. Die alten Kopien wurden entfernt.

### `.github/workflows/ci.yml`
- Trigger: `push` auf `main`/`release/*`, `pull_request` auf `main`, `workflow_dispatch`
- **Job `frontend`**: Checkout → Node aus `.nvmrc` → `npm ci` → `npm test` (Vitest) → `npm run build` → Artefakt `frontend-dist`
- **Job `backend`**: Checkout → Node aus `.nvmrc` → `npm ci` → `npm run build` → `npm run migrate` → `npm run seed` → `npm test -- --runInBand` → Artefakt `backend-dist`
- PostgreSQL-16-Servicecontainer mit Healthcheck, ausschließlich lokaler Trust-Authentifizierung
- `concurrency` bricht veraltete Läufe desselben Branches ab
- Minimale Rechte: `permissions: contents: read`

### `.github/workflows/ci_cd.yml`
- Trigger: `workflow_run` auf `SecurityOps 2.0 CI` (`completed`, Branch `main`)
- Läuft nur bei `conclusion == 'success'`
- Lädt `frontend-dist` und `backend-dist` des auslösenden CI-Laufs, erzeugt ein `BUILD-MANIFEST.txt` und veröffentlicht das Release-Paket als Artefakt (30 Tage)

**Nicht übernommen:** der frühere Python-Pytest-Job und der Docker-Build. Begründung: `frontend/backend/api.py` ist ein unvollständiges FastAPI-Fragment (kein `app = FastAPI()`, fehlende Abhängigkeiten, kein `conftest.py`), und `frontend/deploy/Dockerfile.backend` baut genau dieses nicht lauffähige Python-Modul. Ein solcher Job wäre dauerhaft rot und würde die Pipeline entwerten. Die Übernahme ist im Abschnitt „Offene Punkte“ dokumentiert.

---

## 3. Node.js-Version

Engine-Anforderungen der tatsächlich installierten Pakete:

| Paket | Version | `engines.node` |
|---|---|---|
| vitest | 5.1.0 | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` |
| jsdom | 31.0.0 | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |
| vite | 8.3.8 | `^20.19.0 \|\| >=22.12.0` |
| @vitejs/plugin-react | 6.3.0 | `^20.19.0 \|\| >=22.12.0` |

Gewählt: **Node.js 24 LTS**, dokumentiert in `.nvmrc` (`24`) und in allen drei `package.json`-Dateien (`"engines": { "node": ">=24.15.0" }`). GitHub Actions liest die Version über `node-version-file: .nvmrc`; im Lauf wurde **v24.22.2** verwendet. `node-version: latest` wird nirgends verwendet.

Hinweis: Die lokale Verifikation lief auf Node v26.7.0 (ebenfalls von allen Engines abgedeckt); der CI-Lauf selbst auf v24.22.2.

---

## 4. Backend-Abhängigkeiten und Lockfile

- `frontend/backend/package-lock.json` mit npm erzeugt (206.919 Bytes, lockfileVersion 3), keine manuell erzeugten Integrity-Hashes.
- `npm ci` im Backend erfolgreich: 441 Pakete.
- `argon2@0.40.3` funktioniert nach `npm ci` (Prebuilt-Binary, `argon2.hash()` geprüft).

---

## 5. TypeScript-Fehler `authController.ts`

**Ursache:** `env.JWT_EXPIRES_IN` war als beliebiger `string` typisiert; `jsonwebtoken` erwartet für `expiresIn` den Typ `number | StringValue` (`@types/jsonwebtoken` v9).

**Behebung, ohne `any`:**
1. `frontend/backend/src/config/env.ts`: `JWT_EXPIRES_IN` wird per Zod auf `^\d+[smhd]$` validiert (dasselbe Format, das `parseDurationToMs()` versteht).
2. `frontend/backend/src/controllers/authController.ts`: `SignOptions` importiert, `expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn']` mit erklärendem Kommentar. Der Cast überträgt die bereits erzwungene Laufzeit-Invariante auf den Compiler.

`npm run build` im Backend: **Exit 0**.

---

## 6. Sicherheitsgeheimnisse

Aus beiden Workflow-Dateien entfernt:
- Klartext-Datenbankpasswörter (`SecOpsVault2025Secure`, `TestPassword123Secure!`)
- Klartext-`JWT_SECRET`
- die beschädigten URLs mit `…`-Redaktionsartefakten

Verwendete Repository-Secrets (gesetzt, Werte nicht dokumentiert):

| Secret | Pflicht | Verwendung |
|---|---|---|
| `JWT_SECRET` | ja | Backend-Konfiguration (min. 32 Zeichen) |
| `DATABASE_MIGRATION_URL` | optional | überschreibt die ephemere CI-Datenbank (Admin-Rolle) |
| `DATABASE_URL` | optional | überschreibt die ephemere CI-Datenbank (App-Rolle) |

Ohne die optionalen `DATABASE_*`-Secrets verbindet sich die Pipeline mit dem lokalen PostgreSQL-Servicecontainer (Trust-Authentifizierung, keine Zugangsdaten im Workflow).

**Rotation:** Die bisherigen Klartextwerte sind in der Git-Historie öffentlich einsehbar und müssen als kompromittiert gelten. `JWT_SECRET` wurde durch einen neu erzeugten Zufallswert ersetzt. Falls die alten Datenbankpasswörter außerhalb der Testumgebung verwendet wurden, sind sie zu rotieren. Die Test-Fixtures (`SecOpsVault2025SecurePassword!` in Seed/Tests) sind reine Testdaten und sollten nicht in produktiven Umgebungen verwendet werden.

---

## 7. Zusätzlich behobene Fehler (für einen real grünen Backend-Job)

Die Backend-Suite war zuvor nie real ausführbar. Folgende Fehler wurden diagnostiziert und behoben:

1. **Seed-UUID ungültig:** `'s1111111-…'` ist kein gültiges UUID-Format (Hex). Korrigiert zu `'b1111111-…'`. Der Seed verschluckte den Fehler zusätzlich stumm; `catch` protokolliert ihn jetzt und beendet mit Exit 1.
2. **`guardbook_revisions` Spalte:** Der Sync-Code selektierte `timestamp`, das Schema besitzt `created_at`. Korrigiert zu `created_at AS timestamp` (API-Form bleibt unverändert).
3. **Testbereinigung:** `afterAll` löschte Mandanten mit der App-Rolle, die bewusst kein `DELETE` besitzt. Neue Testhilfe `src/tests/testUtils.ts` nutzt die administrative Rolle und deaktiviert für die Bereinigung die Append-Only-Trigger (`session_replication_role = replica`, nur Testdatenbank).
4. **Leerer Tenant-Kontext:** `withSystemTransaction` setzte `app.current_tenant = ''`, was beim UUID-Cast abbrach. Jetzt NULL-UUID (`00000000-…`), Ergebnis bleibt korrekt „0 Datensätze“.
5. **Token-Kollision:** Zwei JWTs mit identischem Payload, Secret und `iat`-Sekunde ergaben denselben Hash und verletzten `user_sessions_token_hash_key`. Eindeutige `jwtid`-Werte ergänzt.
6. **Stub ohne Tests:** `frontend/backend/src/tests/store_conflict_contract.test.ts` enthielt nur `export {}` und ließ Jest mit „must contain at least one test“ scheitern. Entfernt; der echte Vertragstest liegt unter `frontend/tests/`.
7. **DELETE-Rechte:** Die Sync-Engine löscht Schichten und Aufgaben versionsgesichert, die App-Rolle hatte jedoch kein `DELETE`. Neue Migration `004_operational_delete_privileges.sql` vergibt `DELETE` ausschließlich auf `shifts` und `tasks`. Append-Only-Tabellen und RLS bleiben unverändert.
8. **Append-Only-Erwartungen:** Tests 9/10 akzeptieren jetzt zusätzlich `permission denied`, da die fehlenden Rechte die Unveränderlichkeit sogar stärker erzwingen als der Trigger.

---

## 8. Lokale Verifikation (tatsächlich ausgeführt)

PostgreSQL 16.15 (Docker, `postgres:16-alpine`, Port 55432):

| Prüfung | Ergebnis |
|---|---|
| `npm ci` (Frontend) | ✅ 151 Pakete |
| `npm test` (Frontend) | ✅ 6/6 Tests |
| `npm run build` (Frontend) | ✅ 2498 Module, `dist` erzeugt |
| `npm ci` (Backend) | ✅ 441 Pakete, argon2 funktionsfähig |
| `npm run build` (Backend) | ✅ Exit 0 |
| `npm run migrate` | ✅ 001–004 angewendet |
| `npm run seed` | ✅ `[SEED SUCCESS]` |
| `npm test -- --runInBand` | ✅ **36/36 Tests, 4/4 Suites** |

---

## 9. GitHub-Actions-Verifikation

### CI-Lauf 1 – `50aa109`

- Run `43040321884` wurde automatisch durch den Push ausgelöst.
- Beide Jobs **success**, alle Einzelschritte success (inkl. Container-Initialisierung, Migration, Seed, Jest).
- Artefakte `frontend-dist` und `backend-dist` wurden erzeugt.
- Warnungen (nicht fehlerhaft):
  - GitHub meldet die Deprecation von Node 20 für `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`; die Actions laufen bereits erzwungen auf Node 24.
  - Hinweis auf die geplante Umstellung von `ubuntu-latest` auf Ubuntu 26 (Oktober 2026).

### CI-Lauf 2 – `26021df` (Berichts-Commit)

- Run `43040787522`, ebenfalls **success** (beide Jobs).
- Dieser Lauf bestätigt die Reproduzierbarkeit der Pipeline.

### CD-Workflow

- Run `43040835902`: **success**, Event `workflow_run`, Job „Release-Paket aus CI-Artefakten bauen“. Der Workflow wurde automatisch durch den erfolgreichen CI-Lauf ausgelöst.
- Ein weiterer `workflow_run`-Lauf `43041029332` für denselben Commit wurde ebenfalls **success** abgeschlossen (Doppel-Trigger durch GitHub, beide Läufe fehlerfrei).
- Damit ist die Kette CI → CD nachweislich aktiv.

---

## 10. Offene Punkte

1. **Python-/Docker-Jobs nicht übernommen:** Das FastAPI-Fragment ist nicht lauffähig, das Dockerfile baut es. Eine Reaktivierung erfordert zunächst ein funktionsfähiges Python-Backend oder ein Dockerfile für das TypeScript-Backend – außerhalb dieses Auftrags.
2. **`ubuntu-latest`:** Bei der Umstellung auf Ubuntu 26 sollte der Workflow erneut geprüft werden.
3. **Action-Versionen:** Mittelfristig auf Node-24-fähige Major-Versionen der Actions aktualisieren, sobald verfügbar.

---

## 11. Abgrenzung

- Keine neuen Fachmodule.
- Keine Änderung der Synchronisationsarchitektur (nur Fehlerkorrekturen: Spaltenname, Rechte, Testharness).
- Keine Datenbank-Neuentwicklung (eine additive Rechte-Migration).
- Keine Änderung der Offline-Logik.
- Keine erfundenen Testergebnisse: alle genannten Läufe und Ergebnisse stammen aus tatsächlich ausgeführten Befehlen bzw. dem abgerufenen GitHub-Run.
