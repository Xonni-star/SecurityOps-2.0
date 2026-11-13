ALTER TABLE patrol_checkpoints
    ADD COLUMN building_name VARCHAR(150),
    ADD COLUMN area_name VARCHAR(150),
    ADD COLUMN latitude NUMERIC(9,6),
    ADD COLUMN longitude NUMERIC(9,6),
    ADD CONSTRAINT ck_patrol_checkpoint_coordinates_pair
        CHECK ((latitude IS NULL) = (longitude IS NULL)),
    ADD CONSTRAINT ck_patrol_checkpoint_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT ck_patrol_checkpoint_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

CREATE INDEX ix_patrol_routes_site_unarchived
    ON patrol_routes (tenant_id, site_id, route_code)
    WHERE archived_at IS NULL;
