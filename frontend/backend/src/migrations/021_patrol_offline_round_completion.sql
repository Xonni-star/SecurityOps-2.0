ALTER TABLE patrol_rounds
    ADD COLUMN completion_client_captured_at TIMESTAMPTZ,
    ADD COLUMN completion_server_received_at TIMESTAMPTZ,
    ADD COLUMN completion_client_mutation_id VARCHAR(64),
    ADD COLUMN completion_payload_hash CHAR(64),
    ADD CONSTRAINT uq_patrol_round_completion_mutation
        UNIQUE (tenant_id, completion_client_mutation_id),
    ADD CONSTRAINT ck_patrol_round_completion_mutation_pair
        CHECK ((completion_client_mutation_id IS NULL) = (completion_payload_hash IS NULL)),
    ADD CONSTRAINT ck_patrol_round_completion_payload_hash
        CHECK (completion_payload_hash IS NULL OR completion_payload_hash ~ '^[0-9a-f]{64}$');
