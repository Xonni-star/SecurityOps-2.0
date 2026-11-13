-- Version 017 leaves 015/016 available for the still-open alarm PR #12.
CREATE TABLE handovers (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    area VARCHAR(150),
    shift_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL,
    general_text TEXT NOT NULL DEFAULT '',
    incidents TEXT NOT NULL DEFAULT '',
    important_notes TEXT NOT NULL DEFAULT '',
    safety_information TEXT NOT NULL DEFAULT '',
    status VARCHAR(40) NOT NULL DEFAULT 'pending_handover_confirmation'
        CHECK (status IN ('pending_handover_confirmation', 'pending_takeover_acknowledgement', 'completed')),
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    client_mutation_id VARCHAR(64) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    client_captured_at TIMESTAMPTZ NOT NULL,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_handovers_client_mutation UNIQUE (tenant_id, client_mutation_id),
    CONSTRAINT fk_handover_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_handover_shift FOREIGN KEY (shift_id, tenant_id)
        REFERENCES shifts(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_handovers_tenant_site_time ON handovers (tenant_id, site_id, occurred_at DESC);
CREATE INDEX ix_handovers_tenant_status_time ON handovers (tenant_id, status, occurred_at DESC);
CREATE INDEX ix_handovers_tenant_creator_time ON handovers (tenant_id, created_by_user_id, occurred_at DESC);

CREATE TABLE handover_participants (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    handover_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    participant_role VARCHAR(20) NOT NULL CHECK (participant_role IN ('handover', 'takeover', 'observer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_handover_participant_role UNIQUE (tenant_id, handover_id, participant_role),
    CONSTRAINT uq_handover_participant_employee UNIQUE (tenant_id, handover_id, employee_id),
    CONSTRAINT fk_handover_participant_handover FOREIGN KEY (handover_id, tenant_id)
        REFERENCES handovers(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_handover_participant_employee FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_handover_participants_employee ON handover_participants (tenant_id, employee_id, handover_id);

CREATE TABLE handover_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    handover_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(32) NOT NULL CHECK (action IN (
        'created', 'updated', 'confirmed', 'acknowledged', 'question_added',
        'correction_added', 'task_created', 'task_updated', 'document_linked'
    )),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_handover_event_handover FOREIGN KEY (handover_id, tenant_id)
        REFERENCES handovers(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_handover_events_history ON handover_events (tenant_id, handover_id, occurred_at, id);

CREATE TABLE handover_confirmations (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    handover_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    confirmation_type VARCHAR(12) NOT NULL CHECK (confirmation_type IN ('handover', 'takeover')),
    revision_version INTEGER NOT NULL CHECK (revision_version > 0),
    client_mutation_id VARCHAR(64) NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_handover_confirmation_revision UNIQUE
        (tenant_id, handover_id, revision_version, confirmation_type),
    CONSTRAINT uq_handover_confirmation_mutation UNIQUE (tenant_id, client_mutation_id),
    CONSTRAINT fk_handover_confirmation_handover FOREIGN KEY (handover_id, tenant_id)
        REFERENCES handovers(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_handover_confirmation_employee FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_handover_confirmations_history ON handover_confirmations (tenant_id, handover_id, captured_at);

CREATE TABLE handover_tasks (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL,
    origin_handover_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    assigned_employee_id UUID NOT NULL,
    priority VARCHAR(12) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    due_at TIMESTAMPTZ,
    status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    client_mutation_id VARCHAR(64),
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_handover_task_client_mutation UNIQUE (tenant_id, client_mutation_id),
    CONSTRAINT fk_handover_task_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_handover_task_origin FOREIGN KEY (origin_handover_id, tenant_id)
        REFERENCES handovers(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_handover_task_assignee FOREIGN KEY (assigned_employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_handover_task_completion CHECK (
        (status IN ('done', 'cancelled') AND completed_at IS NOT NULL) OR
        (status IN ('open', 'in_progress') AND completed_at IS NULL)
    )
);
CREATE INDEX ix_handover_tasks_open_site_due ON handover_tasks (tenant_id, site_id, due_at)
    WHERE status IN ('open', 'in_progress');
CREATE INDEX ix_handover_tasks_origin ON handover_tasks (tenant_id, origin_handover_id, created_at);
CREATE INDEX ix_handover_tasks_assignee_status ON handover_tasks (tenant_id, assigned_employee_id, status, due_at);

CREATE TABLE handover_task_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    task_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(20) NOT NULL CHECK (action IN ('created', 'updated')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_handover_task_event_task FOREIGN KEY (task_id, tenant_id)
        REFERENCES handover_tasks(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_handover_task_events_history ON handover_task_events (tenant_id, task_id, occurred_at, id);

CREATE TABLE handover_documents (
    tenant_id UUID NOT NULL,
    handover_id UUID NOT NULL,
    document_id UUID NOT NULL,
    linked_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, handover_id, document_id),
    CONSTRAINT fk_handover_document_handover FOREIGN KEY (handover_id, tenant_id)
        REFERENCES handovers(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_handover_document_document FOREIGN KEY (document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_handover_documents_document ON handover_documents (tenant_id, document_id);

DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'handovers', 'handover_participants', 'handover_events', 'handover_confirmations',
        'handover_tasks', 'handover_task_events', 'handover_documents'
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

CREATE OR REPLACE FUNCTION protect_handover_history()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.id, NEW.tenant_id, NEW.site_id, NEW.shift_id, NEW.client_mutation_id,
        NEW.payload_hash, NEW.client_captured_at, NEW.server_received_at, NEW.created_by_user_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.tenant_id, OLD.site_id, OLD.shift_id, OLD.client_mutation_id,
        OLD.payload_hash, OLD.client_captured_at, OLD.server_received_at, OLD.created_by_user_id, OLD.created_at) THEN
        RAISE EXCEPTION 'Handover identity and sync metadata are immutable.';
    END IF;
    IF OLD.status <> 'pending_handover_confirmation' AND
       (NEW.area, NEW.occurred_at, NEW.general_text, NEW.incidents, NEW.important_notes,
        NEW.safety_information, NEW.revision_version)
       IS DISTINCT FROM
       (OLD.area, OLD.occurred_at, OLD.general_text, OLD.incidents, OLD.important_notes,
        OLD.safety_information, OLD.revision_version) THEN
        RAISE EXCEPTION 'Confirmed handover content is immutable; document a correction as an event.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_handover_content_history
BEFORE UPDATE ON handovers
FOR EACH ROW EXECUTE FUNCTION protect_handover_history();

CREATE OR REPLACE FUNCTION prevent_handover_append_only_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Handover audit, confirmation and task history records are append-only.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_handover_events_immutable
BEFORE UPDATE OR DELETE ON handover_events
FOR EACH ROW EXECUTE FUNCTION prevent_handover_append_only_tampering();
CREATE TRIGGER trg_handover_confirmations_immutable
BEFORE UPDATE OR DELETE ON handover_confirmations
FOR EACH ROW EXECUTE FUNCTION prevent_handover_append_only_tampering();
CREATE TRIGGER trg_handover_task_events_immutable
BEFORE UPDATE OR DELETE ON handover_task_events
FOR EACH ROW EXECUTE FUNCTION prevent_handover_append_only_tampering();
CREATE TRIGGER trg_handover_participants_immutable
BEFORE UPDATE OR DELETE ON handover_participants
FOR EACH ROW EXECUTE FUNCTION prevent_handover_append_only_tampering();
CREATE TRIGGER trg_handover_documents_immutable
BEFORE UPDATE OR DELETE ON handover_documents
FOR EACH ROW EXECUTE FUNCTION prevent_handover_append_only_tampering();

REVOKE ALL ON handovers, handover_participants, handover_events, handover_confirmations,
    handover_tasks, handover_task_events, handover_documents FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON handovers TO secops_app_user;
GRANT SELECT, INSERT ON handover_participants, handover_events, handover_confirmations,
    handover_task_events, handover_documents TO secops_app_user;
GRANT SELECT, INSERT, UPDATE ON handover_tasks TO secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('handovers:read', 'handovers', 'Übergaben und zugehörige Historie lesen'),
    ('handovers:create', 'handovers', 'Übergaben erstellen'),
    ('handovers:update', 'handovers', 'Noch nicht bestätigte Übergaben bearbeiten'),
    ('handovers:confirm', 'handovers', 'Übergabe oder Übernahme bestätigen'),
    ('handovers:tasks', 'handovers', 'Übergabeaufgaben verwalten'),
    ('handovers:manage', 'handovers', 'Übergaben und DMS-Verknüpfungen verwalten')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON
    (r.name IN ('Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Objektleitung')
        AND p.code LIKE 'handovers:%')
    OR (r.name = 'Wachdienstmitarbeiter' AND p.code IN (
        'handovers:read', 'handovers:create', 'handovers:confirm', 'handovers:tasks'
    ))
    OR (r.name = 'Auditor' AND p.code = 'handovers:read')
ON CONFLICT DO NOTHING;
