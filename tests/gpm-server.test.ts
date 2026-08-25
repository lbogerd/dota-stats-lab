import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-gpm-server-"));
const warehousePath = path.join(root, "warehouse", "dota.duckdb");
process.env.WAREHOUSE_PATH = warehousePath;

await mkdir(path.dirname(warehousePath), { recursive: true });
const writer = await DuckDBInstance.create(warehousePath);
const writerConnection = await writer.connect();
await writerConnection.run(`
  CREATE SCHEMA analysis;
  CREATE TABLE analysis.test_rolling_gpm (
    match_id UBIGINT,
    series_kind VARCHAR,
    player_slot INTEGER,
    team_id INTEGER,
    game_time_seconds DOUBLE,
    window_seconds INTEGER,
    gpm DOUBLE
  );
  INSERT INTO analysis.test_rolling_gpm VALUES
    (42, 'player', 128, 3, 61, 60, 300.5),
    (42, 'team', NULL, 2, 61, 60, 1200),
    (42, 'player', 0, 2, 61, 60, 250),
    (42, 'player', 0, 2, 60, 60, 200),
    (42, 'team', NULL, 3, 61, 60, 1400.25),
    (7, 'team', NULL, 2, 61, 60, 9999);
  CREATE MACRO analysis.match_rolling_gpm(requested_match_id, requested_window, requested_step) AS TABLE (
    SELECT series_kind, player_slot, team_id, game_time_seconds, window_seconds, gpm
    FROM analysis.test_rolling_gpm
    WHERE match_id = requested_match_id
      AND window_seconds = requested_window
      AND game_time_seconds % requested_step = 0
  );
`);
writerConnection.closeSync();
writer.closeSync();

const {
  getMatchRollingGpm,
  rollingGpmInputSchema,
} = await import("../src/server/gpm.js");

test("rolling GPM input accepts only the documented windows and output-step limits", () => {
  for (const windowSeconds of [1, 5, 10, 30, 60, 300]) {
    assert.equal(rollingGpmInputSchema.safeParse({
      matchId: "42",
      windowSeconds,
      outputStepSeconds: 1,
    }).success, true);
  }
  assert.equal(rollingGpmInputSchema.safeParse({
    matchId: "42",
    windowSeconds: 60,
    outputStepSeconds: 60,
  }).success, true);

  for (const input of [
    { matchId: "0", windowSeconds: 60, outputStepSeconds: 1 },
    { matchId: "18446744073709551616", windowSeconds: 60, outputStepSeconds: 1 },
    { matchId: "42", windowSeconds: 2, outputStepSeconds: 1 },
    { matchId: "42", windowSeconds: 60.5, outputStepSeconds: 1 },
    { matchId: "42", windowSeconds: 60, outputStepSeconds: 0 },
    { matchId: "42", windowSeconds: 60, outputStepSeconds: 61 },
    { matchId: "42", windowSeconds: 60, outputStepSeconds: 1.5 },
    { matchId: "42", windowSeconds: 60, outputStepSeconds: 1, extra: true },
  ]) {
    assert.equal(rollingGpmInputSchema.safeParse(input).success, false, JSON.stringify(input));
  }
});

test("rolling GPM query groups player and team rows into stable series", async () => {
  const result = await getMatchRollingGpm({
    matchId: "42",
    windowSeconds: 60,
    outputStepSeconds: 1,
  });

  assert.deepEqual(result, {
    matchId: "42",
    windowSeconds: 60,
    outputStepSeconds: 1,
    players: [
      {
        playerSlot: 0,
        teamId: 2,
        points: [
          { gameTimeSeconds: 60, gpm: 200 },
          { gameTimeSeconds: 61, gpm: 250 },
        ],
      },
      {
        playerSlot: 128,
        teamId: 3,
        points: [{ gameTimeSeconds: 61, gpm: 300.5 }],
      },
    ],
    teams: [
      { teamId: 2, points: [{ gameTimeSeconds: 61, gpm: 1200 }] },
      { teamId: 3, points: [{ gameTimeSeconds: 61, gpm: 1400.25 }] },
    ],
  });
});

test("rolling GPM query returns an empty grouped result when the macro returns no rows", async () => {
  assert.deepEqual(await getMatchRollingGpm({
    matchId: "999",
    windowSeconds: 300,
    outputStepSeconds: 60,
  }), {
    matchId: "999",
    windowSeconds: 300,
    outputStepSeconds: 60,
    players: [],
    teams: [],
  });
});
