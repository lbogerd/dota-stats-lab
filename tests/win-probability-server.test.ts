import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-win-probability-server-"));
const warehousePath = path.join(root, "warehouse", "dota.duckdb");
process.env.WAREHOUSE_PATH = warehousePath;

await mkdir(path.dirname(warehousePath), { recursive: true });
const writer = await DuckDBInstance.create(warehousePath);
const writerConnection = await writer.connect();
await writerConnection.run(`
  CREATE SCHEMA analysis;
  CREATE TABLE analysis.test_win_probability (
    match_id UBIGINT,
    sample_index UINTEGER,
    game_time_seconds DOUBLE,
    radiant_probability DOUBLE,
    source VARCHAR
  );
  INSERT INTO analysis.test_win_probability VALUES
    (42, 1, 12.5, 0.625, 'graph_history'),
    (42, 0, 0, 0.5, 'graph_history'),
    (7, 0, 0, 0.25, 'spectator_updates'),
    (43, 0, 0, 0.5, 'application_estimate'),
    (44, 0, 0, 1.5, 'graph_history');
  CREATE MACRO analysis.match_win_probability(requested_match_id) AS TABLE (
    SELECT sample_index, game_time_seconds, radiant_probability, source
    FROM analysis.test_win_probability
    WHERE match_id = requested_match_id
  );
`);
writerConnection.closeSync();
writer.closeSync();

const {
  getMatchWinProbability,
  winProbabilityInputSchema,
} = await import("../src/server/win-probability.js");

test("win probability input accepts only a valid match ID", () => {
  assert.equal(winProbabilityInputSchema.safeParse({ matchId: "42" }).success, true);
  for (const input of [
    { matchId: "0" },
    { matchId: "18446744073709551616" },
    { matchId: "42", extra: true },
  ]) {
    assert.equal(winProbabilityInputSchema.safeParse(input).success, false);
  }
});

test("win probability query returns ordered Radiant and Dire points", async () => {
  assert.deepEqual(await getMatchWinProbability({ matchId: "42" }), {
    matchId: "42",
    source: "graph_history",
    points: [
      { gameTimeSeconds: 0, radiantProbability: 0.5, direProbability: 0.5 },
      { gameTimeSeconds: 12.5, radiantProbability: 0.625, direProbability: 0.375 },
    ],
  });
});

test("win probability query returns an empty result when there are no samples", async () => {
  assert.deepEqual(await getMatchWinProbability({ matchId: "999" }), {
    matchId: "999",
    source: null,
    points: [],
  });
});

test("win probability query rejects unexpected warehouse values", async () => {
  await assert.rejects(
    getMatchWinProbability({ matchId: "43" }),
    /Unexpected win probability source/,
  );
  await assert.rejects(
    getMatchWinProbability({ matchId: "44" }),
    /Unexpected Radiant probability/,
  );
});
