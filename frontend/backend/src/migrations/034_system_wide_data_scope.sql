CREATE OR REPLACE FUNCTION app_request_scope_allows(
    requested_site_id UUID,
    requested_owner_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT CASE
        WHEN COALESCE(current_setting('app.current_permission', true), '') = '' THEN true
        WHEN NULLIF(current_setting('app.current_user_id', true), '') IS NULL THEN false
        ELSE
            EXISTS (
                SELECT 1
                  FROM user_roles ur
                  JOIN role_permissions rp ON rp.role_id = ur.role_id
                  JOIN permissions p ON p.id = rp.permission_id
                 WHERE ur.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
                   AND ur.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                   AND p.code = current_setting('app.current_permission', true)
            )
            OR EXISTS (
                SELECT 1
                  FROM tenant_user_roles tur
                  JOIN tenant_role_permissions trp
                    ON trp.tenant_id = tur.tenant_id AND trp.role_id = tur.role_id
                  JOIN permissions p ON p.id = trp.permission_id
                 WHERE tur.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
                   AND tur.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                   AND p.code = current_setting('app.current_permission', true)
                   AND (
                       (trp.data_scope = 'TENANT' AND tur.site_id IS NULL)
                       OR (
                           trp.data_scope IN ('TENANT', 'SITE')
                           AND requested_site_id IS NOT NULL
                           AND requested_site_id = COALESCE(tur.site_id, trp.site_id)
                           AND (tur.site_id IS NULL OR trp.site_id IS NULL OR tur.site_id = trp.site_id)
                       )
                       OR (
                           trp.data_scope = 'OWN'
                           AND requested_owner_user_id =
                               NULLIF(current_setting('app.current_user_id', true), '')::uuid
                           AND (tur.site_id IS NULL OR requested_site_id = tur.site_id)
                           AND (trp.site_id IS NULL OR requested_site_id = trp.site_id)
                       )
                   )
            )
    END
$$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOR table_name IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relrowsecurity
           AND a.attname = 'tenant_id'
           AND a.attnum > 0
           AND NOT a.attisdropped
           AND c.relname NOT IN (
               'user_roles', 'user_sessions', 'tenant_memberships', 'tenant_roles',
               'tenant_role_permissions', 'tenant_user_roles', 'user_password_reset_tokens',
               'audit_logs'
           )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS app_request_scope ON %I', table_name);
        EXECUTE format(
            'CREATE POLICY app_request_scope ON %I AS RESTRICTIVE FOR ALL
             USING (app_request_scope_allows(NULL, NULL))
             WITH CHECK (app_request_scope_allows(NULL, NULL))',
            table_name
        );
    END LOOP;

    FOR table_name IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute tenant_column ON tenant_column.attrelid = c.oid
          JOIN pg_attribute site_column ON site_column.attrelid = c.oid
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relrowsecurity
           AND tenant_column.attname = 'tenant_id'
           AND tenant_column.attnum > 0
           AND NOT tenant_column.attisdropped
           AND site_column.attname = 'site_id'
           AND site_column.attnum > 0
           AND NOT site_column.attisdropped
           AND c.relname NOT IN (
               'user_roles', 'user_sessions', 'tenant_memberships', 'tenant_roles',
               'tenant_role_permissions', 'tenant_user_roles', 'user_password_reset_tokens'
           )
    LOOP
        EXECUTE format('DROP POLICY app_request_scope ON %I', table_name);
        EXECUTE format(
            'CREATE POLICY app_request_scope ON %I AS RESTRICTIVE FOR ALL
             USING (app_request_scope_allows(site_id, NULL))
             WITH CHECK (app_request_scope_allows(site_id, NULL))',
            table_name
        );
    END LOOP;
END $$;

DROP POLICY app_request_scope ON employees;
CREATE POLICY app_request_scope ON employees AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, account_user_id)
    OR EXISTS (
        SELECT 1
          FROM employee_site_assignments esa
         WHERE esa.tenant_id = employees.tenant_id
           AND esa.employee_id = employees.id
           AND app_request_scope_allows(esa.site_id, NULL)
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, account_user_id)
    OR EXISTS (
        SELECT 1
          FROM employee_site_assignments esa
         WHERE esa.tenant_id = employees.tenant_id
           AND esa.employee_id = employees.id
           AND app_request_scope_allows(esa.site_id, NULL)
    )
);

DROP POLICY app_request_scope ON clients;
CREATE POLICY app_request_scope ON clients AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, NULL)
    OR EXISTS (
        SELECT 1 FROM sites s
         WHERE s.client_id = clients.id
           AND s.tenant_id = clients.tenant_id
           AND app_request_scope_allows(s.id, NULL)
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, NULL)
    OR EXISTS (
        SELECT 1 FROM sites s
         WHERE s.client_id = clients.id
           AND s.tenant_id = clients.tenant_id
           AND app_request_scope_allows(s.id, NULL)
    )
);

DROP POLICY app_request_scope ON employee_qualifications;
CREATE POLICY app_request_scope ON employee_qualifications AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM employees e
         WHERE e.id = employee_qualifications.employee_id
           AND e.tenant_id = employee_qualifications.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM employees e
         WHERE e.id = employee_qualifications.employee_id
           AND e.tenant_id = employee_qualifications.tenant_id
    )
);

DROP POLICY app_request_scope ON employee_absences;
CREATE POLICY app_request_scope ON employee_absences AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM employees e
         WHERE e.id = employee_absences.employee_id
           AND e.tenant_id = employee_absences.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM employees e
         WHERE e.id = employee_absences.employee_id
           AND e.tenant_id = employee_absences.tenant_id
    )
);

DROP POLICY app_request_scope ON shifts;
CREATE POLICY app_request_scope ON shifts AS RESTRICTIVE FOR ALL
USING (app_request_scope_allows(site_id, NULL))
WITH CHECK (app_request_scope_allows(site_id, NULL));

DROP POLICY app_request_scope ON schedule_rule_findings;
CREATE POLICY app_request_scope ON schedule_rule_findings AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, NULL)
    OR (
        shift_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM shifts shift
             WHERE shift.id = schedule_rule_findings.shift_id
               AND shift.tenant_id = schedule_rule_findings.tenant_id
               AND app_request_scope_allows(shift.site_id, NULL)
        )
    )
    OR (
        employee_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM employee_site_assignments assignment
             WHERE assignment.tenant_id = schedule_rule_findings.tenant_id
               AND assignment.employee_id = schedule_rule_findings.employee_id
               AND app_request_scope_allows(assignment.site_id, NULL)
        )
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, NULL)
    OR (
        shift_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM shifts shift
             WHERE shift.id = schedule_rule_findings.shift_id
               AND shift.tenant_id = schedule_rule_findings.tenant_id
               AND app_request_scope_allows(shift.site_id, NULL)
        )
    )
    OR (
        employee_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM employee_site_assignments assignment
             WHERE assignment.tenant_id = schedule_rule_findings.tenant_id
               AND assignment.employee_id = schedule_rule_findings.employee_id
               AND app_request_scope_allows(assignment.site_id, NULL)
        )
    )
);

DROP POLICY app_request_scope ON schedule_rule_exceptions;
CREATE POLICY app_request_scope ON schedule_rule_exceptions AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM schedule_rule_findings finding
         WHERE finding.id = schedule_rule_exceptions.finding_id
           AND finding.tenant_id = schedule_rule_exceptions.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM schedule_rule_findings finding
         WHERE finding.id = schedule_rule_exceptions.finding_id
           AND finding.tenant_id = schedule_rule_exceptions.tenant_id
    )
);

DROP POLICY app_request_scope ON planning_audit_events;
CREATE POLICY app_request_scope ON planning_audit_events AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, NULL)
    OR (
        entity_type = 'shift'
        AND EXISTS (
            SELECT 1 FROM shifts shift
             WHERE shift.id = planning_audit_events.entity_id
               AND shift.tenant_id = planning_audit_events.tenant_id
               AND app_request_scope_allows(shift.site_id, NULL)
        )
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, NULL)
    OR (
        entity_type = 'shift'
        AND EXISTS (
            SELECT 1 FROM shifts shift
             WHERE shift.id = planning_audit_events.entity_id
               AND shift.tenant_id = planning_audit_events.tenant_id
               AND app_request_scope_allows(shift.site_id, NULL)
        )
    )
);

DROP POLICY app_request_scope ON shift_staffing_requirements;
CREATE POLICY app_request_scope ON shift_staffing_requirements AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_staffing_requirements.shift_id
           AND shift.tenant_id = shift_staffing_requirements.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_staffing_requirements.shift_id
           AND shift.tenant_id = shift_staffing_requirements.tenant_id
    )
);

DROP POLICY app_request_scope ON shift_staffing_assignments;
CREATE POLICY app_request_scope ON shift_staffing_assignments AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_staffing_assignments.shift_id
           AND shift.tenant_id = shift_staffing_assignments.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_staffing_assignments.shift_id
           AND shift.tenant_id = shift_staffing_assignments.tenant_id
    )
);

DROP POLICY app_request_scope ON shift_swap_requests;
CREATE POLICY app_request_scope ON shift_swap_requests AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_swap_requests.shift_id
           AND shift.tenant_id = shift_swap_requests.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_swap_requests.shift_id
           AND shift.tenant_id = shift_swap_requests.tenant_id
    )
);

DROP POLICY app_request_scope ON shift_cover_requests;
CREATE POLICY app_request_scope ON shift_cover_requests AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_cover_requests.shift_id
           AND shift.tenant_id = shift_cover_requests.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_cover_requests.shift_id
           AND shift.tenant_id = shift_cover_requests.tenant_id
    )
);

DROP POLICY app_request_scope ON shift_actual_times;
CREATE POLICY app_request_scope ON shift_actual_times AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_actual_times.shift_id
           AND shift.tenant_id = shift_actual_times.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = shift_actual_times.shift_id
           AND shift.tenant_id = shift_actual_times.tenant_id
    )
);

DROP POLICY app_request_scope ON shift_actual_time_revisions;
CREATE POLICY app_request_scope ON shift_actual_time_revisions AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM shift_actual_times actual
         WHERE actual.id = shift_actual_time_revisions.actual_time_id
           AND actual.tenant_id = shift_actual_time_revisions.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM shift_actual_times actual
         WHERE actual.id = shift_actual_time_revisions.actual_time_id
           AND actual.tenant_id = shift_actual_time_revisions.tenant_id
    )
);

DROP POLICY app_request_scope ON keys;
CREATE POLICY app_request_scope ON keys AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    OR app_request_scope_allows(
        NULL,
        (SELECT e.account_user_id FROM employees e
          WHERE e.id = keys.current_holder_id AND e.tenant_id = keys.tenant_id)
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    OR app_request_scope_allows(
        NULL,
        (SELECT e.account_user_id FROM employees e
          WHERE e.id = keys.current_holder_id AND e.tenant_id = keys.tenant_id)
    )
);

DROP POLICY app_request_scope ON guardbook_entries;
CREATE POLICY app_request_scope ON guardbook_entries AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    OR app_request_scope_allows(
        NULL,
        (SELECT e.account_user_id FROM employees e
          WHERE e.id = guardbook_entries.guard_id AND e.tenant_id = guardbook_entries.tenant_id)
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    OR app_request_scope_allows(
        NULL,
        (SELECT e.account_user_id FROM employees e
          WHERE e.id = guardbook_entries.guard_id AND e.tenant_id = guardbook_entries.tenant_id)
    )
);

DROP POLICY app_request_scope ON guardbook_revisions;
CREATE POLICY app_request_scope ON guardbook_revisions AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM guardbook_entries entry
         WHERE entry.id = guardbook_revisions.entry_id
           AND entry.tenant_id = guardbook_revisions.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM guardbook_entries entry
         WHERE entry.id = guardbook_revisions.entry_id
           AND entry.tenant_id = guardbook_revisions.tenant_id
    )
);

DROP POLICY app_request_scope ON documents;
CREATE POLICY app_request_scope ON documents AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, responsible_user_id)
    OR EXISTS (
        SELECT 1 FROM document_relationships relationship
         WHERE relationship.document_id = documents.id
           AND relationship.tenant_id = documents.tenant_id
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, responsible_user_id)
    OR EXISTS (
        SELECT 1 FROM document_relationships relationship
         WHERE relationship.document_id = documents.id
           AND relationship.tenant_id = documents.tenant_id
    )
);

DROP POLICY app_request_scope ON document_relationships;
CREATE POLICY app_request_scope ON document_relationships AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE site.client_id = document_relationships.customer_id
           AND site.tenant_id = document_relationships.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM employee_site_assignments assignment
         WHERE assignment.tenant_id = document_relationships.tenant_id
           AND assignment.employee_id = document_relationships.employee_id
           AND app_request_scope_allows(assignment.site_id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = document_relationships.shift_id
           AND shift.tenant_id = document_relationships.tenant_id
           AND app_request_scope_allows(shift.site_id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM guardbook_entries entry
         WHERE entry.id = document_relationships.incident_id
           AND entry.tenant_id = document_relationships.tenant_id
           AND app_request_scope_allows(entry.site_id, NULL)
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE site.client_id = document_relationships.customer_id
           AND site.tenant_id = document_relationships.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM employee_site_assignments assignment
         WHERE assignment.tenant_id = document_relationships.tenant_id
           AND assignment.employee_id = document_relationships.employee_id
           AND app_request_scope_allows(assignment.site_id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM shifts shift
         WHERE shift.id = document_relationships.shift_id
           AND shift.tenant_id = document_relationships.tenant_id
           AND app_request_scope_allows(shift.site_id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM guardbook_entries entry
         WHERE entry.id = document_relationships.incident_id
           AND entry.tenant_id = document_relationships.tenant_id
           AND app_request_scope_allows(entry.site_id, NULL)
    )
);

DROP POLICY app_request_scope ON sop_instructions;
CREATE POLICY app_request_scope ON sop_instructions AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE sop_instructions.site_id IS NULL
           AND site.client_id = sop_instructions.customer_id
           AND site.tenant_id = sop_instructions.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE sop_instructions.site_id IS NULL
           AND site.client_id = sop_instructions.customer_id
           AND site.tenant_id = sop_instructions.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
);

DROP POLICY app_request_scope ON sop_versions;
CREATE POLICY app_request_scope ON sop_versions AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE sop_versions.site_id IS NULL
           AND site.client_id = sop_versions.customer_id
           AND site.tenant_id = sop_versions.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE sop_versions.site_id IS NULL
           AND site.client_id = sop_versions.customer_id
           AND site.tenant_id = sop_versions.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
);

DROP POLICY app_request_scope ON sop_events;
CREATE POLICY app_request_scope ON sop_events AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM sop_instructions sop
         WHERE sop.id = sop_events.sop_id
           AND sop.tenant_id = sop_events.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM sop_instructions sop
         WHERE sop.id = sop_events.sop_id
           AND sop.tenant_id = sop_events.tenant_id
    )
);

DROP POLICY app_request_scope ON sop_assignments;
CREATE POLICY app_request_scope ON sop_assignments AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM sop_instructions sop
         WHERE sop.id = sop_assignments.sop_id
           AND sop.tenant_id = sop_assignments.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM sop_instructions sop
         WHERE sop.id = sop_assignments.sop_id
           AND sop.tenant_id = sop_assignments.tenant_id
    )
);

DROP POLICY app_request_scope ON sop_assignment_targets;
CREATE POLICY app_request_scope ON sop_assignment_targets AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    OR (
        target_type = 'employee'
        AND EXISTS (
            SELECT 1 FROM employee_site_assignments assignment
             WHERE assignment.tenant_id = sop_assignment_targets.tenant_id
               AND assignment.employee_id = sop_assignment_targets.employee_id
               AND app_request_scope_allows(assignment.site_id, NULL)
        )
    )
    OR (
        target_type = 'customer'
        AND EXISTS (
            SELECT 1 FROM sites site
             WHERE site.client_id = sop_assignment_targets.customer_id
               AND site.tenant_id = sop_assignment_targets.tenant_id
               AND app_request_scope_allows(site.id, NULL)
        )
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    OR (
        target_type = 'employee'
        AND EXISTS (
            SELECT 1 FROM employee_site_assignments assignment
             WHERE assignment.tenant_id = sop_assignment_targets.tenant_id
               AND assignment.employee_id = sop_assignment_targets.employee_id
               AND app_request_scope_allows(assignment.site_id, NULL)
        )
    )
    OR (
        target_type = 'customer'
        AND EXISTS (
            SELECT 1 FROM sites site
             WHERE site.client_id = sop_assignment_targets.customer_id
               AND site.tenant_id = sop_assignment_targets.tenant_id
               AND app_request_scope_allows(site.id, NULL)
        )
    )
);

DROP POLICY app_request_scope ON handover_participants;
CREATE POLICY app_request_scope ON handover_participants AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM handovers handover
         WHERE handover.id = handover_participants.handover_id
           AND handover.tenant_id = handover_participants.tenant_id
    )
    AND EXISTS (
        SELECT 1 FROM employees employee
         WHERE employee.id = handover_participants.employee_id
           AND employee.tenant_id = handover_participants.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM handovers handover
         WHERE handover.id = handover_participants.handover_id
           AND handover.tenant_id = handover_participants.tenant_id
    )
    AND EXISTS (
        SELECT 1 FROM employees employee
         WHERE employee.id = handover_participants.employee_id
           AND employee.tenant_id = handover_participants.tenant_id
    )
);

DROP POLICY app_request_scope ON handover_events;
CREATE POLICY app_request_scope ON handover_events AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM handovers handover
         WHERE handover.id = handover_events.handover_id
           AND handover.tenant_id = handover_events.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM handovers handover
         WHERE handover.id = handover_events.handover_id
           AND handover.tenant_id = handover_events.tenant_id
    )
);

DROP POLICY app_request_scope ON handover_confirmations;
CREATE POLICY app_request_scope ON handover_confirmations AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM handovers handover
         WHERE handover.id = handover_confirmations.handover_id
           AND handover.tenant_id = handover_confirmations.tenant_id
    )
    AND EXISTS (
        SELECT 1 FROM employees employee
         WHERE employee.id = handover_confirmations.employee_id
           AND employee.tenant_id = handover_confirmations.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM handovers handover
         WHERE handover.id = handover_confirmations.handover_id
           AND handover.tenant_id = handover_confirmations.tenant_id
    )
    AND EXISTS (
        SELECT 1 FROM employees employee
         WHERE employee.id = handover_confirmations.employee_id
           AND employee.tenant_id = handover_confirmations.tenant_id
    )
);

DROP POLICY app_request_scope ON handover_task_events;
CREATE POLICY app_request_scope ON handover_task_events AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM handover_tasks task
         WHERE task.id = handover_task_events.task_id
           AND task.tenant_id = handover_task_events.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM handover_tasks task
         WHERE task.id = handover_task_events.task_id
           AND task.tenant_id = handover_task_events.tenant_id
    )
);

DROP POLICY app_request_scope ON handover_documents;
CREATE POLICY app_request_scope ON handover_documents AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM handovers handover
         WHERE handover.id = handover_documents.handover_id
           AND handover.tenant_id = handover_documents.tenant_id
    )
    AND EXISTS (
        SELECT 1 FROM documents document
         WHERE document.id = handover_documents.document_id
           AND document.tenant_id = handover_documents.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM handovers handover
         WHERE handover.id = handover_documents.handover_id
           AND handover.tenant_id = handover_documents.tenant_id
    )
    AND EXISTS (
        SELECT 1 FROM documents document
         WHERE document.id = handover_documents.document_id
           AND document.tenant_id = handover_documents.tenant_id
    )
);

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

DO $$
DECLARE
    table_name TEXT;
    parent_table TEXT;
    parent_id_column TEXT;
    parent_ref_column TEXT;
BEGIN
    FOR table_name, parent_table, parent_id_column, parent_ref_column IN
        SELECT * FROM (VALUES
            ('handover_participants', 'handovers', 'id', 'handover_id'),
            ('handover_events', 'handovers', 'id', 'handover_id'),
            ('handover_confirmations', 'handovers', 'id', 'handover_id'),
            ('handover_documents', 'handovers', 'id', 'handover_id'),
            ('handover_task_events', 'handover_tasks', 'id', 'task_id'),
            ('emergency_management_events', 'emergency_plans', 'id', 'emergency_plan_id'),
            ('alarm_event_actions', 'alarm_incidents', 'id', 'alarm_incident_id'),
            ('alarm_event_assignments', 'alarm_incidents', 'id', 'alarm_incident_id'),
            ('alarm_event_status_history', 'alarm_incidents', 'id', 'alarm_incident_id'),
            ('alarm_notifications', 'alarm_incidents', 'id', 'alarm_incident_id'),
            ('emergency_plan_versions', 'emergency_plans', 'id', 'emergency_plan_id'),
            ('shift_staffing_requirements', 'shifts', 'id', 'shift_id'),
            ('shift_staffing_assignments', 'shifts', 'id', 'shift_id'),
            ('shift_cover_requests', 'shifts', 'id', 'shift_id'),
            ('shift_actual_times', 'shifts', 'id', 'shift_id'),
            ('shift_actual_time_revisions', 'shift_actual_times', 'id', 'actual_time_id'),
            ('shift_swap_requests', 'shifts', 'id', 'shift_id'),
            ('schedule_rule_exceptions', 'schedule_rule_findings', 'id', 'finding_id'),
            ('sop_events', 'sop_instructions', 'id', 'sop_id'),
            ('sop_assignments', 'sop_instructions', 'id', 'sop_id'),
            ('patrol_schedule_occurrence_events', 'patrol_schedule_occurrences', 'id', 'occurrence_id')
        ) AS relations(child_table, parent_name, parent_id, child_ref)
    LOOP
        IF to_regclass(format('public.%I', table_name)) IS NOT NULL
           AND to_regclass(format('public.%I', parent_table)) IS NOT NULL THEN
            EXECUTE format('DROP POLICY IF EXISTS app_request_scope ON %I', table_name);
            EXECUTE format(
                'CREATE POLICY app_request_scope ON %I AS RESTRICTIVE FOR ALL
                 USING (EXISTS (SELECT 1 FROM %I parent
                                 WHERE parent.%I = %I.%I
                                   AND parent.tenant_id = %I.tenant_id))
                 WITH CHECK (EXISTS (SELECT 1 FROM %I parent
                                      WHERE parent.%I = %I.%I
                                        AND parent.tenant_id = %I.tenant_id))',
                table_name, parent_table, parent_id_column, table_name, parent_ref_column, table_name,
                parent_table, parent_id_column, table_name, parent_ref_column, table_name
            );
        END IF;
    END LOOP;
END $$;

DROP POLICY app_request_scope ON emergency_plan_versions;
CREATE POLICY app_request_scope ON emergency_plan_versions AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    AND
    EXISTS (
        SELECT 1 FROM emergency_plans plan
         WHERE plan.id = emergency_plan_versions.emergency_plan_id
           AND plan.tenant_id = emergency_plan_versions.tenant_id
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    AND
    EXISTS (
        SELECT 1 FROM emergency_plans plan
         WHERE plan.id = emergency_plan_versions.emergency_plan_id
           AND plan.tenant_id = emergency_plan_versions.tenant_id
    )
);

DROP POLICY app_request_scope ON emergency_contacts;
CREATE POLICY app_request_scope ON emergency_contacts AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE emergency_contacts.site_id IS NULL
           AND site.client_id = emergency_contacts.customer_id
           AND site.tenant_id = emergency_contacts.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM emergency_plans plan
         WHERE emergency_contacts.site_id IS NULL
           AND emergency_contacts.emergency_plan_id IS NOT NULL
           AND plan.id = emergency_contacts.emergency_plan_id
           AND plan.tenant_id = emergency_contacts.tenant_id
    )
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    OR EXISTS (
        SELECT 1 FROM sites site
         WHERE emergency_contacts.site_id IS NULL
           AND site.client_id = emergency_contacts.customer_id
           AND site.tenant_id = emergency_contacts.tenant_id
           AND app_request_scope_allows(site.id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM emergency_plans plan
         WHERE emergency_contacts.site_id IS NULL
           AND emergency_contacts.emergency_plan_id IS NOT NULL
           AND plan.id = emergency_contacts.emergency_plan_id
           AND plan.tenant_id = emergency_contacts.tenant_id
    )
);

DROP POLICY app_request_scope ON alarm_event_assignments;
CREATE POLICY app_request_scope ON alarm_event_assignments AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = alarm_event_assignments.alarm_incident_id
           AND incident.tenant_id = alarm_event_assignments.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = alarm_event_assignments.alarm_incident_id
           AND incident.tenant_id = alarm_event_assignments.tenant_id
    )
);

DROP POLICY app_request_scope ON alarm_event_actions;
CREATE POLICY app_request_scope ON alarm_event_actions AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = alarm_event_actions.alarm_incident_id
           AND incident.tenant_id = alarm_event_actions.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = alarm_event_actions.alarm_incident_id
           AND incident.tenant_id = alarm_event_actions.tenant_id
    )
);

DROP POLICY app_request_scope ON alarm_event_status_history;
CREATE POLICY app_request_scope ON alarm_event_status_history AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = alarm_event_status_history.alarm_incident_id
           AND incident.tenant_id = alarm_event_status_history.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = alarm_event_status_history.alarm_incident_id
           AND incident.tenant_id = alarm_event_status_history.tenant_id
    )
);

DROP POLICY app_request_scope ON alarm_notifications;
CREATE POLICY app_request_scope ON alarm_notifications AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, recipient_user_id)
    OR (
        recipient_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM alarm_incidents incident
             WHERE incident.id = alarm_notifications.alarm_incident_id
               AND incident.tenant_id = alarm_notifications.tenant_id
        )
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, recipient_user_id)
    OR (
        recipient_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM alarm_incidents incident
             WHERE incident.id = alarm_notifications.alarm_incident_id
               AND incident.tenant_id = alarm_notifications.tenant_id
        )
    )
);

DROP POLICY app_request_scope ON alarm_escalation_steps;
CREATE POLICY app_request_scope ON alarm_escalation_steps AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM alarm_escalation_rules rule
         WHERE rule.id = alarm_escalation_steps.rule_id
           AND rule.tenant_id = alarm_escalation_steps.tenant_id
           AND app_request_scope_allows(rule.site_id, NULL)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM alarm_escalation_rules rule
         WHERE rule.id = alarm_escalation_steps.rule_id
           AND rule.tenant_id = alarm_escalation_steps.tenant_id
           AND app_request_scope_allows(rule.site_id, NULL)
    )
);

DROP POLICY app_request_scope ON alarm_escalation_jobs;
CREATE POLICY app_request_scope ON alarm_escalation_jobs AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = alarm_escalation_jobs.alarm_incident_id
           AND incident.tenant_id = alarm_escalation_jobs.tenant_id
           AND app_request_scope_allows(incident.site_id, NULL)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = alarm_escalation_jobs.alarm_incident_id
           AND incident.tenant_id = alarm_escalation_jobs.tenant_id
           AND app_request_scope_allows(incident.site_id, NULL)
    )
);

DROP POLICY app_request_scope ON patrol_route_versions;
CREATE POLICY app_request_scope ON patrol_route_versions AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM patrol_routes route
         WHERE route.id = patrol_route_versions.route_id
           AND route.tenant_id = patrol_route_versions.tenant_id
           AND app_request_scope_allows(route.site_id, NULL)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM patrol_routes route
         WHERE route.id = patrol_route_versions.route_id
           AND route.tenant_id = patrol_route_versions.tenant_id
           AND app_request_scope_allows(route.site_id, NULL)
    )
);

DROP POLICY IF EXISTS app_request_scope ON emergency_management_events;
CREATE POLICY app_request_scope ON emergency_management_events AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM emergency_plans plan
         WHERE plan.id = emergency_management_events.emergency_plan_id
           AND plan.tenant_id = emergency_management_events.tenant_id
    )
    OR EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = emergency_management_events.alarm_incident_id
           AND incident.tenant_id = emergency_management_events.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM emergency_plans plan
         WHERE plan.id = emergency_management_events.emergency_plan_id
           AND plan.tenant_id = emergency_management_events.tenant_id
    )
    OR EXISTS (
        SELECT 1 FROM alarm_incidents incident
         WHERE incident.id = emergency_management_events.alarm_incident_id
           AND incident.tenant_id = emergency_management_events.tenant_id
    )
);

DROP POLICY IF EXISTS app_request_scope ON patrol_scans;
CREATE POLICY app_request_scope ON patrol_scans AS RESTRICTIVE FOR ALL
USING (
    (
        app_request_scope_allows(site_id, NULL)
        AND (
            round_id IS NULL
            OR EXISTS (
                SELECT 1 FROM patrol_rounds round
                 WHERE round.id = patrol_scans.round_id
                   AND round.tenant_id = patrol_scans.tenant_id
                   AND round.site_id = patrol_scans.site_id
                   AND app_request_scope_allows(round.site_id, NULL)
            )
        )
    )
    OR EXISTS (
        SELECT 1 FROM patrol_rounds round
         WHERE round.id = patrol_scans.round_id
           AND round.tenant_id = patrol_scans.tenant_id
           AND app_request_scope_allows(NULL, round.guard_user_id)
    )
)
WITH CHECK (
    (
        app_request_scope_allows(site_id, NULL)
        AND (
            round_id IS NULL
            OR EXISTS (
                SELECT 1 FROM patrol_rounds round
                 WHERE round.id = patrol_scans.round_id
                   AND round.tenant_id = patrol_scans.tenant_id
                   AND round.site_id = patrol_scans.site_id
                   AND app_request_scope_allows(round.site_id, NULL)
            )
        )
    )
    OR EXISTS (
        SELECT 1 FROM patrol_rounds round
         WHERE round.id = patrol_scans.round_id
           AND round.tenant_id = patrol_scans.tenant_id
           AND app_request_scope_allows(NULL, round.guard_user_id)
    )
);

DROP POLICY app_request_scope ON patrol_scan_attempts;
CREATE POLICY app_request_scope ON patrol_scan_attempts AS RESTRICTIVE FOR ALL
USING (
    (
        round_id IS NULL
        AND app_request_scope_allows(site_id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM patrol_rounds round
         WHERE round.id = patrol_scan_attempts.round_id
           AND round.tenant_id = patrol_scan_attempts.tenant_id
           AND (patrol_scan_attempts.site_id IS NULL OR patrol_scan_attempts.site_id = round.site_id)
           AND (
               app_request_scope_allows(round.site_id, NULL)
               OR app_request_scope_allows(NULL, round.guard_user_id)
           )
    )
)
WITH CHECK (
    (
        round_id IS NULL
        AND app_request_scope_allows(site_id, NULL)
    )
    OR EXISTS (
        SELECT 1 FROM patrol_rounds round
         WHERE round.id = patrol_scan_attempts.round_id
           AND round.tenant_id = patrol_scan_attempts.tenant_id
           AND (patrol_scan_attempts.site_id IS NULL OR patrol_scan_attempts.site_id = round.site_id)
           AND (
               app_request_scope_allows(round.site_id, NULL)
               OR app_request_scope_allows(NULL, round.guard_user_id)
           )
    )
);

DROP POLICY app_request_scope ON patrol_schedule_occurrence_events;
CREATE POLICY app_request_scope ON patrol_schedule_occurrence_events AS RESTRICTIVE FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM patrol_schedule_occurrences occurrence
         WHERE occurrence.id = patrol_schedule_occurrence_events.occurrence_id
           AND occurrence.tenant_id = patrol_schedule_occurrence_events.tenant_id
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM patrol_schedule_occurrences occurrence
         WHERE occurrence.id = patrol_schedule_occurrence_events.occurrence_id
           AND occurrence.tenant_id = patrol_schedule_occurrence_events.tenant_id
    )
);

DROP POLICY IF EXISTS app_request_scope ON sites;
CREATE POLICY app_request_scope ON sites AS RESTRICTIVE FOR ALL
USING (app_request_scope_allows(id, NULL))
WITH CHECK (app_request_scope_allows(id, NULL));

DROP POLICY IF EXISTS app_request_scope ON patrol_exceptions;
CREATE POLICY app_request_scope ON patrol_exceptions AS RESTRICTIVE FOR ALL
USING (
    (
        app_request_scope_allows(site_id, NULL)
        AND (
            round_id IS NULL
            OR EXISTS (
                SELECT 1 FROM patrol_rounds round
                 WHERE round.id = patrol_exceptions.round_id
                   AND round.tenant_id = patrol_exceptions.tenant_id
                   AND round.site_id = patrol_exceptions.site_id
                   AND app_request_scope_allows(round.site_id, NULL)
            )
        )
    )
    OR EXISTS (
        SELECT 1 FROM patrol_rounds round
         WHERE round.id = patrol_exceptions.round_id
           AND round.tenant_id = patrol_exceptions.tenant_id
           AND app_request_scope_allows(NULL, round.guard_user_id)
    )
)
WITH CHECK (
    (
        app_request_scope_allows(site_id, NULL)
        AND (
            round_id IS NULL
            OR EXISTS (
                SELECT 1 FROM patrol_rounds round
                 WHERE round.id = patrol_exceptions.round_id
                   AND round.tenant_id = patrol_exceptions.tenant_id
                   AND round.site_id = patrol_exceptions.site_id
                   AND app_request_scope_allows(round.site_id, NULL)
            )
        )
    )
    OR EXISTS (
        SELECT 1 FROM patrol_rounds round
         WHERE round.id = patrol_exceptions.round_id
           AND round.tenant_id = patrol_exceptions.tenant_id
           AND app_request_scope_allows(NULL, round.guard_user_id)
    )
);

DROP POLICY IF EXISTS app_request_scope ON patrol_rounds;
CREATE POLICY app_request_scope ON patrol_rounds AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(site_id, NULL)
    OR app_request_scope_allows(NULL, guard_user_id)
)
WITH CHECK (
    app_request_scope_allows(site_id, NULL)
    OR app_request_scope_allows(NULL, guard_user_id)
);

DROP POLICY IF EXISTS app_request_scope ON planning_notifications;
CREATE POLICY app_request_scope ON planning_notifications AS RESTRICTIVE FOR ALL
USING (
    app_request_scope_allows(NULL, recipient_user_id)
    OR (
        recipient_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        AND entity_type = 'shift'
        AND EXISTS (
            SELECT 1 FROM shifts shift
             WHERE shift.id = planning_notifications.entity_id
               AND shift.tenant_id = planning_notifications.tenant_id
        )
    )
)
WITH CHECK (
    app_request_scope_allows(NULL, recipient_user_id)
    OR (
        recipient_user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        AND entity_type = 'shift'
        AND EXISTS (
            SELECT 1 FROM shifts shift
             WHERE shift.id = planning_notifications.entity_id
               AND shift.tenant_id = planning_notifications.tenant_id
        )
    )
);

CREATE OR REPLACE FUNCTION validate_planning_notification_tenant_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM tenant_memberships
         WHERE tenant_id = NEW.tenant_id
           AND user_id = NEW.recipient_user_id
           AND is_active = true
           AND is_locked = false
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23503',
            MESSAGE = 'Planning notification recipient must be an active tenant member.';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_request_scope_allows(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_request_scope_allows(UUID, UUID) TO secops_app_user;
