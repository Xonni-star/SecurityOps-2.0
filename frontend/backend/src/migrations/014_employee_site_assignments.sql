CREATE TABLE employee_site_assignments (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    site_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, employee_id, site_id),
    CONSTRAINT fk_employee_site_assignment_employee
        FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_employee_site_assignment_site
        FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE
);

-- A non-null employee_id records an explicit site association, including completed historical shifts.
INSERT INTO employee_site_assignments (tenant_id, employee_id, site_id)
SELECT DISTINCT tenant_id, employee_id, site_id
FROM shifts
WHERE employee_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX ix_employee_site_assignments_site
    ON employee_site_assignments (tenant_id, site_id, employee_id);

ALTER TABLE employee_site_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_site_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_permissive ON employee_site_assignments AS PERMISSIVE FOR ALL TO PUBLIC
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

GRANT SELECT, INSERT, DELETE ON employee_site_assignments TO secops_app_user;
