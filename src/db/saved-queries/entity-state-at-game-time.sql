-- Reconstruct every known property for the game-rules entity at 20:00.
SELECT *
FROM analysis.entity_state_at_game_time(
    'e71b42a9e210fbb0f79bedaf0832bd056931a815a4493b7ee1e3756e1cfe4cee',
    56,
    1200.0
)
LIMIT 100;
