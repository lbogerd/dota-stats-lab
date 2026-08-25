-- Compact, typed tables for the match-analysis-v1 extraction profile.

ALTER TABLE catalog.extractions ADD COLUMN IF NOT EXISTS preparation_elapsed_ms UBIGINT;
ALTER TABLE catalog.extractions ADD COLUMN IF NOT EXISTS summary_elapsed_ms UBIGINT;

CREATE TABLE IF NOT EXISTS raw.combat_events (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    game_time DOUBLE,
    raw_time DOUBLE,
    event_type VARCHAR,
    target_name VARCHAR,
    attacker_name VARCHAR,
    damage_source_name VARCHAR,
    inflictor_name VARCHAR,
    target_team INTEGER,
    attacker_team INTEGER,
    value INTEGER,
    health INTEGER,
    location_x FLOAT,
    location_y FLOAT,
    event_location INTEGER,
    stun_duration FLOAT,
    slow_duration FLOAT,
    modifier_duration FLOAT,
    gold_reason INTEGER,
    xp_reason INTEGER,
    last_hits INTEGER,
    net_worth INTEGER,
    gpm INTEGER,
    xpm INTEGER,
    attacker_hero_level INTEGER,
    target_hero_level INTEGER,
    damage_type INTEGER,
    damage_category INTEGER,
    rune_type INTEGER,
    stack_count INTEGER,
    observer_wards_placed INTEGER,
    assist_players INTEGER[],
    attacker_hero BOOLEAN,
    target_hero BOOLEAN,
    target_building BOOLEAN,
    attacker_illusion BOOLEAN,
    target_illusion BOOLEAN,
    heal_save BOOLEAN,
    long_range_kill BOOLEAN,
    PRIMARY KEY (extraction_id, sequence)
);

CREATE INDEX IF NOT EXISTS combat_events_timeline_idx
    ON raw.combat_events (extraction_id, game_time, event_type);

CREATE TABLE IF NOT EXISTS analysis.matches (
    extraction_id VARCHAR PRIMARY KEY,
    match_id UBIGINT NOT NULL,
    start_time TIMESTAMPTZ,
    duration_seconds INTEGER,
    game_mode VARCHAR,
    lobby_type INTEGER,
    winner_team_id INTEGER,
    winner_team VARCHAR,
    radiant_score INTEGER,
    dire_score INTEGER,
    radiant_team_name VARCHAR,
    dire_team_name VARCHAR,
    cluster INTEGER,
    first_blood_seconds INTEGER,
    metadata_version INTEGER,
    CHECK (winner_team_id IS NULL OR winner_team_id IN (2, 3))
);

CREATE INDEX IF NOT EXISTS matches_list_idx
    ON analysis.matches (start_time, match_id);

CREATE TABLE IF NOT EXISTS analysis.players (
    extraction_id VARCHAR NOT NULL,
    player_slot UINTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    team VARCHAR NOT NULL,
    team_slot UINTEGER,
    account_id UBIGINT,
    player_name VARCHAR,
    hero_id INTEGER,
    level INTEGER,
    kills INTEGER,
    deaths INTEGER,
    assists INTEGER,
    last_hits INTEGER,
    denies INTEGER,
    gold_per_min INTEGER,
    xp_per_min INTEGER,
    net_worth INTEGER,
    hero_damage INTEGER,
    tower_damage INTEGER,
    hero_healing INTEGER,
    PRIMARY KEY (extraction_id, player_slot)
);

CREATE TABLE IF NOT EXISTS analysis.player_items (
    extraction_id VARCHAR NOT NULL,
    player_slot UINTEGER NOT NULL,
    item_slot UINTEGER NOT NULL,
    item_id INTEGER,
    PRIMARY KEY (extraction_id, player_slot, item_slot)
);

CREATE TABLE IF NOT EXISTS analysis.team_time_series (
    extraction_id VARCHAR NOT NULL,
    team_id INTEGER NOT NULL,
    sample_index UINTEGER NOT NULL,
    net_worth DOUBLE,
    gold_earned DOUBLE,
    experience DOUBLE,
    PRIMARY KEY (extraction_id, team_id, sample_index)
);

CREATE OR REPLACE MACRO analysis.match_summary(requested_match_id) AS TABLE
SELECT
    match_id, extraction_id, start_time, duration_seconds, game_mode,
    lobby_type, winner_team_id, winner_team, radiant_score, dire_score,
    radiant_team_name, dire_team_name, cluster, first_blood_seconds
FROM analysis.matches AS match
WHERE match.match_id = requested_match_id
  AND match.extraction_id = (
      SELECT extraction_id FROM analysis.latest_successful_extractions latest
      WHERE latest.match_id = requested_match_id
  );

CREATE OR REPLACE MACRO analysis.match_players(requested_match_id) AS TABLE
SELECT player.*
FROM analysis.players AS player
JOIN analysis.latest_successful_extractions AS latest USING (extraction_id)
WHERE latest.match_id = requested_match_id
ORDER BY player.team_id, player.team_slot, player.player_slot;

CREATE OR REPLACE MACRO analysis.match_team_totals(requested_match_id) AS TABLE
SELECT
    player.team_id,
    player.team,
    count(*)::INTEGER AS players,
    sum(player.kills)::INTEGER AS kills,
    sum(player.deaths)::INTEGER AS deaths,
    sum(player.assists)::INTEGER AS assists,
    sum(player.last_hits)::INTEGER AS last_hits,
    sum(player.denies)::INTEGER AS denies,
    sum(player.net_worth)::BIGINT AS net_worth,
    sum(player.hero_damage)::BIGINT AS hero_damage,
    sum(player.tower_damage)::BIGINT AS tower_damage,
    sum(player.hero_healing)::BIGINT AS hero_healing
FROM analysis.match_players(requested_match_id) AS player
GROUP BY player.team_id, player.team
ORDER BY player.team_id;

CREATE OR REPLACE MACRO analysis.match_net_worth(requested_match_id) AS TABLE
SELECT series.team_id, series.sample_index, series.net_worth,
       series.net_worth - other.net_worth AS net_worth_advantage
FROM analysis.team_time_series series
JOIN analysis.team_time_series other
  ON other.extraction_id = series.extraction_id
 AND other.sample_index = series.sample_index
 AND other.team_id <> series.team_id
JOIN analysis.latest_successful_extractions latest
  ON latest.extraction_id = series.extraction_id
WHERE latest.match_id = requested_match_id
ORDER BY series.sample_index, series.team_id;
