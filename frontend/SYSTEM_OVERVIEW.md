# SecurityOps 2.0 - System-Gesamtübersicht (Release 1.0 Gold Master)

## 1. Systemidentifikation & Normativer Rahmen
- **System**: SecurityOps 2.0 Enterprise Sicherheitsdienstverwaltung
- **Version**: 1.0.0 (Gold Master)
- **Architektur**: Modularer Monolith (FastAPI / SQLAlchemy 2.0 Asyncpg) mit PostgreSQL 16+ Row Level Security (RLS) und React 18+ PWA Frontend
- **Normative Standards**:
  - **DIN 77200-1:2020-10** (Sicherheitsdienstleistungen – Anforderungen an Organisation, Führung und operatives Personal)
  - **§ 34a GewO & BewachV** (Gewerbeordnung, Bewacherregister-Nachweisführung)
  - **DGUV Vorschrift 23 / BGV C7** (Unfallverhütungsvorschrift Wach- und Sicherungsdienst)
  - **Arbeitszeitgesetz (ArbZG)** (Höchstarbeitszeiten, Ruhepausen und 11h-Ruhezeiten)
  - **DSGVO / BDSG** (Datenschutz-Grundverordnung, Zweckbindung, Aufbewahrungs- und Löschfristen)
  - **BSI IT-Grundschutz & TR-02102** (Kryptografische Verfahren, TLS 1.3, Argon2id)

---

## 2. Vollständige Komponenten- und Modulmatrix

| Fachbereich / Modul | Frontend-Komponente | REST-API Router | Datenbank-Tabellen | RLS-Schutz | Offline-Ready | Status |
|---|---|---|---|---|---|---|
| **Einsatz-Dashboard** | `components/Dashboard.tsx` | `/api/v1/health`, `/reporting/kpis` | Aggregierte Views | Ja | Ja (Cache) | **100% Bereit** |
| **Kunden & Verträge** | `components/ClientsModule.tsx` | `/api/v1/customers` | `customers` | Ja | Ja (Read-Cache) | **100% Bereit** |
| **Objektverwaltung** | `components/SitesModule.tsx` | `/api/v1/objects` | `objects`, `object_control_points` | Ja | Ja (Inbox) | **100% Bereit** |
| **Personal & § 34a GewO** | `components/EmployeesModule.tsx` | `/api/v1/employees` | `employees`, `employee_qualifications` | Ja | Ja | **100% Bereit** |
| **Dienstplanung (Soll/Ist)**| `components/RosterModule.tsx` | `/api/v1/shifts` | `shifts` | Ja | Ja (Queue) | **100% Bereit** |
| **Digitales Wachbuch** | `components/GuardBookModule.tsx` | `/api/v1/logbook` | `logbook_entries`, `logbook_revisions` | Ja | Ja (Append-Only) | **100% Bereit** |
| **Schlüssel & Zutritt** | `components/KeysModule.tsx` | `/api/v1/keys` | `keys` | Ja | Ja | **100% Bereit** |
| **QM & Dienstanweisungen** | `components/SOPModule.tsx` | `/api/v1/sops` | `instructions`, `instruction_acknowledgements` | Ja | Ja | **100% Bereit** |
| **Alarmmanagement** | `components/AlarmsModule.tsx` | `/api/v1/alarms` | `alarm_plans` | Ja | Ja | **100% Bereit** |
| **Aufgaben & Maßnahmen** | `components/TasksModule.tsx` | `/api/v1/tasks` | `tasks` | Ja | Ja (Conflict Diff) | **100% Bereit** |
| **Dokumentenmanagement (DMS)**| `components/DocumentsModule.tsx` | `/api/v1/documents` | `managed_documents` | Ja | Nein (15MB Limit) | **100% Bereit** |
| **Automatisierung & Watchdog**| `components/AutomationCenter.tsx` | `/api/v1/automations` | `automation_rules`, `automation_executions` | Ja | Ja | **100% Bereit** |
| **Mobile Mitarbeiter-App** | `components/MobileAppShell.tsx` | `/api/v1/mobile/*` | `patrol_scans`, `shift_handovers` | Ja | Ja (Kamera/QR) | **100% Bereit** |
| **Controlling & Berichte** | `components/ReportsModule.tsx` | `/api/v1/reporting/*` | `report_definitions` | Ja | Ja (CSV/PDF) | **100% Bereit** |
| **Sicherheits-Audit & DSGVO** | `components/SecurityAuditCenter.tsx`| `/api/v1/audit/logs` | `audit_logs`, `sync_devices` | Ja | Ja | **100% Bereit** |
| **E2E-Abnahme & Release** | `components/E2EAcceptanceCenter.tsx`| Alle Endpunkte | Gesamter Datenbestand | Ja | Ja | **100% Bereit** |

---

## 3. Technologischer Kernstack
- **Frontend**: React 18+ (Strict Mode), TypeScript, Tailwind CSS, Lucide React Icons, Recharts Data Viz, Zustand State Management, Native IndexedDB Storage (`SecurityOps2_OfflineVault`), PWA Service Worker (`public/sw.js`).
- **Backend**: Python 3.11, FastAPI REST Engine, SQLAlchemy 2.0 Asyncpg ORM, Pydantic v2 Validierung, Alembic Migrationen, Argon2id & JWT Authentication.
- **Datenbank & Broker**: PostgreSQL 16+ (Row Level Security & B-Tree Indizes), Redis 7+ Cache & Worker Broker.
- **Infrastruktur**: Caddy 2.7 Reverse Proxy (Automated TLS 1.3, HSTS, CSP), Unprivileged Docker Container (Non-Root UID 10001), AES-256 Encrypted Backup Cron.
