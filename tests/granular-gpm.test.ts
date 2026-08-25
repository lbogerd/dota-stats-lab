import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-granular-gpm-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);
after(warehouse.close);

const matchId = 9_001n;
const previousExtractionId = "gpm-previous";
const selectedExtractionId = "gpm-selected";
const failedExtractionId = "gpm-failed";

await warehouse.connection.run(`
  INSERT INTO catalog.extractions (
    extraction_id, match_id, replay_sha256, parser_name, parser_version,
    exporter_version, extraction_config, checkpoint_interval_seconds,
    output_limit_bytes, started_at, completed_at, status
  ) VALUES
    ('${previousExtractionId}', ${matchId}, '${"a".repeat(64)}', 'clarity', 'old',
     '1.2.0', '{}', 30, 1000, '2026-08-25T10:00:00Z', '2026-08-25T10:01:00Z', 'succeeded'),
    ('${selectedExtractionId}', ${matchId}, '${"b".repeat(64)}', 'clarity', 'current',
     '1.2.0', '{}', 30, 1000, '2026-08-25T11:00:00Z', '2026-08-25T11:01:00Z', 'succeeded'),
    ('${failedExtractionId}', ${matchId}, '${"c".repeat(64)}', 'clarity', 'failed',
     '1.2.0', '{}', 30, 1000, '2026-08-25T12:00:00Z', '2026-08-25T12:01:00Z', 'failed');

  INSERT INTO analysis.matches (extraction_id, match_id, duration_seconds) VALUES
    ('${previousExtractionId}', ${matchId}, 60),
    ('${selectedExtractionId}', ${matchId}, 60),
    ('${failedExtractionId}', ${matchId}, 60);

  INSERT INTO analysis.players (
    extraction_id, player_slot, team_id, team, team_slot
  )
  SELECT '${previousExtractionId}',
         CASE WHEN player < 5 THEN player ELSE player + 123 END,
         CASE WHEN player < 5 THEN 2 ELSE 3 END,
         CASE WHEN player < 5 THEN 'Radiant' ELSE 'Dire' END,
         player % 5
  FROM range(10) AS players(player);

  INSERT INTO analysis.players (
    extraction_id, player_slot, team_id, team, team_slot
  )
  SELECT '${selectedExtractionId}',
         CASE WHEN player < 5 THEN player ELSE player + 123 END,
         CASE WHEN player < 5 THEN 2 ELSE 3 END,
         CASE WHEN player < 5 THEN 'Radiant' ELSE 'Dire' END,
         player % 5
  FROM range(10) AS players(player);

  INSERT INTO analysis.player_gold_events VALUES
    ('${previousExtractionId}', 1, 0, 0, 2, -5, 1000),
    ('${previousExtractionId}', 2, 0, 0, 2, 1, 1100);

  INSERT INTO analysis.player_gold_events
  SELECT '${selectedExtractionId}', player + 1, player,
         CASE WHEN player < 5 THEN player ELSE player + 123 END,
         CASE WHEN player < 5 THEN 2 ELSE 3 END,
         -5, 1000
  FROM range(9) AS players(player);

  INSERT INTO analysis.player_gold_events
  SELECT '${selectedExtractionId}', player + 100, player,
         CASE WHEN player < 5 THEN player ELSE player + 123 END,
         CASE WHEN player < 5 THEN 2 ELSE 3 END,
         1, 1001
  FROM range(9) AS players(player);

  -- A later sequence at the same game time must be the step value used for
  -- player zero.
  INSERT INTO analysis.player_gold_events VALUES
    ('${selectedExtractionId}', 200, 0, 0, 2, 1, 1010);

  INSERT INTO analysis.player_gold_events
  SELECT '${selectedExtractionId}', player + 300, player,
         CASE WHEN player < 5 THEN player ELSE player + 123 END,
         CASE WHEN player < 5 THEN 2 ELSE 3 END,
         60, 1060
  FROM range(9) AS players(player);

  INSERT INTO analysis.player_gold_events VALUES
    ('${failedExtractionId}', 1, 0, 0, 2, -5, 1000),
    ('${failedExtractionId}', 2, 0, 0, 2, 1, 2000);
`);

test("one-second GPM uses latest same-time facts and the latest successful extraction", async () => {
  const result = await warehouse.connection.runAndReadAll(`
    SELECT series_kind, player_slot, team_id, game_time_seconds, window_seconds, gpm
    FROM analysis.match_rolling_gpm(${matchId}, 1, 1)
    WHERE game_time_seconds = 1 AND (series_kind = 'team' OR player_slot = 0)
    ORDER BY series_kind
  `);

  assert.deepEqual(result.getRowObjectsJson(), [
    {
      series_kind: "player", player_slot: 0, team_id: 2,
      game_time_seconds: 1, window_seconds: 1, gpm: 600,
    },
    {
      series_kind: "team", player_slot: null, team_id: 2,
      game_time_seconds: 1, window_seconds: 1, gpm: 840,
    },
  ]);
});

test("sixty-second GPM starts only after a complete window and uses the time-zero baseline", async () => {
  const result = await warehouse.connection.runAndReadAll(`
    SELECT series_kind, player_slot, team_id, game_time_seconds, window_seconds, gpm
    FROM analysis.match_rolling_gpm(${matchId}, 60, 1)
    ORDER BY series_kind, team_id, player_slot NULLS FIRST
  `);
  const rows = result.getRowObjectsJson();

  assert.equal(rows.every((row) => Number(row.game_time_seconds) >= 60), true);
  assert.deepEqual(rows.find((row) => row.series_kind === "player" && row.player_slot === 0), {
    series_kind: "player", player_slot: 0, team_id: 2,
    game_time_seconds: 60, window_seconds: 60, gpm: 60,
  });
  assert.deepEqual(rows.find((row) => row.series_kind === "team" && row.team_id === 2), {
    series_kind: "team", player_slot: null, team_id: 2,
    game_time_seconds: 60, window_seconds: 60, gpm: 300,
  });
  assert.equal(rows.some((row) => row.series_kind === "team" && row.team_id === 3), false);
});
