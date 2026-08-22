-- Convenient final-state analysis for the latest successful extraction of a
-- match. These objects retain parser-native IDs and class names.

CREATE OR REPLACE VIEW analysis.latest_successful_extractions AS
SELECT
    match_id,
    extraction_id,
    replay_sha256,
    parser_name,
    parser_version,
    exporter_version,
    started_at,
    completed_at
FROM catalog.extractions
WHERE status = 'succeeded'
QUALIFY row_number() OVER (
    PARTITION BY match_id
    ORDER BY completed_at DESC NULLS LAST,
             started_at DESC NULLS LAST,
             extraction_id DESC
) = 1;

CREATE OR REPLACE MACRO analysis.match_summary(requested_match_id) AS TABLE
WITH selected_entity AS (
    SELECT
        extraction.match_id,
        extraction.extraction_id,
        entity.entity_instance_id
    FROM analysis.latest_successful_extractions AS extraction
    JOIN raw.entity_instances AS entity
      ON entity.extraction_id = extraction.extraction_id
    WHERE extraction.match_id = requested_match_id
      AND entity.class_name = 'CDOTAGamerulesProxy'
    ORDER BY entity.sequence
    LIMIT 1
),
selected_checkpoint AS (
    SELECT
        entity.match_id,
        entity.extraction_id,
        checkpoint.properties
    FROM selected_entity AS entity
    JOIN raw.entity_checkpoints AS checkpoint
      ON checkpoint.extraction_id = entity.extraction_id
     AND checkpoint.entity_instance_id = entity.entity_instance_id
    WHERE checkpoint.checkpoint_kind = 'completion'
    ORDER BY checkpoint.sequence DESC
    LIMIT 1
),
property_values AS (
    SELECT
        checkpoint.match_id,
        checkpoint.extraction_id,
        max(json_extract_string(property.value, '$.value')) FILTER (
            WHERE json_extract_string(property.value, '$.propertyPath') =
                'm_pGameRules.m_nGameWinner'
        )::INTEGER AS winner_team_id,
        max(json_extract_string(property.value, '$.value')) FILTER (
            WHERE json_extract_string(property.value, '$.propertyPath') =
                'm_pGameRules.m_iGameMode'
        )::INTEGER AS game_mode_id,
        max(json_extract_string(property.value, '$.value')) FILTER (
            WHERE json_extract_string(property.value, '$.propertyPath') =
                'm_pGameRules.m_flGameStartTime'
        )::DOUBLE AS game_start_time,
        max(json_extract_string(property.value, '$.value')) FILTER (
            WHERE json_extract_string(property.value, '$.propertyPath') =
                'm_pGameRules.m_flGameEndTime'
        )::DOUBLE AS game_end_time
    FROM selected_checkpoint AS checkpoint,
    LATERAL json_each(checkpoint.properties) AS property
    GROUP BY checkpoint.match_id, checkpoint.extraction_id
)
SELECT
    match_id::UBIGINT AS match_id,
    extraction_id::VARCHAR AS extraction_id,
    winner_team_id::INTEGER AS winner_team_id,
    CASE winner_team_id
        WHEN 2 THEN 'Radiant'
        WHEN 3 THEN 'Dire'
        ELSE CASE WHEN winner_team_id IS NULL THEN NULL ELSE 'Unknown' END
    END::VARCHAR AS winner_team,
    game_mode_id::INTEGER AS game_mode_id,
    game_start_time::DOUBLE AS game_start_time,
    game_end_time::DOUBLE AS game_end_time,
    (game_end_time - game_start_time)::DOUBLE AS duration_seconds
FROM property_values;

CREATE OR REPLACE MACRO analysis.match_players(requested_match_id) AS TABLE
WITH selected_entity AS (
    SELECT
        extraction.match_id,
        extraction.extraction_id,
        entity.entity_instance_id
    FROM analysis.latest_successful_extractions AS extraction
    JOIN raw.entity_instances AS entity
      ON entity.extraction_id = extraction.extraction_id
    WHERE extraction.match_id = requested_match_id
      AND entity.class_name = 'CDOTA_PlayerResource'
    ORDER BY entity.sequence
    LIMIT 1
),
selected_checkpoint AS (
    SELECT
        entity.match_id,
        entity.extraction_id,
        checkpoint.properties
    FROM selected_entity AS entity
    JOIN raw.entity_checkpoints AS checkpoint
      ON checkpoint.extraction_id = entity.extraction_id
     AND checkpoint.entity_instance_id = entity.entity_instance_id
    WHERE checkpoint.checkpoint_kind = 'completion'
    ORDER BY checkpoint.sequence DESC
    LIMIT 1
),
checkpoint_properties AS (
    SELECT
        checkpoint.match_id,
        checkpoint.extraction_id,
        json_extract_string(property.value, '$.propertyPath') AS property_path,
        json_extract_string(property.value, '$.value') AS value
    FROM selected_checkpoint AS checkpoint,
    LATERAL json_each(checkpoint.properties) AS property
),
players AS (
    SELECT
        properties.match_id,
        properties.extraction_id,
        player_index,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerData.{:04d}.m_bIsValid', player_index
            )
        )::BOOLEAN AS is_valid,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerData.{:04d}.m_iPlayerSteamID', player_index
            )
        )::UBIGINT AS steam_id,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerData.{:04d}.m_iPlayerTeam', player_index
            )
        )::INTEGER AS team_id,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerData.{:04d}.m_iszPlayerName', player_index
            )
        )::VARCHAR AS player_name,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerTeamData.{:04d}.m_hSelectedHero', player_index
            )
        )::UBIGINT AS hero_handle,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerTeamData.{:04d}.m_nSelectedHeroID', player_index
            )
        )::INTEGER AS hero_id,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerTeamData.{:04d}.m_iKills', player_index
            )
        )::INTEGER AS kills,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerTeamData.{:04d}.m_iDeaths', player_index
            )
        )::INTEGER AS deaths,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerTeamData.{:04d}.m_iAssists', player_index
            )
        )::INTEGER AS assists,
        max(value) FILTER (
            WHERE property_path = format(
                'm_vecPlayerTeamData.{:04d}.m_iLevel', player_index
            )
        )::INTEGER AS level
    FROM checkpoint_properties AS properties
    CROSS JOIN range(10) AS indexes(player_index)
    GROUP BY properties.match_id, properties.extraction_id, player_index
)
SELECT
    player.match_id::UBIGINT AS match_id,
    player.extraction_id::VARCHAR AS extraction_id,
    player.player_index::UINTEGER AS player_index,
    player.team_id::INTEGER AS team_id,
    CASE player.team_id
        WHEN 2 THEN 'Radiant'
        WHEN 3 THEN 'Dire'
    END::VARCHAR AS team,
    player.player_name::VARCHAR AS player_name,
    player.steam_id::UBIGINT AS steam_id,
    player.hero_id::INTEGER AS hero_id,
    hero.class_name::VARCHAR AS hero_class,
    player.kills::INTEGER AS kills,
    player.deaths::INTEGER AS deaths,
    player.assists::INTEGER AS assists,
    player.level::INTEGER AS level
FROM players AS player
LEFT JOIN raw.entity_instances AS hero
  ON hero.extraction_id = player.extraction_id
 AND hero.handle = player.hero_handle
WHERE player.is_valid
  AND player.team_id IN (2, 3)
ORDER BY player.team_id, player.player_index;
