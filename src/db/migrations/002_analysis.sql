-- The first-release analysis surface. These macros intentionally expose
-- parser-native paths, types, and values without Dota-specific interpretation.

CREATE OR REPLACE VIEW analysis.checkpoint_properties AS
SELECT
    c.extraction_id,
    c.sequence,
    c.entity_instance_id,
    c.checkpoint_kind,
    c.demo_tick,
    c.net_tick,
    c.game_time,
    c.checkpoint_game_time,
    json_extract_string(property.value, '$.propertyPath') AS property_path,
    json_extract_string(property.value, '$.valueType') AS value_type,
    json_extract(property.value, '$.value') AS value
FROM raw.entity_checkpoints AS c,
LATERAL json_each(c.properties) AS property;

CREATE OR REPLACE MACRO analysis.entity_property_history(
    requested_extraction_id,
    requested_instance_id,
    requested_property_path
) AS TABLE
SELECT
    u.extraction_id,
    u.entity_instance_id,
    u.property_path,
    u.sequence,
    u.demo_tick,
    u.net_tick,
    u.game_time,
    u.value_type,
    u.value
FROM raw.entity_property_updates AS u
WHERE u.extraction_id = requested_extraction_id
  AND u.entity_instance_id = requested_instance_id
  AND u.property_path = requested_property_path
ORDER BY u.sequence;

-- Reconstruct a state by taking the latest checkpoint at or before the target
-- game time and overlaying every later update through that time. If no eligible
-- checkpoint exists, all property updates through the target are considered.
CREATE OR REPLACE MACRO analysis.entity_state_at_game_time(
    requested_extraction_id,
    requested_instance_id,
    requested_game_time
) AS TABLE
WITH eligible_checkpoint AS (
    SELECT
        c.sequence,
        c.checkpoint_game_time
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
        p.property_path,
        p.value_type,
        p.value,
        p.sequence,
        p.demo_tick,
        p.net_tick,
        p.checkpoint_game_time AS game_time,
        'checkpoint'::VARCHAR AS source
    FROM analysis.checkpoint_properties AS p
    JOIN eligible_checkpoint AS c
      ON p.sequence = c.sequence
    WHERE p.extraction_id = requested_extraction_id
      AND p.entity_instance_id = requested_instance_id
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
      AND u.sequence > COALESCE(
          (SELECT sequence FROM eligible_checkpoint),
          0
      )
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
    PARTITION BY property_path
    ORDER BY sequence DESC
) = 1
ORDER BY property_path;
