# SecurityOps 2.0 - Phase 13: System-Gesamtübersicht (Release 1.0)

## 1. Systemstatus und Versionsstand
- **Release-Version**: 1.0.0 (Gold Master)
- **Normative Grundlage**: DIN 77200-1:2020-10, BGV C7 (DGUV V23), § 34a GewO / BewachV, ArbZG, DSGVO / BDSG.
- **Architekturmuster**: Modularer Monolith mit entkoppelten Fachmodul-Controllern, strikter PostgreSQL 16+ Row Level Security (RLS) und nativer IndexedDB Offline-First Outbox/Inbox Replikation.

---

## 2. Modulübersicht & Integrationsmatrix
| Fachbereich | Frontend-Komponente | REST-API Endpunkte | DB-Tabellen | RLS-Schutz | Offline-Ready |
|---|---|---|---|---|---|
| **Einsatz-Dashboard** | `Dashboard.tsx` | `/api/v1/health`, `/reporting/kpis` | Aggregiert | Ja | Ja |
| **Kunden & Verträge** | `ClientsModule.tsx` | `/api/v1/customers` | `customers` | Ja | Nein (Read-Only) |
| **Objektverwaltung** | `SitesModule.tsx` | `/api/v1/objects` | `objects`, `control_points` | Ja | Ja (Inbox Cache) |
| **Personal & § 34a** | `EmployeesModule.tsx` | `/api/v1/employees` | `employees`, `qualifications` | Ja | Ja |
| **Dienstplanung** | `RosterModule.tsx` | `/api/v1/shifts` | `shifts` | Ja | Ja |
| **Digitales Wachbuch** | `GuardBookModule.tsx` | `/api/v1/logbook` | `logbook_entries`, `revisions` | Ja | Ja (Append-Only) |
| **Schlüssel & Zutritt** | `KeysModule.tsx` | `/api/v1/keys` | `keys` | Ja | Ja |
| **QM & Anweisungen** | `SOPModule.tsx` | `/api/v1/sops` | `sop_instructions`, `sop_versions`, `sop_events`, `sop_assignments` | Ja | Teilweise (lokale Vormerkung) |
| **Alarm- und Notfallmanagement** | `AlarmsModule.tsx` | `/api/v1/alarms`, `/api/v1/emergency-plans`, `/api/v1/alarm-escalation-rules` | `alarm_incidents`, `alarm_event_actions`, `alarm_event_status_history`, `emergency_plans`, `emergency_plan_versions`, `emergency_contacts`, Eskalationstabellen | Ja, plus Site-Scope in der API | Ja: lokale Mutations-Outbox und bereinigter Plan-Cache |
| **Übergabemanagement** | `HandoversModule.tsx` (`MobileShiftHandover.tsx` nutzt dieselbe Oberfläche) | `/api/v1/handovers`, `/api/v1/handovers/sync` | `handovers`, `handover_participants`, `handover_events`, `handover_confirmations`, `handover_tasks`, `handover_task_events`, `handover_documents` | Ja (FORCE RLS) | Ja (Erfassung/initiale Aufgaben; Status sichtbar bis Quittung) |
| **Aufgaben & Maßnahmen**| `TasksModule.tsx` | `/api/v1/tasks` | `tasks` | Ja | Ja (Conflict Diff) |
| **Dokumente (DMS)** | `DocumentsModule.tsx` | Nicht vorhanden | Nicht vorhanden | Nein | Nein (nur lokale Metadaten; kein echter Datei-Upload/-Download) |
| **Automationen & Watchdog**| `AutomationCenter.tsx` | `/api/v1/automations` | `automation_rules`, `logs` | Ja | Ja |
| **Mobile Guard App** | `MobileAppShell.tsx` | `/api/v1/mobile/*` | `patrol_scans`, `handovers` | Ja | Ja |
| **E2E-Abnahme & Release**| `E2EAcceptanceCenter.tsx`| `/api/v1/reporting/kpis`| Alle Tabellen | Ja | Ja |
| **Sicherheits-Audit** | `SecurityAuditCenter.tsx`| `/api/v1/audit/logs` | `audit_logs`, `sessions` | Ja | Ja |
