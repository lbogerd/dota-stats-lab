import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-neutral-camp-farming-db-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);

const matchId = 8_953_222_159n;
await warehouse.connection.run(`
  INSERT INTO catalog.extractions (
    extraction_id, match_id, replay_sha256, parser_name, parser_version,
    exporter_version, extraction_config, checkpoint_interval_seconds,
    output_limit_bytes, started_at, completed_at, status, manifest
  ) VALUES
    ('neutral-old', ${matchId}, '${"a".repeat(64)}', 'clarity', 'old',
     '2.2.0', '{"profile":"match-analysis-v4"}', 30, 1000,
     '2026-08-25T09:00:00Z', '2026-08-25T09:01:00Z', 'succeeded', '{}'),
    ('neutral-latest', ${matchId}, '${"b".repeat(64)}', 'clarity', 'new',
     '2.2.0', '{"profile":"match-analysis-v4"}', 30, 1000,
     '2026-08-25T10:00:00Z', '2026-08-25T10:01:00Z', 'succeeded', '{}');

  INSERT INTO analysis.matches (extraction_id, match_id, duration_seconds) VALUES
    ('neutral-old', ${matchId}, 120),
    ('neutral-latest', ${matchId}, 120);

  INSERT INTO analysis.neutral_camp_farming_actions VALUES
    ('neutral-old', 0, 'neutral-camp-farming-v1', 0, 0, 10, 1,
     0, 0, 1000, 2000, 'cleared', 2, 200, 2, 2),
    ('neutral-latest', 1, 'neutral-camp-farming-v1', 1, 1, 20, 2,
     100, 200, 3000, 3500, 'not_cleared', 1, 50, 2, 1),
    ('neutral-latest', 0, 'neutral-camp-farming-v1', 0, 0, 10, 1,
     -100, -200, 1000, 2000, 'cleared', 2, 200, 2, 2);
`);

test("neutral camp farming macro selects the latest successful extraction in action order", async () => {
  const result = await warehouse.connection.runAndReadAll(`
    SELECT extraction_id, action_index, player_slot, start_game_time_ms
    FROM analysis.match_neutral_camp_farming_actions(${matchId})
  `);
  assert.deepEqual(result.getRowObjectsJson(), [
    {
      extraction_id: "neutral-latest",
      action_index: 0,
      player_slot: 0,
      start_game_time_ms: "1000",
    },
    {
      extraction_id: "neutral-latest",
      action_index: 1,
      player_slot: 1,
      start_game_time_ms: "3000",
    },
  ]);
});

test("neutral camp farming table rejects an invalid typed action", async () => {
  await assert.rejects(
    warehouse.connection.run(`
      INSERT INTO analysis.neutral_camp_farming_actions VALUES
        ('neutral-latest', 2, 'generic-action-v1', 0, 0, 10, 1,
         0, 0, 2000, 1000, 'unknown', 0, 0, 1, 2)
    `),
  );
});

test.after(() => warehouse.close());
