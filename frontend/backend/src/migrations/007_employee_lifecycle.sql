-- Employee lifecycle is soft-delete only; operational foreign keys remain intact.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS revision_version INT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_employees_tenant_archive_name ON employees (tenant_id, archived_at, last_name, first_name);

ALTER TABLE employee_qualifications ADD COLUMN IF NOT EXISTS revision_version INT NOT NULL DEFAULT 1;
ALTER TABLE employee_qualifications ADD COLUMN IF NOT EXISTS client_mutation_id VARCHAR(64);
ALTER TABLE employee_qualifications ADD COLUMN IF NOT EXISTS document_reference VARCHAR(255);
ALTER TABLE employee_qualifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'VALID';
ALTER TABLE employee_qualifications ALTER COLUMN issue_date DROP NOT NULL;
ALTER TABLE employee_qualifications ALTER COLUMN certificate_number DROP NOT NULL;
ALTER TABLE employee_qualifications ADD CONSTRAINT employee_qualifications_status_check CHECK (status IN ('VALID', 'EXPIRED', 'PENDING'));
UPDATE employee_qualifications SET status = CASE WHEN verified = false THEN 'PENDING' WHEN expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE THEN 'EXPIRED' ELSE 'VALID' END;
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_qualification_mutation ON employee_qualifications (tenant_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_absences (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  absence_type VARCHAR(30) NOT NULL CHECK (absence_type IN ('VACATION', 'SICKNESS', 'OTHER')),
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  notes TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  revision_version INT NOT NULL DEFAULT 1,
  client_mutation_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, tenant_id),
  CONSTRAINT employee_absence_date_order CHECK (date_to >= date_from),
  CONSTRAINT fk_employee_absence_tenant FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT uq_employee_absence_mutation UNIQUE (tenant_id, client_mutation_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_absences_employee_dates ON employee_absences (tenant_id, employee_id, date_from, date_to);

ALTER TABLE employee_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_absences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_permissive ON employee_absences;
CREATE POLICY tenant_isolation_permissive ON employee_absences AS PERMISSIVE FOR ALL TO PUBLIC
  USING (current_setting('app.current_tenant', true) IS NOT NULL AND current_setting('app.current_tenant', true) <> '' AND tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (current_setting('app.current_tenant', true) IS NOT NULL AND current_setting('app.current_tenant', true) <> '' AND tenant_id = current_setting('app.current_tenant', true)::uuid);
GRANT SELECT, INSERT, UPDATE ON employee_absences TO secops_app_user;

INSERT INTO permissions (code, module, description) VALUES
  ('employees:create', 'employees', 'Erlaubt das Anlegen von Mitarbeitern'),
  ('employees:update', 'employees', 'Erlaubt das Bearbeiten von Mitarbeitern'),
  ('employees:archive', 'employees', 'Erlaubt das Archivieren von Mitarbeitern'),
  ('employees:restore', 'employees', 'Erlaubt das Wiederherstellen archivierter Mitarbeiter'),
  ('qualifications:manage', 'employees', 'Erlaubt das Verwalten von Qualifikationen'),
  ('employees:absence:manage', 'employees', 'Erlaubt das Beantragen und Bearbeiten von Abwesenheiten'),
  ('employees:absence:approve', 'employees', 'Erlaubt das Freigeben oder Ablehnen von Abwesenheiten')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('Einsatzleitung', 'Personalverwaltung') AND p.code IN ('employees:create','employees:update','employees:archive','employees:restore','qualifications:manage','employees:absence:manage','employees:absence:approve')
ON CONFLICT DO NOTHING;
