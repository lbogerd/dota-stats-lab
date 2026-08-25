import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-hero-stats-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);
after(warehouse.close);

test("an empty warehouse has no hero statistics", async () => {
  const result = await warehouse.connection.runAndReadAll("SELECT * FROM analysis.hero_stats()");
  assert.deepEqual(result.getRowObjectsJson(), []);
});

const previousExtractionId = "hero-previous";
const firstExtractionId = "hero-first";
const secondExtractionId = "hero-second";
const unresolvedExtractionId = "hero-unresolved";

test("hero statistics use the latest match scope and preserve unknown values", async () => {
  await warehouse.connection.run(`
    INSERT INTO catalog.extractions (
      extraction_id, match_id, replay_sha256, parser_name, parser_version,
      exporter_version, extraction_config, checkpoint_interval_seconds,
      output_limit_bytes, started_at, completed_at, status
    ) VALUES
      ('${previousExtractionId}', 101, '${"a".repeat(64)}', 'clarity', 'old',
       '1.2.0', '{}', 30, 1000, '2026-08-25T09:00:00Z', '2026-08-25T09:01:00Z', 'succeeded'),
      ('${firstExtractionId}', 101, '${"b".repeat(64)}', 'clarity', 'current',
       '1.2.0', '{}', 30, 1000, '2026-08-25T10:00:00Z', '2026-08-25T10:01:00Z', 'succeeded'),
      ('${secondExtractionId}', 102, '${"c".repeat(64)}', 'clarity', 'current',
       '1.2.0', '{}', 30, 1000, '2026-08-25T11:00:00Z', '2026-08-25T11:01:00Z', 'succeeded'),
      ('${unresolvedExtractionId}', 103, '${"d".repeat(64)}', 'clarity', 'current',
       '1.2.0', '{}', 30, 1000, '2026-08-25T12:00:00Z', '2026-08-25T12:01:00Z', 'succeeded');

    INSERT INTO analysis.matches (extraction_id, match_id, winner_team_id) VALUES
      ('${previousExtractionId}', 101, 3),
      ('${firstExtractionId}', 101, 2),
      ('${secondExtractionId}', 102, 2),
      ('${unresolvedExtractionId}', 103, NULL);

    INSERT INTO analysis.players (
      extraction_id, player_slot, team_id, team, hero_id, gold_per_min, xp_per_min
    ) VALUES
      ('${previousExtractionId}', 0, 3, 'Dire', 9, 999, 999),
      ('${firstExtractionId}', 0, 2, 'Radiant', 1, 600, 700),
      ('${secondExtractionId}', 128, 3, 'Dire', 1, 400, NULL),
      ('${unresolvedExtractionId}', 0, 2, 'Radiant', 1, NULL, 500);

    INSERT INTO analysis.hero_draft_events VALUES
      ('${previousExtractionId}', 0, 4, false, 0),
      ('${firstExtractionId}', 0, 2, false, 0),
      ('${firstExtractionId}', 1, 2, false, 1),
      ('${secondExtractionId}', 0, 3, false, 1);
  `);

  const result = await warehouse.connection.runAndReadAll("SELECT * FROM analysis.hero_stats()");

  assert.deepEqual(result.getRowObjectsJson(), [
    {
      hero_id: 1,
      match_count: 3,
      picks: 3,
      bans: 0,
      wins: 1,
      losses: 1,
      pick_rate: 1,
      ban_rate: 0,
      win_rate: 0.5,
      loss_rate: 0.5,
      average_gpm: 500,
      average_xpm: 600,
    },
    {
      hero_id: 2,
      match_count: 3,
      picks: 0,
      bans: 1,
      wins: 0,
      losses: 0,
      pick_rate: 0,
      ban_rate: 1 / 3,
      win_rate: null,
      loss_rate: null,
      average_gpm: null,
      average_xpm: null,
    },
    {
      hero_id: 3,
      match_count: 3,
      picks: 0,
      bans: 1,
      wins: 0,
      losses: 0,
      pick_rate: 0,
      ban_rate: 1 / 3,
      win_rate: null,
      loss_rate: null,
      average_gpm: null,
      average_xpm: null,
    },
  ]);
});
