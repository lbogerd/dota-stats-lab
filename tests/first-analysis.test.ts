import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-first-analysis-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");

const warehouse = await openWarehouse();
await migrate(warehouse.connection);
after(warehouse.close);

const matchId = 8_953_222_159n;
const previousExtractionId = "a".repeat(64);
const selectedExtractionId = "b".repeat(64);
const failedExtractionId = "c".repeat(64);

await warehouse.connection.run(`
  INSERT INTO catalog.extractions (
    extraction_id, match_id, replay_sha256, parser_name, parser_version,
    exporter_version, extraction_config, checkpoint_interval_seconds,
    output_limit_bytes, started_at, completed_at, status
  ) VALUES
    ('${previousExtractionId}', ${matchId}, '${"d".repeat(64)}', 'clarity', '4.0.1',
     '0.1.3', '{}', 30, 1000000, '2026-08-20T10:00:00Z',
     '2026-08-20T10:01:00Z', 'succeeded'),
    ('${selectedExtractionId}', ${matchId}, '${"e".repeat(64)}', 'clarity', '4.0.1',
     '0.1.3', '{}', 30, 1000000, '2026-08-20T11:00:00Z',
     '2026-08-20T11:01:00Z', 'succeeded'),
    ('${failedExtractionId}', ${matchId}, '${"f".repeat(64)}', 'clarity', '4.0.1',
     '0.1.3', '{}', 30, 1000000, '2026-08-20T12:00:00Z',
     '2026-08-20T12:01:00Z', 'failed');

  INSERT INTO raw.entity_instances (
    extraction_id, sequence, entity_instance_id, entity_index, serial, handle,
    class_id, class_name, demo_tick, net_tick, game_time
  ) VALUES
    ('${selectedExtractionId}', 1, 1, 10, 1, 1001, 1,
     'CDOTAGamerulesProxy', 100, 100, 100),
    ('${selectedExtractionId}', 2, 2, 11, 1, 1002, 2,
     'CDOTA_PlayerResource', 100, 100, 100),
    ('${selectedExtractionId}', 3, 3, 12, 1, 2001, 3,
     'CDOTA_Unit_Hero_Axe', 100, 100, 100),
    ('${selectedExtractionId}', 4, 4, 13, 1, 2002, 4,
     'CDOTA_Unit_Hero_Lina', 100, 100, 100),
    ('${selectedExtractionId}', 5, 5, 14, 1, 2999, 3,
     'CDOTA_Unit_Hero_Axe', 100, 100, 100);
`);

const gameRulesProperties = JSON.stringify([
  property("m_pGameRules.m_nGameWinner", "int32", 2),
  property("m_pGameRules.m_iGameMode", "int32", 23),
  property("m_pGameRules.m_flGameStartTime", "float", 120.25),
  property("m_pGameRules.m_flGameEndTime", "float", 2_045.75),
]);
const playerResourceProperties = JSON.stringify([
  property("m_vecPlayerData.0000.m_bIsValid", "bool", true),
  property("m_vecPlayerData.0000.m_iPlayerSteamID", "uint64", 111_111),
  property("m_vecPlayerData.0000.m_iPlayerTeam", "int32", 2),
  property("m_vecPlayerData.0000.m_iszPlayerName", "string", "Radiant Player"),
  property("m_vecPlayerTeamData.0000.m_hSelectedHero", "uint64", 2_001),
  property("m_vecPlayerTeamData.0000.m_nSelectedHeroID", "int32", 2),
  property("m_vecPlayerTeamData.0000.m_iKills", "int32", 10),
  property("m_vecPlayerTeamData.0000.m_iDeaths", "int32", 2),
  property("m_vecPlayerTeamData.0000.m_iAssists", "int32", 8),
  property("m_vecPlayerTeamData.0000.m_iLevel", "int32", 25),

  property("m_vecPlayerData.0001.m_bIsValid", "bool", true),
  property("m_vecPlayerData.0001.m_iPlayerSteamID", "uint64", 222_222),
  property("m_vecPlayerData.0001.m_iPlayerTeam", "int32", 3),
  // The omitted player name exercises nullable optional properties.
  property("m_vecPlayerTeamData.0001.m_hSelectedHero", "uint64", 2_002),
  property("m_vecPlayerTeamData.0001.m_nSelectedHeroID", "int32", 25),
  property("m_vecPlayerTeamData.0001.m_iKills", "int32", 4),
  property("m_vecPlayerTeamData.0001.m_iDeaths", "int32", 7),
  property("m_vecPlayerTeamData.0001.m_iAssists", "int32", 12),
  property("m_vecPlayerTeamData.0001.m_iLevel", "int32", 19),

  property("m_vecPlayerData.0002.m_bIsValid", "bool", false),
  property("m_vecPlayerData.0002.m_iPlayerSteamID", "uint64", 333_333),
  property("m_vecPlayerData.0002.m_iPlayerTeam", "int32", 2),
  property("m_vecPlayerData.0002.m_iszPlayerName", "string", "Invalid Player"),
  property("m_vecPlayerTeamData.0002.m_hSelectedHero", "uint64", 2_001),
  property("m_vecPlayerTeamData.0002.m_nSelectedHeroID", "int32", 2),
  property("m_vecPlayerTeamData.0002.m_iKills", "int32", 99),
  property("m_vecPlayerTeamData.0002.m_iDeaths", "int32", 0),
  property("m_vecPlayerTeamData.0002.m_iAssists", "int32", 99),
  property("m_vecPlayerTeamData.0002.m_iLevel", "int32", 30),
]);

await warehouse.connection.run(
  `INSERT INTO raw.entity_checkpoints (
     extraction_id, sequence, entity_instance_id, checkpoint_kind, demo_tick,
     net_tick, game_time, checkpoint_game_time, properties
   ) VALUES
     ('${selectedExtractionId}', 10, 1, 'completion', 200, 200, 2045.75,
      2045.75, $gameRulesProperties),
     ('${selectedExtractionId}', 11, 2, 'completion', 200, 200, 2045.75,
      2045.75, $playerResourceProperties)`,
  { gameRulesProperties, playerResourceProperties },
);

test("latest successful extractions ignore newer failed attempts", async () => {
  const result = await warehouse.connection.runAndReadAll(`
    SELECT match_id, extraction_id
    FROM analysis.latest_successful_extractions
    WHERE match_id = ${matchId}`);

  assert.deepEqual(result.getRowObjectsJson(), [{
    match_id: matchId.toString(),
    extraction_id: selectedExtractionId,
  }]);
});

test("match summary uses the latest successful extraction and derives typed match facts", async () => {
  const result = await warehouse.connection.runAndReadAll(
    `SELECT * FROM analysis.match_summary(${matchId})`,
  );

  assert.deepEqual(result.getRowObjectsJson(), [{
    match_id: matchId.toString(),
    extraction_id: selectedExtractionId,
    winner_team_id: 2,
    winner_team: "Radiant",
    game_mode_id: 23,
    game_start_time: 120.25,
    game_end_time: 2_045.75,
    duration_seconds: 1_925.5,
  }]);
});

test("match players returns valid teams, typed scoreboard values, and selected heroes", async () => {
  const result = await warehouse.connection.runAndReadAll(
    `SELECT * FROM analysis.match_players(${matchId}) ORDER BY player_index`,
  );

  assert.deepEqual(result.getRowObjectsJson(), [
    {
      match_id: matchId.toString(),
      extraction_id: selectedExtractionId,
      player_index: 0,
      team_id: 2,
      team: "Radiant",
      player_name: "Radiant Player",
      steam_id: "111111",
      hero_id: 2,
      hero_class: "CDOTA_Unit_Hero_Axe",
      kills: 10,
      deaths: 2,
      assists: 8,
      level: 25,
    },
    {
      match_id: matchId.toString(),
      extraction_id: selectedExtractionId,
      player_index: 1,
      team_id: 3,
      team: "Dire",
      player_name: null,
      steam_id: "222222",
      hero_id: 25,
      hero_class: "CDOTA_Unit_Hero_Lina",
      kills: 4,
      deaths: 7,
      assists: 12,
      level: 19,
    },
  ]);
});

test("first analysis macros return no rows for an unknown match", async () => {
  const summary = await warehouse.connection.runAndReadAll(
    "SELECT * FROM analysis.match_summary(999999999999)",
  );
  const players = await warehouse.connection.runAndReadAll(
    "SELECT * FROM analysis.match_players(999999999999)",
  );

  assert.deepEqual(summary.getRowObjectsJson(), []);
  assert.deepEqual(players.getRowObjectsJson(), []);
});

function property(propertyPath: string, valueType: string, value: unknown): Record<string, unknown> {
  return { propertyPath, valueType, value };
}
