CREATE TABLE patrol_employee_groups (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL,
    name VARCHAR(120) NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_employee_group_scope UNIQUE (tenant_id, id, site_id),
    CONSTRAINT uq_patrol_employee_group_name UNIQUE (tenant_id, site_id, name),
    CONSTRAINT fk_patrol_employee_group_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_employee_groups_site
    ON patrol_employee_groups (tenant_id, site_id, archived_at, lower(name));

CREATE TABLE patrol_employee_group_members (
    tenant_id UUID NOT NULL,
    employee_group_id UUID NOT NULL,
    site_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, employee_group_id, employee_id),
    CONSTRAINT fk_patrol_employee_group_member_group
        FOREIGN KEY (tenant_id, employee_group_id, site_id)
        REFERENCES patrol_employee_groups(tenant_id, id, site_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_employee_group_member_employee_site
        FOREIGN KEY (tenant_id, employee_id, site_id)
        REFERENCES employee_site_assignments(tenant_id, employee_id, site_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_employee_group_members_employee
    ON patrol_employee_group_members (tenant_id, employee_id, employee_group_id);

CREATE TABLE patrol_route_version_group_assignments (
    tenant_id UUID NOT NULL,
    route_version_id UUID NOT NULL,
    route_id UUID NOT NULL,
    site_id UUID NOT NULL,
    employee_group_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, route_version_id, employee_group_id),
    CONSTRAINT fk_patrol_route_group_assignment_version
        FOREIGN KEY (tenant_id, route_version_id, route_id)
        REFERENCES patrol_route_versions(tenant_id, id, route_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_route_group_assignment_route_site
        FOREIGN KEY (tenant_id, route_id, site_id)
        REFERENCES patrol_routes(tenant_id, id, site_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_route_group_assignment_group
        FOREIGN KEY (tenant_id, employee_group_id, site_id)
        REFERENCES patrol_employee_groups(tenant_id, id, site_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_route_group_assignments_group
    ON patrol_route_version_group_assignments (tenant_id, employee_group_id, route_version_id);

DO $$
DECLARE tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'patrol_employee_groups',
        'patrol_employee_group_members',
        'patrol_route_version_group_assignments'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_permissive ON %I AS PERMISSIVE FOR ALL TO PUBLIC
             USING (current_setting(''app.current_tenant'', true) IS NOT NULL
                    AND current_setting(''app.current_tenant'', true) <> ''''
                    AND tenant_id = current_setting(''app.current_tenant'', true)::uuid)
             WITH CHECK (current_setting(''app.current_tenant'', true) IS NOT NULL
                         AND current_setting(''app.current_tenant'', true) <> ''''
                         AND tenant_id = current_setting(''app.current_tenant'', true)::uuid)', tbl);
    END LOOP;
END $$;

ALTER TABLE patrol_events
    DROP CONSTRAINT patrol_events_entity_type_check,
    ADD CONSTRAINT ck_patrol_event_entity_type CHECK (entity_type IN (
        'checkpoint', 'route', 'route_version', 'round', 'scan', 'exception', 'employee_group'
    ));

CREATE TRIGGER trg_patrol_route_version_group_assignments_immutable
    BEFORE UPDATE OR DELETE ON patrol_route_version_group_assignments
    FOR EACH ROW EXECUTE FUNCTION prevent_patrol_history_tampering();

REVOKE ALL ON patrol_employee_groups, patrol_employee_group_members,
    patrol_route_version_group_assignments FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON patrol_employee_groups TO secops_app_user;
GRANT SELECT, INSERT, DELETE ON patrol_employee_group_members TO secops_app_user;
GRANT SELECT, INSERT ON patrol_route_version_group_assignments TO secops_app_user;
