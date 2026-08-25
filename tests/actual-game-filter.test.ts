import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-actual-game-filter-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);
after(warehouse.close);

const completeExtraction = "complete";
const isolatedExtraction = "isolated";
const missingStartExtraction = "missing-start";
const missingStopExtraction = "missing-stop";

await warehouse.connection.run(`
  INSERT INTO raw.combat_events (
    extraction_id, sequence, game_time, event_type, value
  ) VALUES
    ('${completeExtraction}', 15, -100, 'DOTA_COMBATLOG_GAME_STATE', 6),
    ('${completeExtraction}', 19,  -90, 'DOTA_COMBATLOG_DAMAGE', 10),
    ('${completeExtraction}', 20,  -90, 'DOTA_COMBATLOG_GAME_STATE', 4),
    ('${completeExtraction}', 21,  -90, 'DOTA_COMBATLOG_DAMAGE', 20),
    ('${completeExtraction}', 22,  -80, 'DOTA_COMBATLOG_GAME_STATE', 4),
    ('${completeExtraction}', 30,    0, 'DOTA_COMBATLOG_DAMAGE', 30),
    ('${completeExtraction}', 39,  120, 'DOTA_COMBATLOG_DAMAGE', 40),
    ('${completeExtraction}', 40,  120, 'DOTA_COMBATLOG_GAME_STATE', 6),
    ('${completeExtraction}', 41,  120, 'DOTA_COMBATLOG_DAMAGE', 50),
    ('${completeExtraction}', 45,  130, 'DOTA_COMBATLOG_GAME_STATE', 6),
    ('${isolatedExtraction}', 100, -75, 'DOTA_COMBATLOG_GAME_STATE', 4),
    ('${isolatedExtraction}', 101, -75, 'DOTA_COMBATLOG_DAMAGE', 60),
    ('${isolatedExtraction}', 102, 900, 'DOTA_COMBATLOG_GAME_STATE', 6),
    ('${missingStartExtraction}', 200, 10, 'DOTA_COMBATLOG_DAMAGE', 70),
    ('${missingStartExtraction}', 201, 20, 'DOTA_COMBATLOG_GAME_STATE', 6),
    ('${missingStopExtraction}', 299, -100, 'DOTA_COMBATLOG_GAME_STATE', 6),
    ('${missingStopExtraction}', 300,  -90, 'DOTA_COMBATLOG_GAME_STATE', 4),
    ('${missingStopExtraction}', 301,    0, 'DOTA_COMBATLOG_DAMAGE', 80);
`);

test("actual game includes the first start marker and excludes the first later stop marker", async () => {
  const result = await warehouse.connection.runAndReadAll(`
    SELECT sequence::INTEGER AS sequence
    FROM raw.combat_events
    WHERE extraction_id = '${completeExtraction}'
      AND analysis.is_actual_game(extraction_id, sequence)
    ORDER BY sequence
  `);

  assert.deepEqual(result.getRowObjectsJson(), [
    { sequence: 20 },
    { sequence: 21 },
    { sequence: 22 },
    { sequence: 30 },
    { sequence: 39 },
  ]);
});

test("actual game limits are isolated by extraction and require both markers", async () => {
  const isolated = await warehouse.connection.runAndReadAll(`
    SELECT sequence::INTEGER AS sequence
    FROM raw.combat_events
    WHERE extraction_id = '${isolatedExtraction}'
      AND analysis.is_actual_game(extraction_id, sequence)
    ORDER BY sequence
  `);
  assert.deepEqual(isolated.getRowObjectsJson(), [
    { sequence: 100 },
    { sequence: 101 },
  ]);

  const incomplete = await warehouse.connection.runAndReadAll(`
    SELECT extraction_id, sequence::INTEGER AS sequence
    FROM raw.combat_events
    WHERE extraction_id IN ('${missingStartExtraction}', '${missingStopExtraction}')
      AND analysis.is_actual_game(extraction_id, sequence)
    ORDER BY extraction_id, sequence
  `);
  assert.deepEqual(incomplete.getRowObjectsJson(), []);

  const incompletePredicates = await warehouse.connection.runAndReadAll(`
    SELECT
      analysis.is_actual_game('${missingStartExtraction}', 200::UBIGINT) AS missing_start,
      analysis.is_actual_game('${missingStopExtraction}', 301::UBIGINT) AS missing_stop
  `);
  assert.deepEqual(incompletePredicates.getRowObjectsJson(), [{
    missing_start: false,
    missing_stop: false,
  }]);
});

test("actual game returns false for null inputs", async () => {
  const result = await warehouse.connection.runAndReadAll(`
    SELECT
      analysis.is_actual_game(NULL::VARCHAR, 20::UBIGINT) AS null_extraction,
      analysis.is_actual_game('${completeExtraction}', NULL::UBIGINT) AS null_sequence,
      analysis.is_actual_game(NULL::VARCHAR, NULL::UBIGINT) AS both_null
  `);

  assert.deepEqual(result.getRowObjectsJson(), [{
    null_extraction: false,
    null_sequence: false,
    both_null: false,
  }]);
});
