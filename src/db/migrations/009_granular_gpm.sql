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
    ON analysis.player_gold_events (extraction_id, player_slot, game_time_seconds);

CREATE OR REPLACE MACRO analysis.match_rolling_gpm(
    requested_match_id,
    requested_window_seconds,
    requested_output_step_seconds
) AS TABLE
WITH latest AS (
    SELECT matches.extraction_id, matches.match_id, matches.duration_seconds
    FROM analysis.matches AS matches
    JOIN analysis.latest_successful_extractions AS latest
      ON latest.extraction_id = matches.extraction_id
    WHERE matches.match_id = requested_match_id
),
grid AS (
    SELECT latest.extraction_id, latest.duration_seconds,
           seconds::DOUBLE AS game_time_seconds
    FROM latest, range(0, greatest(duration_seconds, 0) + 1, requested_output_step_seconds) AS times(seconds)
),
players AS (
    SELECT player.extraction_id, player.player_slot, player.team_id
    FROM analysis.players AS player
    JOIN latest ON latest.extraction_id = player.extraction_id
),
player_values AS (
    SELECT p.player_slot, p.team_id, g.game_time_seconds,
           60.0 * (current_value.total_gold_earned - previous_value.total_gold_earned)
             / requested_window_seconds AS gpm
    FROM players p
    CROSS JOIN grid g
    LEFT JOIN LATERAL (
        SELECT e.total_gold_earned
        FROM analysis.player_gold_events e
        WHERE e.extraction_id = p.extraction_id AND e.player_slot = p.player_slot
          AND e.game_time_seconds <= g.game_time_seconds
        ORDER BY e.game_time_seconds DESC, e.sequence DESC
        LIMIT 1
    ) current_value ON true
    LEFT JOIN LATERAL (
        SELECT e.total_gold_earned
        FROM analysis.player_gold_events e
        WHERE e.extraction_id = p.extraction_id AND e.player_slot = p.player_slot
          AND e.game_time_seconds <= g.game_time_seconds - requested_window_seconds
        ORDER BY e.game_time_seconds DESC, e.sequence DESC
        LIMIT 1
    ) previous_value ON true
    WHERE current_value.total_gold_earned IS NOT NULL
      AND previous_value.total_gold_earned IS NOT NULL
),
team_values AS (
    SELECT game_time_seconds, team_id,
           sum(gpm) AS gpm
    FROM player_values
    GROUP BY game_time_seconds, team_id
    HAVING count(*) = 5
)
SELECT 'player'::VARCHAR AS series_kind, player_slot, team_id,
       game_time_seconds, requested_window_seconds::INTEGER AS window_seconds, gpm
FROM player_values
UNION ALL
SELECT 'team'::VARCHAR, NULL::UINTEGER, team_id,
       game_time_seconds, requested_window_seconds::INTEGER, gpm
FROM team_values
ORDER BY series_kind, team_id, player_slot NULLS FIRST, game_time_seconds;
