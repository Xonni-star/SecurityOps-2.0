-- Preserve customer/site relationships: archive instead of physically deleting clients.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS revision_version INT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_clients_active_tenant ON clients (tenant_id, company_name) WHERE archived_at IS NULL;
