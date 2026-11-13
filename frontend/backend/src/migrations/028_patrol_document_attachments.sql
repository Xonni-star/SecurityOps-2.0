CREATE TABLE patrol_attachments (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL,
    round_id UUID NOT NULL,
    document_id UUID NOT NULL,
    linked_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_attachment_round_document UNIQUE (tenant_id, round_id, document_id),
    CONSTRAINT fk_patrol_attachment_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_attachment_round FOREIGN KEY (round_id, tenant_id)
        REFERENCES patrol_rounds(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_attachment_document FOREIGN KEY (document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_patrol_attachments_round
    ON patrol_attachments (tenant_id, round_id, created_at);

ALTER TABLE patrol_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_permissive ON patrol_attachments
    AS PERMISSIVE FOR ALL TO PUBLIC
    USING (
        current_setting('app.current_tenant', true) IS NOT NULL
        AND current_setting('app.current_tenant', true) <> ''
        AND tenant_id = current_setting('app.current_tenant', true)::uuid
    )
    WITH CHECK (
        current_setting('app.current_tenant', true) IS NOT NULL
        AND current_setting('app.current_tenant', true) <> ''
        AND tenant_id = current_setting('app.current_tenant', true)::uuid
    );

CREATE TRIGGER trg_patrol_attachments_immutable
    BEFORE UPDATE OR DELETE ON patrol_attachments
    FOR EACH ROW EXECUTE FUNCTION prevent_patrol_history_tampering();

REVOKE ALL ON patrol_attachments FROM PUBLIC;
GRANT SELECT, INSERT ON patrol_attachments TO secops_app_user;
