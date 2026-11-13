CREATE TABLE patrol_scan_attempts (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    site_id UUID,
    checkpoint_id UUID,
    round_id UUID,
    client_mutation_id VARCHAR(64) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    method VARCHAR(16),
    outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('rejected', 'duplicate')),
    reason_code VARCHAR(32) NOT NULL CHECK (reason_code IN (
        'invalid_payload', 'unassigned_employee', 'round_unavailable', 'unknown_checkpoint',
        'invalid_token', 'stale_token', 'duplicate_scan', 'invalid_capture_time'
    )),
    client_captured_at TIMESTAMPTZ,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_scan_attempt_mutation UNIQUE (tenant_id, client_mutation_id),
    CONSTRAINT fk_patrol_scan_attempt_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_scan_attempts_site_time
    ON patrol_scan_attempts (tenant_id, site_id, server_received_at DESC);
CREATE INDEX ix_patrol_scan_attempts_reason_time
    ON patrol_scan_attempts (tenant_id, reason_code, server_received_at DESC);

ALTER TABLE patrol_scan_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_scan_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_permissive ON patrol_scan_attempts
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
REVOKE ALL ON patrol_scan_attempts FROM PUBLIC;
GRANT SELECT, INSERT ON patrol_scan_attempts TO secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
    ('patrol:scan-attempt:read', 'patrol', 'Abgewiesene und doppelte Kontrollpunkt-Scans prüfen')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM roles r
JOIN permissions p ON p.code='patrol:scan-attempt:read'
WHERE r.name IN (
    'Systemadministrator', 'Geschäftsführung', 'Einsatzleitung', 'Objektleitung',
    'Qualitätsmanagement', 'Auditor'
)
ON CONFLICT DO NOTHING;
