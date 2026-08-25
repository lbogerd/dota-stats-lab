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
    ('${previousExtractionId}', ${matchId}, '${"d".repeat(64)}', 'clarity', 'revision-a',
     '1.0.0', '{}', 30, 1000000, '2026-08-20T10:00:00Z', '2026-08-20T10:01:00Z', 'succeeded'),
    ('${selectedExtractionId}', ${matchId}, '${"e".repeat(64)}', 'clarity', 'revision-b',
     '1.0.0', '{}', 30, 1000000, '2026-08-20T11:00:00Z', '2026-08-20T11:01:00Z', 'succeeded'),
    ('${failedExtractionId}', ${matchId}, '${"f".repeat(64)}', 'clarity', 'revision-c',
     '1.0.0', '{}', 30, 1000000, '2026-08-20T12:00:00Z', '2026-08-20T12:01:00Z', 'failed');

  INSERT INTO analysis.matches VALUES
    ('${selectedExtractionId}', ${matchId}, '2026-08-20T10:30:00Z', 1925,
     'DOTA_GAMEMODE_ALL_DRAFT', 7, 2, 'Radiant', 31, 20,
     'Radiant Five', 'Dire Five', 123, 45, 1);

  INSERT INTO analysis.players VALUES
    ('${selectedExtractionId}', 0, 2, 'Radiant', 0, 111111, 'Radiant Player', 2,
     25, 10, 2, 8, 301, 12, 650, 700, 25000, 32000, 5000, 700),
    ('${selectedExtractionId}', 128, 3, 'Dire', 0, 222222, NULL, 25,
     19, 4, 7, 12, 155, 4, 430, 510, 17000, 18000, 1200, 250);

  INSERT INTO analysis.team_time_series VALUES
    ('${selectedExtractionId}', 2, 0, 1000, 1000, 1000),
    ('${selectedExtractionId}', 3, 0, 900, 900, 900);
`);

test("latest successful extractions ignore newer failed attempts", async () => {
  const result = await warehouse.connection.runAndReadAll(`
    SELECT match_id, extraction_id FROM analysis.latest_successful_extractions
    WHERE match_id = ${matchId}`);
  assert.deepEqual(result.getRowObjectsJson(), [{ match_id: matchId.toString(), extraction_id: selectedExtractionId }]);
});

test("match summary returns typed normalized facts", async () => {
  const result = await warehouse.connection.runAndReadAll(`SELECT * FROM analysis.match_summary(${matchId})`);
  assert.deepEqual(result.getRowObjectsJson(), [{
    match_id: matchId.toString(), extraction_id: selectedExtractionId,
    start_time: "2026-08-20 10:30:00+00", duration_seconds: 1925,
    game_mode: "DOTA_GAMEMODE_ALL_DRAFT", lobby_type: 7,
    winner_team_id: 2, winner_team: "Radiant", radiant_score: 31, dire_score: 20,
    radiant_team_name: "Radiant Five", dire_team_name: "Dire Five", cluster: 123,
    first_blood_seconds: 45,
  }]);
});

test("scoreboard, team totals, and net-worth analysis use typed tables", async () => {
  const players = await warehouse.connection.runAndReadAll(`
    SELECT player_slot, team, player_name, kills, last_hits, net_worth
    FROM analysis.match_players(${matchId}) ORDER BY player_slot`);
  assert.deepEqual(players.getRowObjectsJson(), [
    { player_slot: 0, team: "Radiant", player_name: "Radiant Player", kills: 10, last_hits: 301, net_worth: 25000 },
    { player_slot: 128, team: "Dire", player_name: null, kills: 4, last_hits: 155, net_worth: 17000 },
  ]);
  const totals = await warehouse.connection.runAndReadAll(`SELECT team, kills, net_worth FROM analysis.match_team_totals(${matchId})`);
  assert.deepEqual(totals.getRowObjectsJson(), [
    { team: "Radiant", kills: 10, net_worth: "25000" },
    { team: "Dire", kills: 4, net_worth: "17000" },
  ]);
  const series = await warehouse.connection.runAndReadAll(`
    SELECT team_id, sample_index, net_worth_advantage FROM analysis.match_net_worth(${matchId})`);
  assert.deepEqual(series.getRowObjectsJson(), [
    { team_id: 2, sample_index: 0, net_worth_advantage: 100 },
    { team_id: 3, sample_index: 0, net_worth_advantage: -100 },
  ]);
});

test("analysis macros return no rows for an unknown match", async () => {
  const summary = await warehouse.connection.runAndReadAll("SELECT * FROM analysis.match_summary(999999999999)");
  const players = await warehouse.connection.runAndReadAll("SELECT * FROM analysis.match_players(999999999999)");
  assert.deepEqual(summary.getRowObjectsJson(), []);
  assert.deepEqual(players.getRowObjectsJson(), []);
});
