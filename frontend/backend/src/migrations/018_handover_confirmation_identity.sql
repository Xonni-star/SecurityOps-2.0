ALTER TABLE employees
    ADD COLUMN account_user_id UUID,
    ADD CONSTRAINT fk_employees_account_user
        FOREIGN KEY (account_user_id) REFERENCES users(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX uq_employees_tenant_account_user
    ON employees (tenant_id, account_user_id)
    WHERE account_user_id IS NOT NULL;

CREATE FUNCTION validate_employee_account_tenant()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.account_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = NEW.account_user_id AND tenant_id = NEW.tenant_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'Employee account must have a role in the same tenant.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employee_account_tenant
BEFORE INSERT OR UPDATE OF account_user_id, tenant_id ON employees
FOR EACH ROW EXECUTE FUNCTION validate_employee_account_tenant();

ALTER TABLE handover_confirmations
    ADD COLUMN payload_hash CHAR(64),
    ADD CONSTRAINT ck_handover_confirmation_payload_hash
        CHECK (payload_hash IS NULL OR payload_hash ~ '^[0-9a-f]{64}$');
