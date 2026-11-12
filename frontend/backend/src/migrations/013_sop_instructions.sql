CREATE UNIQUE INDEX uq_sop_site_customer_reference ON sites (id, client_id, tenant_id);

CREATE TABLE sop_instructions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sop_number VARCHAR(100) NOT NULL DEFAULT ('SOP-' || substr(uuid_generate_v4()::text, 1, 8)),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category VARCHAR(100) NOT NULL DEFAULT 'Allgemeine Dienstanweisung',
    site_id UUID,
    customer_id UUID,
    mandatory_acknowledgment BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE,
    effective_until DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'in_review', 'reviewed', 'approved', 'published', 'withdrawn', 'archived')),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    submitted_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    submitted_at TIMESTAMPTZ,
    reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    reviewed_at TIMESTAMPTZ,
    approved_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    published_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    published_at TIMESTAMPTZ,
    withdrawn_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    withdrawn_at TIMESTAMPTZ,
    archived_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    archived_at TIMESTAMPTZ,
    draft_content JSONB NOT NULL,
    draft_dms_document_id UUID,
    draft_change_reason TEXT,
    draft_version_id UUID,
    current_version_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_sop_number_tenant UNIQUE (tenant_id, sop_number),
    CONSTRAINT ck_sop_effective_dates CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from),
    CONSTRAINT fk_sop_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_site_customer FOREIGN KEY (site_id, customer_id, tenant_id)
        REFERENCES sites(id, client_id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_customer FOREIGN KEY (customer_id, tenant_id)
        REFERENCES clients(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_draft_document FOREIGN KEY (draft_dms_document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE sop_versions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    sop_id UUID NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    sop_number VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category VARCHAR(100) NOT NULL,
    site_id UUID,
    customer_id UUID,
    mandatory_acknowledgment BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE,
    effective_until DATE,
    content JSONB NOT NULL,
    dms_document_id UUID,
    change_reason TEXT,
    author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    submitted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_sop_version_instruction_reference UNIQUE (id, tenant_id, sop_id),
    CONSTRAINT uq_sop_version_number UNIQUE (tenant_id, sop_id, version_number),
    CONSTRAINT ck_sop_version_effective_dates CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from),
    CONSTRAINT fk_sop_version_instruction FOREIGN KEY (sop_id, tenant_id)
        REFERENCES sop_instructions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_version_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_version_site_customer FOREIGN KEY (site_id, customer_id, tenant_id)
        REFERENCES sites(id, client_id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_version_customer FOREIGN KEY (customer_id, tenant_id)
        REFERENCES clients(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_version_document FOREIGN KEY (dms_document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT
);

ALTER TABLE sop_instructions
    ADD CONSTRAINT fk_sop_draft_version FOREIGN KEY (draft_version_id, tenant_id, id)
        REFERENCES sop_versions(id, tenant_id, sop_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_sop_current_version FOREIGN KEY (current_version_id, tenant_id, id)
        REFERENCES sop_versions(id, tenant_id, sop_id) ON DELETE RESTRICT;

CREATE INDEX ix_sop_instructions_tenant_state ON sop_instructions (tenant_id, status, updated_at DESC);
CREATE INDEX ix_sop_versions_history ON sop_versions (tenant_id, sop_id, version_number DESC);

CREATE TABLE sop_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    sop_id UUID NOT NULL,
    version_id UUID,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(40) NOT NULL CHECK (action IN (
        'created', 'updated', 'version_draft_created', 'submitted', 'changes_requested',
        'reviewed', 'approved', 'published', 'withdrawn', 'archived', 'assigned', 'acknowledged'
    )),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_sop_event_instruction FOREIGN KEY (sop_id, tenant_id)
        REFERENCES sop_instructions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_event_version FOREIGN KEY (version_id, tenant_id)
        REFERENCES sop_versions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_event_same_instruction_version FOREIGN KEY (version_id, tenant_id, sop_id)
        REFERENCES sop_versions(id, tenant_id, sop_id) ON DELETE RESTRICT
);
CREATE INDEX ix_sop_events_history ON sop_events (tenant_id, sop_id, occurred_at DESC);

CREATE TABLE sop_assignment_targets (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    sop_id UUID NOT NULL,
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('employee', 'site', 'customer', 'tenant')),
    employee_id UUID,
    site_id UUID,
    customer_id UUID,
    due_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_sop_target_instruction FOREIGN KEY (sop_id, tenant_id)
        REFERENCES sop_instructions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_target_employee FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_target_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_target_customer FOREIGN KEY (customer_id, tenant_id)
        REFERENCES clients(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_sop_target_identifier CHECK (
        (target_type = 'employee' AND employee_id IS NOT NULL AND site_id IS NULL AND customer_id IS NULL) OR
        (target_type = 'site' AND employee_id IS NULL AND site_id IS NOT NULL AND customer_id IS NULL) OR
        (target_type = 'customer' AND employee_id IS NULL AND site_id IS NULL AND customer_id IS NOT NULL) OR
        (target_type = 'tenant' AND employee_id IS NULL AND site_id IS NULL AND customer_id IS NULL)
    )
);
CREATE UNIQUE INDEX uq_sop_assignment_target
    ON sop_assignment_targets (tenant_id,sop_id,target_type,
        COALESCE(employee_id,site_id,customer_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX ix_sop_assignment_targets_sop ON sop_assignment_targets (tenant_id, sop_id);

CREATE TABLE sop_assignments (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    sop_id UUID NOT NULL,
    version_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    due_at TIMESTAMPTZ,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    captured_at TIMESTAMPTZ,
    server_received_at TIMESTAMPTZ,
    client_mutation_id VARCHAR(64),
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_sop_assignment_employee_version UNIQUE (tenant_id, version_id, employee_id),
    CONSTRAINT uq_sop_assignment_client_mutation UNIQUE (tenant_id, client_mutation_id),
    CONSTRAINT fk_sop_assignment_instruction FOREIGN KEY (sop_id, tenant_id)
        REFERENCES sop_instructions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_assignment_version FOREIGN KEY (version_id, tenant_id)
        REFERENCES sop_versions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_assignment_same_instruction_version FOREIGN KEY (version_id, tenant_id, sop_id)
        REFERENCES sop_versions(id, tenant_id, sop_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sop_assignment_employee FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_sop_assignment_ack_fields CHECK (
        (acknowledged_at IS NULL AND acknowledged_by_user_id IS NULL AND captured_at IS NULL AND server_received_at IS NULL) OR
        (acknowledged_at IS NOT NULL AND acknowledged_by_user_id IS NOT NULL AND server_received_at IS NOT NULL)
    )
);
CREATE INDEX ix_sop_assignments_employee_due ON sop_assignments (tenant_id, employee_id, due_at)
    WHERE acknowledged_at IS NULL;
CREATE INDEX ix_sop_assignments_sop_version ON sop_assignments (tenant_id, sop_id, version_id);

DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'sop_instructions', 'sop_versions', 'sop_events',
        'sop_assignment_targets', 'sop_assignments'
    ] LOOP
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

CREATE OR REPLACE FUNCTION prevent_sop_immutable_record_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SOP-Versionen und Audit-Ereignisse sind unveränderlich.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sop_versions_immutable
BEFORE UPDATE OR DELETE ON sop_versions
FOR EACH ROW EXECUTE FUNCTION prevent_sop_immutable_record_tampering();
CREATE TRIGGER trg_sop_events_immutable
BEFORE UPDATE OR DELETE ON sop_events
FOR EACH ROW EXECUTE FUNCTION prevent_sop_immutable_record_tampering();

CREATE OR REPLACE FUNCTION protect_sop_assignment_history()
RETURNS TRIGGER AS $$
DECLARE
    employee_email text;
    actor_email text;
BEGIN
    IF (NEW.tenant_id, NEW.sop_id, NEW.version_id, NEW.employee_id)
        IS DISTINCT FROM (OLD.tenant_id, OLD.sop_id, OLD.version_id, OLD.employee_id) THEN
        RAISE EXCEPTION 'SOP assignment identity is immutable.';
    END IF;
    IF OLD.acknowledged_at IS NOT NULL AND
       (NEW.acknowledged_at, NEW.acknowledged_by_user_id, NEW.captured_at,
        NEW.server_received_at, NEW.client_mutation_id)
       IS DISTINCT FROM
       (OLD.acknowledged_at, OLD.acknowledged_by_user_id, OLD.captured_at,
        OLD.server_received_at, OLD.client_mutation_id) THEN
        RAISE EXCEPTION 'SOP acknowledgements are immutable.';
    END IF;
    IF OLD.acknowledged_at IS NULL AND NEW.acknowledged_at IS NOT NULL THEN
        SELECT lower(email) INTO employee_email
        FROM employees WHERE id=NEW.employee_id AND tenant_id=NEW.tenant_id;
        SELECT lower(email) INTO actor_email
        FROM users WHERE id=NEW.acknowledged_by_user_id;
        IF employee_email IS NULL OR actor_email IS DISTINCT FROM employee_email THEN
            RAISE EXCEPTION 'SOP acknowledgement actor must match the assigned employee.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sop_assignment_history
BEFORE UPDATE ON sop_assignments
FOR EACH ROW EXECUTE FUNCTION protect_sop_assignment_history();

REVOKE ALL ON sop_instructions, sop_versions, sop_events, sop_assignment_targets, sop_assignments FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON sop_instructions TO secops_app_user;
GRANT SELECT, INSERT ON sop_versions, sop_events TO secops_app_user;
GRANT SELECT, INSERT ON sop_assignment_targets TO secops_app_user;
GRANT SELECT, INSERT, UPDATE ON sop_assignments TO secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('sop:read', 'sop', 'Dienstanweisungen und eigene Kenntnisnahmen lesen'),
    ('sop:create', 'sop', 'Dienstanweisungen erstellen'),
    ('sop:update', 'sop', 'Entwürfe von Dienstanweisungen bearbeiten'),
    ('sop:submit', 'sop', 'Dienstanweisungen zur Prüfung einreichen'),
    ('sop:review', 'sop', 'Dienstanweisungen prüfen und Änderungen anfordern'),
    ('sop:approve', 'sop', 'Dienstanweisungen freigeben'),
    ('sop:publish', 'sop', 'Freigegebene Dienstanweisungen veröffentlichen'),
    ('sop:assign', 'sop', 'Dienstanweisungen Mitarbeitern zuweisen'),
    ('sop:acknowledge', 'sop', 'Eigene Kenntnisnahme bestätigen'),
    ('sop:archive', 'sop', 'Dienstanweisungen archivieren'),
    ('sop:manage', 'sop', 'Dienstanweisungen und Berichte verwalten')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON
    (r.name IN ('Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Qualitätsmanagement')
        AND p.code LIKE 'sop:%')
    OR (r.name = 'Personalverwaltung' AND p.code IN (
        'sop:read', 'sop:create', 'sop:update', 'sop:submit', 'sop:assign', 'sop:manage'
    ))
    OR (r.name IN ('Objektleitung', 'Wachdienstmitarbeiter') AND p.code IN (
        'sop:read', 'sop:acknowledge'
    ))
    OR (r.name = 'Auditor' AND p.code = 'sop:read')
ON CONFLICT DO NOTHING;
