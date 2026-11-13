CREATE TABLE emergency_plans (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    scenario VARCHAR(80) NOT NULL CHECK (scenario IN (
        'BMA - Brandmeldeanlage',
        'EMA - Einbruchsalarm',
        'Bombendrohung',
        'Medizinischer Notfall',
        'Hausfriedensbruch / Aggression'
    )),
    action_steps JSONB NOT NULL CHECK (
        jsonb_typeof(action_steps) = 'array' AND jsonb_array_length(action_steps) BETWEEN 1 AND 30
    ),
    contacts JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(contacts) = 'array' AND jsonb_array_length(contacts) <= 30
    ),
    last_drill_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    archived_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_emergency_plan_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_emergency_plans_tenant_site
    ON emergency_plans (tenant_id, site_id, is_active) WHERE archived_at IS NULL;

CREATE TABLE alarm_incidents (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    emergency_plan_id UUID,
    scenario VARCHAR(80) NOT NULL CHECK (scenario IN (
        'BMA - Brandmeldeanlage',
        'EMA - Einbruchsalarm',
        'Bombendrohung',
        'Medizinischer Notfall',
        'Hausfriedensbruch / Aggression'
    )),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('Niedrig', 'Normal', 'Dringend', 'Kritisch')),
    status VARCHAR(20) NOT NULL DEFAULT 'gemeldet'
        CHECK (status IN ('gemeldet', 'bestätigt', 'eskaliert', 'abgeschlossen')),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMPTZ,
    escalated_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    reported_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    resolution_note TEXT,
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_alarm_incident_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_alarm_incident_plan FOREIGN KEY (emergency_plan_id, tenant_id)
        REFERENCES emergency_plans(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_alarm_incident_resolution CHECK (
        (status = 'abgeschlossen' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL)
        OR
        (status <> 'abgeschlossen' AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_note IS NULL)
    ),
    CONSTRAINT ck_alarm_incident_acknowledged CHECK (
        (status = 'gemeldet' AND acknowledged_at IS NULL)
        OR (status <> 'gemeldet' AND acknowledged_at IS NOT NULL)
    ),
    CONSTRAINT ck_alarm_incident_escalated CHECK (
        (status = 'eskaliert' AND escalated_at IS NOT NULL)
        OR (status <> 'eskaliert' AND escalated_at IS NULL)
    )
);
CREATE INDEX ix_alarm_incidents_tenant_status
    ON alarm_incidents (tenant_id, status, reported_at DESC);
CREATE INDEX ix_alarm_incidents_tenant_site
    ON alarm_incidents (tenant_id, site_id, reported_at DESC);

CREATE TABLE emergency_management_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    emergency_plan_id UUID,
    alarm_incident_id UUID,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(40) NOT NULL CHECK (action IN (
        'plan_created', 'plan_updated', 'plan_archived', 'drill_recorded',
        'incident_reported', 'incident_acknowledged', 'incident_escalated', 'incident_resolved'
    )),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_emergency_event_plan FOREIGN KEY (emergency_plan_id, tenant_id)
        REFERENCES emergency_plans(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_emergency_event_incident FOREIGN KEY (alarm_incident_id, tenant_id)
        REFERENCES alarm_incidents(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_emergency_event_target CHECK (
        (emergency_plan_id IS NOT NULL AND alarm_incident_id IS NULL)
        OR (emergency_plan_id IS NULL AND alarm_incident_id IS NOT NULL)
    )
);
CREATE INDEX ix_emergency_events_plan_history
    ON emergency_management_events (tenant_id, emergency_plan_id, occurred_at DESC);
CREATE INDEX ix_emergency_events_incident_history
    ON emergency_management_events (tenant_id, alarm_incident_id, occurred_at DESC);

DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'emergency_plans', 'alarm_incidents', 'emergency_management_events'
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

CREATE OR REPLACE FUNCTION prevent_emergency_event_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Ereignisse des Alarm- und Notfallmanagements sind unveränderlich.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emergency_events_immutable
BEFORE UPDATE OR DELETE ON emergency_management_events
FOR EACH ROW EXECUTE FUNCTION prevent_emergency_event_tampering();

REVOKE ALL ON emergency_plans, alarm_incidents, emergency_management_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON emergency_plans, alarm_incidents TO secops_app_user;
GRANT SELECT, INSERT ON emergency_management_events TO secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('alarm:read', 'alarm', 'Alarm- und Notfallpläne sowie Vorfälle lesen'),
    ('alarm:manage', 'alarm', 'Notfallpläne verwalten und Übungen dokumentieren'),
    ('alarm:report', 'alarm', 'Einen Alarmvorfall melden'),
    ('alarm:respond', 'alarm', 'Alarmvorfälle bestätigen, eskalieren und abschließen')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON
    (r.name IN ('Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Qualitätsmanagement')
        AND p.code LIKE 'alarm:%')
    OR (r.name = 'Objektleitung' AND p.code IN ('alarm:read', 'alarm:report', 'alarm:respond'))
    OR (r.name = 'Wachdienstmitarbeiter' AND p.code IN ('alarm:read', 'alarm:report', 'alarm:respond'))
    OR (r.name = 'Auditor' AND p.code = 'alarm:read')
ON CONFLICT DO NOTHING;
