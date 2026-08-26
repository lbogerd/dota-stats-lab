import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-hero-positions-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);

const matchId = 8_953_222_159n;
const oldExtractionId = "position-old";
const selectedExtractionId = "position-selected";
const noStreamMatchId = 8_953_222_160n;
const noStreamExtractionId = "position-no-stream";

await warehouse.connection.run(`
  INSERT INTO catalog.extractions (
    extraction_id, match_id, replay_sha256, parser_name, parser_version,
    exporter_version, extraction_config, checkpoint_interval_seconds,
    output_limit_bytes, started_at, completed_at, status, manifest
  ) VALUES
    ('${oldExtractionId}', ${matchId}, '${"a".repeat(64)}', 'clarity', 'old',
     '1', '{}', 30, 1000, '2026-08-25T09:00:00Z', '2026-08-25T09:01:00Z',
     'succeeded', '{"schemaVersion":2,"files":{"heroPositions":{}}}'),
    ('${selectedExtractionId}', ${matchId}, '${"b".repeat(64)}', 'clarity', 'new',
     '2', '{}', 30, 1000, '2026-08-25T10:00:00Z', '2026-08-25T10:01:00Z',
     'succeeded', '{"schemaVersion":2,"files":{"heroPositions":{}}}'),
    ('${noStreamExtractionId}', ${noStreamMatchId}, '${"c".repeat(64)}', 'clarity', 'old',
     '1', '{}', 30, 1000, '2026-08-25T11:00:00Z', '2026-08-25T11:01:00Z',
     'succeeded', '{"schemaVersion":1,"files":{}}');

  INSERT INTO analysis.matches (extraction_id, match_id, duration_seconds) VALUES
    ('${oldExtractionId}', ${matchId}, 1),
    ('${selectedExtractionId}', ${matchId}, 1),
    ('${noStreamExtractionId}', ${noStreamMatchId}, 1);

  INSERT INTO analysis.hero_position_samples VALUES
    ('${oldExtractionId}', 1, 0, 0, 1, 2, 0, 0),
    ('${selectedExtractionId}', 1, 0, 0, 1, 2, -8288, 8288),
    ('${selectedExtractionId}', 2, 0, 1, 2, 2, 8288, 8288),
    ('${selectedExtractionId}', 3, 100, 0, 1, 2, -8288, -8288),
    ('${selectedExtractionId}', 4, 100, 1, 2, 2, 8288, -8288),
    ('${selectedExtractionId}', 5, 200, 0, 1, 2, 0, 0);
`);
warehouse.close();

async function query(sql: string): Promise<Array<Record<string, unknown>>> {
  const reader = await openWarehouse(true);
  try {
    const result = await reader.connection.runAndReadAll(sql);
    return result.getRowObjectsJson() as Array<Record<string, unknown>>;
  } finally {
    reader.close();
  }
}

test("hero heat map uses latest samples, inclusive 100 ms bounds, and calibrated axes", async () => {
  const rows = await query(`
    SELECT cell_x, cell_y, sample_count
    FROM analysis.match_hero_heatmap(${matchId}, 0, 100, NULL, 64)
  `);
  assert.deepEqual(rows, [
    { cell_x: 0, cell_y: 0, sample_count: "1" },
    { cell_x: 63, cell_y: 0, sample_count: "1" },
    { cell_x: 0, cell_y: 63, sample_count: "1" },
    { cell_x: 63, cell_y: 63, sample_count: "1" },
  ]);
});

test("hero heat map selects one player and can return a zero-row range", async () => {
  const selected = await query(`
    SELECT cell_x, cell_y, sample_count
    FROM analysis.match_hero_heatmap(${matchId}, 100, 100, 0, 64)
  `);
  assert.deepEqual(selected, [
    { cell_x: 0, cell_y: 63, sample_count: "1" },
  ]);

  const empty = await query(`
    SELECT * FROM analysis.match_hero_heatmap(${matchId}, 300, 300, NULL, 64)
  `);
  assert.deepEqual(empty, []);
});

const { getMatchHeroHeatmap, heroHeatmapInputSchema } = await import("../src/server/hero-positions.js");

test("hero heat map server validates 100 ms time inputs", () => {
  assert.equal(heroHeatmapInputSchema.safeParse({
    matchId: matchId.toString(), startMilliseconds: 0, endMilliseconds: 100, playerSlot: null,
  }).success, true);
  for (const input of [
    { matchId: matchId.toString(), startMilliseconds: 1, endMilliseconds: 100, playerSlot: null },
    { matchId: matchId.toString(), startMilliseconds: 0, endMilliseconds: 101, playerSlot: null },
    { matchId: matchId.toString(), startMilliseconds: 0, endMilliseconds: 100, playerSlot: 1.5 },
  ]) assert.equal(heroHeatmapInputSchema.safeParse(input).success, false);
});

test("hero heat map server returns ordered JSON-safe cells and totals", async () => {
  const result = await getMatchHeroHeatmap({
    matchId: matchId.toString(), startMilliseconds: 0, endMilliseconds: 100, playerSlot: null,
  });
  assert.deepEqual(result, {
    matchId: matchId.toString(),
    available: true,
    startMilliseconds: 0,
    endMilliseconds: 100,
    playerSlot: null,
    sampleCount: 4,
    maximumCellCount: 1,
    cells: [
      { cellX: 0, cellY: 0, sampleCount: 1 },
      { cellX: 63, cellY: 0, sampleCount: 1 },
      { cellX: 0, cellY: 63, sampleCount: 1 },
      { cellX: 63, cellY: 63, sampleCount: 1 },
    ],
  });
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("hero heat map server distinguishes an unavailable stream from an empty selection", async () => {
  const unavailable = await getMatchHeroHeatmap({
    matchId: noStreamMatchId.toString(), startMilliseconds: 0, endMilliseconds: 100, playerSlot: null,
  });
  assert.deepEqual(unavailable, {
    matchId: noStreamMatchId.toString(), available: false,
    startMilliseconds: 0, endMilliseconds: 100, playerSlot: null,
    sampleCount: 0, maximumCellCount: 0, cells: [],
  });

  const empty = await getMatchHeroHeatmap({
    matchId: matchId.toString(), startMilliseconds: 300, endMilliseconds: 300, playerSlot: 1,
  });
  assert.equal(empty.available, true);
  assert.equal(empty.sampleCount, 0);
  assert.deepEqual(empty.cells, []);
});

test("hero heat map server rejects reversed and out-of-duration ranges", async () => {
  await assert.rejects(getMatchHeroHeatmap({
    matchId: matchId.toString(), startMilliseconds: 200, endMilliseconds: 100, playerSlot: null,
  }), /Start time/);
  await assert.rejects(getMatchHeroHeatmap({
    matchId: matchId.toString(), startMilliseconds: 0, endMilliseconds: 1_100, playerSlot: null,
  }), /match duration/);
});
