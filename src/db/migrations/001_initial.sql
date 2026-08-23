-- Initial catalog and parser-native storage for the replay data lab.
-- Migrations are append-only once applied.

CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS analysis;

CREATE TABLE catalog.replay_acquisitions (
    acquisition_id UUID PRIMARY KEY DEFAULT uuid(),
    match_id UBIGINT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
    completed_at TIMESTAMPTZ,
    source VARCHAR NOT NULL,
    source_url VARCHAR,
    replay_path VARCHAR,
    replay_sha256 VARCHAR,
    replay_size_bytes UBIGINT,
    status VARCHAR NOT NULL CHECK (status IN ('started', 'succeeded', 'replay_unavailable', 'failed')),
    elapsed_ms UBIGINT,
    error_code VARCHAR,
    error_message VARCHAR,
    metadata JSON,
    CHECK (replay_sha256 IS NULL OR regexp_full_match(replay_sha256, '[0-9a-f]{64}'))
);

CREATE INDEX replay_acquisitions_match_id_idx
    ON catalog.replay_acquisitions (match_id, requested_at);

CREATE TABLE catalog.extractions (
    extraction_id VARCHAR PRIMARY KEY,
    match_id UBIGINT NOT NULL,
    acquisition_id UUID,
    replay_sha256 VARCHAR NOT NULL,
    parser_name VARCHAR NOT NULL,
    parser_version VARCHAR NOT NULL,
    exporter_version VARCHAR NOT NULL,
    extraction_config JSON NOT NULL,
    checkpoint_interval_seconds DOUBLE NOT NULL DEFAULT 30,
    output_limit_bytes UBIGINT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
    completed_at TIMESTAMPTZ,
    status VARCHAR NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
    parse_elapsed_ms UBIGINT,
    load_elapsed_ms UBIGINT,
    output_size_bytes UBIGINT,
    record_counts JSON,
    error_code VARCHAR,
    error_message VARCHAR,
    manifest JSON,
    FOREIGN KEY (acquisition_id) REFERENCES catalog.replay_acquisitions (acquisition_id),
    CHECK (regexp_full_match(replay_sha256, '[0-9a-f]{64}')),
    CHECK (checkpoint_interval_seconds > 0)
);

CREATE INDEX extractions_match_id_idx
    ON catalog.extractions (match_id, started_at);

-- Every decoded parser message has exactly one row here. sequence is the
-- extraction-wide ordering assigned by the exporter.
CREATE TABLE raw.records (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    demo_tick BIGINT,
    net_tick BIGINT,
    game_time DOUBLE,
    category VARCHAR NOT NULL,
    record_type VARCHAR NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (extraction_id, sequence)
);

-- Byte-valued fields are removed from payload and stored once here. field_path
-- is the unchanged parser path identifying the field in its source record.
CREATE TABLE raw.record_blobs (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    demo_tick BIGINT,
    net_tick BIGINT,
    game_time DOUBLE,
    blob_id VARCHAR NOT NULL,
    record_sequence UBIGINT NOT NULL,
    field_path VARCHAR NOT NULL,
    value BLOB NOT NULL,
    PRIMARY KEY (extraction_id, sequence),
    CHECK (regexp_full_match(blob_id, '[0-9a-f]{64}'))
);

-- entity_instance_id is exporter-assigned and unique only within an extraction.
-- It is deliberately distinct from entity_index, which the game may reuse.
CREATE TABLE raw.entity_instances (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    entity_instance_id UBIGINT NOT NULL,
    entity_index UINTEGER NOT NULL,
    serial UINTEGER NOT NULL,
    handle UBIGINT NOT NULL,
    class_id INTEGER NOT NULL,
    class_name VARCHAR NOT NULL,
    demo_tick BIGINT,
    net_tick BIGINT,
    game_time DOUBLE,
    PRIMARY KEY (extraction_id, sequence),
    UNIQUE (extraction_id, entity_instance_id)
);

CREATE INDEX entity_instances_index_idx
    ON raw.entity_instances (extraction_id, entity_index, sequence);

CREATE TABLE raw.entity_events (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    entity_instance_id UBIGINT NOT NULL,
    event_type VARCHAR NOT NULL CHECK (event_type IN ('create', 'delete')),
    demo_tick BIGINT,
    net_tick BIGINT,
    game_time DOUBLE,
    synthetic BOOLEAN NOT NULL,
    PRIMARY KEY (extraction_id, sequence),
    FOREIGN KEY (extraction_id, entity_instance_id)
        REFERENCES raw.entity_instances (extraction_id, entity_instance_id)
);

CREATE INDEX entity_events_instance_idx
    ON raw.entity_events (extraction_id, entity_instance_id, sequence);

CREATE TABLE raw.entity_property_updates (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    entity_instance_id UBIGINT NOT NULL,
    property_path VARCHAR NOT NULL,
    value_type VARCHAR NOT NULL,
    value JSON NOT NULL,
    demo_tick BIGINT,
    net_tick BIGINT,
    game_time DOUBLE,
    PRIMARY KEY (extraction_id, sequence),
    FOREIGN KEY (extraction_id, entity_instance_id)
        REFERENCES raw.entity_instances (extraction_id, entity_instance_id)
);

CREATE INDEX entity_property_updates_history_idx
    ON raw.entity_property_updates
        (extraction_id, entity_instance_id, property_path, sequence);

-- properties is an array of objects with "propertyPath", "valueType", and
-- "value" fields. checkpoint_kind explains why the full active-entity state
-- was emitted.
CREATE TABLE raw.entity_checkpoints (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    entity_instance_id UBIGINT NOT NULL,
    checkpoint_kind VARCHAR NOT NULL
        CHECK (checkpoint_kind IN ('creation', 'completion')),
    demo_tick BIGINT,
    net_tick BIGINT,
    game_time DOUBLE,
    checkpoint_game_time DOUBLE,
    properties JSON NOT NULL,
    PRIMARY KEY (extraction_id, sequence),
    FOREIGN KEY (extraction_id, entity_instance_id)
        REFERENCES raw.entity_instances (extraction_id, entity_instance_id)
);

CREATE INDEX entity_checkpoints_lookup_idx
    ON raw.entity_checkpoints
        (extraction_id, entity_instance_id, checkpoint_game_time, sequence);
