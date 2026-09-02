import { DuckDBInstance } from "@duckdb/node-api";

const AUDIT_VERSION = "death-anchored-fights-v1-fields";
const DEFAULT_MATCH_COUNT = 5;

const warehousePath = required("WAREHOUSE_PATH");
const requestedMatchCount = positiveInteger(
  process.env.FIGHTS_AUDIT_MATCH_COUNT ?? String(DEFAULT_MATCH_COUNT),
  "FIGHTS_AUDIT_MATCH_COUNT",
);

const instance = await DuckDBInstance.create(warehousePath, {
  access_mode: "READ_ONLY",
  threads: "1",
  memory_limit: "1GB",
  enable_external_access: "false",
});
const connection = await instance.connect();

let output;
try {
  await requireAuditSchema(connection);
  const positionTableAvailable = await tableExists(connection, "analysis", "hero_position_samples");
  const matches = await selectMatches(connection, requestedMatchCount);
  const auditedMatches = [];

  for (const match of matches) {
    const bounds = await readActualGameBounds(connection, match.extractionId);
    const parameters = {
      extractionId: match.extractionId,
      startSequence: bounds.startSequence,
      endSequence: bounds.endSequence,
    };

    const [events, assists, positions] = await Promise.all([
      bounds.available ? readEventFindings(connection, parameters) : emptyEventFindings(),
      bounds.available ? readAssistFindings(connection, parameters) : emptyAssistFindings(),
      readPositionFindings(connection, match.extractionId, positionTableAvailable),
    ]);

    auditedMatches.push({
      matchId: match.matchId,
      startTime: match.startTime,
      durationSeconds: match.durationSeconds,
      exporterVersion: match.exporterVersion,
      manifestSchemaVersion: match.manifestSchemaVersion,
      extractionProfile: match.extractionProfile,
      rosterPlayers: match.rosterPlayers,
      actualGameBounds: {
        available: bounds.available,
        startSequencePresent: bounds.startSequence !== null,
        endSequencePresent: bounds.endSequence !== null,
      },
      ...events,
      assists,
      positions,
    });
  }

  output = {
    auditVersion: AUDIT_VERSION,
    readOnly: true,
    privacy: "Output contains no player names, hero names, account IDs, or extraction IDs.",
    selection: {
      order: "match start time descending, then match ID descending",
      requestedMatchCount,
      selectedMatchCount: auditedMatches.length,
    },
    matches: auditedMatches,
  };
} finally {
  connection.closeSync();
  instance.closeSync();
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

async function selectMatches(connection, limit) {
  const result = await connection.runAndReadAll(
    `SELECT
       match.extraction_id,
       match.match_id::VARCHAR AS match_id,
       match.start_time::VARCHAR AS start_time,
       match.duration_seconds,
       extraction.exporter_version,
       try_cast(json_extract_string(extraction.manifest, '$.schemaVersion') AS INTEGER)
         AS manifest_schema_version,
       coalesce(
         json_extract_string(extraction.extraction_config, '$.profile'),
         json_extract_string(extraction.manifest, '$.config.profile')
       ) AS extraction_profile,
       (SELECT count(*)
        FROM analysis.players AS player
        WHERE player.extraction_id = match.extraction_id) AS roster_players
     FROM analysis.matches AS match
     JOIN analysis.latest_successful_extractions AS latest USING (extraction_id)
     JOIN catalog.extractions AS extraction USING (extraction_id)
     ORDER BY match.start_time DESC NULLS LAST, match.match_id DESC
     LIMIT $limit`,
    { limit },
  );
  return result.getRowObjectsJson().map((row) => ({
    extractionId: requiredString(row.extraction_id, "extraction ID"),
    matchId: requiredString(row.match_id, "match ID"),
    startTime: nullableString(row.start_time, "match start time"),
    durationSeconds: nullableInteger(row.duration_seconds, "match duration"),
    exporterVersion: nullableString(row.exporter_version, "exporter version"),
    manifestSchemaVersion: nullableInteger(row.manifest_schema_version, "manifest schema version"),
    extractionProfile: nullableString(row.extraction_profile, "extraction profile"),
    rosterPlayers: count(row.roster_players, "roster players"),
  }));
}

async function readActualGameBounds(connection, extractionId) {
  const startResult = await connection.runAndReadAll(
    `SELECT min(sequence) AS start_sequence
     FROM raw.combat_events
     WHERE extraction_id = $extractionId
       AND event_type = 'DOTA_COMBATLOG_GAME_STATE'
       AND value = 4`,
    { extractionId },
  );
  const startSequence = nullableBigInt(startResult.getRowObjectsJson()[0]?.start_sequence, "game start sequence");
  if (startSequence === null) {
    return { available: false, startSequence: null, endSequence: null };
  }

  const endResult = await connection.runAndReadAll(
    `SELECT min(sequence) AS end_sequence
     FROM raw.combat_events
     WHERE extraction_id = $extractionId
       AND event_type = 'DOTA_COMBATLOG_GAME_STATE'
       AND value = 6
       AND sequence > $startSequence`,
    { extractionId, startSequence },
  );
  const endSequence = nullableBigInt(endResult.getRowObjectsJson()[0]?.end_sequence, "game end sequence");
  return { available: endSequence !== null, startSequence, endSequence };
}

async function readEventFindings(connection, parameters) {
  const result = await connection.runAndReadAll(
    `SELECT
       count(*) FILTER (WHERE event_type = 'DOTA_COMBATLOG_DEATH') AS death_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND target_hero = true AND target_team IN (2, 3)
       ) AS hero_death_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND target_hero = true AND target_team IN (2, 3)
           AND target_illusion = false
       ) AS non_illusion_hero_death_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND target_hero = true AND target_team IN (2, 3)
           AND target_illusion = false
           AND game_time IS NOT NULL AND isfinite(game_time)
           AND nullif(target_name, '') IS NOT NULL
       ) AS death_rows_with_victim_and_time,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND target_hero = true AND target_team IN (2, 3)
           AND nullif(attacker_name, '') IS NOT NULL
       ) AS hero_death_rows_with_attacker,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND target_hero = true AND target_team IN (2, 3)
           AND nullif(damage_source_name, '') IS NOT NULL
       ) AS hero_death_rows_with_credited_source,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND target_hero = true AND target_team IN (2, 3)
           AND nullif(damage_source_name, '') IS NOT NULL
           AND damage_source_name IS DISTINCT FROM attacker_name
       ) AS hero_death_rows_with_distinct_credited_source,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND target_hero = true AND target_team IN (2, 3)
           AND list_count(coalesce(assist_players, []::INTEGER[])) > 0
       ) AS hero_death_rows_with_assists,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND target_hero = true AND target_team IN (2, 3)
           AND location_x IS NOT NULL AND isfinite(location_x)
           AND location_y IS NOT NULL AND isfinite(location_y)
       ) AS hero_death_rows_with_location,
       count(*) FILTER (WHERE event_type = 'DOTA_COMBATLOG_DAMAGE') AS damage_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DAMAGE'
           AND target_hero = true AND target_team IN (2, 3)
       ) AS hero_target_damage_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DAMAGE'
           AND target_hero = true AND target_team IN (2, 3)
           AND attacker_team IN (2, 3) AND attacker_team <> target_team
           AND value > 0 AND game_time IS NOT NULL AND isfinite(game_time)
       ) AS enemy_hero_damage_shape_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DAMAGE'
           AND target_hero = true AND target_team IN (2, 3)
           AND starts_with(coalesce(damage_source_name, ''), 'npc_dota_hero_')
       ) AS hero_target_damage_hero_source_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DAMAGE'
           AND target_hero = true AND target_team IN (2, 3)
           AND starts_with(coalesce(damage_source_name, ''), 'npc_dota_hero_')
           AND damage_source_name IS DISTINCT FROM attacker_name
       ) AS hero_target_damage_controlled_source_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DAMAGE'
           AND (attacker_illusion = true OR target_illusion = true)
       ) AS illusion_damage_rows,
       count(*) FILTER (WHERE event_type = 'DOTA_COMBATLOG_HEAL') AS heal_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_HEAL' AND target_hero = true
       ) AS hero_target_heal_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_HEAL' AND target_hero = true
           AND starts_with(coalesce(damage_source_name, ''), 'npc_dota_hero_')
       ) AS heal_hero_source_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_HEAL'
           AND nullif(damage_source_name, '') IS NOT NULL
           AND damage_source_name IS DISTINCT FROM attacker_name
       ) AS heal_distinct_source_rows,
       count(*) FILTER (WHERE event_type = 'DOTA_COMBATLOG_XP') AS experience_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_XP'
           AND value IS NOT NULL AND game_time IS NOT NULL AND isfinite(game_time)
       ) AS experience_rows_with_value_and_time,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_XP'
           AND starts_with(coalesce(target_name, ''), 'npc_dota_hero_')
       ) AS experience_hero_target_name_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_XP'
           AND nullif(attacker_name, '') IS NOT NULL
       ) AS experience_attacker_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_XP'
           AND nullif(damage_source_name, '') IS NOT NULL
       ) AS experience_source_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH' AND target_building = true
       ) AS building_death_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND contains(lower(coalesce(target_name, '')), 'tower')
       ) AS tower_death_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND (contains(lower(coalesce(target_name, '')), 'barracks')
             OR contains(lower(coalesce(target_name, '')), '_rax'))
       ) AS barracks_death_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND contains(lower(coalesce(target_name, '')), 'roshan')
       ) AS roshan_death_rows,
       count(*) FILTER (
         WHERE event_type = 'DOTA_COMBATLOG_DEATH'
           AND contains(lower(coalesce(target_name, '')), 'tormentor')
       ) AS tormentor_death_rows
     FROM raw.combat_events
     WHERE extraction_id = $extractionId
       AND sequence >= $startSequence
       AND sequence < $endSequence
       AND event_type IN (
         'DOTA_COMBATLOG_DEATH', 'DOTA_COMBATLOG_DAMAGE',
         'DOTA_COMBATLOG_HEAL', 'DOTA_COMBATLOG_XP'
       )`,
    parameters,
  );
  const row = result.getRowObjectsJson()[0] ?? {};
  return {
    deaths: {
      rows: count(row.death_rows, "death rows"),
      heroRows: count(row.hero_death_rows, "hero death rows"),
      nonIllusionHeroRows: count(row.non_illusion_hero_death_rows, "non-illusion hero death rows"),
      rowsWithVictimAndFiniteTime: count(row.death_rows_with_victim_and_time, "death victim/time rows"),
      rowsWithAttacker: count(row.hero_death_rows_with_attacker, "death attacker rows"),
      rowsWithCreditedSource: count(row.hero_death_rows_with_credited_source, "death source rows"),
      rowsWithDistinctCreditedSource: count(
        row.hero_death_rows_with_distinct_credited_source,
        "distinct death source rows",
      ),
      rowsWithAssists: count(row.hero_death_rows_with_assists, "death assist rows"),
      rowsWithEventLocation: count(row.hero_death_rows_with_location, "death location rows"),
    },
    damage: {
      rows: count(row.damage_rows, "damage rows"),
      heroTargetRows: count(row.hero_target_damage_rows, "hero target damage rows"),
      enemyHeroShapeRows: count(row.enemy_hero_damage_shape_rows, "enemy hero damage shape rows"),
      heroSourceRows: count(row.hero_target_damage_hero_source_rows, "hero source damage rows"),
      controlledSourceRows: count(row.hero_target_damage_controlled_source_rows, "controlled source damage rows"),
      illusionRows: count(row.illusion_damage_rows, "illusion damage rows"),
    },
    healing: {
      rows: count(row.heal_rows, "heal rows"),
      heroTargetRows: count(row.hero_target_heal_rows, "hero target heal rows"),
      heroSourceRows: count(row.heal_hero_source_rows, "hero source heal rows"),
      distinctSourceRows: count(row.heal_distinct_source_rows, "distinct heal source rows"),
    },
    experience: {
      rows: count(row.experience_rows, "experience rows"),
      rowsWithValueAndFiniteTime: count(row.experience_rows_with_value_and_time, "experience value/time rows"),
      heroTargetNameRows: count(row.experience_hero_target_name_rows, "experience hero target rows"),
      rowsWithAttacker: count(row.experience_attacker_rows, "experience attacker rows"),
      rowsWithCreditedSource: count(row.experience_source_rows, "experience source rows"),
    },
    objectives: {
      buildingDeathRows: count(row.building_death_rows, "building death rows"),
      towerDeathRows: count(row.tower_death_rows, "tower death rows"),
      barracksDeathRows: count(row.barracks_death_rows, "barracks death rows"),
      roshanDeathRows: count(row.roshan_death_rows, "Roshan death rows"),
      tormentorDeathRows: count(row.tormentor_death_rows, "Tormentor death rows"),
    },
  };
}

async function readAssistFindings(connection, parameters) {
  const result = await connection.runAndReadAll(
    `WITH metadata_candidates AS MATERIALIZED (
       SELECT try_cast(json_extract_string(player.value, '$.game_player_id') AS INTEGER)
         AS game_player_id
       FROM raw.records AS metadata,
            json_each(metadata.payload, '$.metadata.teams') AS team,
            json_each(team.value, '$.players') AS player
       WHERE metadata.extraction_id = $extractionId
         AND metadata.record_type = 'CDOTAMatchMetadataFile'
     ), metadata_ids AS (
       SELECT game_player_id, count(*) AS candidate_count
       FROM metadata_candidates
       WHERE game_player_id IS NOT NULL AND game_player_id >= 0
       GROUP BY game_player_id
     ), assist_ids AS (
       SELECT assist.game_player_id
       FROM raw.combat_events AS event,
            unnest(coalesce(event.assist_players, []::INTEGER[])) AS assist(game_player_id)
       WHERE event.extraction_id = $extractionId
         AND event.sequence >= $startSequence
         AND event.sequence < $endSequence
         AND event.event_type = 'DOTA_COMBATLOG_DEATH'
         AND event.target_hero = true
         AND event.target_team IN (2, 3)
     )
     SELECT
       (SELECT count(*) FROM metadata_ids) AS metadata_game_player_ids,
       (SELECT count(*) FROM metadata_ids WHERE candidate_count > 1) AS ambiguous_metadata_ids,
       count(*) AS assist_credits,
       count(*) FILTER (WHERE metadata.candidate_count = 1) AS mapped_assist_credits,
       count(*) FILTER (WHERE metadata.game_player_id IS NULL) AS unmapped_assist_credits,
       count(*) FILTER (WHERE metadata.candidate_count > 1) AS ambiguous_assist_credits
     FROM assist_ids AS assist
     LEFT JOIN metadata_ids AS metadata USING (game_player_id)`,
    parameters,
  );
  const row = result.getRowObjectsJson()[0] ?? {};
  return {
    metadataGamePlayerIds: count(row.metadata_game_player_ids, "metadata game-player IDs"),
    ambiguousMetadataIds: count(row.ambiguous_metadata_ids, "ambiguous metadata IDs"),
    credits: count(row.assist_credits, "assist credits"),
    mappedCredits: count(row.mapped_assist_credits, "mapped assist credits"),
    unmappedCredits: count(row.unmapped_assist_credits, "unmapped assist credits"),
    ambiguousCredits: count(row.ambiguous_assist_credits, "ambiguous assist credits"),
  };
}

async function readPositionFindings(connection, extractionId, schemaAvailable) {
  if (!schemaAvailable) {
    return { schemaAvailable: false, rows: null, onExact100MillisecondBoundary: null };
  }
  const result = await connection.runAndReadAll(
    `SELECT
       count(*) AS position_rows,
       count(*) FILTER (WHERE game_time_milliseconds % 100 = 0) AS exact_boundary_rows
     FROM analysis.hero_position_samples
     WHERE extraction_id = $extractionId`,
    { extractionId },
  );
  const row = result.getRowObjectsJson()[0] ?? {};
  const rows = count(row.position_rows, "position rows");
  const exactRows = count(row.exact_boundary_rows, "exact position rows");
  return {
    schemaAvailable: true,
    rows,
    onExact100MillisecondBoundary: rows === 0 ? null : exactRows === rows,
  };
}

async function requireAuditSchema(connection) {
  const requiredColumns = new Map([
    ["analysis.matches", ["extraction_id", "match_id", "start_time", "duration_seconds"]],
    ["analysis.players", ["extraction_id"]],
    ["catalog.extractions", ["extraction_id", "exporter_version", "extraction_config", "manifest"]],
    ["raw.combat_events", [
      "extraction_id", "sequence", "game_time", "event_type", "target_name", "attacker_name",
      "damage_source_name", "target_team", "attacker_team", "value", "location_x", "location_y",
      "assist_players", "attacker_hero", "target_hero", "target_building", "attacker_illusion",
      "target_illusion",
    ]],
    ["raw.records", ["extraction_id", "record_type", "payload"]],
  ]);
  const result = await connection.runAndReadAll(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE table_schema IN ('analysis', 'catalog', 'raw')`,
  );
  const found = new Set(result.getRowObjectsJson().map((row) => (
    `${row.table_schema}.${row.table_name}.${row.column_name}`
  )));
  const missing = [];
  for (const [table, columns] of requiredColumns) {
    for (const column of columns) {
      if (!found.has(`${table}.${column}`)) missing.push(`${table}.${column}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Fight audit requires missing warehouse fields: ${missing.join(", ")}`);
  }
  if (!await tableExists(connection, "analysis", "latest_successful_extractions")) {
    throw new Error("Fight audit requires analysis.latest_successful_extractions");
  }
}

async function tableExists(connection, schema, table) {
  const result = await connection.runAndReadAll(
    `SELECT count(*) AS table_count
     FROM information_schema.tables
     WHERE table_schema = $schema AND table_name = $table`,
    { schema, table },
  );
  return count(result.getRowObjectsJson()[0]?.table_count, "table count") === 1;
}

function emptyEventFindings() {
  return {
    deaths: null,
    damage: null,
    healing: null,
    experience: null,
    objectives: null,
  };
}

function emptyAssistFindings() {
  return null;
}

function count(value, label) {
  const parsed = typeof value === "number" ? value
    : typeof value === "bigint" ? Number(value)
      : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Fight audit is missing ${label}`);
  return parsed;
}

function nullableInteger(value, label) {
  if (value === null || value === undefined) return null;
  return count(value, label);
}

function nullableBigInt(value, label) {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Fight audit has an invalid ${label}`);
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Fight audit is missing ${label}`);
  return value;
}

function nullableString(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Fight audit has an invalid ${label}`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(`${name} must be an integer from 1 through 100`);
  }
  return parsed;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
