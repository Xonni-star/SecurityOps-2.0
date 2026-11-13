CREATE TABLE patrol_checkpoints (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    location_details TEXT NOT NULL DEFAULT '',
    token_hash CHAR(64) NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 1 CHECK (token_version > 0),
    required_interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (required_interval_minutes > 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_checkpoint_code UNIQUE (tenant_id, site_id, code),
    CONSTRAINT uq_patrol_checkpoint_identity UNIQUE (id, tenant_id, site_id),
    CONSTRAINT fk_patrol_checkpoint_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_checkpoints_site_active
    ON patrol_checkpoints (tenant_id, site_id, active, code);

CREATE TABLE patrol_routes (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    route_code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_route_code UNIQUE (tenant_id, site_id, route_code),
    CONSTRAINT uq_patrol_route_identity UNIQUE (id, tenant_id, site_id),
    CONSTRAINT fk_patrol_route_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_routes_site_active ON patrol_routes (tenant_id, site_id, active, route_code);

CREATE TABLE patrol_route_versions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    route_id UUID NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    name VARCHAR(150) NOT NULL,
    change_reason VARCHAR(500) NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_route_version UNIQUE (tenant_id, route_id, version),
    CONSTRAINT uq_patrol_route_version_identity UNIQUE (id, tenant_id, route_id, version),
    CONSTRAINT fk_patrol_route_version_route FOREIGN KEY (route_id, tenant_id)
        REFERENCES patrol_routes(id, tenant_id) ON DELETE RESTRICT
);

ALTER TABLE patrol_routes
    ADD CONSTRAINT fk_patrol_route_current_version
    FOREIGN KEY (tenant_id, id, current_version)
    REFERENCES patrol_route_versions(tenant_id, route_id, version)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE patrol_route_version_checkpoints (
    tenant_id UUID NOT NULL,
    route_version_id UUID NOT NULL,
    checkpoint_id UUID NOT NULL,
    site_id UUID NOT NULL,
    sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
    planned_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (planned_offset_minutes >= 0),
    PRIMARY KEY (tenant_id, route_version_id, sequence_no),
    CONSTRAINT uq_patrol_route_version_checkpoint UNIQUE (tenant_id, route_version_id, checkpoint_id),
    CONSTRAINT fk_patrol_route_checkpoint_version FOREIGN KEY (route_version_id, tenant_id)
        REFERENCES patrol_route_versions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_route_checkpoint_checkpoint FOREIGN KEY (checkpoint_id, tenant_id, site_id)
        REFERENCES patrol_checkpoints(id, tenant_id, site_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_route_checkpoint_order
    ON patrol_route_version_checkpoints (tenant_id, route_version_id, sequence_no);

CREATE TABLE patrol_rounds (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID NOT NULL,
    route_id UUID,
    route_version INTEGER,
    guard_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    client_mutation_id VARCHAR(64) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    client_captured_at TIMESTAMPTZ NOT NULL,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_round_mutation UNIQUE (tenant_id, client_mutation_id),
    CONSTRAINT fk_patrol_round_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_round_route FOREIGN KEY (route_id, tenant_id, site_id)
        REFERENCES patrol_routes(id, tenant_id, site_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_round_route_version FOREIGN KEY (tenant_id, route_id, route_version)
        REFERENCES patrol_route_versions(tenant_id, route_id, version) ON DELETE RESTRICT,
    CONSTRAINT ck_patrol_round_completion CHECK (
        (status = 'in_progress' AND completed_at IS NULL) OR
        (status IN ('completed', 'abandoned') AND completed_at IS NOT NULL)
    )
);
CREATE INDEX ix_patrol_rounds_site_status ON patrol_rounds (tenant_id, site_id, status, started_at DESC);
CREATE INDEX ix_patrol_rounds_guard_time ON patrol_rounds (tenant_id, guard_user_id, started_at DESC);

ALTER TABLE patrol_scans
    ADD COLUMN checkpoint_uuid UUID,
    ADD COLUMN round_id UUID,
    ADD COLUMN checkpoint_token_version INTEGER,
    ADD COLUMN client_captured_at TIMESTAMPTZ,
    ADD COLUMN server_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN payload_hash CHAR(64),
    ADD COLUMN verification_status VARCHAR(16) NOT NULL DEFAULT 'verified'
        CHECK (verification_status IN ('verified', 'manual', 'rejected')),
    ADD CONSTRAINT fk_patrol_scan_checkpoint FOREIGN KEY (checkpoint_uuid, tenant_id, site_id)
        REFERENCES patrol_checkpoints(id, tenant_id, site_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_patrol_scan_round FOREIGN KEY (round_id, tenant_id)
        REFERENCES patrol_rounds(id, tenant_id) ON DELETE RESTRICT;
CREATE INDEX ix_patrol_scans_site_time ON patrol_scans (tenant_id, site_id, scanned_at DESC);
CREATE INDEX ix_patrol_scans_checkpoint_time ON patrol_scans (tenant_id, checkpoint_uuid, scanned_at DESC);
CREATE INDEX ix_patrol_scans_round ON patrol_scans (tenant_id, round_id, scanned_at);

CREATE TABLE patrol_exceptions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL,
    round_id UUID,
    scan_id UUID,
    checkpoint_id UUID,
    category VARCHAR(32) NOT NULL CHECK (category IN (
        'missed_checkpoint', 'late_checkpoint', 'access_blocked', 'hazard', 'damage', 'other'
    )),
    severity VARCHAR(12) NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'critical')),
    description TEXT NOT NULL,
    client_mutation_id VARCHAR(64) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    client_captured_at TIMESTAMPTZ NOT NULL,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_exception_mutation UNIQUE (tenant_id, client_mutation_id),
    CONSTRAINT fk_patrol_exception_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_exception_round FOREIGN KEY (round_id, tenant_id)
        REFERENCES patrol_rounds(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_exception_scan FOREIGN KEY (scan_id, tenant_id)
        REFERENCES patrol_scans(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_exception_checkpoint FOREIGN KEY (checkpoint_id, tenant_id, site_id)
        REFERENCES patrol_checkpoints(id, tenant_id, site_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_exceptions_site_time ON patrol_exceptions (tenant_id, site_id, created_at DESC);
CREATE INDEX ix_patrol_exceptions_category_time ON patrol_exceptions (tenant_id, category, created_at DESC);

CREATE TABLE patrol_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    site_id UUID,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    entity_type VARCHAR(24) NOT NULL CHECK (entity_type IN (
        'checkpoint', 'route', 'route_version', 'round', 'scan', 'exception'
    )),
    entity_id UUID NOT NULL,
    action VARCHAR(32) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_patrol_event_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_events_entity_history
    ON patrol_events (tenant_id, entity_type, entity_id, occurred_at, id);

DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'patrol_checkpoints', 'patrol_routes', 'patrol_route_versions',
        'patrol_route_version_checkpoints', 'patrol_rounds',
        'patrol_exceptions', 'patrol_events'
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

CREATE OR REPLACE FUNCTION prevent_patrol_history_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Patrol scans, route versions, exceptions and audit events are append-only.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_patrol_scans_immutable
    BEFORE UPDATE OR DELETE ON patrol_scans
    FOR EACH ROW EXECUTE FUNCTION prevent_patrol_history_tampering();
CREATE TRIGGER trg_patrol_route_versions_immutable
    BEFORE UPDATE OR DELETE ON patrol_route_versions
    FOR EACH ROW EXECUTE FUNCTION prevent_patrol_history_tampering();
CREATE TRIGGER trg_patrol_route_checkpoints_immutable
    BEFORE UPDATE OR DELETE ON patrol_route_version_checkpoints
    FOR EACH ROW EXECUTE FUNCTION prevent_patrol_history_tampering();
CREATE TRIGGER trg_patrol_exceptions_immutable
    BEFORE UPDATE OR DELETE ON patrol_exceptions
    FOR EACH ROW EXECUTE FUNCTION prevent_patrol_history_tampering();
CREATE TRIGGER trg_patrol_events_immutable
    BEFORE UPDATE OR DELETE ON patrol_events
    FOR EACH ROW EXECUTE FUNCTION prevent_patrol_history_tampering();

REVOKE ALL ON patrol_checkpoints, patrol_routes, patrol_route_versions,
    patrol_route_version_checkpoints, patrol_rounds, patrol_scans,
    patrol_exceptions, patrol_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON patrol_checkpoints, patrol_routes, patrol_rounds TO secops_app_user;
GRANT SELECT, INSERT ON patrol_route_versions, patrol_route_version_checkpoints,
    patrol_exceptions, patrol_events TO secops_app_user;
GRANT SELECT, INSERT ON patrol_scans TO secops_app_user;
REVOKE UPDATE, DELETE ON patrol_scans FROM secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('patrol:read', 'patrol', 'Kontrollgänge, Routen und Abweichungen lesen'),
    ('patrol:manage', 'patrol', 'Kontrollpunkte und versionierte Routen verwalten'),
    ('patrol:exception:create', 'patrol', 'Kontrollgangsabweichungen erfassen'),
    ('patrol:audit', 'patrol', 'Revisionsereignisse der Kontrollgänge lesen')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON
    (r.name IN ('Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Objektleitung')
        AND p.code IN ('patrol:read', 'patrol:create', 'patrol:manage', 'patrol:exception:create', 'patrol:audit'))
    OR (r.name = 'Wachdienstmitarbeiter'
        AND p.code IN ('patrol:read', 'patrol:create', 'patrol:exception:create'))
    OR (r.name = 'Qualitätsmanagement' AND p.code IN ('patrol:read', 'patrol:audit'))
    OR (r.name = 'Auditor' AND p.code IN ('patrol:read', 'patrol:audit'))
ON CONFLICT DO NOTHING;
