# SecurityOps 2.0 — Sicherheitsdienstverwaltung

Mandantenfähige Verwaltungssoftware für Sicherheitsunternehmen mit Prozessbezug zu **DIN 77200** und **§ 34a GewO**: Dienstplanung, Objekt- und Mitarbeiterverwaltung, digitales Wachbuch, Übergabe- und Kontrollgangsmanagement, Schlüssel- und Aufgabenverwaltung sowie Offline-Synchronisation für den mobilen Einsatz. Das ist keine Zertifizierungs- oder Rechtskonformitätsaussage.

> **Projektstatus: In Entwicklung; nicht für Produktion freigegeben.**
> Die Backend- und Frontend-Funktionen werden durch lokale Tests und CI geprüft. Das ist kein Nachweis eines Produktions-Rollouts, einer fachlichen Abnahme oder der Rechtskonformität im konkreten Einsatz.
> Der aktuelle quellcodebasierte Stand, Befunde und Prüfgrenzen stehen im [Phase-1-Abschlussbericht](./PHASE_1_INTEGRATION_COMPLETION_REPORT.md). Frühere Umsetzungsberichte sind historische Snapshots.
> Alarmmanagement (#12), Übergaben (#13) und Kontrollgänge (#14) sind in `main` integriert. Details: [Handovers-API](./frontend/HANDOVERS_API.md), [Alarm-API](./frontend/ALARM_EMERGENCY_API.md) und [Kontrollgang-Modul](./frontend/PATROL_MANAGEMENT.md).
> **Mainline-Status:** `main` steht auf `b94e21d` (PR #16); PRs #17 und #18 sind ebenfalls Vorfahren von `main`. PRs #19–#24 wurden in Feature-Branches zusammengeführt, sind aber noch nicht in `main`. Der aktuelle Integrationsstand und seine Prüfung sind im [Mainline-Integrationsbericht](./MAINLINE_INTEGRATION_STATUS.md) dokumentiert.

---

## Architektur

| Verzeichnis | Inhalt |
|---|---|
| `frontend/` | React-19-SPA mit Vite, TypeScript, Zustand-Store, IndexedDB-Outbox und Vitest |
| `frontend/backend/` | Node.js/Express/TypeScript-REST-API (`/api/v1`) mit PostgreSQL 16+ Row-Level-Security, serverseitig widerrufbaren Cookie-Sitzungen und Argon2id |
Es gibt kein separates Root-Proxy-Backend. Alle SecurityOps-Backend-Befehle (Migrationen, Seed, Tests) laufen unter `frontend/backend/`.

---

## Voraussetzungen

* **Node.js ≥ 24.15.0** (siehe `.nvmrc`: `24`) und npm
* **PostgreSQL 16+**
* Zwei Datenbankrollen:
  * `secops_admin` — ausschließlich für DDL-Migrationen und Schema-Upgrades
  * `secops_app_user` — operativer Betrieb, **ohne** Superuser- oder `BYPASSRLS`-Rechte

---

## Schnellstart

```bash
git clone https://github.com/Xonni-star/SecurityOps-2.0.git
cd SecurityOps-2.0

# Abhängigkeiten
npm install
npm --prefix frontend install
npm --prefix frontend/backend ci

# Konfiguration
cp frontend/backend/.env.example frontend/backend/.env
# → Werte in frontend/backend/.env eintragen (siehe unten)

# Datenbank vorbereiten
npm --prefix frontend/backend run migrate
npm --prefix frontend/backend run seed

# Frontend + Backend parallel starten
npm run dev
```

`npm run dev` startet das Vite-Frontend und das SecurityOps-Backend (Standard-Port `8000`).

---

## Umgebungsvariablen (`frontend/backend/.env`)

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `PORT` | nein | HTTP-Port des Backends (Standard: `8000`) |
| `NODE_ENV` | nein | `development` \| `test` \| `production` |
| `DATABASE_URL` | **ja** | Verbindung als `secops_app_user` (RLS-Operationen) |
| `DATABASE_MIGRATION_URL` | Migrationen/Seed: **ja** | Verbindung als `secops_admin`; nicht für den laufenden API-Prozess |
| `JWT_SECRET` | **ja (Legacy-Konfigurationsprüfung)** | Mindestens 32 Zeichen; aktuelle Sitzung verwendet opake Cookies und signiert keine JWTs |
| `JWT_EXPIRES_IN` | nein | Sitzungsdauer im Format `<Zahl><s\|m\|h\|d>`, z. B. `8h` |
| `CORS_ORIGIN` | **ja** | Kommagetrennte Whitelist, z. B. `http://localhost:3000` |
| `RATE_LIMIT_MAX` | nein | Globales per-IP-Limit je Minute (Standard `120`) |
| `RATE_LIMIT_REDIS_URL` | Entwicklung: nein; Produktion: **ja** | Gemeinsamer Redis-Store für API-Limits; alle Backend-Replikas müssen dieselbe Redis-Instanz verwenden |

Das Backend verweigert den Start bei fehlenden, ungültigen oder offensichtlich unsicheren Secrets.

---

## Module

| Modul | Status | Anmerkung |
|---|---|---|
| Kunden | API integriert | Mandantengeschützte Liste, Anlage, Änderung, Archivierung und Offline-Mutationen |
| Objekte | API integriert | Mandantengeschützte CRUD-/Archiv-/Wiederherstellungs- und Sync-Pfade |
| Mitarbeiter | API integriert | Stammdaten, Zuordnungen, Qualifikationen, Abwesenheiten und Kontoverknüpfung; Berechtigungen bleiben serverseitig |
| Schichten | API integriert, Planung fachlich unvollständig | CRUD/Synchronisierung vorhanden; Überschneidungs-, Ruhezeit-, Arbeitszeit- und Tarifprüfungen sind nicht implementiert |
| Schlüssel und Aufgaben | API integriert | CRUD und Sync-Pfade; eine vollständige Offline- und Revisionshistorie ist nicht für alle Aktionen nachgewiesen |
| Wachbuch | API integriert | Lesen, Erfassung, append-only Korrekturergänzungen und Sync; keine vollständige Abnahme aller Offline-/Auditfälle |
| Dokumente | implementiert, nicht deployed | Tenant-scoped API, private Dateispeicherung, Versionen, Kategorien/Ordner, Audit und Beziehungen; Offline-Binärdateien und externer Malware-Scan fehlen |
| SOPs | implementiert, nicht deployed | Versionierter Prüf-/Freigabe-Workflow, Zuweisungen, Bestätigungen und Berichte; Details siehe [SOP-API](./frontend/SOP_API.md) |
| Alarme/Notfallpläne | implementiert, nicht deployed | Versionierte Pläne, Vorfälle, Ereignisse, Offline-Queue und Eskalationsworker; externe E-Mail-/Push-Zustellung ist nicht konfiguriert |
| Übergaben | in `main` integriert, nicht deployed | Tenant-scoped Protokolle, getrennte Bestätigungen, Ereignisse, übernommene Aufgaben, DMS-Links und Offline-Sync |
| Kontrollgänge | in `main` integriert, nicht deployed | RLS, QR/NFC/manuelle Scans, versionierte Routen, Gruppen, Termin-Vorkommen, Abweichungen und Offline-Sync; externe Benachrichtigung und Offline-Binäranhänge fehlen |
| Benutzer/Rechte | Integration von PRs [#20](https://github.com/Xonni-star/SecurityOps-2.0/pull/20), [#22](https://github.com/Xonni-star/SecurityOps-2.0/pull/22) und [#24](https://github.com/Xonni-star/SecurityOps-2.0/pull/24) vorgeschlagen; noch nicht in `main` | Tenant-scoped Benutzerverwaltung, Rollen/Grants, Passwort-Reset-Zustellungsschnittstelle und standortbezogene Autorisierung; Online-Adminfunktionen, keine Produktionsfreigabe |
| API-Rate-Limit | Integration von PR [#21](https://github.com/Xonni-star/SecurityOps-2.0/pull/21) vorgeschlagen; noch nicht in `main` | Per-IP-Limit mit gemeinsamem Redis-Store; Redis ist im Produktionsmodus erforderlich |
| Offline-Sync | teilweise integriert; Verbesserungen aus PR [#23](https://github.com/Xonni-star/SecurityOps-2.0/pull/23) im Integrationsvorschlag | IndexedDB-Outbox und modulbezogene Sync-Pfade; nicht jede Funktion und jedes Binärartefakt ist offline verfügbar |
| Dienstplanung | Backend/UI aus PRs [#16](https://github.com/Xonni-star/SecurityOps-2.0/pull/16), [#17](https://github.com/Xonni-star/SecurityOps-2.0/pull/17) und [#18](https://github.com/Xonni-star/SecurityOps-2.0/pull/18) in `main`; weitergehende Workflows aus PR [#19](https://github.com/Xonni-star/SecurityOps-2.0/pull/19) im Integrationsvorschlag | API-gestützte Kalender- und Planungsabläufe; nicht deployed und keine Rechtskonformitätsaussage. Aktueller Integrationsstatus: [Mainline-Integrationsbericht](./MAINLINE_INTEGRATION_STATUS.md) |

---

## Tests und Build

```bash
# Backend (Jest, inkl. PostgreSQL-RLS-Integrationstests)
npm --prefix frontend/backend test

# Frontend (Vitest)
npm --prefix frontend test

# Produktions-Build
npm --prefix frontend run build
npm --prefix frontend/backend run build

# Dependency audits
npm --prefix frontend audit
npm --prefix frontend/backend audit
npm --prefix frontend/backend audit --omit=dev
```

Audit snapshot (2026-11-14): `npm --prefix frontend audit` found 0 vulnerabilities. The full backend audit found 7 LOW findings for `deepmerge@4.3.1` (GHSA-gcqx-w2h4) in Jest/`ts-jest` development dependencies; `npm --prefix frontend/backend audit --omit=dev` found 0 production findings. Upstream has no patched 4.x release; do not force the breaking Jest downgrade suggested by npm.

---

## Sicherheit

* **Mandantenisolation:** RLS und `FORCE ROW LEVEL SECURITY` sind für ausgewählte tenantgebundene Tabellen konfiguriert; dies gilt nicht pauschal für jede historische Tabelle. Tenant-scoped API-Zugriffe setzen ihren Datenbankkontext aus der authentifizierten Sitzung. Bekannte modulbezogene Grenzen stehen in den jeweiligen API-/Sicherheitsdokumenten.
* **Least Privilege:** Der operative Benutzer `secops_app_user` besitzt weder Superuser- noch `BYPASSRLS`-Rechte; die Rolle wird beim Serverstart verifiziert.
* **Authentifizierung:** Argon2id-Passworthashes, opake zufällige `HttpOnly`-Sitzungscookies, Datenbank-Widerruf, CSRF-Schutz und kontoabhängiger Lockout nach Fehlversuchen. Ein per-IP-API-Limit kann einen gemeinsamen Redis-Store verwenden; im Produktionsmodus ist Redis erforderlich. Ohne Redis im Entwicklungsmodus bleibt der Zähler pro Prozess.
* **Offline-Sync:** Idempotente Mutationen über `POST /api/v1/sync/push`; Übergaben verwenden zusätzlich `POST /api/v1/handovers/sync`, Advisory Locks und persistente Quittungen. Lokale Erfassung bleibt bis zur API-Quittung ausstehend; Konflikte überschreiben keine bestätigten Protokolle.

---

## Dokumentation

* [frontend/README.md](./frontend/README.md) — detaillierte Architektur-, Build- und Testhinweise
* [frontend/INSTALLATION_GUIDE.md](./frontend/INSTALLATION_GUIDE.md) — Installation und Inbetriebnahme
* [frontend/SYSTEM_OVERVIEW.md](./frontend/SYSTEM_OVERVIEW.md) — Systemüberblick
* [frontend/HANDOVERS_API.md](./frontend/HANDOVERS_API.md) — Übergabe-API, Statusmodell und Offline-Synchronisierung
* [frontend/USER_ADMINISTRATION_API.md](./frontend/USER_ADMINISTRATION_API.md) — Benutzer-/Rollen-API, Berechtigungsgrenzen und Reset-Ablauf
* [MAINLINE_INTEGRATION_STATUS.md](./MAINLINE_INTEGRATION_STATUS.md) — bestätigte Mainline-Ancestry, integrierte PR-Deltas und Validierungsstatus
* [frontend/SECURITY_AUDIT.md](./frontend/SECURITY_AUDIT.md) — historischer Sicherheitsaudit-Snapshot und aktueller Verweis
* [frontend/KNOWN_ISSUES.md](./frontend/KNOWN_ISSUES.md) — bekannte Einschränkungen
* [docs/development/NEXT_DEVELOPMENT_REPORT.md](./docs/development/NEXT_DEVELOPMENT_REPORT.md) — historischer Implementierungsbericht zu Benutzer-/Rechteverwaltung
* [PHASE_1_INTEGRATION_COMPLETION_REPORT.md](./PHASE_1_INTEGRATION_COMPLETION_REPORT.md) — aktueller quellcodebasierter Umsetzungsstand, Befunde und Prüfgrenzen
* [frontend/SERVICE_PLANNING_SPECIFICATION.md](./frontend/SERVICE_PLANNING_SPECIFICATION.md) — Dienstplanungs-Spezifikation und Phase-2-Implementierungsstand
* [PHASE_2_FINAL_COMPLETION_REPORT.md](./PHASE_2_FINAL_COMPLETION_REPORT.md) — Phase-2-Implementierungssnapshot; aktuelle PR-/Mainline-Status siehe Integrationsbericht
* [PHASE_2_SERVICE_PLANNING_COMPLETION_REPORT.md](./PHASE_2_SERVICE_PLANNING_COMPLETION_REPORT.md) — historischer Backend-/Frontend-Implementierungsbericht
* [FINAL_COMPLETION_REPORT.md](./FINAL_COMPLETION_REPORT.md) — historischer Umsetzungsstand
* [DMS_IMPLEMENTATION_REPORT.md](./DMS_IMPLEMENTATION_REPORT.md) — DMS-Umfang, Sicherheitsmodell, Tests und offene Einschränkungen
* [frontend/ALARM_EMERGENCY_API.md](./frontend/ALARM_EMERGENCY_API.md) — Alarm-/Notfall-API, Berechtigungen und Workflow
* [ALARM_EMERGENCY_IMPLEMENTATION_REPORT.md](./ALARM_EMERGENCY_IMPLEMENTATION_REPORT.md) — umgesetzter Umfang, Validierung und Einschränkungen

---

## Lizenz

Für dieses Repository ist derzeit keine Lizenz hinterlegt.
