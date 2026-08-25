-- Observed cumulative player gold changes. Rolling windows remain query-time
-- calculations so the same detailed facts support every requested window.

CREATE TABLE analysis.player_gold_events (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    game_player_id INTEGER NOT NULL,
    player_slot UINTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    game_time_seconds DOUBLE NOT NULL,
    total_gold_earned BIGINT NOT NULL,
    PRIMARY KEY (extraction_id, sequence)
);

CREATE INDEX player_gold_events_lookup_idx
    ON analysis.player_gold_events (
        extraction_id, player_slot, game_time_seconds
    );

CREATE OR REPLACE MACRO analysis.match_rolling_gpm(
    requested_match_id,
    requested_window_seconds,
    requested_output_step_seconds
) AS TABLE
WITH selected_extraction AS MATERIALIZED (
    SELECT match.extraction_id, match.duration_seconds
    FROM analysis.matches AS match
    JOIN analysis.latest_successful_extractions AS latest
      ON latest.extraction_id = match.extraction_id
    WHERE match.match_id = requested_match_id
),
output_times AS MATERIALIZED (
    SELECT
        selected.extraction_id,
        output.game_time_seconds::DOUBLE AS game_time_seconds
    FROM selected_extraction AS selected,
         range(
             0,
             greatest(selected.duration_seconds, 0) + 1,
             requested_output_step_seconds
         ) AS output(game_time_seconds)
    -- A pre-game fact supplies the value at zero, but pre-game time is never
    -- allowed to make a rolling window complete.
    WHERE output.game_time_seconds >= requested_window_seconds
),
players AS MATERIALIZED (
    SELECT player.extraction_id, player.player_slot, player.team_id
    FROM analysis.players AS player
    JOIN selected_extraction AS selected USING (extraction_id)
),
player_values AS (
    SELECT
        player.player_slot,
        player.team_id,
        output.game_time_seconds,
        60.0
          * (current_value.total_gold_earned - previous_value.total_gold_earned)
          / requested_window_seconds AS gpm
    FROM players AS player
    CROSS JOIN output_times AS output
    LEFT JOIN LATERAL (
        SELECT event.total_gold_earned
        FROM analysis.player_gold_events AS event
        WHERE event.extraction_id = player.extraction_id
          AND event.player_slot = player.player_slot
          AND event.game_time_seconds <= output.game_time_seconds
        ORDER BY event.game_time_seconds DESC, event.sequence DESC
        LIMIT 1
    ) AS current_value ON true
    LEFT JOIN LATERAL (
        SELECT event.total_gold_earned
        FROM analysis.player_gold_events AS event
        WHERE event.extraction_id = player.extraction_id
          AND event.player_slot = player.player_slot
          AND event.game_time_seconds
              <= output.game_time_seconds - requested_window_seconds
        ORDER BY event.game_time_seconds DESC, event.sequence DESC
        LIMIT 1
    ) AS previous_value ON true
    WHERE current_value.total_gold_earned IS NOT NULL
      AND previous_value.total_gold_earned IS NOT NULL
),
team_values AS (
    SELECT
        player.game_time_seconds,
        player.team_id,
        sum(player.gpm) AS gpm
    FROM player_values AS player
    GROUP BY player.game_time_seconds, player.team_id
    HAVING count(*) = 5
)
SELECT
    'player'::VARCHAR AS series_kind,
    player.player_slot::UINTEGER AS player_slot,
    player.team_id::INTEGER AS team_id,
    player.game_time_seconds::DOUBLE AS game_time_seconds,
    requested_window_seconds::INTEGER AS window_seconds,
    player.gpm::DOUBLE AS gpm
FROM player_values AS player
UNION ALL
SELECT
    'team'::VARCHAR AS series_kind,
    NULL::UINTEGER AS player_slot,
    team.team_id::INTEGER AS team_id,
    team.game_time_seconds::DOUBLE AS game_time_seconds,
    requested_window_seconds::INTEGER AS window_seconds,
    team.gpm::DOUBLE AS gpm
FROM team_values AS team
ORDER BY series_kind, team_id, player_slot NULLS FIRST, game_time_seconds;
