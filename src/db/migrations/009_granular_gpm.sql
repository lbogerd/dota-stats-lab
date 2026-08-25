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
events AS MATERIALIZED (
    -- Parser output is normally tick-coalesced. Collapse any same-time facts
    -- defensively so timeline lookups retain the latest shared sequence.
    SELECT
        event.extraction_id,
        event.player_slot,
        event.game_time_seconds AS event_game_time_seconds,
        arg_max(event.total_gold_earned, event.sequence) AS total_gold_earned
    FROM analysis.player_gold_events AS event
    JOIN selected_extraction AS selected USING (extraction_id)
    GROUP BY event.extraction_id, event.player_slot, event.game_time_seconds
),
lookup_grid AS MATERIALIZED (
    SELECT
        player.extraction_id,
        player.player_slot,
        player.team_id,
        output.game_time_seconds AS output_game_time_seconds,
        'current'::VARCHAR AS lookup_kind,
        output.game_time_seconds AS lookup_game_time_seconds
    FROM players AS player
    CROSS JOIN output_times AS output
    UNION ALL
    SELECT
        player.extraction_id,
        player.player_slot,
        player.team_id,
        output.game_time_seconds AS output_game_time_seconds,
        'previous'::VARCHAR AS lookup_kind,
        output.game_time_seconds - requested_window_seconds AS lookup_game_time_seconds
    FROM players AS player
    CROSS JOIN output_times AS output
),
timeline AS MATERIALIZED (
    SELECT
        player.extraction_id,
        player.player_slot,
        player.team_id,
        NULL::DOUBLE AS output_game_time_seconds,
        NULL::VARCHAR AS lookup_kind,
        event.event_game_time_seconds AS lookup_game_time_seconds,
        0::UTINYINT AS row_kind,
        event.total_gold_earned
    FROM events AS event
    JOIN players AS player USING (extraction_id, player_slot)
    UNION ALL
    SELECT
        lookup.extraction_id,
        lookup.player_slot,
        lookup.team_id,
        lookup.output_game_time_seconds,
        lookup.lookup_kind,
        lookup.lookup_game_time_seconds,
        1::UTINYINT AS row_kind,
        NULL::BIGINT AS total_gold_earned
    FROM lookup_grid AS lookup
),
resolved_timeline AS MATERIALIZED (
    SELECT
        timeline.*,
        last_value(total_gold_earned IGNORE NULLS) OVER (
            PARTITION BY extraction_id, player_slot
            ORDER BY lookup_game_time_seconds, row_kind
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS resolved_gold
    FROM timeline
),
player_values AS (
    SELECT
        resolved.player_slot,
        resolved.team_id,
        resolved.output_game_time_seconds AS game_time_seconds,
        60.0
          * (
              max(resolved_gold) FILTER (WHERE lookup_kind = 'current')
              - max(resolved_gold) FILTER (WHERE lookup_kind = 'previous')
            )
          / requested_window_seconds AS gpm
    FROM resolved_timeline AS resolved
    WHERE resolved.row_kind = 1
    GROUP BY resolved.player_slot, resolved.team_id, resolved.output_game_time_seconds
    HAVING count(resolved_gold) FILTER (WHERE lookup_kind = 'current') = 1
       AND count(resolved_gold) FILTER (WHERE lookup_kind = 'previous') = 1
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
