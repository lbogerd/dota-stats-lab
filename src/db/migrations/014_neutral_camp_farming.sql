-- Typed version-1 neutral-camp farming actions. Camp IDs and spawner handles
-- are replay-local and must not be used as permanent map identifiers.

CREATE TABLE analysis.neutral_camp_farming_actions (
    extraction_id VARCHAR NOT NULL,
    action_index UINTEGER NOT NULL,
    definition_name VARCHAR NOT NULL
        CHECK (definition_name = 'neutral-camp-farming-v1'),
    player_slot UINTEGER NOT NULL,
    camp_id UINTEGER NOT NULL,
    spawner_handle UBIGINT NOT NULL,
    camp_type INTEGER NOT NULL,
    camp_world_x FLOAT NOT NULL CHECK (isfinite(camp_world_x)),
    camp_world_y FLOAT NOT NULL CHECK (isfinite(camp_world_y)),
    start_game_time_ms BIGINT NOT NULL,
    end_game_time_ms BIGINT NOT NULL,
    result VARCHAR NOT NULL CHECK (result IN ('cleared', 'not_cleared')),
    damage_event_count UINTEGER NOT NULL CHECK (damage_event_count > 0),
    total_damage BIGINT NOT NULL CHECK (total_damage > 0),
    initial_creep_count UINTEGER NOT NULL CHECK (initial_creep_count > 0),
    dead_initial_creep_count UINTEGER NOT NULL,
    PRIMARY KEY (extraction_id, action_index),
    CHECK (end_game_time_ms >= start_game_time_ms),
    CHECK (dead_initial_creep_count <= initial_creep_count),
    CHECK (result <> 'cleared' OR dead_initial_creep_count = initial_creep_count)
);

CREATE INDEX neutral_camp_farming_actions_player_time_idx
    ON analysis.neutral_camp_farming_actions
       (extraction_id, player_slot, start_game_time_ms);

CREATE OR REPLACE MACRO analysis.match_neutral_camp_farming_actions(
    requested_match_id
) AS TABLE
SELECT action.*
FROM analysis.neutral_camp_farming_actions AS action
JOIN analysis.latest_successful_extractions AS latest
  ON latest.extraction_id = action.extraction_id
WHERE latest.match_id = requested_match_id
ORDER BY action.start_game_time_ms, action.action_index;
