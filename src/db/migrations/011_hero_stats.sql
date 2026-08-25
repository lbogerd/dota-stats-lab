-- Normalize the draft from stored match documents and expose hero overview
-- statistics over the latest successful extraction for every match.

CREATE TABLE analysis.hero_draft_events (
    extraction_id VARCHAR NOT NULL,
    draft_order UINTEGER NOT NULL,
    hero_id INTEGER NOT NULL CHECK (hero_id > 0),
    is_pick BOOLEAN NOT NULL,
    team_index INTEGER NOT NULL CHECK (team_index IN (0, 1)),
    PRIMARY KEY (extraction_id, draft_order)
);

CREATE INDEX hero_draft_events_lookup_idx
    ON analysis.hero_draft_events (extraction_id, hero_id, is_pick);

INSERT INTO analysis.hero_draft_events
SELECT
    overview.extraction_id,
    draft.key::UINTEGER AS draft_order,
    try_cast(json_extract_string(draft.value, '$.hero_id') AS INTEGER) AS hero_id,
    try_cast(json_extract_string(draft.value, '$.is_pick') AS BOOLEAN) AS is_pick,
    try_cast(json_extract_string(draft.value, '$.team') AS INTEGER) AS team_index
FROM raw.records AS overview,
     json_each(overview.payload, '$.picks_bans') AS draft
WHERE overview.record_type = 'CMsgDOTAMatch'
  AND try_cast(json_extract_string(draft.value, '$.hero_id') AS INTEGER) > 0
  AND json_type(draft.value, '$.is_pick') = 'BOOLEAN'
  AND try_cast(json_extract_string(draft.value, '$.team') AS INTEGER) IN (0, 1);

CREATE OR REPLACE MACRO analysis.hero_stats() AS TABLE
WITH match_scope AS MATERIALIZED (
    SELECT match.match_id, match.extraction_id, match.winner_team_id
    FROM analysis.matches AS match
    JOIN analysis.latest_successful_extractions AS latest
      ON latest.extraction_id = match.extraction_id
     AND latest.match_id = match.match_id
),
scope_size AS MATERIALIZED (
    SELECT count(DISTINCT match_id)::INTEGER AS match_count
    FROM match_scope
),
player_facts AS MATERIALIZED (
    SELECT
        player.hero_id,
        count(DISTINCT scope.match_id)::INTEGER AS picks,
        count(DISTINCT scope.match_id) FILTER (
            WHERE scope.winner_team_id IN (2, 3)
              AND player.team_id = scope.winner_team_id
        )::INTEGER AS wins,
        count(DISTINCT scope.match_id) FILTER (
            WHERE scope.winner_team_id IN (2, 3)
              AND player.team_id <> scope.winner_team_id
        )::INTEGER AS losses,
        avg(player.gold_per_min)::DOUBLE AS average_gpm,
        avg(player.xp_per_min)::DOUBLE AS average_xpm
    FROM analysis.players AS player
    JOIN match_scope AS scope USING (extraction_id)
    WHERE player.hero_id IS NOT NULL
      AND player.hero_id > 0
    GROUP BY player.hero_id
),
ban_facts AS MATERIALIZED (
    SELECT
        draft.hero_id,
        count(DISTINCT scope.match_id)::INTEGER AS bans
    FROM analysis.hero_draft_events AS draft
    JOIN match_scope AS scope USING (extraction_id)
    WHERE NOT draft.is_pick
    GROUP BY draft.hero_id
),
heroes AS (
    SELECT hero_id FROM player_facts
    UNION
    SELECT hero_id FROM ban_facts
),
combined AS (
    SELECT
        hero.hero_id,
        scope.match_count,
        coalesce(player.picks, 0)::INTEGER AS picks,
        coalesce(ban.bans, 0)::INTEGER AS bans,
        coalesce(player.wins, 0)::INTEGER AS wins,
        coalesce(player.losses, 0)::INTEGER AS losses,
        player.average_gpm,
        player.average_xpm
    FROM heroes AS hero
    CROSS JOIN scope_size AS scope
    LEFT JOIN player_facts AS player USING (hero_id)
    LEFT JOIN ban_facts AS ban USING (hero_id)
)
SELECT
    hero_id,
    match_count,
    picks,
    bans,
    wins,
    losses,
    picks::DOUBLE / nullif(match_count, 0) AS pick_rate,
    bans::DOUBLE / nullif(match_count, 0) AS ban_rate,
    wins::DOUBLE / nullif(wins + losses, 0) AS win_rate,
    losses::DOUBLE / nullif(wins + losses, 0) AS loss_rate,
    average_gpm,
    average_xpm
FROM combined
ORDER BY pick_rate DESC, ban_rate DESC, hero_id;
