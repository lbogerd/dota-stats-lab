-- Bound combat-log analysis to the replay's actual game. Sequence preserves
-- parser emission order for same-time records and pre-horn activity.

CREATE OR REPLACE MACRO analysis.is_actual_game(
    requested_extraction_id,
    requested_sequence
) AS (
    WITH requested_values(extraction_value, sequence_value) AS MATERIALIZED (
        SELECT requested_extraction_id, requested_sequence
    ),
    game_state_markers AS MATERIALIZED (
        SELECT
            marker.sequence,
            marker.value,
            min(marker.sequence) FILTER (
                WHERE marker.value = 4
            ) OVER () AS start_sequence
        FROM raw.combat_events AS marker
        CROSS JOIN requested_values AS requested
        WHERE marker.extraction_id = requested.extraction_value
          AND marker.event_type = 'DOTA_COMBATLOG_GAME_STATE'
          AND marker.value IN (4, 6)
    )
    SELECT coalesce(
        requested.extraction_value IS NOT NULL
        AND requested.sequence_value IS NOT NULL
        AND requested.sequence_value >= min(marker.start_sequence)
        AND requested.sequence_value < min(marker.sequence) FILTER (
            WHERE marker.value = 6
              AND marker.sequence > marker.start_sequence
        ),
        false
    )
    FROM requested_values AS requested
    LEFT JOIN game_state_markers AS marker ON true
    GROUP BY requested.extraction_value, requested.sequence_value
);
