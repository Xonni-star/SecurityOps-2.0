# SecurityOps 2.0 - PostgreSQL 16+ Database Architecture & Schema Specification

## 1. System Overview
SecurityOps 2.0 uses PostgreSQL 16+ with SQLAlchemy 2.0 (Asyncpg) and Alembic. The database is built around three foundational architectural principles:
1. **Multi-Tenancy (Row Level Security & Composite FKs)**: Eliminates cross-tenant data contamination physically at the database level.
2. **Offline-First Resilience**: Full support for client UUID idempotency keys, revision counters, and conflict resolution.
3. **DIN 77200 & § 34a GewO Compliance**: Revisionssichere Auditprotokolle (`audit_logs`) und lückenlose Bewacherregister-Nachweisführung.

---

## 2. Multi-Tenant Composite Foreign Key Pattern
Unlike standard single-column foreign keys that only enforce `id`, SecurityOps 2.0 enforces composite foreign keys `(parent_id, tenant_id)` referencing `(id, tenant_id)` in the parent table.

```sql
-- Example: SecurityObject foreign key to Customer
CONSTRAINT fk_objects_customer_tenant FOREIGN KEY (customer_id, tenant_id)
    REFERENCES customers(id, tenant_id) ON DELETE RESTRICT;
```
**Advantage**: Even if an application bug attempts to insert an object with `customer_id` from Tenant B into Tenant A, PostgreSQL physically aborts the transaction with an `IntegrityError`.

---

## 3. PostgreSQL Row Level Security (RLS)
Every tenant-scoped table has RLS enabled:
```sql
ALTER TABLE logbook_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON logbook_entries
    AS RESTRICTIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
```

## 4. Dokumentenmanagement (Migration 012)

`document_categories`, `document_folders`, `documents`, `document_versions`, `document_relationships`, `document_tags`, `document_tag_assignments` und `document_audit_events` sind mandantengebundene Tabellen mit `ENABLE` und `FORCE ROW LEVEL SECURITY` anhand `app.current_tenant`. Anwendungszugriffe laufen ausschließlich über `withTenantTransaction`.

Kategorien, Ordner und Dokumente haben zusammengesetzte Schlüssel/Fremdschlüssel mit `tenant_id`. Beziehungen zu `clients`, `sites`, `employees`, `shifts` und `guardbook_entries` nutzen ebenfalls zusammengesetzte Tenant-FKs. Die Datenbank verhindert so fremdmandantige Zuordnungen unabhängig von Frontend-IDs. Dokumentversionen sind immutable; für eine Wiederherstellung wird eine neue Versionsnummer erstellt, die auf denselben unveränderlichen Blob-Schlüssel verweisen darf.

`document_audit_events` enthält Actor, Dokument, Mandant, Aktion, JSON-Details und Zeitstempel. `secops_app_user` darf Auditdaten nur lesen und einfügen. Zusätzlich weist ein Trigger `UPDATE` und `DELETE` zurück. Dokumente werden archiviert, nicht physisch gelöscht.

Datei-Blobs werden getrennt von PostgreSQL unter einem zufälligen UUID-Schlüssel im privaten `DMS_STORAGE_PATH` abgelegt. Das Originaldateiname ist nur Metadatum. Das persistente Docker-Volume heißt `secops_documents`; Datei-Backups müssen zusammen mit dem Datenbankdump wiederhergestellt werden.

## Alarm- und Notfallmanagement (Migration 016)

`alarm_types`, `emergency_contacts`, `emergency_plan_versions`, `alarm_event_assignments`, `alarm_event_actions`, `alarm_event_status_history`, `alarm_escalation_rules`, `alarm_escalation_steps`, `alarm_escalation_jobs`, `alarm_notifications` und `alarm_mutation_receipts` sind tenantgebunden und erzwingen `ENABLE` plus `FORCE ROW LEVEL SECURITY`. Vorhandene `emergency_plans` und `alarm_incidents` erhalten Kunden-, Alarmtyp-, Versions- und Site-Fremdschlüssel. Zusammengesetzte FKs verhindern Zuordnungen über Mandanten- oder Kunde/Site-Grenzen hinweg.

Planversionen, Aktionen und Statushistorie besitzen Datenbanktrigger gegen UPDATE/DELETE und nur INSERT-/SELECT-Rechte für die Anwendungsrolle. Die aktuelle Planfassung kann geändert werden; veröffentlichte Versionen bleiben als unveränderlicher Snapshot erhalten. Eskalationsjobs und Zustellversuche sind veränderliche Prozesszustände; sie sind nicht Teil der append-only Vorfallshistorie. Mutation-Quittungen enthalten einen Payload-Hash zur Idempotenzprüfung. Die Site-Autorisierung wird zusätzlich in der API erzwungen; RLS selbst begrenzt auf den Tenant.

## Übergabemanagement (Migrationen 017–019)

Migration `017_handover_management.sql` folgt auf die Alarmmigrationen 015/016. Die Tabellen `handovers`, `handover_participants`, `handover_events`, `handover_confirmations`, `handover_tasks`, `handover_task_events` und `handover_documents` erzwingen alle `ENABLE` und `FORCE ROW LEVEL SECURITY` mit `app.current_tenant`. Fremdschlüssel binden Objekt, Dienst, Mitarbeiter, Ursprungübergabe und DMS-Dokument jeweils zusammen mit `tenant_id`.

Übergaben enthalten Objekt/Bereich, Datum, Dienst, strukturierte Textfelder, Status, Revision, Client-Mutations-ID, Payload-Hash sowie client- und serverseitige Empfangszeitpunkte. Eine eindeutige `(tenant_id, client_mutation_id)`-Constraint und Hashprüfung verhindern Doppelanlage sowie Wiederverwendung einer Client-ID für abweichende Inhalte. Bestätigungen sind an Übergabe, Mitarbeiter, authentifiziertes Benutzerkonto, Aktion, Revision, Mutations-ID und Payload-Hash gebunden. Ereignis-, Bestätigungs-, Teilnehmer-, Dokument- und Aufgabenhistorientabellen sind durch Trigger und Least-Privilege-Rechte unveränderlich.

Aufgaben bleiben mit dem Ursprungsprotokoll verknüpft; ein Index unterstützt die Abfrage offener Aufgaben je Objekt und Fälligkeit. Sie werden bei Folgeübergaben mit `carried_forward=true` dargestellt, ohne den ursprünglichen Bezug umzuschreiben. Die vollständige Tabellen- und Statusbeschreibung steht in [HANDOVERS_API.md](./HANDOVERS_API.md).

Migration 018 ergänzt `employees.account_user_id` als nullable, tenant-validierten Fremdschlüssel auf `users`. Migration 019 ergänzt das dedizierte Recht `employees:account:link`; nur `Personalverwaltung` erhält es. Bestehende Datensätze werden absichtlich nicht anhand ihrer möglicherweise veralteten oder doppelten E-Mail-Adresse automatisch verknüpft. Konten müssen über die Mitarbeiter-API explizit und innerhalb desselben Mandanten zugeordnet werden. Bestätiger können das eigene Konto nicht neu einem Mitarbeiter zuordnen, und Bestätigungswiederholungen benötigen die aktuelle erwartete Revision.

## Kontrollgangsmanagement (Migration 020)

Migration `020_patrol_management.sql` ergänzt `patrol_checkpoints`, `patrol_routes`, unveränderliche `patrol_route_versions` und ihre Kontrollpunktreihenfolge, `patrol_rounds`, `patrol_exceptions` sowie append-only `patrol_events`. Jede neu angelegte mandantenbezogene Tabelle erzwingt `ENABLE` und `FORCE ROW LEVEL SECURITY` anhand `app.current_tenant`; zusammengesetzte Fremdschlüssel binden Kontrollpunkte, Routen, Rundgänge, Scans und Abweichungen an dasselbe Mandant-/Objektpaar. Die bestehende Tabelle `patrol_scans` erhält Kontrollpunkt-, Rundgangs-, Tokenversions- und Erfassungsmetadaten.

Kontrollpunkt-Tokens werden kryptografisch zufällig erzeugt und nur als SHA-256-Hash gespeichert; die API gibt den Klartext ausschließlich beim Anlegen oder Rotieren einmalig zurück. Der Datenbanktrigger sowie SELECT-/INSERT-Rechte schützen Scans, Routenversionen, Routenkontrollpunkte, Abweichungen und Ereignisse vor UPDATE/DELETE durch die Anwendungsrolle. Der Server leitet den Mitarbeiter aus dem authentifizierten Konto und einer aktiven Objektzuordnung ab; der Client kann diese Identität nicht vorgeben. Die detaillierte Tabellen-/API-Beschreibung steht in [PATROL_MANAGEMENT.md](./PATROL_MANAGEMENT.md).
