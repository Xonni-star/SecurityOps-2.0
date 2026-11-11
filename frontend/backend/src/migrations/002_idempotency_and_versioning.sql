-- ==============================================================================
-- SECURITYOPS 2.0: MIGRATION 002 - IDEMPOTENZ & ATOMARER VERSIONSSCHUTZ
-- ==============================================================================

-- 1. Sicherstellen, dass revision_version auf allen veränderlichen Tabellen existiert
ALTER TABLE IF EXISTS shifts ADD COLUMN IF NOT EXISTS revision_version INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS revision_version INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS keys ADD COLUMN IF NOT EXISTS revision_version INT NOT NULL DEFAULT 1;

-- 2. Sicherstellen, dass client_mutation_id auf allen relevanten Tabellen existiert
ALTER TABLE IF EXISTS clients ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS sites ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS shifts ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS guardbook_entries ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS guardbook_revisions ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS keys ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS patrol_scans ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE IF EXISTS shift_handovers ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);

-- 3. Idempotente Unique Constraints für client_mutation_id
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_shifts_client_mutation') THEN
        ALTER TABLE shifts ADD CONSTRAINT uq_shifts_client_mutation UNIQUE (tenant_id, client_mutation_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_tasks_client_mutation') THEN
        ALTER TABLE tasks ADD CONSTRAINT uq_tasks_client_mutation UNIQUE (tenant_id, client_mutation_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_keys_client_mutation') THEN
        ALTER TABLE keys ADD CONSTRAINT uq_keys_client_mutation UNIQUE (tenant_id, client_mutation_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_guardbook_client_mutation') THEN
        ALTER TABLE guardbook_entries ADD CONSTRAINT uq_guardbook_client_mutation UNIQUE (tenant_id, client_mutation_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_revisions_client_mutation') THEN
        ALTER TABLE guardbook_revisions ADD CONSTRAINT uq_revisions_client_mutation UNIQUE (tenant_id, client_mutation_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_patrol_client_mutation') THEN
        ALTER TABLE patrol_scans ADD CONSTRAINT uq_patrol_client_mutation UNIQUE (tenant_id, client_mutation_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_handover_client_mutation') THEN
        ALTER TABLE shift_handovers ADD CONSTRAINT uq_handover_client_mutation UNIQUE (tenant_id, client_mutation_id);
    END IF;
END $$;

-- 4. Idempotenz-Quittungstabelle sicherstellen
CREATE TABLE IF NOT EXISTS sync_idempotency_receipts (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_mutation_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL,
    server_id VARCHAR(64) NOT NULL,
    server_version INT NOT NULL,
    response_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, client_mutation_id)
);

ALTER TABLE sync_idempotency_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_idempotency_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_permissive ON sync_idempotency_receipts;
CREATE POLICY tenant_isolation_permissive ON sync_idempotency_receipts
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

GRANT SELECT, INSERT, UPDATE ON sync_idempotency_receipts TO secops_app_user;
