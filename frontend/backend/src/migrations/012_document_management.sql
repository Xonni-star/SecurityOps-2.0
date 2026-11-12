-- Tenant-scoped document management. Files are immutable blobs addressed by
-- generated storage keys; user-provided filenames are metadata only.

CREATE TABLE document_categories (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_document_category_name_tenant UNIQUE (tenant_id, name)
);

CREATE TABLE document_folders (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_id UUID,
    name VARCHAR(150) NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_document_folder_parent_tenant
        FOREIGN KEY (parent_id, tenant_id)
        REFERENCES document_folders(id, tenant_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_document_folder_name_parent
    ON document_folders (tenant_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE TABLE documents (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    category_id UUID NOT NULL,
    folder_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'Entwurf'
        CHECK (status IN ('Entwurf', 'In Prüfung', 'Freigegeben', 'Veröffentlicht', 'Abgelaufen', 'Archiviert')),
    description TEXT NOT NULL DEFAULT '',
    document_number VARCHAR(100),
    valid_from DATE,
    valid_until DATE,
    responsible_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
    archived_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_documents_category_tenant
        FOREIGN KEY (category_id, tenant_id)
        REFERENCES document_categories(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_documents_folder_tenant
        FOREIGN KEY (folder_id, tenant_id)
        REFERENCES document_folders(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_documents_validity CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX ix_documents_tenant_updated ON documents (tenant_id, updated_at DESC);
CREATE INDEX ix_documents_tenant_category ON documents (tenant_id, category_id);
CREATE INDEX ix_documents_tenant_folder ON documents (tenant_id, folder_id);
CREATE INDEX ix_documents_tenant_status ON documents (tenant_id, status, archived_at);

CREATE TABLE document_versions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    document_id UUID NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    original_filename VARCHAR(255) NOT NULL,
    storage_key UUID NOT NULL,
    content_type VARCHAR(127) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256_hash CHAR(64) NOT NULL CHECK (sha256_hash ~ '^[0-9a-f]{64}$'),
    scan_status VARCHAR(20) NOT NULL DEFAULT 'not_scanned'
        CHECK (scan_status IN ('clean', 'infected', 'not_scanned')),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    restored_from_version INTEGER,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_document_version_number UNIQUE (tenant_id, document_id, version_number),
    CONSTRAINT fk_document_versions_document_tenant
        FOREIGN KEY (document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_version_restore_source
        FOREIGN KEY (tenant_id, document_id, restored_from_version)
        REFERENCES document_versions(tenant_id, document_id, version_number) ON DELETE RESTRICT
);
CREATE INDEX ix_document_versions_history
    ON document_versions (tenant_id, document_id, version_number DESC);
CREATE INDEX ix_document_versions_storage_key ON document_versions (storage_key);

CREATE TABLE document_relationships (
    tenant_id UUID NOT NULL,
    document_id UUID NOT NULL,
    relationship_type VARCHAR(20) NOT NULL,
    customer_id UUID,
    site_id UUID,
    employee_id UUID,
    shift_id UUID,
    incident_id UUID,
    PRIMARY KEY (document_id, tenant_id),
    CONSTRAINT fk_document_relationship_document
        FOREIGN KEY (document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_relationship_customer
        FOREIGN KEY (customer_id, tenant_id)
        REFERENCES clients(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_relationship_site
        FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_relationship_employee
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_relationship_shift
        FOREIGN KEY (shift_id, tenant_id)
        REFERENCES shifts(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_relationship_incident
        FOREIGN KEY (incident_id, tenant_id)
        REFERENCES guardbook_entries(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_document_relationship_target CHECK (
        (relationship_type = 'customer' AND customer_id IS NOT NULL AND site_id IS NULL AND employee_id IS NULL AND shift_id IS NULL AND incident_id IS NULL) OR
        (relationship_type = 'site' AND customer_id IS NULL AND site_id IS NOT NULL AND employee_id IS NULL AND shift_id IS NULL AND incident_id IS NULL) OR
        (relationship_type = 'employee' AND customer_id IS NULL AND site_id IS NULL AND employee_id IS NOT NULL AND shift_id IS NULL AND incident_id IS NULL) OR
        (relationship_type = 'shift' AND customer_id IS NULL AND site_id IS NULL AND employee_id IS NULL AND shift_id IS NOT NULL AND incident_id IS NULL) OR
        (relationship_type = 'incident' AND customer_id IS NULL AND site_id IS NULL AND employee_id IS NULL AND shift_id IS NULL AND incident_id IS NOT NULL)
    )
);

CREATE TABLE document_tags (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_document_tag_name_tenant UNIQUE (tenant_id, name)
);

CREATE TABLE document_tag_assignments (
    tenant_id UUID NOT NULL,
    document_id UUID NOT NULL,
    tag_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, document_id, tag_id),
    CONSTRAINT fk_document_tag_assignment_document
        FOREIGN KEY (document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_tag_assignment_tag
        FOREIGN KEY (tag_id, tenant_id)
        REFERENCES document_tags(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE document_audit_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    document_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(40) NOT NULL CHECK (action IN (
        'created', 'uploaded', 'downloaded', 'updated', 'version_created',
        'version_restored', 'archived', 'restored', 'approved', 'published',
        'moved', 'relationship_changed'
    )),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_document_audit_document_tenant
        FOREIGN KEY (document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_document_audit_history ON document_audit_events (tenant_id, document_id, occurred_at DESC);

DO $$
DECLARE
    tbl text;
    rls_tables text[] := ARRAY[
        'document_categories', 'document_folders', 'documents',
        'document_versions', 'document_relationships', 'document_tags',
        'document_tag_assignments', 'document_audit_events'
    ];
BEGIN
    FOREACH tbl IN ARRAY rls_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('CREATE POLICY tenant_isolation_permissive ON %I
            AS PERMISSIVE FOR ALL TO PUBLIC
            USING (current_setting(''app.current_tenant'', true) IS NOT NULL
                AND current_setting(''app.current_tenant'', true) <> ''''
                AND tenant_id = current_setting(''app.current_tenant'', true)::uuid)
            WITH CHECK (current_setting(''app.current_tenant'', true) IS NOT NULL
                AND current_setting(''app.current_tenant'', true) <> ''''
                AND tenant_id = current_setting(''app.current_tenant'', true)::uuid);', tbl);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_document_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'DMS-Audit-Ereignisse sind unveränderlich und unlöschbar.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_audit_events_immutable
BEFORE UPDATE OR DELETE ON document_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_document_audit_tampering();

REVOKE ALL ON document_categories, document_folders, documents, document_versions,
    document_relationships, document_tags, document_tag_assignments, document_audit_events
    FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON document_categories, document_folders, documents,
    document_relationships, document_tags, document_tag_assignments TO secops_app_user;
GRANT SELECT, INSERT ON document_versions, document_audit_events TO secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('documents:read', 'documents', 'Dokumente und Metadaten lesen'),
    ('documents:create', 'documents', 'Dokumente und Ordner erstellen'),
    ('documents:update', 'documents', 'Dokumentmetadaten und Zuordnungen bearbeiten'),
    ('documents:download', 'documents', 'Dokumentdateien herunterladen oder anzeigen'),
    ('documents:archive', 'documents', 'Dokumente und Ordner archivieren'),
    ('documents:restore', 'documents', 'Archivierte Dokumente wiederherstellen'),
    ('documents:manage', 'documents', 'DMS-Kategorien, Schlagwörter und Berechtigungen verwalten'),
    ('documents:approve', 'documents', 'Dokumente freigeben und veröffentlichen')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON
    (r.name IN ('Systemadministrator', 'Geschäftsführung') AND p.code LIKE 'documents:%')
    OR (r.name IN ('Einsatzleitung', 'Qualitätsmanagement') AND p.code IN (
        'documents:read', 'documents:create', 'documents:update', 'documents:download',
        'documents:archive', 'documents:restore', 'documents:manage', 'documents:approve'
    ))
    OR (r.name = 'Personalverwaltung' AND p.code IN (
        'documents:read', 'documents:create', 'documents:update', 'documents:download',
        'documents:archive', 'documents:restore'
    ))
    OR (r.name IN ('Objektleitung', 'Wachdienstmitarbeiter', 'Auditor') AND p.code IN (
        'documents:read', 'documents:download'
    ))
ON CONFLICT DO NOTHING;
