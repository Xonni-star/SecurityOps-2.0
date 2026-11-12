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
