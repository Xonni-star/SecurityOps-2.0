ALTER TABLE shifts ADD COLUMN IF NOT EXISTS end_date DATE;
UPDATE shifts
   SET end_date = (ends_at AT TIME ZONE time_zone)::date
 WHERE end_date IS NULL;
ALTER TABLE shifts ALTER COLUMN end_date SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'shifts'::regclass
           AND conname = 'shifts_end_date_order'
    ) THEN
        ALTER TABLE shifts ADD CONSTRAINT shifts_end_date_order CHECK (end_date >= shift_date);
    END IF;
END $$;

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

    IF TG_OP = 'INSERT' THEN
        IF NEW.end_date IS NULL THEN
            NEW.end_date := CASE
                WHEN NEW.ends_at IS NOT NULL THEN (NEW.ends_at AT TIME ZONE NEW.time_zone)::date
                ELSE NEW.shift_date + CASE WHEN NEW.end_time::time <= NEW.start_time::time THEN 1 ELSE 0 END
            END;
        END IF;
        IF NEW.starts_at IS NULL THEN
            NEW.starts_at := (NEW.shift_date + NEW.start_time::time) AT TIME ZONE NEW.time_zone;
        END IF;
        IF NEW.ends_at IS NULL THEN
            NEW.ends_at := (NEW.end_date + NEW.end_time::time) AT TIME ZONE NEW.time_zone;
        END IF;
    ELSE
        IF NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at
           AND (NEW.shift_date IS DISTINCT FROM OLD.shift_date
                OR NEW.start_time IS DISTINCT FROM OLD.start_time
                OR NEW.time_zone IS DISTINCT FROM OLD.time_zone) THEN
            NEW.starts_at := (NEW.shift_date + NEW.start_time::time) AT TIME ZONE NEW.time_zone;
        END IF;
        IF NEW.ends_at IS NOT DISTINCT FROM OLD.ends_at
           AND (NEW.end_date IS DISTINCT FROM OLD.end_date
                OR NEW.end_time IS DISTINCT FROM OLD.end_time
                OR NEW.time_zone IS DISTINCT FROM OLD.time_zone) THEN
            NEW.ends_at := (NEW.end_date + NEW.end_time::time) AT TIME ZONE NEW.time_zone;
        ELSIF NEW.ends_at IS DISTINCT FROM OLD.ends_at
              AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date THEN
            NEW.end_date := (NEW.ends_at AT TIME ZONE NEW.time_zone)::date;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shifts_set_instants ON shifts;
CREATE TRIGGER trg_shifts_set_instants
    BEFORE INSERT OR UPDATE OF site_id, shift_date, start_time, end_time, end_date, time_zone, starts_at, ends_at
    ON shifts
    FOR EACH ROW EXECUTE FUNCTION set_shift_instants();

CREATE TABLE shift_cover_requests (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL,
    shift_revision_version_at_request INTEGER NOT NULL CHECK (shift_revision_version_at_request > 0),
    requested_employee_id UUID,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_shift_cover_request_shift
        FOREIGN KEY (shift_id, tenant_id) REFERENCES shifts(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_shift_cover_requested_employee
        FOREIGN KEY (requested_employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE SET NULL (requested_employee_id),
    CONSTRAINT shift_cover_request_decision
        CHECK ((status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
            OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE INDEX ix_shift_cover_requests_pending
    ON shift_cover_requests (tenant_id, status, requested_at DESC);

CREATE TABLE shift_actual_times (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    actual_start_at TIMESTAMPTZ NOT NULL,
    actual_end_at TIMESTAMPTZ NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_shift_actual_time_employee UNIQUE (tenant_id, shift_id, employee_id),
    CONSTRAINT fk_shift_actual_time_assignment
        FOREIGN KEY (tenant_id, shift_id, employee_id)
        REFERENCES shift_staffing_assignments(tenant_id, shift_id, employee_id) ON DELETE CASCADE,
    CONSTRAINT shift_actual_time_order CHECK (actual_end_at > actual_start_at),
    CONSTRAINT shift_actual_time_break_duration
        CHECK (break_minutes <= EXTRACT(EPOCH FROM (actual_end_at - actual_start_at)) / 60)
);

CREATE INDEX ix_shift_actual_times_employee
    ON shift_actual_times (tenant_id, employee_id, actual_start_at);

DO $$
DECLARE
    tbl TEXT;
    planning_tables TEXT[] := ARRAY['shift_cover_requests', 'shift_actual_times'];
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

REVOKE ALL ON shift_cover_requests, shift_actual_times FROM PUBLIC, secops_app_user;
GRANT SELECT, INSERT, UPDATE ON shift_cover_requests, shift_actual_times TO secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('planning:covers:manage', 'planning', 'Vertretungsanträge erstellen'),
    ('planning:covers:approve', 'planning', 'Vertretungsanträge genehmigen oder ablehnen'),
    ('planning:actuals:manage', 'planning', 'Tatsächlich geleistete Schichtzeiten erfassen und korrigieren')
ON CONFLICT (code) DO NOTHING;
