import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-hero-stats-server-"));
const warehousePath = path.join(root, "warehouse", "dota.duckdb");
process.env.WAREHOUSE_PATH = warehousePath;

await mkdir(path.dirname(warehousePath), { recursive: true });
const writer = await DuckDBInstance.create(warehousePath);
const writerConnection = await writer.connect();
await writerConnection.run(`
  CREATE SCHEMA analysis;
  CREATE TABLE analysis.latest_successful_extractions (
    match_id UBIGINT,
    extraction_id VARCHAR
  );
  CREATE TABLE analysis.matches (
    match_id UBIGINT,
    extraction_id VARCHAR
  );
  INSERT INTO analysis.latest_successful_extractions VALUES
    (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd'), (5, 'not-materialized');
  INSERT INTO analysis.matches VALUES
    (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd');

  CREATE TABLE analysis.test_hero_stats (
    hero_id INTEGER,
    match_count UBIGINT,
    picks UBIGINT,
    bans UBIGINT,
    wins UBIGINT,
    losses UBIGINT,
    pick_rate DOUBLE,
    ban_rate DOUBLE,
    win_rate DOUBLE,
    loss_rate DOUBLE,
    average_gpm DOUBLE,
    average_xpm DOUBLE
  );
  INSERT INTO analysis.test_hero_stats VALUES
    (7, 4, 0, 1, 0, 0, 0, 0.25, NULL, NULL, NULL, NULL),
    (3, 4, 2, 1, 1, 1, 0.5, 0.25, 0.5, 0.5, 400.25, NULL),
    (4, 4, 2, 2, 2, 0, 0.5, 0.5, 1, 0, NULL, 515.5);
  CREATE MACRO analysis.hero_stats() AS TABLE (
    SELECT * FROM analysis.test_hero_stats
  );
`);
writerConnection.closeSync();
writer.closeSync();

const { listHeroStats } = await import("../src/server/hero-stats.js");

test("hero statistics are JSON-safe, preserve nulls, and have stable row order", async () => {
  const result = await listHeroStats();

  assert.deepEqual(result, {
    matchCount: 4,
    heroes: [
      {
        heroId: 4,
        matchCount: 4,
        picks: 2,
        bans: 2,
        wins: 2,
        losses: 0,
        pickRate: 0.5,
        banRate: 0.5,
        winRate: 1,
        lossRate: 0,
        averageGpm: null,
        averageXpm: 515.5,
      },
      {
        heroId: 3,
        matchCount: 4,
        picks: 2,
        bans: 1,
        wins: 1,
        losses: 1,
        pickRate: 0.5,
        banRate: 0.25,
        winRate: 0.5,
        lossRate: 0.5,
        averageGpm: 400.25,
        averageXpm: null,
      },
      {
        heroId: 7,
        matchCount: 4,
        picks: 0,
        bans: 1,
        wins: 0,
        losses: 0,
        pickRate: 0,
        banRate: 0.25,
        winRate: null,
        lossRate: null,
        averageGpm: null,
        averageXpm: null,
      },
    ],
  });
  assert.doesNotThrow(() => JSON.stringify(result));
  for (const hero of result.heroes) {
    for (const value of Object.values(hero)) {
      assert.notEqual(typeof value, "bigint");
    }
  }
});
