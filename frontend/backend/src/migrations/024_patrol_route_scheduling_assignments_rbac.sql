ALTER TABLE patrol_route_versions
    ADD COLUMN time_window_start TIME,
    ADD COLUMN time_window_end TIME,
    ADD COLUMN recurrence_frequency VARCHAR(8) NOT NULL DEFAULT 'none'
        CHECK (recurrence_frequency IN ('none', 'daily', 'weekly')),
    ADD COLUMN recurrence_interval INTEGER NOT NULL DEFAULT 1
        CHECK (recurrence_interval BETWEEN 1 AND 365),
    ADD COLUMN recurrence_days SMALLINT[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT ck_patrol_route_version_time_window_pair
        CHECK ((time_window_start IS NULL) = (time_window_end IS NULL)),
    ADD CONSTRAINT ck_patrol_route_version_recurrence_days
        CHECK (
            (recurrence_frequency = 'weekly' AND cardinality(recurrence_days) BETWEEN 1 AND 7
                AND recurrence_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[])
            OR (recurrence_frequency <> 'weekly' AND cardinality(recurrence_days) = 0)
        ),
    ADD CONSTRAINT uq_patrol_route_version_route_site UNIQUE (tenant_id, id, route_id);

CREATE TABLE patrol_route_version_assignments (
    tenant_id UUID NOT NULL,
    route_version_id UUID NOT NULL,
    route_id UUID NOT NULL,
    site_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, route_version_id, employee_id),
    CONSTRAINT fk_patrol_route_assignment_version
        FOREIGN KEY (tenant_id, route_version_id, route_id)
        REFERENCES patrol_route_versions(tenant_id, id, route_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_route_assignment_site
        FOREIGN KEY (tenant_id, route_id, site_id)
        REFERENCES patrol_routes(tenant_id, id, site_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_route_assignment_employee_site
        FOREIGN KEY (tenant_id, employee_id, site_id)
        REFERENCES employee_site_assignments(tenant_id, employee_id, site_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_route_assignments_employee
    ON patrol_route_version_assignments (tenant_id, employee_id, route_version_id);

ALTER TABLE patrol_route_version_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_route_version_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_permissive ON patrol_route_version_assignments
    AS PERMISSIVE FOR ALL TO PUBLIC
    USING (
        current_setting('app.current_tenant', true) IS NOT NULL
        AND current_setting('app.current_tenant', true) <> ''
        AND tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.current_tenant', true) IS NOT NULL
        AND current_setting('app.current_tenant', true) <> ''
        AND tenant_id = current_setting('app.current_tenant', true)::uuid
    );
REVOKE ALL ON patrol_route_version_assignments FROM PUBLIC;
GRANT SELECT, INSERT ON patrol_route_version_assignments TO secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('patrol:dashboard:read', 'patrol', 'Kontrollgang-Dashboard und Kennzahlen lesen'),
    ('patrol:checkpoint:read', 'patrol', 'Kontrollpunkte lesen'),
    ('patrol:checkpoint:manage', 'patrol', 'Kontrollpunkte verwalten'),
    ('patrol:route:read', 'patrol', 'Kontrollrouten lesen'),
    ('patrol:route:manage', 'patrol', 'Kontrollrouten verwalten'),
    ('patrol:round:read', 'patrol', 'Kontrollgänge lesen'),
    ('patrol:round:start', 'patrol', 'Kontrollgänge starten'),
    ('patrol:round:perform', 'patrol', 'Kontrollgänge durchführen und synchronisieren'),
    ('patrol:round:complete', 'patrol', 'Kontrollgänge abschließen'),
    ('patrol:exception:read', 'patrol', 'Kontrollgangsabweichungen lesen'),
    ('patrol:history:read', 'patrol', 'Kontrollgangshistorie lesen'),
    ('patrol:analytics:read', 'patrol', 'Kontrollgangsauswertungen lesen')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON
    (r.name IN ('Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Objektleitung')
        AND p.code IN (
            'patrol:dashboard:read', 'patrol:checkpoint:read', 'patrol:checkpoint:manage',
            'patrol:route:read', 'patrol:route:manage', 'patrol:round:read',
            'patrol:round:start', 'patrol:round:perform', 'patrol:round:complete',
            'patrol:exception:read', 'patrol:exception:create', 'patrol:history:read',
            'patrol:analytics:read', 'patrol:audit'
        ))
    OR (r.name = 'Wachdienstmitarbeiter'
        AND p.code IN (
            'patrol:checkpoint:read', 'patrol:route:read', 'patrol:round:read',
            'patrol:round:start', 'patrol:round:perform', 'patrol:round:complete',
            'patrol:exception:read', 'patrol:exception:create'
        ))
    OR (r.name IN ('Qualitätsmanagement', 'Auditor')
        AND p.code IN (
            'patrol:dashboard:read', 'patrol:checkpoint:read', 'patrol:route:read',
            'patrol:round:read', 'patrol:exception:read', 'patrol:history:read',
            'patrol:analytics:read', 'patrol:audit'
        ))
ON CONFLICT DO NOTHING;
