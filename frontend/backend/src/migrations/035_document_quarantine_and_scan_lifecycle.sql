ALTER TABLE documents
    ADD COLUMN site_id UUID;

ALTER TABLE documents
    ADD CONSTRAINT fk_documents_scope_site
        FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT;

UPDATE documents document
   SET site_id = relationship.site_id
  FROM document_relationships relationship
 WHERE relationship.document_id = document.id
   AND relationship.tenant_id = document.tenant_id
   AND relationship.relationship_type = 'site';

CREATE INDEX ix_documents_site_scope ON documents (tenant_id, site_id);

ALTER TABLE document_versions
    ALTER COLUMN storage_key TYPE TEXT USING storage_key::text,
    ALTER COLUMN scan_status SET DEFAULT 'pending',
    ADD COLUMN released_at TIMESTAMPTZ,
    ADD COLUMN scanned_at TIMESTAMPTZ,
    ADD COLUMN scan_error_code VARCHAR(40),
    ADD COLUMN storage_deleted_at TIMESTAMPTZ;

ALTER TABLE document_versions
    DROP CONSTRAINT document_versions_scan_status_check,
    ADD CONSTRAINT document_versions_scan_status_check
        CHECK (scan_status IN ('pending', 'clean', 'infected', 'unavailable', 'error', 'not_scanned')),
    ADD CONSTRAINT ck_document_versions_release_state
        CHECK (released_at IS NULL OR scan_status IN ('clean', 'not_scanned')),
    ADD CONSTRAINT ck_document_versions_deleted_not_released
        CHECK (storage_deleted_at IS NULL OR released_at IS NULL);

UPDATE document_versions
   SET scan_status = 'not_scanned',
       released_at = NULL,
       scan_error_code = 'rescan_required';

UPDATE documents
   SET status = 'In Prüfung',
       approved_by = NULL,
       approved_at = NULL
 WHERE status IN ('Freigegeben', 'Veröffentlicht');

ALTER TABLE document_audit_events
    DROP CONSTRAINT document_audit_events_action_check,
    ADD CONSTRAINT document_audit_events_action_check
        CHECK (action IN (
            'created', 'uploaded', 'downloaded', 'updated', 'version_created',
            'version_restored', 'archived', 'restored', 'approved', 'published',
            'moved', 'relationship_changed', 'scan_pending', 'scan_clean',
            'scan_infected', 'scan_unavailable', 'scan_error', 'scan_not_configured',
            'files_deleted'
        ));

CREATE OR REPLACE FUNCTION prevent_unscanned_document_approval()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('Freigegeben', 'Veröffentlicht') AND NOT EXISTS (
        SELECT 1
          FROM document_versions version
         WHERE version.document_id = NEW.id
           AND version.tenant_id = NEW.tenant_id
           AND version.version_number = NEW.current_version
           AND version.released_at IS NOT NULL
           AND version.storage_deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Dokumentdateien müssen vor der Freigabe erfolgreich geprüft und freigegeben sein.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_require_released_file
BEFORE INSERT OR UPDATE OF status, current_version ON documents
FOR EACH ROW EXECUTE FUNCTION prevent_unscanned_document_approval();

DROP POLICY app_request_scope ON document_versions;
CREATE POLICY app_request_scope ON document_versions AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM documents document
         WHERE document.id = document_versions.document_id
           AND document.tenant_id = document_versions.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM documents document
         WHERE document.id = document_versions.document_id
           AND document.tenant_id = document_versions.tenant_id
    )
);

DROP POLICY app_request_scope ON documents;
CREATE POLICY app_request_scope ON documents AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, responsible_user_id)
    OR EXISTS (
        SELECT 1 FROM document_relationships relationship
         WHERE relationship.document_id = documents.id
           AND relationship.tenant_id = documents.tenant_id
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, responsible_user_id)
    OR EXISTS (
        SELECT 1 FROM document_relationships relationship
         WHERE relationship.document_id = documents.id
           AND relationship.tenant_id = documents.tenant_id
    )
);

DROP POLICY app_request_scope ON document_categories;
CREATE POLICY app_request_scope ON document_categories AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE site.tenant_id = document_categories.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE site.tenant_id = document_categories.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
);

DROP POLICY app_request_scope ON document_folders;
CREATE POLICY app_request_scope ON document_folders AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE site.tenant_id = document_folders.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE site.tenant_id = document_folders.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
);

DROP POLICY app_request_scope ON document_tag_assignments;
CREATE POLICY app_request_scope ON document_tag_assignments AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM documents document
         WHERE document.id = document_tag_assignments.document_id
           AND document.tenant_id = document_tag_assignments.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM documents document
         WHERE document.id = document_tag_assignments.document_id
           AND document.tenant_id = document_tag_assignments.tenant_id
    )
);

DROP POLICY app_request_scope ON document_tags;
CREATE POLICY app_request_scope ON document_tags AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE site.tenant_id = document_tags.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE site.tenant_id = document_tags.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
);

DROP POLICY app_request_scope ON document_audit_events;
CREATE POLICY app_request_scope ON document_audit_events AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM documents document
         WHERE document.id = document_audit_events.document_id
           AND document.tenant_id = document_audit_events.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM documents document
         WHERE document.id = document_audit_events.document_id
           AND document.tenant_id = document_audit_events.tenant_id
    )
);

REVOKE ALL ON document_versions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON document_versions TO secops_app_user;
GRANT SELECT, INSERT ON document_audit_events TO secops_app_user;
