ALTER TABLE patrol_route_versions
    ADD COLUMN flexible_order BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN target_duration_minutes INTEGER
        CHECK (target_duration_minutes IS NULL OR target_duration_minutes BETWEEN 1 AND 10080),
    ADD COLUMN late_tolerance_minutes INTEGER NOT NULL DEFAULT 5
        CHECK (late_tolerance_minutes BETWEEN 0 AND 1440);

ALTER TABLE patrol_scans
    ADD COLUMN latitude NUMERIC(9,6),
    ADD COLUMN longitude NUMERIC(9,6),
    ADD CONSTRAINT ck_patrol_scan_coordinates_pair
        CHECK ((latitude IS NULL) = (longitude IS NULL)),
    ADD CONSTRAINT ck_patrol_scan_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT ck_patrol_scan_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

ALTER TABLE patrol_rounds
    ADD COLUMN completion_notes TEXT NOT NULL DEFAULT '';
