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
