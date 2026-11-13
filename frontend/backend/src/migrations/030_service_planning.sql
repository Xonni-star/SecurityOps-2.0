-- Phase 2 service planning schema and tenant security policies.
ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS time_zone VARCHAR(100) NOT NULL DEFAULT 'UTC';

ALTER TABLE shifts
    ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS time_zone VARCHAR(100),
    ADD COLUMN IF NOT EXISTS planning_status VARCHAR(20) NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS schedule_period_id UUID;

UPDATE shifts s
   SET time_zone = st.time_zone,
       starts_at = (s.shift_date + s.start_time::time) AT TIME ZONE st.time_zone,
       ends_at = (
           s.shift_date
           + CASE WHEN s.end_time::time <= s.start_time::time THEN 1 ELSE 0 END
           + s.end_time::time
       ) AT TIME ZONE st.time_zone
  FROM sites st
 WHERE st.id = s.site_id
   AND st.tenant_id = s.tenant_id
   AND (s.starts_at IS NULL OR s.ends_at IS NULL OR s.time_zone IS NULL);

ALTER TABLE shifts
    ALTER COLUMN starts_at SET NOT NULL,
    ALTER COLUMN ends_at SET NOT NULL,
    ALTER COLUMN time_zone SET NOT NULL,
    ADD CONSTRAINT shifts_planning_status_check
        CHECK (planning_status IN ('draft', 'validated', 'published', 'cancelled')),
    ADD CONSTRAINT shifts_break_minutes_check CHECK (break_minutes >= 0),
    ADD CONSTRAINT shifts_time_order_check CHECK (ends_at > starts_at);

CREATE OR REPLACE FUNCTION set_shift_instants()
RETURNS TRIGGER AS $$
DECLARE
    site_time_zone TEXT;
BEGIN
    SELECT time_zone INTO site_time_zone
      FROM sites
     WHERE tenant_id = NEW.tenant_id AND id = NEW.site_id;
    IF site_time_zone IS NULL THEN
        RAISE EXCEPTION 'Schichtobjekt oder IANA-Zeitzone nicht gefunden.';
    END IF;
    NEW.time_zone := COALESCE(NEW.time_zone, site_time_zone);
    IF NEW.starts_at IS NULL THEN
        NEW.starts_at := (NEW.shift_date + NEW.start_time::time) AT TIME ZONE NEW.time_zone;
    END IF;
    IF NEW.ends_at IS NULL THEN
        NEW.ends_at := (
            NEW.shift_date
            + CASE WHEN NEW.end_time::time <= NEW.start_time::time THEN 1 ELSE 0 END
            + NEW.end_time::time
        ) AT TIME ZONE NEW.time_zone;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shifts_set_instants
    BEFORE INSERT OR UPDATE OF site_id, shift_date, start_time, end_time, time_zone
    ON shifts
    FOR EACH ROW EXECUTE FUNCTION set_shift_instants();

CREATE TABLE schedule_periods (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    time_zone VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    published_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT schedule_period_date_order CHECK (date_to >= date_from),
    CONSTRAINT uq_schedule_period_name UNIQUE (tenant_id, name)
);

ALTER TABLE shifts
    ADD CONSTRAINT fk_shifts_period_tenant
        FOREIGN KEY (schedule_period_id, tenant_id)
        REFERENCES schedule_periods(id, tenant_id) ON DELETE SET NULL (schedule_period_id);

CREATE TABLE schedule_templates (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    name VARCHAR(160) NOT NULL,
    time_zone VARCHAR(100) NOT NULL,
    local_start_time TIME NOT NULL,
    local_end_time TIME NOT NULL,
    required_qualification VARCHAR(100) NOT NULL,
    recurrence JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_schedule_template_site
        FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT uq_schedule_template_name UNIQUE (tenant_id, name)
);

CREATE TABLE shift_staffing_requirements (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL,
    qualification_type VARCHAR(100) NOT NULL,
    required_count INTEGER NOT NULL CHECK (required_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_shift_staffing_requirement UNIQUE (tenant_id, shift_id, qualification_type),
    CONSTRAINT fk_shift_staffing_requirement_shift
        FOREIGN KEY (shift_id, tenant_id) REFERENCES shifts(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE shift_staffing_assignments (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'assigned'
        CHECK (status IN ('assigned', 'released')),
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    assigned_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMPTZ,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_shift_staffing_assignment UNIQUE (tenant_id, shift_id, employee_id),
    CONSTRAINT fk_shift_staffing_assignment_shift
        FOREIGN KEY (shift_id, tenant_id) REFERENCES shifts(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_shift_staffing_assignment_employee
        FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX ix_shift_staffing_employee_active
    ON shift_staffing_assignments (tenant_id, employee_id, shift_id)
    WHERE status = 'assigned';

INSERT INTO shift_staffing_assignments (tenant_id, shift_id, employee_id)
SELECT tenant_id, id, employee_id
  FROM shifts
 WHERE employee_id IS NOT NULL
ON CONFLICT (tenant_id, shift_id, employee_id) DO NOTHING;

CREATE TABLE schedule_rule_profiles (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_schedule_rule_profile_name UNIQUE (tenant_id, name)
);

CREATE TABLE schedule_rule_profile_versions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    effective_from DATE NOT NULL,
    effective_until DATE,
    source_name VARCHAR(255) NOT NULL,
    source_reference TEXT NOT NULL,
    rules JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'approved', 'superseded')),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_schedule_rule_profile_version UNIQUE (tenant_id, profile_id, version_number),
    CONSTRAINT fk_schedule_rule_profile_version_profile
        FOREIGN KEY (profile_id, tenant_id)
        REFERENCES schedule_rule_profiles(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT schedule_rule_profile_version_dates
        CHECK (effective_until IS NULL OR effective_until >= effective_from),
    CONSTRAINT schedule_rule_profile_approval
        CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE INDEX ix_schedule_rule_profile_effective
    ON schedule_rule_profile_versions (tenant_id, profile_id, status, effective_from, effective_until);

CREATE TABLE schedule_rule_findings (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    run_id UUID NOT NULL,
    shift_id UUID,
    employee_id UUID,
    rule_code VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'blocking')),
    message TEXT NOT NULL,
    source_name VARCHAR(255),
    profile_version_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_schedule_finding_shift
        FOREIGN KEY (shift_id, tenant_id) REFERENCES shifts(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_schedule_finding_employee
        FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (employee_id),
    CONSTRAINT fk_schedule_finding_profile_version
        FOREIGN KEY (profile_version_id, tenant_id)
        REFERENCES schedule_rule_profile_versions(id, tenant_id) ON DELETE SET NULL (profile_version_id)
);

CREATE INDEX ix_schedule_rule_findings_run
    ON schedule_rule_findings (tenant_id, run_id, severity, created_at);

CREATE TABLE schedule_rule_exceptions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    finding_id UUID NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_schedule_exception_finding UNIQUE (tenant_id, finding_id),
    CONSTRAINT fk_schedule_exception_finding
        FOREIGN KEY (finding_id, tenant_id)
        REFERENCES schedule_rule_findings(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT schedule_exception_decision
        CHECK ((status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
            OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE shift_swap_requests (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL,
    requester_employee_id UUID NOT NULL,
    proposed_employee_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_shift_swap_shift
        FOREIGN KEY (shift_id, tenant_id) REFERENCES shifts(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_shift_swap_requester_employee
        FOREIGN KEY (requester_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_shift_swap_proposed_employee
        FOREIGN KEY (proposed_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT shift_swap_distinct_employees CHECK (requester_employee_id <> proposed_employee_id)
);

CREATE INDEX ix_shift_swap_requests_pending
    ON shift_swap_requests (tenant_id, status, requested_at DESC);

CREATE TABLE planning_audit_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    event_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id UUID NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id)
);

CREATE INDEX ix_planning_audit_entity
    ON planning_audit_events (tenant_id, entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_planning_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Planungs-Auditereignisse sind unveränderlich.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_planning_audit_immutable
    BEFORE UPDATE OR DELETE ON planning_audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_planning_audit_tampering();

DO $$
DECLARE
    tbl TEXT;
    planning_tables TEXT[] := ARRAY[
        'schedule_periods', 'schedule_templates', 'shift_staffing_requirements',
        'shift_staffing_assignments', 'schedule_rule_profiles',
        'schedule_rule_profile_versions', 'schedule_rule_findings',
        'schedule_rule_exceptions', 'shift_swap_requests', 'planning_audit_events'
    ];
BEGIN
    FOREACH tbl IN ARRAY planning_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_permissive ON %I AS PERMISSIVE FOR ALL TO PUBLIC
             USING (current_setting(''app.current_tenant'', true) IS NOT NULL
                    AND current_setting(''app.current_tenant'', true) <> ''''
                    AND tenant_id = current_setting(''app.current_tenant'', true)::uuid)
             WITH CHECK (current_setting(''app.current_tenant'', true) IS NOT NULL
                         AND current_setting(''app.current_tenant'', true) <> ''''
                         AND tenant_id = current_setting(''app.current_tenant'', true)::uuid)',
            tbl
        );
    END LOOP;
END $$;

REVOKE ALL ON schedule_periods, schedule_templates, shift_staffing_requirements,
    shift_staffing_assignments, schedule_rule_profiles, schedule_rule_profile_versions,
    schedule_rule_findings, schedule_rule_exceptions, shift_swap_requests,
    planning_audit_events FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON schedule_periods, schedule_templates,
    shift_staffing_requirements, shift_staffing_assignments, schedule_rule_profiles,
    schedule_rule_profile_versions, schedule_rule_exceptions, shift_swap_requests
    TO secops_app_user;
GRANT SELECT, INSERT ON schedule_rule_findings, planning_audit_events TO secops_app_user;
INSERT INTO permissions (code, module, description) VALUES
    ('planning:read', 'planning', 'Dienstpläne, Besetzung und Prüfberichte lesen'),
    ('planning:manage', 'planning', 'Dienstpläne und Besetzungen bearbeiten'),
    ('planning:publish', 'planning', 'Geprüfte Dienstplanperioden veröffentlichen'),
    ('planning:rules:manage', 'planning', 'Versionierte Regelprofile verwalten'),
    ('planning:rules:approve', 'planning', 'Regelprofilversionen fachlich freigeben'),
    ('planning:exceptions:manage', 'planning', 'Regelausnahmen beantragen und entscheiden'),
    ('planning:exceptions:approve', 'planning', 'Regelausnahmen fachlich freigeben'),
    ('planning:swaps:manage', 'planning', 'Diensttausch beantragen'),
    ('planning:swaps:approve', 'planning', 'Diensttausch genehmigen oder ablehnen'),
    ('planning:reports:read', 'planning', 'Planungsberichte lesen und exportieren')
ON CONFLICT (code) DO NOTHING;
