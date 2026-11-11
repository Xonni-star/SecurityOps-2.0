# SecurityOps 2.0 – Entwicklungsschritt 5R.3.2
> **Historischer Snapshot:** Dieser Bericht hält den Stand vor Schritt 5R.3.4 fest. Damals erwähnte KI-/Proxy-Funktionen wurden in Schritt 5R.3.4 vollständig aus dem Produkt entfernt; die folgenden Angaben sind kein aktueller Funktions- oder Architekturstatus.

## Produktionsdeployment vollständig auf das TypeScript-Backend umstellen

**Durchgeführt am:** 2026-11-11  
**Code-Commit:** `25963ca` – `fix: align production deployment with TypeScript backend`  
**CI-Run:** `43078287238` – alle vier Jobs erfolgreich  
**CD-Run:** `43078565272` – Release-Paket erfolgreich

---

## 1. Analyse der bisherigen Deployment-Architektur

Die bestehende Produktionskonfiguration stammte aus der früheren FastAPI-/Google-Cloud-Architektur:

- `frontend/deploy/Caddyfile` leitete `/api/*`, `/docs*` und `/openapi.json*` an `backend:8000`.
- Der Compose-Dienst `backend` baute `deploy/Dockerfile.backend` – ein **Python-3.11-Image** mit `uvicorn backend.api:app`.
- Zusätzlich existierten ein Redis-Broker und ein Python-Celery-Worker.
- Das eigentliche SecurityOps-Backend unter `frontend/backend/` (Node.js/Express/TypeScript, PostgreSQL-RLS, JWT) wurde **nirgends gebaut oder gestartet**.
- Das Frontend wurde aus `../public` ausgeliefert; dort liegen nur `manifest.json` und `sw.js`, nicht der Vite-Produktionsbuild.
- Migrationen liefen über Alembic/Python, nicht über den TypeScript-Migrationsrunner.
- Die Datenbank-URL des Backends verwendete die administrative Rolle `secops_admin` (`postgresql+asyncpg://…`), nicht die Least-Privilege-Rolle `secops_app_user`.
- Für `secops_app_user` wurde kein Passwort gesetzt.
- Healthchecks prüften den Python-Container per `curl`; der TypeScript-Health-Endpunkt wurde nicht verwendet.
- Die CSP erlaubte nicht benötigte Google-Fonts-/gstatic-Verbindungen; `/docs` und `/openapi.json` existierten im TS-Backend nicht.
- `index.html` enthielt eine tote Referenz auf `/index.js`, die im Build nicht existiert.

**Folge:** Der Produktionsproxy zeigte auf einen nicht lauffähigen Python-Stack; das TypeScript-Backend war im Deployment nicht erreichbar.

---

## 2. Ursache der FastAPI-Fehlleitung

Die Compose-Datei und das Caddyfile waren gemeinsam auf den alten Python-Dienst abgestimmt:

```yaml
backend:
  build:
    dockerfile: deploy/Dockerfile.backend
```

```caddyfile
handle /api/* {
    reverse_proxy backend:8000
}
```

Der Dienstname `backend` war korrekt, das dahinterliegende Image jedoch das Python-Image. Es gab keinen Dienst, der `frontend/backend` baute. Damit zeigte Caddy formal auf „backend:8000“, tatsächlich aber auf den falschen Stack.

---

## 3. Tatsächliche neue Produktionsarchitektur

```
Internet
   │ 80/443 (TLS)
   ▼
proxy (Caddy, Frontend-Build + Reverse Proxy)
   │ /api/* → backend:8000
   ▼
backend (Node.js/Express/TypeScript, secops_app_user)
   │ 5432
   ▼
db (PostgreSQL 16, RLS, nur intern)

migrate (einmalig, secops_admin) ──► db
db-init (einmalig, setzt Passwort für secops_app_user)
backup (verschlüsselte pg_dump-Backups, nur intern)
```

### Startreihenfolge

1. `db` wird healthy (`pg_isready`).
2. `migrate` führt alle TypeScript-Migrationen mit `secops_admin` aus.
3. `db-init` setzt das Passwort für `secops_app_user`.
4. `backend` startet, prüft die App-Rolle (kein Superuser, kein BYPASSRLS) und wird healthy.
5. `proxy` startet und liefert Frontend + API aus.

### Container- und Netzwerkübersicht

| Dienst | Image | Netzwerk | Host-Ports | Aufgabe |
|---|---|---|---|---|
| `db` | `postgres:16-alpine` | `secops_internal` | **keine** | PostgreSQL 16, Volume `secops_pgdata` |
| `migrate` | `securityops-backend:latest` | `secops_internal` | keine | einmalige DDL-Migrationen via `secops_admin` |
| `db-init` | `securityops-backend:latest` | `secops_internal` | keine | setzt Passwort für `secops_app_user` |
| `backend` | `securityops-backend:latest` | `secops_internal` | **keine** | Express-API, ausschließlich `secops_app_user` |
| `proxy` | `securityops-frontend:latest` | `secops_internal` + `secops_public` | `80`, `443` (konfigurierbar) | Caddy TLS, statisches Frontend, API-Proxy |
| `backup` | `postgres:16-bookworm` | `secops_internal` | keine | AES-256-verschlüsselte DB-Backups |

Volumes: `secops_pgdata`, `secops_backups`, `caddy_data`, `caddy_config`.

---

## 4. Geänderte Dateien

| Datei | Änderung |
|---|---|
| `frontend/deploy/Caddyfile` | API auf TS-Backend; Frontend aus `/srv`; FastAPI-Docs-Routen entfernt; CSP auf tatsächliche Ressourcen angepasst |
| `frontend/deploy/Dockerfile.backend` | **Ersetzt:** Node-24-Multi-Stage-Build des TypeScript-Backends, SQL-Migrationen im Image, Non-root-User |
| `frontend/deploy/Dockerfile.frontend` | **Neu:** Vite-Build + Caddy-Image mit statischem Frontend |
| `frontend/deploy/docker-compose.production.yml` | **Neu aufgebaut:** db/migrate/db-init/backend/proxy/backup; keine Redis-/Python-Worker; keine öffentlichen DB-/Backend-Ports |
| `frontend/deploy/.env.example` | Neue Secrets (`POSTGRES_APP_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN`, `BACKUP_ENCRYPTION_KEY`), optionale Proxy-Ports |
| `frontend/deploy/install.sh` | TypeScript-Deployment, Secret-Generierung, Migration/Healthcheck, kein Alembic/Redis/Worker |
| `frontend/deploy/backup_cron.sh` | PostgreSQL-Backup + AES-256-Verschlüsselung, 30 Tage Retention |
| `frontend/deploy/restore.sh` | Restore über `pg_restore` im `db`-Container |
| `frontend/deploy/PRODUCTION_DEPLOYMENT.md` | **Neu:** vollständige Installations-/Betriebsanleitung |
| `frontend/.dockerignore` | Build-Kontext bereinigt |
| `frontend/index.html` | Tote `/index.js`-Referenz entfernt |
| `frontend/backend/src/config/env.ts` | `DATABASE_MIGRATION_URL` für den API-Server optional |
| `frontend/backend/src/migrations/runner.ts` | Klarer Fehler, wenn `DATABASE_MIGRATION_URL` fehlt |
| `frontend/backend/src/scripts/setAppPassword.ts` | **Neu:** setzt das App-Passwort über die Admin-Verbindung |
| `frontend/backend/src/tests/migrations.test.ts` | Test-Helper an optionale Migrations-URL angepasst |
| `.github/workflows/ci.yml` | Neuer Job `docker-production`: Compose-Validierung + Image-Builds |

---

## 5. Sicherheitsprüfungen

- **CORS-Whitelist** unverändert aktiv; PATCH-Preflight über Caddy mit HTTP 204 bestätigt.
- **Helmet** bleibt im Backend aktiv.
- **TLS** über Caddy; im lokalen Test mit interner CA (`localhost`), produktiv mit öffentlicher Domain.
- **RLS und Mandantenisolation** über den echten API-Pfad bestätigt: Bavaria-Login sah ausschließlich Bavaria-Daten, nicht den Frankfurt-Testkunden.
- **Least-Privilege:** `secops_app_user` wird mit `LOGIN`, ohne `SUPERUSER`, `BYPASSRLS`, `CREATEROLE`, `CREATEDB` verwendet. Der API-Container erhält **keine** administrative DB-URL.
- **Keine öffentlichen DB-/Backend-Ports**; nur Caddy ist über 80/443 erreichbar.
- **Secrets** ausschließlich über `.env` (Modus 600); `.env.example` enthält nur Platzhalter; `install.sh` erzeugt hex-kodierte Zufallswerte.
- **CSP** entspricht den tatsächlichen Ressourcen: Tailwind CDN, Inline-Konfiguration, Gemini-API, `data:`/`blob:`-Bilder. Nicht benötigte Google-Fonts-/gstatic-Quellen wurden entfernt.
- **Migrationen** laufen ausschließlich mit `secops_admin`; der normale Betrieb mit `secops_app_user`.
- **Healthcheck** prüft die echte PostgreSQL-Verbindung über `/api/v1/health`.

---

## 6. Tatsächliche Testergebnisse

### 6.1 Docker-Integrationstests (lokal)

| # | Test | Ergebnis |
|---|---|---|
| 1 | Backend-Image bauen | ✅ `securityops-backend:ci` |
| 2 | Frontend-/Caddy-Image bauen | ✅ `securityops-frontend:ci` |
| 3 | Compose-Konfiguration validieren | ✅ `docker compose config --no-interpolate --quiet` |
| 4 | Startreihenfolge | ✅ db healthy → migrate exited → db-init exited → backend healthy → proxy started |
| 5 | Caddy erreicht TypeScript-Backend | ✅ `/api/v1/health` über `https://localhost:18443` |
| 6 | Health-Endpunkt | ✅ `status: OPERATIONAL`, PostgreSQL verbunden |
| 7 | Frontend über Caddy | ✅ HTTP 200, `id="root"` vorhanden |
| 8 | Login über Caddy | ✅ HTTP 200, JWT erhalten |
| 9 | Authentifizierte API-Anfrage | ✅ `GET /api/v1/customers` mit Bearer-Token |
| 10 | CORS-PATCH-Preflight über Caddy | ✅ HTTP 204, `PATCH` in Allow-Methods |
| 11 | Nicht erlaubte Origin | ✅ HTTP 500, kein `Access-Control-Allow-Origin` |
| 12 | Mandantenisolation | ✅ Bavaria-Login sah nur Bavaria-Kunden |
| 13 | Persistenz nach Container-Neustart | ✅ `DOCKER-TEST-1794421614` nach `restart db backend` weiterhin vorhanden |
| 14 | Demo-Seed im Container | ✅ `[SEED SUCCESS]` |

### 6.2 Anwendungssuiten

| Prüfung | Ergebnis |
|---|---|
| Backend `tsc` | ✅ Exit 0 |
| Backend Jest | ✅ **129/129 Tests, 7/7 Suiten** |
| Frontend Vitest | ✅ **14/14 Tests, 2/2 Dateien** |
| Frontend `vite build` | ✅ Exit 0 |

---

## 7. Nicht durchgeführte Tests

1. **Öffentliche Let's-Encrypt-Zertifikate:** Der lokale Test verwendete `DOMAIN=localhost` mit Caddys interner CA und `curl -k`. Eine echte öffentliche Domain/DNS wurde nicht getestet.
2. **Vollständiger Browser-E2E-Test:** Login-UI, Klicks und Modulinteraktionen wurden nicht im Browser automatisiert; geprüft wurden API, Frontend-HTML und CORS.
3. **Backup-/Restore-End-to-End:** Der Backup-Container startete, aber es wurde kein vollständiger 24-Stunden-Zyklus und kein echter Restore-Lauf durchgeführt.
4. **Externe Integrationen:** SMTP, Google Cloud und Gemini wurden nicht getestet.
5. **Produktions-DNS/Firewall:** Nicht Teil der lokalen Prüfung.
6. **GitHub-Actions-Docker-Integrationstest:** Der CI-Job validiert Compose und baut beide Images; die vollständige Container-Kette wurde lokal getestet, nicht in GitHub Actions gestartet.

---

## 8. GitHub-CI/CD-Ergebnisse

| Workflow | Run-ID | Ergebnis |
|---|---|---|
| SecurityOps 2.0 CI | [`43078287238`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43078287238) | **success** – Root, Frontend, Backend, Produktions-Docker |
| SecurityOps 2.0 CD | [`43078565272`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43078565272) | **success** – Release-Paket |

Artefakte:

| Run | Artefakt | Größe |
|---|---|---|
| CI `43078287238` | `frontend-dist` | 341.297 Bytes |
| CI `43078287238` | `backend-dist` | 69.855 Bytes |
| CD `43078565272` | `securityops-release-25963ca…` | 411.774 Bytes |

Der neue CI-Job `docker-production` war erfolgreich: Compose-Konfiguration ohne Secret-Interpolation gültig, Backend- und Frontend-Image gebaut.

---

## 9. Noch offene Produktionsrisiken

1. **Dokumente, SOPs, Alarme/Notfallpläne:** weiterhin keine Tabellen/Endpunkte; das Frontend nutzt dort Mock-Daten.
2. **KI/Copilot:** Gemini wird weiterhin im Browser initialisiert; die CSP erlaubt `generativelanguage.googleapis.com`. Eine serverseitige Proxy-Lösung fehlt.
3. **Auth-Härtung:** JWT liegt im `localStorage`; HttpOnly-Cookies, CSRF und Login-Rate-Limiting sind offen.
4. **Tailwind CDN:** Produktions-CSP erlaubt `cdn.tailwindcss.com`; für eine strengere CSP/Offline-Fähigkeit sollte Tailwind lokal gebaut werden.
5. **Backup/Restore:** Verschlüsselungsschlüssel-Verwaltung und echter Restore sind nicht automatisiert getestet.
6. **TLS:** Öffentliche Zertifikatsausstellung, DNS und Firewall wurden nicht verifiziert.
7. **Docker-Tags:** `node:24-bookworm-slim` und `caddy:2-alpine` sind nicht auf Digests gepinnt.
8. **App-Passwort-Rotation:** Erfordert erneutes `db-init` und Backend-Neustart; kein automatisierter Rotationsprozess.
9. **Mock-Daten:** Nicht integrierte Module zeigen weiterhin lokale Beispieldaten.
10. **E2E-/Security-Scan:** Vollständige Browser-E2E-Tests, Linting und Container-Security-Scans fehlen.

---

**Abschlussstatus:** Das Produktionsdeployment verwendet jetzt nachweislich das TypeScript-/Express-Backend, startet reproduzierbar über Docker Compose, liefert das Frontend über Caddy aus, führt Migrationen mit `secops_admin` aus und betreibt die API ausschließlich mit `secops_app_user`. Die Docker-Integrationstests und GitHub-CI wurden tatsächlich bestätigt. Die oben genannten Produktionsrisiken bleiben offen.
