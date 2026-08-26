-- Store pause-safe hero locations sampled at 100 ms intervals. The world
-- bounds are calibrated for the map asset used by the first heat map version.

CREATE TABLE analysis.hero_position_samples (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    game_time_milliseconds UINTEGER NOT NULL
        CHECK (game_time_milliseconds % 100 = 0),
    player_slot UINTEGER NOT NULL,
    hero_id INTEGER NOT NULL CHECK (hero_id > 0),
    team_id INTEGER NOT NULL CHECK (team_id IN (2, 3)),
    world_x FLOAT NOT NULL CHECK (isfinite(world_x)),
    world_y FLOAT NOT NULL CHECK (isfinite(world_y)),
    PRIMARY KEY (extraction_id, game_time_milliseconds, player_slot)
);

CREATE INDEX hero_position_samples_player_time_idx
    ON analysis.hero_position_samples
       (extraction_id, player_slot, game_time_milliseconds);

CREATE TABLE analysis.hero_map_world_bounds (
    bounds_id BOOLEAN PRIMARY KEY DEFAULT true CHECK (bounds_id),
    minimum_x FLOAT NOT NULL,
    maximum_x FLOAT NOT NULL,
    minimum_y FLOAT NOT NULL,
    maximum_y FLOAT NOT NULL,
    CHECK (minimum_x < maximum_x),
    CHECK (minimum_y < maximum_y)
);

INSERT INTO analysis.hero_map_world_bounds
    (bounds_id, minimum_x, maximum_x, minimum_y, maximum_y)
VALUES (true, -8288, 8288, -8288, 8288);

CREATE OR REPLACE MACRO analysis.match_hero_heatmap(
    requested_match_id,
    requested_start_milliseconds,
    requested_end_milliseconds,
    requested_player_slot,
    requested_grid_size
) AS TABLE
WITH selected_samples AS MATERIALIZED (
    SELECT sample.world_x, sample.world_y
    FROM analysis.hero_position_samples AS sample
    JOIN analysis.latest_successful_extractions AS latest
      ON latest.extraction_id = sample.extraction_id
    WHERE latest.match_id = requested_match_id
      AND sample.game_time_milliseconds >= requested_start_milliseconds
      AND sample.game_time_milliseconds <= requested_end_milliseconds
      AND (
        requested_player_slot IS NULL
        OR sample.player_slot = requested_player_slot
      )
),
normalized_samples AS (
    SELECT
        least(
            requested_grid_size - 1,
            greatest(
                0,
                floor(
                    (sample.world_x - bounds.minimum_x)
                    / (bounds.maximum_x - bounds.minimum_x)
                    * requested_grid_size
                )::INTEGER
            )
        )::INTEGER AS cell_x,
        -- World Y increases toward the top of the map. Image Y increases
        -- downward, so the heat-map grid uses the inverse Y direction.
        least(
            requested_grid_size - 1,
            greatest(
                0,
                floor(
                    (bounds.maximum_y - sample.world_y)
                    / (bounds.maximum_y - bounds.minimum_y)
                    * requested_grid_size
                )::INTEGER
            )
        )::INTEGER AS cell_y
    FROM selected_samples AS sample
    CROSS JOIN analysis.hero_map_world_bounds AS bounds
    WHERE requested_grid_size > 0
)
SELECT cell_x, cell_y, count(*)::UBIGINT AS sample_count
FROM normalized_samples
GROUP BY cell_x, cell_y
ORDER BY cell_y, cell_x;
