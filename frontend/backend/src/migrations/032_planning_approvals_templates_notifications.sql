ALTER TABLE schedule_templates
    ADD COLUMN break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
    ADD COLUMN required_staff_count INTEGER NOT NULL DEFAULT 1 CHECK (required_staff_count > 0),
    ADD COLUMN effective_from DATE,
    ADD COLUMN effective_until DATE,
    ADD CONSTRAINT schedule_template_validity_dates
        CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from);

ALTER TABLE shift_actual_times
    ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (approval_status IN ('pending', 'approved')),
    ADD COLUMN approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN approved_at TIMESTAMPTZ,
    ADD COLUMN approved_revision_version INTEGER,
    ADD CONSTRAINT shift_actual_time_approval_state CHECK (
        (approval_status = 'pending'
            AND approved_by IS NULL
            AND approved_at IS NULL
            AND approved_revision_version IS NULL)
        OR
        (approval_status = 'approved'
            AND approved_by IS NOT NULL
            AND approved_at IS NOT NULL
            AND approved_revision_version = revision_version)
    ),
    ADD CONSTRAINT shift_actual_time_no_self_approval
        CHECK (approved_by IS NULL OR approved_by <> recorded_by);

CREATE TABLE shift_actual_time_revisions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actual_time_id UUID NOT NULL,
    revision_version INTEGER NOT NULL CHECK (revision_version > 0),
    previous_values JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_shift_actual_time_revision_record
        FOREIGN KEY (actual_time_id, tenant_id)
        REFERENCES shift_actual_times(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX ix_shift_actual_time_revisions_record
    ON shift_actual_time_revisions (tenant_id, actual_time_id, created_at, id);

CREATE OR REPLACE FUNCTION append_shift_actual_time_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.revision_version NOT IN (OLD.revision_version, OLD.revision_version + 1) THEN
        RAISE EXCEPTION 'Actual-time revision must remain unchanged or increment by exactly one.';
    END IF;
    IF (NEW.actual_start_at, NEW.actual_end_at, NEW.break_minutes, NEW.notes, NEW.recorded_by)
       IS DISTINCT FROM
       (OLD.actual_start_at, OLD.actual_end_at, OLD.break_minutes, OLD.notes, OLD.recorded_by) THEN
        IF NEW.revision_version <> OLD.revision_version + 1
           OR NEW.approval_status <> 'pending'
           OR NEW.approved_by IS NOT NULL
           OR NEW.approved_at IS NOT NULL
           OR NEW.approved_revision_version IS NOT NULL THEN
            RAISE EXCEPTION 'Actual-time corrections must increment the revision and clear approval.';
        END IF;
    ELSIF NEW.revision_version <> OLD.revision_version THEN
        RAISE EXCEPTION 'Actual-time revision cannot change without a correction.';
    END IF;
    INSERT INTO shift_actual_time_revisions
        (tenant_id, actual_time_id, revision_version, previous_values)
    VALUES (OLD.tenant_id, OLD.id, OLD.revision_version, to_jsonb(OLD));
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shift_actual_time_revision
    BEFORE UPDATE ON shift_actual_times
    FOR EACH ROW EXECUTE FUNCTION append_shift_actual_time_revision();

CREATE TABLE planning_notifications (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id UUID NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ,
    PRIMARY KEY (id, tenant_id)
);

CREATE INDEX ix_planning_notifications_inbox
    ON planning_notifications (tenant_id, recipient_user_id, created_at DESC, id);

CREATE FUNCTION validate_planning_notification_tenant_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM user_roles
         WHERE tenant_id = NEW.tenant_id AND user_id = NEW.recipient_user_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'Planning notification recipient must belong to the same tenant.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_planning_notification_tenant_user
    BEFORE INSERT OR UPDATE OF tenant_id, recipient_user_id ON planning_notifications
    FOR EACH ROW EXECUTE FUNCTION validate_planning_notification_tenant_user();

DO $$
DECLARE
    tbl TEXT;
    planning_tables TEXT[] := ARRAY['shift_actual_time_revisions', 'planning_notifications'];
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

REVOKE ALL ON shift_actual_time_revisions, planning_notifications FROM PUBLIC, secops_app_user;
GRANT SELECT ON shift_actual_time_revisions TO secops_app_user;
GRANT SELECT, INSERT, UPDATE (read_at) ON planning_notifications TO secops_app_user;
REVOKE ALL ON FUNCTION append_shift_actual_time_revision() FROM PUBLIC, secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('planning:actuals:approve', 'planning', 'Erfasste Ist-Zeiten fachlich freigeben')
ON CONFLICT (code) DO NOTHING;
