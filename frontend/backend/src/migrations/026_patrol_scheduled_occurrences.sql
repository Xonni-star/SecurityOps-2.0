ALTER TABLE patrol_route_versions
    ADD COLUMN schedule_timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    ADD COLUMN schedule_anchor_date DATE NOT NULL DEFAULT CURRENT_DATE,
    ADD CONSTRAINT ck_patrol_route_version_timezone CHECK (length(trim(schedule_timezone)) > 0);

ALTER TABLE patrol_events
    ALTER COLUMN actor_user_id DROP NOT NULL,
    ADD COLUMN actor_type VARCHAR(12) NOT NULL DEFAULT 'user'
        CHECK (actor_type IN ('user', 'system')),
    ADD CONSTRAINT ck_patrol_event_actor
        CHECK ((actor_type = 'user' AND actor_user_id IS NOT NULL) OR
               (actor_type = 'system' AND actor_user_id IS NULL));

ALTER TABLE patrol_exceptions
    DROP CONSTRAINT patrol_exceptions_category_check,
    ADD CONSTRAINT ck_patrol_exception_category CHECK (category IN (
        'missed_checkpoint', 'late_checkpoint', 'missed_round', 'abandoned_round',
        'access_blocked', 'hazard', 'damage', 'other'
    )),
    ALTER COLUMN created_by_user_id DROP NOT NULL,
    ADD COLUMN created_by_type VARCHAR(12) NOT NULL DEFAULT 'user'
        CHECK (created_by_type IN ('user', 'system')),
    ADD CONSTRAINT ck_patrol_exception_creator
        CHECK ((created_by_type = 'user' AND created_by_user_id IS NOT NULL) OR
               (created_by_type = 'system' AND created_by_user_id IS NULL));

CREATE TABLE patrol_schedule_occurrences (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL,
    route_id UUID NOT NULL,
    route_version INTEGER NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    window_ends_at TIMESTAMPTZ NOT NULL,
    deadline_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'missed', 'abandoned')),
    round_id UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT uq_patrol_schedule_occurrence UNIQUE (tenant_id, route_id, route_version, scheduled_at),
    CONSTRAINT uq_patrol_schedule_occurrence_round UNIQUE (tenant_id, round_id),
    CONSTRAINT fk_patrol_schedule_occurrence_site FOREIGN KEY (site_id, tenant_id)
        REFERENCES sites(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_schedule_occurrence_version FOREIGN KEY (tenant_id, route_id, route_version)
        REFERENCES patrol_route_versions(tenant_id, route_id, version) ON DELETE RESTRICT,
    CONSTRAINT fk_patrol_schedule_occurrence_round FOREIGN KEY (round_id, tenant_id)
        REFERENCES patrol_rounds(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_patrol_schedule_occurrence_deadlines
        CHECK (scheduled_at <= window_ends_at AND window_ends_at <= deadline_at),
    CONSTRAINT ck_patrol_schedule_occurrence_resolution
        CHECK ((status IN ('scheduled', 'in_progress') AND resolved_at IS NULL) OR
               (status IN ('completed', 'missed', 'abandoned') AND resolved_at IS NOT NULL))
);
CREATE INDEX ix_patrol_schedule_occurrences_status_deadline
    ON patrol_schedule_occurrences (tenant_id, status, deadline_at);
CREATE INDEX ix_patrol_schedule_occurrences_site_time
    ON patrol_schedule_occurrences (tenant_id, site_id, scheduled_at DESC);

CREATE TABLE patrol_schedule_occurrence_events (
    id UUID NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    occurrence_id UUID NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    actor_type VARCHAR(12) NOT NULL CHECK (actor_type IN ('user', 'system')),
    action VARCHAR(24) NOT NULL CHECK (action IN (
        'materialized', 'round_started', 'round_completed', 'round_missed', 'round_abandoned'
    )),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, tenant_id),
    CONSTRAINT fk_patrol_schedule_occurrence_event FOREIGN KEY (occurrence_id, tenant_id)
        REFERENCES patrol_schedule_occurrences(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT ck_patrol_schedule_occurrence_event_actor
        CHECK ((actor_type = 'user' AND actor_user_id IS NOT NULL) OR
               (actor_type = 'system' AND actor_user_id IS NULL))
);
CREATE INDEX ix_patrol_schedule_occurrence_events_history
    ON patrol_schedule_occurrence_events (tenant_id, occurrence_id, occurred_at);

DO $$
DECLARE tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['patrol_schedule_occurrences', 'patrol_schedule_occurrence_events'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_permissive ON %I AS PERMISSIVE FOR ALL TO PUBLIC
             USING (current_setting(''app.current_tenant'', true) IS NOT NULL
                    AND current_setting(''app.current_tenant'', true) <> ''''
                    AND tenant_id = current_setting(''app.current_tenant'', true)::uuid)
             WITH CHECK (current_setting(''app.current_tenant'', true) IS NOT NULL
                         AND current_setting(''app.current_tenant'', true) <> ''''
                         AND tenant_id = current_setting(''app.current_tenant'', true)::uuid)', tbl);
    END LOOP;
END $$;

CREATE TRIGGER trg_patrol_schedule_occurrence_events_immutable
    BEFORE UPDATE OR DELETE ON patrol_schedule_occurrence_events
    FOR EACH ROW EXECUTE FUNCTION prevent_patrol_history_tampering();

REVOKE ALL ON patrol_schedule_occurrences, patrol_schedule_occurrence_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON patrol_schedule_occurrences TO secops_app_user;
GRANT SELECT, INSERT ON patrol_schedule_occurrence_events TO secops_app_user;
REVOKE UPDATE, DELETE ON patrol_schedule_occurrence_events FROM secops_app_user;
