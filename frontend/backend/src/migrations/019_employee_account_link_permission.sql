INSERT INTO permissions (code, module, description)
VALUES (
    'employees:account:link',
    'employees',
    'Erlaubt vertrauenswürdigen Personalverwaltern die Zuordnung von Mitarbeiterkonten'
)
ON CONFLICT (code) DO NOTHING;

DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.id
  AND rp.role_id = r.id
  AND p.code = 'employees:account:link'
  AND r.name <> 'Personalverwaltung';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'employees:account:link'
WHERE r.name = 'Personalverwaltung'
ON CONFLICT DO NOTHING;
