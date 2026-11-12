-- Split customer write privileges without changing existing effective access.
-- Roles that previously had customers:create (the legacy permission for create,
-- update and archive) receive the matching explicit action permissions.
INSERT INTO permissions (code, module, description)
VALUES
  ('customers:update', 'customers', 'Erlaubt customers:update'),
  ('customers:archive', 'customers', 'Erlaubt customers:archive')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT legacy.role_id, explicit_permission.id
FROM role_permissions legacy
JOIN permissions create_permission ON create_permission.id = legacy.permission_id
JOIN permissions explicit_permission ON explicit_permission.code IN ('customers:update', 'customers:archive')
WHERE create_permission.code = 'customers:create'
ON CONFLICT DO NOTHING;
