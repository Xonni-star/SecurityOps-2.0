# SecurityOps 2.0 – Schritt 5R.2.20
## Root-Projekt in CI integrieren und Gesamtstart absichern

**Ausgangsstand:** `main` @ `e54b897`
**Durchgeführt am:** 2026-11-11
**Commit:** `ci: verify root application startup and integration`

---

## 1. Ergebnis

Die Pipeline besteht jetzt aus **drei unabhängigen Jobs**:

| Job | Inhalt |
|---|---|
| `root` | Root-Installation, Strukturprüfung, Gesamtstart von Frontend + Backend |
| `frontend` | `npm ci`, Vitest, Produktions-Build, Artefakt |
| `backend` | PostgreSQL 16, Migration, Seed, TypeScript-Build, Jest/RLS, Artefakt |

Die bisherigen Frontend- und Backend-Prüfungen wurden inhaltlich **nicht verändert**. Der neue Root-Job hat einen eigenen PostgreSQL-Service und eigene Installationsschritte, sodass ein Fehler in einem Job die anderen nicht verdeckt.

---

## 2. Geprüfte Root-Dateien

| Datei | Prüfung |
|---|---|
| `package.json` | `concurrently` exakt gepinnt, Skriptziele, keine `workspaces`, keine Proxy-Abhängigkeit, `engines.node` |
| `package-lock.json` | Vorhanden, `concurrently`-Version stimmt mit `package.json` überein |
| `.nvmrc` | Enthält `24`; CI installiert Node.js ausschließlich daraus |
| `.gitignore` | Ignoriert `node_modules/` im Root |

---

## 3. Neuer Root-Job in `.github/workflows/ci.yml`

Schritte:

1. Repository auschecken
2. Node.js über `node-version-file: .nvmrc` (Cache für alle drei Lockfiles)
3. Node-/npm-Version protokollieren
4. `npm ci` im Repository-Root
5. `npm ls --depth=0`
6. `npm ci --prefix frontend`
7. `npm ci --prefix frontend/backend`
8. `npm run migrate --prefix frontend/backend` (isolierte CI-Datenbank)
9. `npm run seed --prefix frontend/backend`
10. `node scripts/ci/verify-root.mjs`
11. `node scripts/ci/smoke-start.mjs`

Der Job besitzt einen eigenen PostgreSQL-16-Servicecontainer mit ausschließlich lokaler Trust-Authentifizierung. Es werden keine produktiven Zugangsdaten verwendet; `JWT_SECRET` kommt aus dem Repository-Secret, die Datenbank-URLs sind optional überschreibbar.

---

## 4. Strukturprüfung (`scripts/ci/verify-root.mjs`)

Geprüft und im lokalen Lauf bestanden:

- `.nvmrc` = `24`
- `engines.node` = `>=24.15.0`
- `concurrently` exakt gepinnt (kein `latest`, kein Range): `10.0.7`
- Lockfile enthält `concurrently@10.0.7`
- Installierte Version via `npm ls concurrently --depth=0 --json` = `10.0.7`
- `dev-frontend` → `frontend`
- `dev-backend` → `frontend/backend`
- `dev-backend` verwendet **nicht** `--prefix backend` (Google-Cloud-Proxy)
- Keine `workspaces`-Deklaration im Root-Paket
- Keine Root-Abhängigkeit mit `file:`, `link:`, `workspace:` oder Pfad auf `backend`
- `.gitignore` ignoriert `node_modules/`

Ausgabe des lokalen Laufs: **11 Prüfungen bestanden, Exit 0**.

---

## 5. Kontrollierter Gesamtstart (`scripts/ci/smoke-start.mjs`)

Ablauf:

1. Startet `npm run dev` (concurrently) mit Test-Umgebungsvariablen und `PORT=8010`.
2. Erkennt die Frontend-Bereitschaft an der Vite-Ausgabe (`Local: http://localhost:<port>/`).
3. Erkennt die Backend-Bereitschaft an `[SECURITYOPS 2.0 BACKEND] Gestartet auf Port …`.
4. Erkennt vorzeitige Prozessenden an `npm run dev-frontend|dev-backend exited with code …` und bricht mit Fehler ab.
5. Ruft `GET /api/v1/health` auf und verlangt `status: "OPERATIONAL"` sowie eine verbundene PostgreSQL-Datenbank.
6. Ruft die Frontend-URL auf und verlangt HTTP 200 mit `id="root"` im HTML.
7. Prüft, dass der Gesamtprozess noch läuft.
8. Beendet die Prozessgruppe kontrolliert (SIGTERM, danach SIGKILL).
9. Timeout: 180 Sekunden (konfigurierbar über `SMOKE_TIMEOUT_MS`).

Damit wird ein vorzeitiges Ende **eines** der beiden Prozesse zuverlässig als Fehler erkannt, auch wenn der andere weiterläuft.

Lokales Ergebnis:

```
[SMOKE] Frontend erkannt: http://localhost:5174
[SMOKE] Backend-Startmeldung erkannt.
[SMOKE] Backend-Health: OPERATIONAL / PostgreSQL 16+ Connected (RLS Active)
[SMOKE] Frontend erreichbar: HTTP 200
[SMOKE] Beide Prozesse laufen und antworten. Starttest bestanden.
```

Exit 0.

---

## 6. Lokal tatsächlich ausgeführt

| Befehl | Ergebnis |
|---|---|
| `npm ci` (Root) | ✅ 20 Pakete |
| `npm ls --depth=0` | ✅ nur `concurrently@10.0.7`, Exit 0 |
| `npm ci --prefix frontend` | ✅ 151 Pakete |
| `npm ci --prefix frontend/backend` | ✅ 441 Pakete |
| `npm run migrate --prefix frontend/backend` | ✅ Migrationen 001–004 |
| `npm run seed --prefix frontend/backend` | ✅ `[SEED SUCCESS]` |
| `node scripts/ci/verify-root.mjs` | ✅ 11/11 Prüfungen |
| `node scripts/ci/smoke-start.mjs` | ✅ Starttest bestanden, Exit 0 |

Datenbank: isoliertes PostgreSQL 16.15 (Docker, Port 55432), Testdatenbank `securityops_v2`.

---

## 7. Unveränderte Prüfungen

- PostgreSQL-16-Service mit Healthcheck
- Migrationen über `secops_admin`
- Seed über die Anwendungsrolle
- Jest-/RLS-/Mandanten-/Rollen-Tests (36 Tests, 4 Suites)
- TypeScript-Build
- Vitest (6 Tests) und Produktions-Build
- Artefakte `frontend-dist` und `backend-dist`
- CD-Workflow unverändert

---

## 8. GitHub-Actions-Läufe

Die tatsächlichen Run-IDs und Ergebnisse werden nach dem Push ergänzt:

| Workflow | Run-ID | Ergebnis |
|---|---|---|
| SecurityOps 2.0 CI (Root) | _wird ergänzt_ | _wird ergänzt_ |
| SecurityOps 2.0 CI (Frontend) | _wird ergänzt_ | _wird ergänzt_ |
| SecurityOps 2.0 CI (Backend) | _wird ergänzt_ | _wird ergänzt_ |
| SecurityOps 2.0 CD | _wird ergänzt_ | _wird ergänzt_ |

---

## 9. Abgrenzung

- Keine neuen Fachfunktionen.
- Keine Änderungen an Datenbankmigrationen.
- Keine Änderungen an Mandantenfähigkeit oder Offline-Synchronisation.
- Keine Klartext-Secrets.
- Keine Versionsupdates; `concurrently` bleibt bei `10.0.7`.
- Keine Verwendung von `latest`.
- Keine erfundenen Ergebnisse: alle Angaben stammen aus den oben genannten Befehlen.
