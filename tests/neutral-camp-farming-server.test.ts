import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-neutral-camp-farming-server-"));
const warehousePath = path.join(root, "warehouse", "dota.duckdb");
process.env.WAREHOUSE_PATH = warehousePath;

await mkdir(path.dirname(warehousePath), { recursive: true });
const writer = await DuckDBInstance.create(warehousePath);
const writerConnection = await writer.connect();
await writerConnection.run(`
  CREATE SCHEMA catalog;
  CREATE SCHEMA analysis;
  CREATE TABLE catalog.extractions (
    extraction_id VARCHAR,
    manifest JSON
  );
  CREATE TABLE analysis.latest_successful_extractions (
    match_id UBIGINT,
    extraction_id VARCHAR
  );
  CREATE TABLE analysis.test_neutral_camp_farming_actions (
    match_id UBIGINT,
    extraction_id VARCHAR,
    action_index UINTEGER,
    definition_name VARCHAR,
    player_slot UINTEGER,
    camp_id UINTEGER,
    spawner_handle UBIGINT,
    camp_type INTEGER,
    camp_world_x DOUBLE,
    camp_world_y DOUBLE,
    start_game_time_ms BIGINT,
    end_game_time_ms BIGINT,
    result VARCHAR,
    damage_event_count UINTEGER,
    total_damage BIGINT,
    initial_creep_count UINTEGER,
    dead_initial_creep_count UINTEGER
  );

  INSERT INTO catalog.extractions VALUES
    ('ready', '{"profile":"match-analysis-v4"}'),
    ('empty', '{"profile":"match-analysis-v4"}'),
    ('old', '{"profile":"match-analysis-v3"}'),
    ('invalid', '{"profile":"match-analysis-v4"}');
  INSERT INTO analysis.latest_successful_extractions VALUES
    (42, 'ready'), (43, 'empty'), (44, 'old'), (45, 'invalid');
  INSERT INTO analysis.test_neutral_camp_farming_actions VALUES
    (42, 'ready', 1, 'neutral-camp-farming-v1', 128, 7, 4294967295, 2,
     500.5, -100.25, 2000, 9000, 'cleared', 4, 375, 3, 3),
    (42, 'ready', 0, 'neutral-camp-farming-v1', 0, 3, 123, 1,
     -50, 75, 1000, 1500, 'not_cleared', 1, 25, 2, 1),
    (44, 'old', 0, 'neutral-camp-farming-v1', 0, 1, 123, 1,
     0, 0, 1000, 1000, 'not_cleared', 1, 10, 1, 0),
    (45, 'invalid', 0, 'neutral-camp-farming-v1', 0, 1, 123, 1,
     0, 0, 2000, 1000, 'not_cleared', 1, 10, 1, 0);

  CREATE MACRO analysis.match_neutral_camp_farming_actions(requested_match_id) AS TABLE (
    SELECT * EXCLUDE (match_id)
    FROM analysis.test_neutral_camp_farming_actions
    WHERE match_id = requested_match_id
  );
`);
writerConnection.closeSync();
writer.closeSync();

const {
  getMatchNeutralCampFarming,
  neutralCampFarmingInputSchema,
} = await import("../src/server/neutral-camp-farming.js");

test("neutral camp farming input accepts only a valid match ID", () => {
  assert.equal(neutralCampFarmingInputSchema.safeParse({ matchId: "42" }).success, true);
  for (const input of [
    { matchId: "0" },
    { matchId: "18446744073709551616" },
    { matchId: "42", extra: true },
  ]) {
    assert.equal(neutralCampFarmingInputSchema.safeParse(input).success, false);
  }
});

test("neutral camp farming returns validated actions in macro order", async () => {
  assert.deepEqual(await getMatchNeutralCampFarming({ matchId: "42" }), {
    matchId: "42",
    available: true,
    actions: [
      {
        extractionId: "ready",
        actionIndex: 0,
        definitionName: "neutral-camp-farming-v1",
        playerSlot: 0,
        campId: 3,
        spawnerHandle: "123",
        campType: 1,
        campWorldX: -50,
        campWorldY: 75,
        startGameTimeMilliseconds: 1000,
        endGameTimeMilliseconds: 1500,
        result: "not_cleared",
        damageEventCount: 1,
        totalDamage: 25,
        initialCreepCount: 2,
        deadInitialCreepCount: 1,
      },
      {
        extractionId: "ready",
        actionIndex: 1,
        definitionName: "neutral-camp-farming-v1",
        playerSlot: 128,
        campId: 7,
        spawnerHandle: "4294967295",
        campType: 2,
        campWorldX: 500.5,
        campWorldY: -100.25,
        startGameTimeMilliseconds: 2000,
        endGameTimeMilliseconds: 9000,
        result: "cleared",
        damageEventCount: 4,
        totalDamage: 375,
        initialCreepCount: 3,
        deadInitialCreepCount: 3,
      },
    ],
  });
});

test("neutral camp farming distinguishes empty and unavailable extractions", async () => {
  assert.deepEqual(await getMatchNeutralCampFarming({ matchId: "43" }), {
    matchId: "43",
    available: true,
    actions: [],
  });
  assert.deepEqual(await getMatchNeutralCampFarming({ matchId: "44" }), {
    matchId: "44",
    available: false,
    actions: [],
  });
  assert.deepEqual(await getMatchNeutralCampFarming({ matchId: "999" }), {
    matchId: "999",
    available: false,
    actions: [],
  });
});

test("neutral camp farming rejects invalid database values", async () => {
  await assert.rejects(
    getMatchNeutralCampFarming({ matchId: "45" }),
    /action time range/,
  );
});
