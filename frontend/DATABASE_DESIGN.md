# SECURITYOPS 2.0 – DATENBANKDESIGN & SCHEMA-SPEZIFIKATION (PHASE 1)

## 1. Überblick & Normalisierung
Das Datenbanksystem basiert auf **PostgreSQL 16**. Alle Tabellen befinden sich mindestens in der **3. Normalform (3NF)**.
Für mandantenfähige und offline-synchronisierbare Entitäten gilt verbindlich:
- **Eindeutige Primärschlüssel**: `UUID PRIMARY KEY DEFAULT gen_random_uuid()` (oder UUIDv7 für zeitlich geordnete Indizes)
- **Mandantenbindung**: Jede Fachdatentabelle enthält `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT`
- **Optimistic Concurrency Control**: `version INT NOT NULL DEFAULT 1`
- **Revisions-Zeitstempel**: `created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`, `updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`
- **Soft-Delete Flag**: `deleted_at TIMESTAMP WITH TIME ZONE NULL` (DSGVO- und Audit-konform)

---

## 2. Vollständiges ER-Diagramm (Entity Relationship)

```mermaid
erDiagram
    TENANTS ||--o{ USERS : "besitzt"
    TENANTS ||--o{ CLIENTS : "verwaltet"
    TENANTS ||--o{ SECURITY_SITES : "überwacht"
    TENANTS ||--o{ EMPLOYEES : "beschäftigt"
    TENANTS ||--o{ SHIFTS : "plant"
    TENANTS ||--o{ WACHBUCH_INCIDENTS : "protokolliert"
    TENANTS ||--o{ SOP_INSTRUCTIONS : "definiert"
    TENANTS ||--o{ KEY_ITEMS : "inventarisiert"
    TENANTS ||--o{ OPERATIONAL_TASKS : "steuert"
    TENANTS ||--o{ AUDIT_LOGS : "archiviert"

    CLIENTS ||--o{ SECURITY_SITES : "beauftragt"
    SECURITY_SITES ||--o{ CHECKPOINTS : "enthält"
    SECURITY_SITES ||--o{ SHIFTS : "erfordert"
    SECURITY_SITES ||--o{ WACHBUCH_INCIDENTS : "betrifft"
    SECURITY_SITES ||--o{ KEY_ITEMS : "zugeordnet"

    EMPLOYEES ||--o{ QUALIFICATIONS : "nachgewiesen"
    EMPLOYEES ||--o{ SHIFTS : "zugewiesen"
    EMPLOYEES ||--o{ WACHBUCH_INCIDENTS : "erfasst_von"
    EMPLOYEES ||--o{ SOP_ACKNOWLEDGMENTS : "quittiert"

    SOP_INSTRUCTIONS ||--o{ SOP_ACKNOWLEDGMENTS : "verbindlich_fuer"

    TENANTS {
        UUID id PK
        VARCHAR code UK
        VARCHAR name
        VARCHAR din77200_certificate_number
        VARCHAR rls_schema_name
        BOOLEAN is_active
    }

    CLIENTS {
        UUID id PK
        UUID tenant_id FK
        VARCHAR customer_number
        VARCHAR name
        VARCHAR sla_level
        INT version
    }

    SECURITY_SITES {
        UUID id PK
        UUID tenant_id FK
        UUID client_id FK
        VARCHAR site_code
        VARCHAR name
        VARCHAR risk_level
        INT active_guards_required
        INT version
    }

    CHECKPOINTS {
        UUID id PK
        UUID tenant_id FK
        UUID site_id FK
        VARCHAR code
        VARCHAR tag_type
        VARCHAR tag_uid
    }

    EMPLOYEES {
        UUID id PK
        UUID tenant_id FK
        VARCHAR personnel_number
        VARCHAR first_name
        VARCHAR last_name
        VARCHAR status
        INT target_hours
        INT version
    }

    QUALIFICATIONS {
        UUID id PK
        UUID tenant_id FK
        UUID employee_id FK
        VARCHAR name
        VARCHAR type
        DATE expiry_date
        BOOLEAN is_valid
    }

    SHIFTS {
        UUID id PK
        UUID tenant_id FK
        UUID site_id FK
        UUID employee_id FK
        DATE shift_date
        VARCHAR shift_type
        VARCHAR status
        BOOLEAN has_conflict
        INT version
    }

    WACHBUCH_INCIDENTS {
        UUID id PK
        UUID tenant_id FK
        VARCHAR incident_number UK
        TIMESTAMP incident_timestamp
        UUID site_id FK
        UUID guard_id FK
        VARCHAR priority
        VARCHAR category
        VARCHAR audit_hash
        VARCHAR prev_audit_hash
        BOOLEAN offline_created
        INT version
    }

    SOP_INSTRUCTIONS {
        UUID id PK
        UUID tenant_id FK
        VARCHAR code
        VARCHAR title
        VARCHAR version
        TEXT content
    }

    KEY_ITEMS {
        UUID id PK
        UUID tenant_id FK
        UUID site_id FK
        VARCHAR key_number
        VARCHAR status
        VARCHAR current_holder
    }

    OPERATIONAL_TASKS {
        UUID id PK
        UUID tenant_id FK
        VARCHAR title
        DATE due_date
        VARCHAR priority
        VARCHAR status
        INT version
    }

    AUDIT_LOGS {
        UUID id PK
        UUID tenant_id FK
        UUID user_id FK
        VARCHAR action
        VARCHAR table_name
        UUID record_id
        JSONB changes
        TIMESTAMP created_at
    }
```

---

## 3. Relationales Schema (Auszug Kern-DDL)

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. MANDANTENTABELLE
-- ============================================================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    company_registration_number VARCHAR(128) NOT NULL,
    address TEXT NOT NULL,
    primary_contact VARCHAR(128) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(64) NOT NULL,
    din77200_certificate_number VARCHAR(128) NOT NULL,
    license_level VARCHAR(64) NOT NULL DEFAULT 'Enterprise Tier 1',
    data_storage_region VARCHAR(64) NOT NULL DEFAULT 'eu-central-1',
    rls_schema_name VARCHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. REVISIONSSICHERES DIGITALES WACHBUCH (DIN 77200)
-- ============================================================================
CREATE TABLE wachbuch_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    incident_number VARCHAR(64) NOT NULL,
    incident_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    site_id UUID NOT NULL REFERENCES security_sites(id) ON DELETE RESTRICT,
    guard_id UUID NULL REFERENCES employees(id) ON DELETE SET NULL,
    guard_name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    priority VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    actions_taken TEXT NOT NULL,
    police_involved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    images_count INT NOT NULL DEFAULT 0,
    escalation_status VARCHAR(32) NOT NULL DEFAULT 'In Bearbeitung',
    offline_created BOOLEAN NOT NULL DEFAULT FALSE,
    audit_hash VARCHAR(128) NOT NULL, -- SHA-256 über Datensatz zur Revisionssicherheit
    prev_audit_hash VARCHAR(128) NULL, -- Blockchain-ähnliche Verkettung nach DIN 77200
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_incident_number UNIQUE (tenant_id, incident_number)
);

-- Performance & Isolation Indices
CREATE INDEX idx_clients_tenant ON clients(tenant_id);
CREATE INDEX idx_sites_tenant ON security_sites(tenant_id);
CREATE INDEX idx_employees_tenant ON employees(tenant_id);
CREATE INDEX idx_shifts_tenant_date ON shifts(tenant_id, shift_date);
CREATE INDEX idx_incidents_tenant_time ON wachbuch_incidents(tenant_id, incident_timestamp DESC);
CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);
```
