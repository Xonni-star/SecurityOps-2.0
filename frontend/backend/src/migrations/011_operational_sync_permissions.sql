-- Split offline operational writes from logbook writes while preserving
-- existing access for roles that had logbook:create.
INSERT INTO permissions (code, module, description)
VALUES
  ('patrol:create', 'patrol', 'Erlaubt Kontrollgang-Scans zu erfassen'),
  ('handover:create', 'handover', 'Erlaubt Schichtübergaben zu erfassen')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT legacy.role_id, operational.id
FROM role_permissions legacy
JOIN permissions legacy_permission ON legacy_permission.id = legacy.permission_id
JOIN permissions operational ON operational.code IN ('patrol:create', 'handover:create')
WHERE legacy_permission.code = 'logbook:create'
ON CONFLICT DO NOTHING;
