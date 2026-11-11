-- ==============================================================================
-- SECURITYOPS 2.0: MIGRATION 003 - TRENNUNG VON PUSH- UND KONFLIKT-QUITTUNGEN
-- ==============================================================================

-- Dedizierte Tabelle für Konfliktauflösungs-Quittungen
-- Verhindert Kollisionen zwischen vorangegangener Push-Quittung (Status: CONFLICT)
-- und nachfolgender, legitimer Konfliktauflösung derselben client_mutation_id.
CREATE TABLE IF NOT EXISTS sync_conflict_resolution_receipts (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_mutation_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    strategy VARCHAR(20) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    server_version INT NOT NULL,
    response_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, client_mutation_id)
);

-- RLS aktivieren und erzwingen
ALTER TABLE sync_conflict_resolution_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflict_resolution_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_permissive ON sync_conflict_resolution_receipts;
CREATE POLICY tenant_isolation_permissive ON sync_conflict_resolution_receipts
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (
        current_setting('app.current_tenant', true) IS NOT NULL 
        AND current_setting('app.current_tenant', true) != ''
        AND tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.current_tenant', true) IS NOT NULL 
        AND current_setting('app.current_tenant', true) != ''
        AND tenant_id = current_setting('app.current_tenant', true)::uuid
    );

-- Least-Privilege Rechte für secops_app_user
GRANT SELECT, INSERT, UPDATE ON sync_conflict_resolution_receipts TO secops_app_user;
