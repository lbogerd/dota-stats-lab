-- Bind: extraction_id (VARCHAR), instance_id (UBIGINT), game_time (DOUBLE).
SELECT *
FROM analysis.entity_state_at_game_time(?::VARCHAR, ?::UBIGINT, ?::DOUBLE);
