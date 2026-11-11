-- Sites are archived, never physically deleted: operational tables retain their references.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS revision_version INT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_sites_tenant_archive_name ON sites (tenant_id, archived_at, name);

-- Granular permissions are additive; existing tenant RLS and table grants remain unchanged.
INSERT INTO permissions (code, module, description) VALUES
  ('sites:update', 'sites', 'Erlaubt das Bearbeiten von Standorten'),
  ('sites:archive', 'sites', 'Erlaubt das Archivieren von Standorten'),
  ('sites:restore', 'sites', 'Erlaubt das Wiederherstellen archivierter Standorte')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Einsatzleitung' AND p.code IN ('sites:update', 'sites:archive', 'sites:restore')
ON CONFLICT DO NOTHING;
