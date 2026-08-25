import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-hero-stats-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
const sourceMigrationRoot = path.resolve("src/db/migrations");
const migrationRoot = path.join(root, "migrations");
await mkdir(migrationRoot);
for (const name of await readdir(sourceMigrationRoot)) {
  if (/^00[1-9]_.*\.sql$/.test(name) || /^010_.*\.sql$/.test(name)) {
    await copyFile(path.join(sourceMigrationRoot, name), path.join(migrationRoot, name));
  }
}
process.env.MIGRATION_ROOT = migrationRoot;

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);
const backfillExtractionId = "hero-backfill";
await warehouse.connection.run(
  `INSERT INTO raw.records
   VALUES ($id, 1, NULL, NULL, NULL, 'match_overview', 'CMsgDOTAMatch', $payload::JSON)`,
  {
    id: backfillExtractionId,
    payload: JSON.stringify({ picks_bans: [
      { hero_id: 1, is_pick: true, team: 0 },
      { hero_id: 2, is_pick: false, team: 1 },
      { hero_id: 0, is_pick: false, team: 0 },
      { hero_id: 3, is_pick: "false", team: 0 },
      { hero_id: 4, is_pick: false, team: 2 },
      { hero_id: "5", is_pick: false, team: 0 },
      { hero_id: 6, is_pick: false, team: "1" },
    ] }),
  },
);
await copyFile(
  path.join(sourceMigrationRoot, "011_hero_stats.sql"),
  path.join(migrationRoot, "011_hero_stats.sql"),
);
await migrate(warehouse.connection);
after(warehouse.close);

test("migration backfills valid draft events and an empty match scope has no hero statistics", async () => {
  const drafts = await warehouse.connection.runAndReadAll(
    `SELECT draft_order, hero_id, is_pick, team_index
     FROM analysis.hero_draft_events
     WHERE extraction_id = $id
     ORDER BY draft_order`,
    { id: backfillExtractionId },
  );
  assert.deepEqual(drafts.getRowObjectsJson(), [
    { draft_order: 0, hero_id: 1, is_pick: true, team_index: 0 },
    { draft_order: 1, hero_id: 2, is_pick: false, team_index: 1 },
  ]);

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
