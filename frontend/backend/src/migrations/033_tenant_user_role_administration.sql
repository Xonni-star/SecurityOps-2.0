ALTER TABLE users
    ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN last_login_at TIMESTAMPTZ;

CREATE TABLE tenant_memberships (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_locked BOOLEAN NOT NULL DEFAULT false,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, user_id)
);

INSERT INTO tenant_memberships (tenant_id, user_id, first_name, last_name, phone)
SELECT DISTINCT assignments.tenant_id, assignments.user_id, u.first_name, u.last_name, u.phone
FROM (
    SELECT tenant_id,user_id FROM user_roles
    UNION
    SELECT tenant_id,user_id FROM user_sessions
) assignments
JOIN users u ON u.id = assignments.user_id
ON CONFLICT DO NOTHING;

ALTER TABLE user_roles
    ADD CONSTRAINT fk_user_roles_tenant_membership
        FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE;
ALTER TABLE user_sessions
    ADD CONSTRAINT fk_user_sessions_tenant_membership
        FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE;

CREATE TABLE tenant_roles (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_tenant_roles_name UNIQUE (tenant_id, name)
);

INSERT INTO tenant_roles (tenant_id,name,description)
SELECT t.id,defaults.name,defaults.description
FROM tenants t
CROSS JOIN (VALUES
    ('Mandantenadministrator','Mandantenbezogene Benutzer- und Rollenverwaltung'),
    ('Geschäftsführung','Konfigurierbare Leitungsrolle'),
    ('Einsatzleitung','Konfigurierbare Einsatzleitungsrolle'),
    ('Objektleitung','Konfigurierbare Objektleitungsrolle'),
    ('Disposition','Konfigurierbare Dispositionsrolle'),
    ('Personalverwaltung','Konfigurierbare Personalverwaltungsrolle'),
    ('Mitarbeiter','Konfigurierbare Mitarbeitendenrolle'),
    ('Sicherheitsmitarbeiter','Konfigurierbare Sicherheitsmitarbeitendenrolle'),
    ('Revisor/Auditor','Konfigurierbare revisionsorientierte Leserolle')
) AS defaults(name,description)
ON CONFLICT (tenant_id,name) DO NOTHING;

CREATE TABLE tenant_role_permissions (
    tenant_id UUID NOT NULL,
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    site_id UUID,
    data_scope VARCHAR(16) NOT NULL DEFAULT 'TENANT'
        CHECK (data_scope IN ('TENANT', 'SITE', 'OWN')),
    can_delegate BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant_role_permissions_role
        FOREIGN KEY (role_id, tenant_id) REFERENCES tenant_roles(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_tenant_role_permissions_site
        FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT ck_tenant_role_permissions_scope
        CHECK ((data_scope = 'SITE' AND site_id IS NOT NULL) OR (data_scope <> 'SITE' AND site_id IS NULL))
);

CREATE UNIQUE INDEX uq_tenant_role_permission_scope
    ON tenant_role_permissions (tenant_id, role_id, permission_id, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE tenant_user_roles (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role_id UUID NOT NULL,
    site_id UUID,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_tenant_user_roles_membership
        FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE,
    CONSTRAINT fk_tenant_user_roles_role
        FOREIGN KEY (role_id, tenant_id) REFERENCES tenant_roles(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_tenant_user_roles_site
        FOREIGN KEY (site_id, tenant_id) REFERENCES sites(id, tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_tenant_user_role_scope
    ON tenant_user_roles (tenant_id, user_id, role_id, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX ix_tenant_user_roles_user ON tenant_user_roles (tenant_id, user_id);

CREATE TABLE user_password_reset_tokens (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_user_password_reset_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_user_password_reset_membership
        FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships(tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX ix_user_password_reset_open
    ON user_password_reset_tokens (tenant_id, user_id, expires_at)
    WHERE consumed_at IS NULL;

INSERT INTO permissions (code, module, description) VALUES
    ('users:read', 'users', 'Benutzer des aktuellen Mandanten lesen'),
    ('users:manage', 'users', 'Benutzerkonten und Mandantenzuordnungen verwalten'),
    ('roles:read', 'roles', 'Rollen und Berechtigungen des aktuellen Mandanten lesen'),
    ('roles:manage', 'roles', 'Mandanteneigene Rollen und delegierbare Berechtigungen verwalten'),
    ('roles:delegate_admin', 'roles', 'Administrative Berechtigungen delegieren')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (name, description) VALUES
    ('Mandantenadministrator', 'Administriert Benutzer und Rollen ausschließlich im zugeordneten Mandanten')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('Systemadministrator', 'Mandantenadministrator')
  AND p.code IN ('users:read', 'users:manage', 'roles:read', 'roles:manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'roles:delegate_admin'
WHERE r.name = 'Systemadministrator'
ON CONFLICT DO NOTHING;

INSERT INTO tenant_roles (tenant_id,name,description,is_system_role)
SELECT DISTINCT ur.tenant_id,r.name,r.description,(r.name='Systemadministrator')
FROM user_roles ur
JOIN roles r ON r.id=ur.role_id
ON CONFLICT (tenant_id,name) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id,role_id,permission_id,site_id,data_scope,can_delegate)
SELECT DISTINCT ur.tenant_id,tr.id,rp.permission_id,NULL::uuid,'TENANT',false
FROM user_roles ur
JOIN roles r ON r.id=ur.role_id
JOIN tenant_roles tr ON tr.tenant_id=ur.tenant_id AND tr.name=r.name
JOIN role_permissions rp ON rp.role_id=r.id
JOIN permissions p ON p.id=rp.permission_id
WHERE p.code <> 'roles:delegate_admin'
ON CONFLICT DO NOTHING;

INSERT INTO tenant_user_roles (tenant_id,user_id,role_id,site_id,assigned_by)
SELECT ur.tenant_id,ur.user_id,tr.id,NULL,NULL
FROM user_roles ur
JOIN roles r ON r.id=ur.role_id
JOIN tenant_roles tr ON tr.tenant_id=ur.tenant_id AND tr.name=r.name
ON CONFLICT DO NOTHING;

DELETE FROM user_roles ur
USING users u
WHERE u.id=ur.user_id
  AND u.is_superadmin=false;

DO $$
DECLARE
    tbl TEXT;
    rbac_tables TEXT[] := ARRAY[
        'tenant_memberships',
        'tenant_roles',
        'tenant_role_permissions',
        'tenant_user_roles',
        'user_password_reset_tokens'
    ];
BEGIN
    FOREACH tbl IN ARRAY rbac_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_permissive ON %I AS PERMISSIVE FOR ALL TO PUBLIC
             USING (current_setting(''app.current_tenant'', true) IS NOT NULL
                    AND current_setting(''app.current_tenant'', true) <> ''''
                    AND tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)
             WITH CHECK (current_setting(''app.current_tenant'', true) IS NOT NULL
                         AND current_setting(''app.current_tenant'', true) <> ''''
                         AND tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)',
            tbl
        );
    END LOOP;
END $$;

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_permissive ON user_roles
    AS PERMISSIVE FOR ALL TO PUBLIC
    USING (
        current_setting('app.current_tenant', true) IS NOT NULL
        AND current_setting('app.current_tenant', true) <> ''
        AND tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
    WITH CHECK (
        current_setting('app.current_tenant', true) IS NOT NULL
        AND current_setting('app.current_tenant', true) <> ''
        AND tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    );
CREATE POLICY user_role_login_lookup ON user_roles
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_permissive ON user_sessions
    AS PERMISSIVE FOR ALL TO PUBLIC
    USING (
        current_setting('app.current_tenant', true) IS NOT NULL
        AND current_setting('app.current_tenant', true) <> ''
        AND tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
    WITH CHECK (
        current_setting('app.current_tenant', true) IS NOT NULL
        AND current_setting('app.current_tenant', true) <> ''
        AND tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    );
CREATE POLICY user_session_token_lookup ON user_sessions
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (
        current_setting('app.session_lookup_hash', true) IS NOT NULL
        AND token_hash = current_setting('app.session_lookup_hash', true)
    );
CREATE POLICY user_session_self_lookup ON user_sessions
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );
CREATE POLICY user_session_self_revoke ON user_sessions
    AS PERMISSIVE FOR UPDATE TO PUBLIC
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
    WITH CHECK (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );

CREATE POLICY user_membership_login_lookup ON tenant_memberships
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );

REVOKE ALL ON tenant_memberships, tenant_roles, tenant_role_permissions, tenant_user_roles,
    user_password_reset_tokens FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_memberships, tenant_roles, tenant_role_permissions,
    tenant_user_roles TO secops_app_user;
GRANT SELECT, INSERT, UPDATE ON user_password_reset_tokens TO secops_app_user;
REVOKE UPDATE ON user_sessions FROM secops_app_user;
GRANT UPDATE (revoked) ON user_sessions TO secops_app_user;
