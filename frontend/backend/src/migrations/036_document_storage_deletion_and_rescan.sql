ALTER TABLE document_versions
    ADD COLUMN storage_deletion_pending_at TIMESTAMPTZ,
    ADD CONSTRAINT ck_document_versions_pending_deletion_not_released
        CHECK (storage_deletion_pending_at IS NULL OR released_at IS NULL),
    ADD CONSTRAINT ck_document_versions_deleted_not_pending
        CHECK (storage_deleted_at IS NULL OR storage_deletion_pending_at IS NULL);

CREATE TABLE document_storage_deletion_outbox (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    document_id UUID NOT NULL,
    version_number INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error_code VARCHAR(40),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, document_id, version_number),
    CONSTRAINT fk_document_storage_deletion_document
        FOREIGN KEY (document_id, tenant_id)
        REFERENCES documents(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_document_storage_deletion_version
        FOREIGN KEY (tenant_id, document_id, version_number)
        REFERENCES document_versions(tenant_id, document_id, version_number) ON DELETE RESTRICT
);
CREATE INDEX ix_document_storage_deletion_pending
    ON document_storage_deletion_outbox (tenant_id, requested_at)
    WHERE completed_at IS NULL;

ALTER TABLE document_storage_deletion_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_storage_deletion_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_permissive ON document_storage_deletion_outbox
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
CREATE POLICY app_request_scope ON document_storage_deletion_outbox
    AS RESTRICTIVE FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM documents document
             WHERE document.id = document_storage_deletion_outbox.document_id
               AND document.tenant_id = document_storage_deletion_outbox.tenant_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM documents document
             WHERE document.id = document_storage_deletion_outbox.document_id
               AND document.tenant_id = document_storage_deletion_outbox.tenant_id
        )
    );

ALTER TABLE document_audit_events
    DROP CONSTRAINT document_audit_events_action_check,
    ADD CONSTRAINT document_audit_events_action_check
        CHECK (action IN (
            'created', 'uploaded', 'downloaded', 'updated', 'version_created',
            'version_restored', 'archived', 'restored', 'approved', 'published',
            'moved', 'relationship_changed', 'scan_pending', 'scan_clean',
            'scan_infected', 'scan_unavailable', 'scan_error', 'scan_not_configured',
            'scan_retry_started', 'files_deleted', 'file_deletion_requested',
            'file_deletion_attempted', 'file_deletion_failed', 'file_storage_deleted'
        ));

REVOKE ALL ON document_storage_deletion_outbox FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON document_storage_deletion_outbox TO secops_app_user;
