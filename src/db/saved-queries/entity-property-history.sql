-- Follow the game-rules state changes over the course of a replay.
SELECT *
FROM analysis.entity_property_history(
    'e71b42a9e210fbb0f79bedaf0832bd056931a815a4493b7ee1e3756e1cfe4cee',
    56,
    'm_pGameRules.m_nGameState'
);
