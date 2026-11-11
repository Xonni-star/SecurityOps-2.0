-- ==============================================================================
-- SECURITYOPS 2.0: POSTGRESQL 16+ ENTERPRISE SCHEMA (SCHRITT 3 FINALE HÄRTUNG)
-- Least-Privilege Rollentrennung, Append-Only Trigger, Composite FKs & RLS
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Erstelle unprivilegierten Anwendungsbenutzer ohne Superuser- oder Bypass-Rechte
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'secops_app_user') THEN
        CREATE ROLE secops_app_user WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
    END IF;
END $$;

-- 1. MANDANTEN & SYSTEM
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    subdomain VARCHAR(100) UNIQUE NOT NULL,
    tax_number VARCHAR(50) NOT NULL,
    license_tier VARCHAR(50) NOT NULL DEFAULT 'ENTERPRISE',
    bwr_register_id VARCHAR(50) NOT NULL,
    din77200_certified BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_superadmin BOOLEAN NOT NULL DEFAULT false,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(100) UNIQUE NOT NULL,
    module VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    device_name VARCHAR(150),
    ip_address VARCHAR(45),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. KUNDEN UND OBJEKTE (MIT COMPOSITE FOREIGN KEYS)
CREATE TABLE IF NOT EXISTS clients (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_number VARCHAR(50) NOT NULL,
    company_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    contract_start DATE NOT NULL,
    contract_end DATE NOT NULL,
    contract_auto_renew BOOLEAN NOT NULL DEFAULT true,
    notice_period_months INT NOT NULL DEFAULT 3,
    sla_level VARCHAR(50) NOT NULL DEFAULT 'Gold (24/7 Vor-Ort)',
    billing_status VARCHAR(50) NOT NULL DEFAULT 'Regulär',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_client_number_tenant UNIQUE (tenant_id, client_number)
);

CREATE TABLE IF NOT EXISTS sites (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_id UUID NOT NULL,
    site_code VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    address TEXT NOT NULL,
    security_level VARCHAR(50) NOT NULL DEFAULT 'Hoch (KRITIS / BSI)',
    required_guards_day INT NOT NULL DEFAULT 2,
    required_guards_night INT NOT NULL DEFAULT 2,
    alarm_system VARCHAR(150),
    access_rules TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_site_code_tenant UNIQUE (tenant_id, site_code),
    CONSTRAINT fk_sites_client_tenant FOREIGN KEY (client_id, tenant_id)
        REFERENCES clients(id, tenant_id) ON DELETE RESTRICT
);

-- 3. PERSONAL UND § 34a GewO
CREATE TABLE IF NOT EXISTS employees (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    personnel_number VARCHAR(50) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'Wachdienstmitarbeiter',
    status VARCHAR(30) NOT NULL DEFAULT 'Aktiv',
    weekly_hours NUMERIC(4,1) NOT NULL DEFAULT 40.0,
    hourly_rate NUMERIC(6,2) NOT NULL DEFAULT 18.50,
    date_of_joining DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_employee_number_tenant UNIQUE (tenant_id, personnel_number)
);

CREATE TABLE IF NOT EXISTS employee_qualifications (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    qualification_type VARCHAR(100) NOT NULL,
    certificate_number VARCHAR(100) NOT NULL,
    issue_date DATE NOT NULL,
    expiry_date DATE,
    verified BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_qualifications_employee_tenant FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE CASCADE
);

-- 4. DIENSTPLANUNG (COMPOSITE FOREIGN KEYS GEGEN CROSS-TENANT-ZUWEISUNG)
CREATE TABLE IF NOT EXISTS shifts (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    employee_id UUID,
    shift_date DATE NOT NULL,
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'Tagdienst',
    status VARCHAR(30) NOT NULL DEFAULT 'Besetzt',
    required_qualification VARCHAR(100) NOT NULL,
    conflict_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_shifts_site_tenant FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_shifts_employee_tenant FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT
);

-- 5. DIGITALES WACHBUCH & VORFÄLLE (APPEND-ONLY MIT IDEMPOTENZ-CONSTRAINT)
CREATE TABLE IF NOT EXISTS guardbook_entries (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    guard_id UUID NOT NULL,
    entry_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    category VARCHAR(50) NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
    stage VARCHAR(30) NOT NULL DEFAULT 'Erfasst',
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    police_involved BOOLEAN NOT NULL DEFAULT false,
    resolved BOOLEAN NOT NULL DEFAULT false,
    resolution_note TEXT,
    client_mutation_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_guardbook_client_mutation UNIQUE (tenant_id, client_mutation_id),
    CONSTRAINT fk_guardbook_site_tenant FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_guardbook_guard_tenant FOREIGN KEY (guard_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT
);

-- Revisionshistorie für nachträgliche Ergänzungen (Append-Only)
CREATE TABLE IF NOT EXISTS guardbook_revisions (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL,
    author_name VARCHAR(100) NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_revisions_guardbook_tenant FOREIGN KEY (entry_id, tenant_id)
        REFERENCES guardbook_entries(id, tenant_id) ON DELETE CASCADE
);

-- 6. SCHLÜSSELVERWALTUNG (COMPOSITE FOREIGN KEYS)
CREATE TABLE IF NOT EXISTS keys (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    key_number VARCHAR(50) NOT NULL,
    label VARCHAR(150) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'Master-Schlüssel',
    status VARCHAR(30) NOT NULL DEFAULT 'Im Tresor',
    current_holder_id UUID,
    issued_at TIMESTAMP WITH TIME ZONE,
    expected_return TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_key_number_tenant UNIQUE (tenant_id, key_number),
    CONSTRAINT fk_keys_site_tenant FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_keys_holder_tenant FOREIGN KEY (current_holder_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT
);

-- 7. AUFGABEN
CREATE TABLE IF NOT EXISTS tasks (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    assigned_to_name VARCHAR(100) NOT NULL,
    site_name VARCHAR(200),
    due_date DATE NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'Mittel',
    status VARCHAR(30) NOT NULL DEFAULT 'Offen',
    category VARCHAR(50) NOT NULL DEFAULT 'Audit',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id)
);

-- 8. AUDIT PROTOKOLLE
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
    target_entity VARCHAR(150) NOT NULL,
    details TEXT NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id)
);

-- ==============================================================================
-- POSTGRESQL ROW-LEVEL SECURITY (RLS) AKTIVIERUNG & POLICY DEFINITIONEN
-- ==============================================================================

DO $$
DECLARE
    tbl text;
    rls_tables text[] := ARRAY[
        'clients',
        'sites',
        'employees',
        'employee_qualifications',
        'shifts',
        'guardbook_entries',
        'guardbook_revisions',
        'keys',
        'tasks',
        'audit_logs'
    ];
BEGIN
    FOREACH tbl IN ARRAY rls_tables LOOP
        -- RLS aktivieren und zwingend auch für Tabellenbesitzer erzwingen
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
        
        -- Alte Policies entfernen
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_permissive ON %I;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I;', tbl);
        
        -- Strikte Mandanten-Isolierung:
        -- Gibt ausschließlich Datensätze frei, wenn app.current_tenant exakt gesetzt ist
        -- und mit der tenant_id des Datensatzes übereinstimmt.
        -- Ohne gesetzten Mandantenkontext (NULL oder leer) liefert USING false und WITH CHECK false!
        EXECUTE format('
            CREATE POLICY tenant_isolation_permissive ON %I
                AS PERMISSIVE
                FOR ALL
                TO PUBLIC
                USING (
                    current_setting(''app.current_tenant'', true) IS NOT NULL 
                    AND current_setting(''app.current_tenant'', true) != ''''
                    AND tenant_id = current_setting(''app.current_tenant'', true)::uuid
                )
                WITH CHECK (
                    current_setting(''app.current_tenant'', true) IS NOT NULL 
                    AND current_setting(''app.current_tenant'', true) != ''''
                    AND tenant_id = current_setting(''app.current_tenant'', true)::uuid
                );
        ', tbl);
    END LOOP;
END $$;

-- ==============================================================================
-- ECHTER APPEND-ONLY SCHUTZ FÜR WACHBUCH & REVISIONEN AUF DATENBANKEBENE
-- Verhindert nachträgliche Manipulation von Kernfeldern und Löschungen physisch
-- ==============================================================================

CREATE OR REPLACE FUNCTION prevent_guardbook_tampering()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Löschen von Einträgen in guardbook_entries ist nach DIN 77200 unzulässig (Append-Only Integrität).';
    ELSIF TG_OP = 'UPDATE' THEN
        -- Nur kontrollierte Aktualisierungen von stage, resolved und resolution_note zulässig.
        -- Kernfelder wie entry_timestamp, category, title, description, guard_id, site_id, tenant_id, client_mutation_id dürfen NIEMALS geändert werden!
        IF OLD.entry_timestamp != NEW.entry_timestamp OR
           OLD.category != NEW.category OR
           OLD.title != NEW.title OR
           OLD.description != NEW.description OR
           OLD.guard_id != NEW.guard_id OR
           OLD.site_id != NEW.site_id OR
           OLD.tenant_id != NEW.tenant_id OR
           OLD.client_mutation_id IS DISTINCT FROM NEW.client_mutation_id THEN
            RAISE EXCEPTION 'Nachträgliche Manipulation von Kernfeldern im Wachbuch ist verboten. Nutzen Sie guardbook_revisions.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_revision_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Revisionen in guardbook_revisions sind unumstößlich und können weder geändert noch gelöscht werden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guardbook_entries_immutable ON guardbook_entries;
CREATE TRIGGER trg_guardbook_entries_immutable
BEFORE UPDATE OR DELETE ON guardbook_entries
FOR EACH ROW EXECUTE FUNCTION prevent_guardbook_tampering();

DROP TRIGGER IF EXISTS trg_guardbook_revisions_immutable ON guardbook_revisions;
CREATE TRIGGER trg_guardbook_revisions_immutable
BEFORE UPDATE OR DELETE ON guardbook_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_revision_tampering();

-- ==============================================================================
-- LEAST-PRIVILEGE RECHTE FÜR DEN UNPRIVILEGIERTEN ANWENDUNGSBENUTZER
-- Keine Vergabe von ALL PRIVILEGES! Nur minimal notwendige Rechte.
-- ==============================================================================

REVOKE ALL ON SCHEMA public FROM secops_app_user;
GRANT USAGE ON SCHEMA public TO secops_app_user;

-- Lese- und Schreibrechte für operative Tabellen
GRANT SELECT, INSERT, UPDATE ON clients, sites, employees, employee_qualifications, shifts, guardbook_entries, tasks, audit_logs, users, user_sessions, user_roles, roles, permissions, role_permissions, tenants TO secops_app_user;

-- Revisionshistorie: Streng auf SELECT und INSERT limitiert (KEIN UPDATE, KEIN DELETE)
GRANT SELECT, INSERT ON guardbook_revisions TO secops_app_user;

-- Sequenzen für ID-Generierung
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO secops_app_user;

-- Physischer Ausschluss von DELETE-Rechten auf Wachbuch und Revisionen
REVOKE DELETE ON guardbook_entries, guardbook_revisions FROM secops_app_user;
