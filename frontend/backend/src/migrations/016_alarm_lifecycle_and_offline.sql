CREATE TABLE alarm_types (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(80) NOT NULL,
    label VARCHAR(160) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    UNIQUE (tenant_id, code),
    UNIQUE (tenant_id, label)
);

INSERT INTO alarm_types (tenant_id,code,label,is_system)
SELECT t.id, a.code, a.label, true
FROM tenants t
CROSS JOIN (VALUES
    ('brandalarm','Brandalarm'),
    ('bma','Brandmeldeanlage (BMA)'),
    ('einbruchalarm','Einbruchalarm'),
    ('ema','Einbruchmeldeanlage (EMA)'),
    ('ueberfallalarm','Überfallalarm'),
    ('medizinischer_notfall','Medizinischer Notfall'),
    ('technischer_alarm','Technischer Alarm'),
    ('stromausfall','Stromausfall'),
    ('wasserschaden','Wasserschaden'),
    ('gasaustritt','Gasaustritt'),
    ('evakuierung','Evakuierung'),
    ('sicherheitsvorfall','Sicherheitsvorfall'),
    ('sonstiger_alarm','Sonstiger Alarm'),
    ('bombendrohung','Bombendrohung'),
    ('hausfriedensbruch_aggression','Hausfriedensbruch / Aggression')
) AS a(code,label)
ON CONFLICT (tenant_id,code) DO NOTHING;

ALTER TABLE sites ADD CONSTRAINT uq_sites_id_tenant_client UNIQUE (id,tenant_id,client_id);

ALTER TABLE emergency_management_events
    DROP CONSTRAINT IF EXISTS emergency_management_events_action_check,
    ADD CONSTRAINT ck_emergency_event_action CHECK (action IN (
        'plan_created','plan_updated','plan_archived','plan_published','drill_recorded',
        'incident_reported','incident_acknowledged','incident_escalated','incident_resolved',
        'incident_action_recorded','incident_status_changed',
        'incident_responder_assigned','incident_responder_unassigned'
    ));

ALTER TABLE emergency_plans
    ADD COLUMN customer_id UUID,
    ADD COLUMN alarm_type_id UUID,
    ADD COLUMN owner_employee_id UUID,
    ADD COLUMN effective_from DATE,
    ADD COLUMN effective_until DATE,
    ADD COLUMN publication_status VARCHAR(16) NOT NULL DEFAULT 'published'
        CHECK (publication_status IN ('draft','published','archived')),
    ADD COLUMN current_version_id UUID,
    ADD COLUMN published_version_id UUID;

UPDATE emergency_plans p
SET customer_id=s.client_id
FROM sites s
WHERE s.id=p.site_id AND s.tenant_id=p.tenant_id;

UPDATE emergency_plans p
SET alarm_type_id=t.id
FROM alarm_types t
WHERE t.tenant_id=p.tenant_id
  AND t.code=CASE p.scenario
    WHEN 'BMA - Brandmeldeanlage' THEN 'bma'
    WHEN 'EMA - Einbruchsalarm' THEN 'ema'
    WHEN 'Bombendrohung' THEN 'bombendrohung'
    WHEN 'Medizinischer Notfall' THEN 'medizinischer_notfall'
    ELSE 'hausfriedensbruch_aggression'
  END;

UPDATE emergency_plans p
SET scenario=t.code
FROM alarm_types t
WHERE t.id=p.alarm_type_id AND t.tenant_id=p.tenant_id;

ALTER TABLE emergency_plans
    ALTER COLUMN customer_id SET NOT NULL,
    ALTER COLUMN alarm_type_id SET NOT NULL,
    ADD CONSTRAINT fk_emergency_plan_customer FOREIGN KEY (customer_id,tenant_id)
        REFERENCES clients(id,tenant_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_emergency_plan_site_customer FOREIGN KEY (site_id,tenant_id,customer_id)
        REFERENCES sites(id,tenant_id,client_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_emergency_plan_alarm_type FOREIGN KEY (alarm_type_id,tenant_id)
        REFERENCES alarm_types(id,tenant_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_emergency_plan_owner FOREIGN KEY (owner_employee_id,tenant_id)
        REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
    ADD CONSTRAINT ck_emergency_plan_validity CHECK (
        effective_from IS NULL OR effective_until IS NULL OR effective_until >= effective_from
    );

ALTER TABLE emergency_plans DROP CONSTRAINT IF EXISTS emergency_plans_scenario_check;

CREATE TABLE emergency_contacts (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID,
    site_id UUID,
    emergency_plan_id UUID,
    contact_type VARCHAR(32) NOT NULL CHECK (contact_type IN (
        'site_manager','deputy','operations','customer','technical','fire','police','medical','other'
    )),
    role VARCHAR(100) NOT NULL,
    name VARCHAR(160) NOT NULL,
    phone VARCHAR(80) NOT NULL,
    email VARCHAR(255),
    notes VARCHAR(1000) NOT NULL DEFAULT '',
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    archived_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id,tenant_id),
    CONSTRAINT fk_emergency_contact_customer FOREIGN KEY (customer_id,tenant_id)
        REFERENCES clients(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_emergency_contact_site_customer FOREIGN KEY (site_id,tenant_id,customer_id)
        REFERENCES sites(id,tenant_id,client_id) ON DELETE RESTRICT,
    CONSTRAINT fk_emergency_contact_plan FOREIGN KEY (emergency_plan_id,tenant_id)
        REFERENCES emergency_plans(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_emergency_contact_scope CHECK (
        emergency_plan_id IS NOT NULL OR site_id IS NOT NULL OR customer_id IS NOT NULL
    )
);
CREATE INDEX ix_emergency_contacts_tenant_scope
    ON emergency_contacts (tenant_id,customer_id,site_id,emergency_plan_id)
    WHERE archived_at IS NULL;

INSERT INTO emergency_contacts
    (tenant_id,customer_id,site_id,emergency_plan_id,contact_type,role,name,phone,created_by,updated_by)
SELECT p.tenant_id,p.customer_id,p.site_id,p.id,'other',
       left(coalesce(c->>'role','Notfallkontakt'),100),
       left(coalesce(c->>'name','Kontakt'),160),
       left(coalesce(c->>'phone',''),80),p.created_by,p.updated_by
FROM emergency_plans p
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.contacts)='array' THEN p.contacts ELSE '[]'::jsonb END
) c;

CREATE TABLE emergency_plan_versions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    emergency_plan_id UUID NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    customer_id UUID NOT NULL,
    site_id UUID NOT NULL,
    alarm_type_id UUID NOT NULL,
    owner_employee_id UUID,
    action_steps JSONB NOT NULL CHECK (
        jsonb_typeof(action_steps)='array' AND jsonb_array_length(action_steps) BETWEEN 1 AND 30
    ),
    contact_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contact_snapshot)='array'),
    effective_from DATE,
    effective_until DATE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id,tenant_id),
    UNIQUE (tenant_id,emergency_plan_id,version_number),
    UNIQUE (id,tenant_id,emergency_plan_id),
    CONSTRAINT fk_emergency_plan_version_plan FOREIGN KEY (emergency_plan_id,tenant_id)
        REFERENCES emergency_plans(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_emergency_plan_version_customer FOREIGN KEY (customer_id,tenant_id)
        REFERENCES clients(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_emergency_plan_version_site FOREIGN KEY (site_id,tenant_id,customer_id)
        REFERENCES sites(id,tenant_id,client_id) ON DELETE RESTRICT,
    CONSTRAINT fk_emergency_plan_version_type FOREIGN KEY (alarm_type_id,tenant_id)
        REFERENCES alarm_types(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_emergency_plan_version_owner FOREIGN KEY (owner_employee_id,tenant_id)
        REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_emergency_plan_version_validity CHECK (
        effective_from IS NULL OR effective_until IS NULL OR effective_until >= effective_from
    )
);

INSERT INTO emergency_plan_versions
    (tenant_id,emergency_plan_id,version_number,customer_id,site_id,alarm_type_id,owner_employee_id,
     action_steps,contact_snapshot,effective_from,effective_until,created_by)
SELECT p.tenant_id,p.id,1,p.customer_id,p.site_id,p.alarm_type_id,p.owner_employee_id,
       p.action_steps,
       COALESCE(jsonb_agg(jsonb_build_object(
         'id',c.id,'role',c.role,'name',c.name,'phone',c.phone,'email',c.email,'contactType',c.contact_type
       )) FILTER (WHERE c.id IS NOT NULL),'[]'::jsonb),
       p.effective_from,p.effective_until,p.created_by
FROM emergency_plans p
LEFT JOIN emergency_contacts c ON c.emergency_plan_id=p.id AND c.tenant_id=p.tenant_id AND c.archived_at IS NULL
GROUP BY p.tenant_id,p.id;

UPDATE emergency_plans p
SET current_version_id=v.id,
    published_version_id=CASE WHEN p.is_active AND p.archived_at IS NULL THEN v.id ELSE NULL END,
    publication_status=CASE WHEN p.archived_at IS NOT NULL THEN 'archived'
                            WHEN p.is_active THEN 'published' ELSE 'draft' END
FROM emergency_plan_versions v
WHERE v.tenant_id=p.tenant_id AND v.emergency_plan_id=p.id AND v.version_number=1;

ALTER TABLE emergency_plans
    ADD CONSTRAINT fk_emergency_plan_current_version FOREIGN KEY (current_version_id,tenant_id)
        REFERENCES emergency_plan_versions(id,tenant_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_emergency_plan_published_version FOREIGN KEY (published_version_id,tenant_id)
        REFERENCES emergency_plan_versions(id,tenant_id) ON DELETE RESTRICT;

ALTER TABLE alarm_incidents
    DROP CONSTRAINT IF EXISTS alarm_incidents_scenario_check,
    DROP CONSTRAINT IF EXISTS alarm_incidents_status_check,
    DROP CONSTRAINT IF EXISTS ck_alarm_incident_acknowledged,
    DROP CONSTRAINT IF EXISTS ck_alarm_incident_resolution,
    DROP CONSTRAINT IF EXISTS ck_alarm_incident_escalated,
    ADD COLUMN customer_id UUID,
    ADD COLUMN alarm_type_id UUID,
    ADD COLUMN assigned_employee_id UUID,
    ADD COLUMN emergency_plan_version_id UUID,
    ADD COLUMN incident_number BIGINT GENERATED BY DEFAULT AS IDENTITY,
    ADD COLUMN captured_at TIMESTAMPTZ,
    ADD COLUMN server_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN client_mutation_id VARCHAR(64);

UPDATE alarm_incidents a
SET customer_id=s.client_id
FROM sites s
WHERE s.id=a.site_id AND s.tenant_id=a.tenant_id;

UPDATE alarm_incidents a
SET alarm_type_id=t.id
FROM alarm_types t
WHERE t.tenant_id=a.tenant_id
  AND t.code=CASE a.scenario
    WHEN 'BMA - Brandmeldeanlage' THEN 'bma'
    WHEN 'EMA - Einbruchsalarm' THEN 'ema'
    WHEN 'Bombendrohung' THEN 'bombendrohung'
    WHEN 'Medizinischer Notfall' THEN 'medizinischer_notfall'
    ELSE 'hausfriedensbruch_aggression'
  END;

UPDATE alarm_incidents a
SET scenario=t.code
FROM alarm_types t
WHERE t.id=a.alarm_type_id AND t.tenant_id=a.tenant_id;

UPDATE alarm_incidents a
SET emergency_plan_version_id=p.published_version_id
FROM emergency_plans p
WHERE p.id=a.emergency_plan_id AND p.tenant_id=a.tenant_id;

UPDATE alarm_incidents SET captured_at=reported_at WHERE captured_at IS NULL;
UPDATE alarm_incidents SET status=CASE status
    WHEN 'gemeldet' THEN 'neu'
    WHEN 'bestätigt' THEN 'bestätigt'
    WHEN 'eskaliert' THEN 'eskaliert'
    ELSE 'abgeschlossen'
END;

ALTER TABLE alarm_incidents
    ALTER COLUMN status SET DEFAULT 'neu',
    ALTER COLUMN status TYPE VARCHAR(32),
    ALTER COLUMN customer_id SET NOT NULL,
    ALTER COLUMN alarm_type_id SET NOT NULL,
    ALTER COLUMN captured_at SET NOT NULL,
    ADD CONSTRAINT ck_alarm_incident_status CHECK (status IN (
        'neu','bestätigt','in_bearbeitung','eskaliert','einsatzkraefte_verstaendigt',
        'massnahmen_eingeleitet','entwarnung','abgeschlossen','archiviert'
    )),
    ADD CONSTRAINT ck_alarm_incident_acknowledged CHECK (
        (status='neu' AND acknowledged_at IS NULL)
        OR (status<>'neu' AND acknowledged_at IS NOT NULL)
    ),
    ADD CONSTRAINT ck_alarm_incident_resolution CHECK (
        (status IN ('abgeschlossen','archiviert') AND resolved_at IS NOT NULL
          AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL)
        OR
        (status NOT IN ('abgeschlossen','archiviert') AND resolved_at IS NULL
          AND resolved_by IS NULL AND resolution_note IS NULL)
    ),
    ADD CONSTRAINT ck_alarm_incident_escalated CHECK (
        status<>'eskaliert' OR escalated_at IS NOT NULL
    ),
    ADD CONSTRAINT uq_alarm_incident_number UNIQUE (tenant_id,incident_number),
    ADD CONSTRAINT uq_alarm_incident_mutation UNIQUE (tenant_id,client_mutation_id),
    ADD CONSTRAINT fk_alarm_incident_customer FOREIGN KEY (customer_id,tenant_id)
        REFERENCES clients(id,tenant_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_alarm_incident_site_customer FOREIGN KEY (site_id,tenant_id,customer_id)
        REFERENCES sites(id,tenant_id,client_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_alarm_incident_type FOREIGN KEY (alarm_type_id,tenant_id)
        REFERENCES alarm_types(id,tenant_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_alarm_incident_plan_version FOREIGN KEY
        (emergency_plan_version_id,tenant_id,emergency_plan_id)
        REFERENCES emergency_plan_versions(id,tenant_id,emergency_plan_id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_alarm_incident_assigned_employee FOREIGN KEY (assigned_employee_id,tenant_id)
        REFERENCES employees(id,tenant_id) ON DELETE RESTRICT;

CREATE TABLE alarm_event_assignments (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alarm_incident_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unassigned_at TIMESTAMPTZ,
    unassigned_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    PRIMARY KEY (id,tenant_id),
    CONSTRAINT fk_alarm_assignment_incident FOREIGN KEY (alarm_incident_id,tenant_id)
        REFERENCES alarm_incidents(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_alarm_assignment_employee FOREIGN KEY (employee_id,tenant_id)
        REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_alarm_assignment_release CHECK (
        (unassigned_at IS NULL AND unassigned_by IS NULL)
        OR (unassigned_at IS NOT NULL AND unassigned_by IS NOT NULL)
    )
);
CREATE UNIQUE INDEX uq_alarm_assignment_active
    ON alarm_event_assignments (tenant_id,alarm_incident_id,employee_id) WHERE unassigned_at IS NULL;

CREATE TABLE alarm_event_actions (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alarm_incident_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action_type VARCHAR(24) NOT NULL CHECK (action_type IN (
        'measure','note','assignment','status_change','escalation'
    )),
    description VARCHAR(4000) NOT NULL,
    result VARCHAR(4000) NOT NULL DEFAULT '',
    attachment_document_id UUID,
    client_mutation_id VARCHAR(64),
    captured_at TIMESTAMPTZ,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id,tenant_id),
    UNIQUE (tenant_id,client_mutation_id),
    CONSTRAINT fk_alarm_action_incident FOREIGN KEY (alarm_incident_id,tenant_id)
        REFERENCES alarm_incidents(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_alarm_action_document FOREIGN KEY (attachment_document_id,tenant_id)
        REFERENCES documents(id,tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_alarm_actions_incident_time
    ON alarm_event_actions (tenant_id,alarm_incident_id,occurred_at DESC,id DESC);

CREATE TABLE alarm_event_status_history (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alarm_incident_id UUID NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL CHECK (to_status IN (
        'neu','bestätigt','in_bearbeitung','eskaliert','einsatzkraefte_verstaendigt',
        'massnahmen_eingeleitet','entwarnung','abgeschlossen','archiviert'
    )),
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason VARCHAR(4000) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id,tenant_id),
    CONSTRAINT fk_alarm_status_incident FOREIGN KEY (alarm_incident_id,tenant_id)
        REFERENCES alarm_incidents(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_alarm_status_from CHECK (
        from_status IS NULL OR from_status IN (
            'neu','bestätigt','in_bearbeitung','eskaliert','einsatzkraefte_verstaendigt',
            'massnahmen_eingeleitet','entwarnung','abgeschlossen','archiviert'
        )
    )
);
CREATE INDEX ix_alarm_status_incident_time
    ON alarm_event_status_history (tenant_id,alarm_incident_id,occurred_at DESC,id DESC);

INSERT INTO alarm_event_status_history
    (tenant_id,alarm_incident_id,from_status,to_status,actor_user_id,reason,occurred_at)
SELECT e.tenant_id,e.alarm_incident_id,
       CASE e.details->>'fromStatus'
         WHEN 'gemeldet' THEN 'neu' WHEN 'bestätigt' THEN 'bestätigt'
         WHEN 'eskaliert' THEN 'eskaliert' WHEN 'abgeschlossen' THEN 'abgeschlossen'
         ELSE NULL END,
       CASE e.details->>'toStatus'
         WHEN 'gemeldet' THEN 'neu' WHEN 'bestätigt' THEN 'bestätigt'
         WHEN 'eskaliert' THEN 'eskaliert' WHEN 'abgeschlossen' THEN 'abgeschlossen'
         ELSE 'neu' END,
       e.actor_user_id,COALESCE(e.details->>'note','Alarmereignis übernommen.'),e.occurred_at
FROM emergency_management_events e
WHERE e.alarm_incident_id IS NOT NULL;

INSERT INTO alarm_event_actions
    (tenant_id,alarm_incident_id,actor_user_id,action_type,description,result,occurred_at,server_received_at)
SELECT e.tenant_id,e.alarm_incident_id,e.actor_user_id,
       CASE WHEN e.action='incident_escalated' THEN 'escalation' ELSE 'status_change' END,
       COALESCE(e.details->>'note',e.action),COALESCE(e.details->>'toStatus',''),e.occurred_at,e.occurred_at
FROM emergency_management_events e
WHERE e.alarm_incident_id IS NOT NULL;

CREATE TABLE alarm_escalation_rules (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    site_id UUID,
    alarm_type_id UUID,
    minimum_severity VARCHAR(20) NOT NULL DEFAULT 'Niedrig'
        CHECK (minimum_severity IN ('Niedrig','Normal','Dringend','Kritisch')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    revision_version INTEGER NOT NULL DEFAULT 1 CHECK (revision_version > 0),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id,tenant_id),
    CONSTRAINT fk_alarm_rule_site FOREIGN KEY (site_id,tenant_id)
        REFERENCES sites(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_alarm_rule_type FOREIGN KEY (alarm_type_id,tenant_id)
        REFERENCES alarm_types(id,tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_alarm_rules_match
    ON alarm_escalation_rules (tenant_id,is_active,site_id,alarm_type_id);

CREATE TABLE alarm_escalation_steps (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL,
    step_number INTEGER NOT NULL CHECK (step_number > 0),
    delay_minutes INTEGER NOT NULL CHECK (delay_minutes BETWEEN 0 AND 10080),
    recipient_role_id UUID REFERENCES roles(id) ON DELETE RESTRICT,
    recipient_employee_id UUID,
    channel VARCHAR(12) NOT NULL CHECK (channel IN ('in_app','email','push')),
    PRIMARY KEY (id,tenant_id),
    UNIQUE (tenant_id,rule_id,step_number),
    CONSTRAINT fk_alarm_step_rule FOREIGN KEY (rule_id,tenant_id)
        REFERENCES alarm_escalation_rules(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_alarm_step_employee FOREIGN KEY (recipient_employee_id,tenant_id)
        REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_alarm_step_recipient CHECK (
        (recipient_role_id IS NOT NULL AND recipient_employee_id IS NULL)
        OR (recipient_role_id IS NULL AND recipient_employee_id IS NOT NULL)
    )
);

CREATE TABLE alarm_escalation_jobs (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alarm_incident_id UUID NOT NULL,
    rule_id UUID NOT NULL,
    step_id UUID NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','completed','cancelled','blocked')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    retry_at TIMESTAMPTZ,
    lease_until TIMESTAMPTZ,
    last_error VARCHAR(1000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id,tenant_id),
    UNIQUE (tenant_id,alarm_incident_id,step_id),
    CONSTRAINT fk_alarm_job_incident FOREIGN KEY (alarm_incident_id,tenant_id)
        REFERENCES alarm_incidents(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_alarm_job_rule FOREIGN KEY (rule_id,tenant_id)
        REFERENCES alarm_escalation_rules(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_alarm_job_step FOREIGN KEY (step_id,tenant_id)
        REFERENCES alarm_escalation_steps(id,tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ix_alarm_jobs_due ON alarm_escalation_jobs (tenant_id,status,retry_at,scheduled_at);

CREATE TABLE alarm_notifications (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    escalation_job_id UUID,
    alarm_incident_id UUID NOT NULL,
    recipient_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    recipient_email VARCHAR(255),
    channel VARCHAR(12) NOT NULL CHECK (channel IN ('in_app','email','push')),
    notification_type VARCHAR(24) NOT NULL DEFAULT 'escalation'
        CHECK (notification_type IN ('escalation','incident_assignment')),
    delivery_status VARCHAR(20) NOT NULL CHECK (
        delivery_status IN ('queued','delivered','failed','not_configured')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    retry_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id,tenant_id),
    UNIQUE (tenant_id,escalation_job_id,channel,recipient_user_id),
    CONSTRAINT fk_alarm_notification_job FOREIGN KEY (escalation_job_id,tenant_id)
        REFERENCES alarm_escalation_jobs(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_alarm_notification_incident FOREIGN KEY (alarm_incident_id,tenant_id)
        REFERENCES alarm_incidents(id,tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_alarm_notification_delivery CHECK (
        (delivery_status='delivered' AND delivered_at IS NOT NULL)
        OR (delivery_status<>'delivered' AND delivered_at IS NULL)
    )
);
CREATE INDEX ix_alarm_notifications_tenant_user
    ON alarm_notifications (tenant_id,recipient_user_id,created_at DESC);

CREATE TABLE alarm_mutation_receipts (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    client_mutation_id VARCHAR(64) NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    mutation_type VARCHAR(24) NOT NULL CHECK (mutation_type IN ('incident_report','action_create','status_change')),
    payload_hash VARCHAR(64) NOT NULL,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id,client_mutation_id)
);

CREATE OR REPLACE FUNCTION prevent_alarm_history_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Alarmhistorie ist unveränderlich.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emergency_plan_versions_immutable
BEFORE UPDATE OR DELETE ON emergency_plan_versions
FOR EACH ROW EXECUTE FUNCTION prevent_alarm_history_tampering();
CREATE TRIGGER trg_alarm_event_actions_immutable
BEFORE UPDATE OR DELETE ON alarm_event_actions
FOR EACH ROW EXECUTE FUNCTION prevent_alarm_history_tampering();
CREATE TRIGGER trg_alarm_event_status_history_immutable
BEFORE UPDATE OR DELETE ON alarm_event_status_history
FOR EACH ROW EXECUTE FUNCTION prevent_alarm_history_tampering();

DO $$
DECLARE tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'alarm_types','emergency_contacts','emergency_plan_versions','alarm_event_assignments',
        'alarm_event_actions','alarm_event_status_history','alarm_escalation_rules',
        'alarm_escalation_steps','alarm_escalation_jobs','alarm_notifications','alarm_mutation_receipts'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;',tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;',tbl);
        EXECUTE format('CREATE POLICY tenant_isolation_permissive ON %I
            AS PERMISSIVE FOR ALL TO PUBLIC
            USING (current_setting(''app.current_tenant'',true) IS NOT NULL
              AND current_setting(''app.current_tenant'',true) <> ''''
              AND tenant_id=current_setting(''app.current_tenant'',true)::uuid)
            WITH CHECK (current_setting(''app.current_tenant'',true) IS NOT NULL
              AND current_setting(''app.current_tenant'',true) <> ''''
              AND tenant_id=current_setting(''app.current_tenant'',true)::uuid);',tbl);
    END LOOP;
END $$;

REVOKE ALL ON alarm_types,emergency_contacts,emergency_plan_versions,alarm_event_assignments,
    alarm_event_actions,alarm_event_status_history,alarm_escalation_rules,alarm_escalation_steps,
    alarm_escalation_jobs,alarm_notifications,alarm_mutation_receipts FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON alarm_types,emergency_contacts,alarm_event_assignments,
    alarm_escalation_rules,alarm_escalation_steps,alarm_escalation_jobs,alarm_notifications TO secops_app_user;
GRANT SELECT,INSERT ON emergency_plan_versions,alarm_event_actions,alarm_event_status_history,
    alarm_mutation_receipts TO secops_app_user;
GRANT USAGE,SELECT ON SEQUENCE alarm_incidents_incident_number_seq TO secops_app_user;

INSERT INTO permissions (code,module,description) VALUES
    ('alarm:type:manage','alarm','Alarmarten verwalten'),
    ('alarm:assign','alarm','Alarmereignisse zuweisen'),
    ('alarm:archive','alarm','Abgeschlossene Alarmereignisse archivieren'),
    ('alarm:action:create','alarm','Alarmmaßnahmen dokumentieren'),
    ('alarm:escalation:manage','alarm','Eskalationsregeln verwalten'),
    ('alarm:notifications:read','alarm','Alarmbenachrichtigungsstatus lesen'),
    ('emergency_plan:publish','alarm','Notfallplanversion veröffentlichen'),
    ('emergency_contact:read','alarm','Notfallkontakte lesen'),
    ('emergency_contact:manage','alarm','Notfallkontakte verwalten')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON
    (r.name IN ('Systemadministrator','Geschäftsführung','Einsatzleitung','Qualitätsmanagement')
      AND p.code IN ('alarm:type:manage','alarm:assign','alarm:archive','alarm:action:create','alarm:escalation:manage',
        'alarm:notifications:read','emergency_plan:publish','emergency_contact:read','emergency_contact:manage'))
    OR (r.name='Objektleitung' AND p.code IN ('alarm:assign','alarm:archive','alarm:action:create','alarm:notifications:read',
        'emergency_plan:publish','emergency_contact:read','emergency_contact:manage'))
    OR (r.name='Wachdienstmitarbeiter' AND p.code IN ('alarm:action:create','emergency_contact:read'))
    OR (r.name='Auditor' AND p.code IN ('alarm:notifications:read','emergency_contact:read'))
ON CONFLICT DO NOTHING;
