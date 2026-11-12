# SecurityOps 2.0 — Sicherheitsdienstverwaltung

Mandantenfähige Verwaltungssoftware für Sicherheitsunternehmen nach **DIN 77200** und **§ 34a GewO**: Dienstplanung, Objekt- und Mitarbeiterverwaltung, digitales Wachbuch, Schlüssel- und Aufgabenverwaltung sowie Offline-Synchronisation für den mobilen Einsatz.

> **Projektstatus: In Entwicklung; nicht für Produktion freigegeben.**
> DMS, SOP/Dienstanweisungen und Alarm-/Notfallmanagement sind im Repository implementiert, aber nicht deployed oder für Produktion freigegeben. Übergaben und Streifenkontrollen sind weiterhin offen.
> Historischer Gesamtstatus: [FINAL_COMPLETION_REPORT.md](./FINAL_COMPLETION_REPORT.md); aktuelle SOP-Umsetzung: [SOP_IMPLEMENTATION_REPORT.md](./SOP_IMPLEMENTATION_REPORT.md); Alarm-/Notfallmanagement: [Implementierungsbericht](./ALARM_EMERGENCY_IMPLEMENTATION_REPORT.md).

---

## Architektur

| Verzeichnis | Inhalt |
|---|---|
| `frontend/` | React-19-SPA mit Vite, TypeScript, Zustand-Store, IndexedDB-Outbox und Vitest |
| `frontend/backend/` | Node.js/Express/TypeScript-REST-API (`/api/v1`) mit PostgreSQL 16+ Row-Level-Security, JWT und Argon2id |
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
| `DATABASE_MIGRATION_URL` | **ja** | Verbindung als `secops_admin` (Migrationen) |
| `JWT_SECRET` | **ja** | Mindestens 32 Zeichen; erzeugen mit `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | nein | Format `<Zahl><s\|m\|h\|d>`, z. B. `8h` |
| `CORS_ORIGIN` | **ja** | Kommagetrennte Whitelist, z. B. `http://localhost:3000` |
| `RATE_LIMIT_MAX` | nein | Anfragen pro Minute je IP (Standard: `120`) |

Das Backend verweigert den Start bei fehlenden, ungültigen oder offensichtlich unsicheren Secrets.

---

## Module

| Modul | Status | Anmerkung |
|---|---|---|
| Kunden | teilweise | Anlegen/Lesen persistiert; Ändern/Löschen offen |
| Objekte | teilweise | Anlegen/Lesen/Ändern persistiert; Archivieren/Löschen offen |
| Mitarbeiter | teilweise | Anlegen/Lesen/Ändern persistiert; Qualifikationen/Abwesenheiten offen |
| Schichten | CRUD fertig | ArbZG-Prüfungen offen |
| Schlüssel | CRUD fertig | Historie teilweise |
| Aufgaben | CRUD fertig | — |
| Wachbuch | teilweise | Lesen persistiert; Schreiben über Outbox/Sync |
| Dokumente | implementiert, lokal verifiziert; nicht deployed | Mandantengeschützte PostgreSQL-Verwaltung, private Dateispeicherung, Versionen, Kategorien, Ordner, Audit und REST-API; Einschränkungen siehe [DMS-Bericht](./DMS_IMPLEMENTATION_REPORT.md) |
| SOPs | implementiert, nicht deployed | Versionierter Prüf-/Freigabe-Workflow, Zuweisungen, Bestätigungen, JSON-Berichte; Einschränkungen siehe [SOP-API](./frontend/SOP_API.md) und [Implementierungsbericht](./SOP_IMPLEMENTATION_REPORT.md) |
| Alarme/Notfallpläne | implementiert, lokal verifiziert; nicht deployed | Mandantengeschützte Notfallpläne, Alarmvorfälle, Maßnahmenverlauf und Übungsdokumentation; Umfang und Einschränkungen siehe [API-Dokumentation](./frontend/ALARM_EMERGENCY_API.md) und [Implementierungsbericht](./ALARM_EMERGENCY_IMPLEMENTATION_REPORT.md) |
| Übergaben | offen | Nur lokales Mobile-Modul |
| Streifenkontrollen | offen | Nur lokales Mobile-Modul |
| Benutzer/Rechte | teilweise | Login/RBAC vorhanden; Verwaltungs-API offen |
| Offline-Sync | teilweise | Outbox vorhanden; nicht alle Module angebunden |

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
```

---

## Sicherheit

* **Mandantenisolation:** PostgreSQL 16+ erzwingt `FORCE ROW LEVEL SECURITY`; ohne gesetzten Transaktionskontext (`SET LOCAL app.current_tenant`) liefert die Datenbank physisch keine Datensätze.
* **Least Privilege:** Der operative Benutzer `secops_app_user` besitzt weder Superuser- noch `BYPASSRLS`-Rechte; die Rolle wird beim Serverstart verifiziert.
* **Authentifizierung:** Argon2id-Passworthashes, JWT-Sessions, Rate Limiting und Brute-Force-Schutz.
* **Offline-Sync:** Idempotente Mutationen über `POST /api/v1/sync/push` mit Advisory Locks und Quittungstabellen; Konflikte werden über `POST /api/v1/sync/conflicts/resolve` entschieden.

---

## Dokumentation

* [frontend/README.md](./frontend/README.md) — detaillierte Architektur-, Build- und Testhinweise
* [frontend/INSTALLATION_GUIDE.md](./frontend/INSTALLATION_GUIDE.md) — Installation und Inbetriebnahme
* [frontend/SYSTEM_OVERVIEW.md](./frontend/SYSTEM_OVERVIEW.md) — Systemüberblick
* [frontend/SECURITY_AUDIT.md](./frontend/SECURITY_AUDIT.md) — Sicherheitsaudit
* [frontend/KNOWN_ISSUES.md](./frontend/KNOWN_ISSUES.md) — bekannte Einschränkungen
* [FINAL_COMPLETION_REPORT.md](./FINAL_COMPLETION_REPORT.md) — aktueller Umsetzungsstand
* [DMS_IMPLEMENTATION_REPORT.md](./DMS_IMPLEMENTATION_REPORT.md) — DMS-Umfang, Sicherheitsmodell, Tests und offene Einschränkungen
* [frontend/ALARM_EMERGENCY_API.md](./frontend/ALARM_EMERGENCY_API.md) — Alarm-/Notfall-API, Berechtigungen und Workflow
* [ALARM_EMERGENCY_IMPLEMENTATION_REPORT.md](./ALARM_EMERGENCY_IMPLEMENTATION_REPORT.md) — umgesetzter Umfang, Validierung und Einschränkungen

---

## Lizenz

Für dieses Repository ist derzeit keine Lizenz hinterlegt.
