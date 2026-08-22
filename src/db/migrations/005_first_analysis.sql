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
WITH selected_entity AS MATERIALIZED (
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
selected_checkpoint_key AS MATERIALIZED (
    SELECT
        checkpoint.extraction_id,
        checkpoint.entity_instance_id,
        checkpoint.sequence
    FROM selected_entity AS entity
    JOIN raw.entity_checkpoints AS checkpoint
      ON checkpoint.extraction_id = entity.extraction_id
     AND checkpoint.entity_instance_id = entity.entity_instance_id
    WHERE checkpoint.checkpoint_kind = 'completion'
    ORDER BY checkpoint.sequence DESC
    LIMIT 1
),
selected_checkpoint AS MATERIALIZED (
    SELECT
        entity.match_id,
        key.extraction_id,
        checkpoint.properties
    FROM selected_entity AS entity
    JOIN selected_checkpoint_key AS key
      ON key.extraction_id = entity.extraction_id
     AND key.entity_instance_id = entity.entity_instance_id
    JOIN raw.entity_checkpoints AS checkpoint
      ON checkpoint.extraction_id = key.extraction_id
     AND checkpoint.entity_instance_id = key.entity_instance_id
     AND checkpoint.sequence = key.sequence
),
-- A scalar json_each input expands only the selected JSON value. A lateral
-- join would retain the large parent checkpoint once for every property row.
checkpoint_properties AS MATERIALIZED (
    SELECT
        json_extract_string(property.value, '$.propertyPath') AS property_path,
        json_extract_string(property.value, '$.value') AS value
    FROM json_each((SELECT properties FROM selected_checkpoint)) AS property
),
property_values AS (
    SELECT
        entity.match_id,
        entity.extraction_id,
        max(property.value) FILTER (
            WHERE property.property_path = 'm_pGameRules.m_nGameWinner'
        )::INTEGER AS winner_team_id,
        max(property.value) FILTER (
            WHERE property.property_path = 'm_pGameRules.m_iGameMode'
        )::INTEGER AS game_mode_id,
        max(property.value) FILTER (
            WHERE property.property_path = 'm_pGameRules.m_flGameStartTime'
        )::DOUBLE AS game_start_time,
        max(property.value) FILTER (
            WHERE property.property_path = 'm_pGameRules.m_flGameEndTime'
        )::DOUBLE AS game_end_time
    FROM selected_entity AS entity
    CROSS JOIN checkpoint_properties AS property
    GROUP BY entity.match_id, entity.extraction_id
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
WITH selected_entity AS MATERIALIZED (
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
selected_checkpoint_key AS MATERIALIZED (
    SELECT
        checkpoint.extraction_id,
        checkpoint.entity_instance_id,
        checkpoint.sequence
    FROM selected_entity AS entity
    JOIN raw.entity_checkpoints AS checkpoint
      ON checkpoint.extraction_id = entity.extraction_id
     AND checkpoint.entity_instance_id = entity.entity_instance_id
    WHERE checkpoint.checkpoint_kind = 'completion'
    ORDER BY checkpoint.sequence DESC
    LIMIT 1
),
selected_checkpoint AS MATERIALIZED (
    SELECT
        entity.match_id,
        key.extraction_id,
        checkpoint.properties
    FROM selected_entity AS entity
    JOIN selected_checkpoint_key AS key
      ON key.extraction_id = entity.extraction_id
     AND key.entity_instance_id = entity.entity_instance_id
    JOIN raw.entity_checkpoints AS checkpoint
      ON checkpoint.extraction_id = key.extraction_id
     AND checkpoint.entity_instance_id = key.entity_instance_id
     AND checkpoint.sequence = key.sequence
),
-- Keep the selected checkpoint JSON out of the expanded rows so this final
-- state query stays within the web SQL runner's bounded memory configuration.
checkpoint_properties AS MATERIALIZED (
    SELECT
        json_extract_string(property.value, '$.propertyPath') AS property_path,
        json_extract_string(property.value, '$.value') AS value
    FROM json_each((SELECT properties FROM selected_checkpoint)) AS property
),
players AS (
    SELECT
        entity.match_id,
        entity.extraction_id,
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
    FROM selected_entity AS entity
    CROSS JOIN range(10) AS indexes(player_index)
    CROSS JOIN checkpoint_properties AS properties
    GROUP BY entity.match_id, entity.extraction_id, player_index
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
