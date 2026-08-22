-- Expand only the selected entity checkpoint. Going through the convenience
-- view can cause DuckDB to unnest every checkpoint before applying the macro's
-- entity predicate, which is needlessly expensive for production extractions.

CREATE OR REPLACE MACRO analysis.entity_state_at_game_time(
    requested_extraction_id,
    requested_instance_id,
    requested_game_time
) AS TABLE
WITH eligible_checkpoint AS (
    SELECT c.sequence, c.checkpoint_game_time
    FROM raw.entity_checkpoints AS c
    WHERE c.extraction_id = requested_extraction_id
      AND c.entity_instance_id = requested_instance_id
      AND c.checkpoint_game_time IS NOT NULL
      AND c.checkpoint_game_time <= requested_game_time
    ORDER BY c.checkpoint_game_time DESC, c.sequence DESC
    LIMIT 1
),
base_properties AS (
    SELECT
        json_extract_string(property.value, '$.propertyPath') AS property_path,
        json_extract_string(property.value, '$.valueType') AS value_type,
        json_extract(property.value, '$.value') AS value,
        c.sequence,
        c.demo_tick,
        c.net_tick,
        c.checkpoint_game_time AS game_time,
        'checkpoint'::VARCHAR AS source
    FROM eligible_checkpoint AS selected
    JOIN raw.entity_checkpoints AS c
      ON c.extraction_id = requested_extraction_id
     AND c.entity_instance_id = requested_instance_id
     AND c.sequence = selected.sequence,
    LATERAL json_each(c.properties) AS property
),
later_updates AS (
    SELECT
        u.property_path,
        u.value_type,
        u.value,
        u.sequence,
        u.demo_tick,
        u.net_tick,
        u.game_time,
        'update'::VARCHAR AS source
    FROM raw.entity_property_updates AS u
    WHERE u.extraction_id = requested_extraction_id
      AND u.entity_instance_id = requested_instance_id
      AND u.game_time IS NOT NULL
      AND u.game_time <= requested_game_time
      AND u.sequence > COALESCE((SELECT sequence FROM eligible_checkpoint), 0)
),
candidate_values AS (
    SELECT * FROM base_properties
    UNION ALL
    SELECT * FROM later_updates
)
SELECT
    requested_extraction_id AS extraction_id,
    requested_instance_id::UBIGINT AS instance_id,
    requested_game_time::DOUBLE AS selected_game_time,
    property_path,
    value_type,
    value,
    sequence AS source_sequence,
    demo_tick AS source_demo_tick,
    net_tick AS source_net_tick,
    game_time AS source_game_time,
    source
FROM candidate_values
QUALIFY row_number() OVER (
    PARTITION BY property_path ORDER BY sequence DESC
) = 1
ORDER BY property_path;
