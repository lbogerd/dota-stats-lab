import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-fights-server-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);

const hash = "a".repeat(64);
await warehouse.connection.run(`
  INSERT INTO catalog.extractions (
    extraction_id, match_id, replay_sha256, parser_name, parser_version,
    exporter_version, extraction_config, output_limit_bytes, started_at,
    completed_at, status, manifest
  ) VALUES
    ('fight-old', 420, '${hash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded', '{}'),
    ('fight-latest', 420, '${hash}', 'test', '2', '2', '{}', 1,
      '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z', 'succeeded', '{}'),
    ('fight-failed', 420, '${hash}', 'test', '3', '3', '{}', 1,
      '2026-01-03T00:00:00Z', '2026-01-03T00:01:00Z', 'failed', '{}'),
    ('fight-no-positions', 421, '${hash}', 'test', '2', '2', '{}', 1,
      '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z', 'succeeded', '{}'),
    ('fight-empty', 422, '${hash}', 'test', '2', '2', '{}', 1,
      '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z', 'succeeded', '{}');

  INSERT INTO analysis.matches (extraction_id, match_id, duration_seconds) VALUES
    ('fight-old', 420, 200), ('fight-latest', 420, 200),
    ('fight-no-positions', 421, 200), ('fight-empty', 422, 200);

  INSERT INTO analysis.players (
    extraction_id, player_slot, team_id, team, team_slot, hero_id
  ) VALUES
    ('fight-old', 0, 2, 'Radiant', 0, 1),
    ('fight-old', 128, 3, 'Dire', 0, 2),
    ('fight-latest', 0, 2, 'Radiant', 0, 1),
    ('fight-latest', 128, 3, 'Dire', 0, 2),
    ('fight-no-positions', 0, 2, 'Radiant', 0, 1),
    ('fight-no-positions', 128, 3, 'Dire', 0, 2);

  INSERT INTO raw.records (
    extraction_id, sequence, category, record_type, payload
  ) VALUES
    ('fight-latest', 1, 'match_metadata', 'CDOTAMatchMetadataFile',
      '{"metadata":{"teams":[{"dota_team":2,"players":[{"game_player_id":0,"player_slot":0}]},{"dota_team":3,"players":[{"game_player_id":5,"player_slot":128}]}]}}'),
    ('fight-no-positions', 1, 'match_metadata', 'CDOTAMatchMetadataFile',
      '{"metadata":{"teams":[{"dota_team":2,"players":[{"game_player_id":0,"player_slot":0}]},{"dota_team":3,"players":[{"game_player_id":5,"player_slot":128}]}]}}');

  INSERT INTO raw.combat_events (
    extraction_id, sequence, game_time, event_type, target_name, attacker_name,
    damage_source_name, target_team, attacker_team, value, assist_players,
    attacker_hero, target_hero, target_building, attacker_illusion, target_illusion
  ) VALUES
    ('fight-old', 1, 90, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 4, [], NULL, NULL, false, false, false),
    ('fight-old', 2, 100, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 5, [], NULL, NULL, false, false, false),
    ('fight-old', 3, 110, 'DOTA_COMBATLOG_DEATH', 'npc_dota_hero_axe', 'npc_dota_hero_antimage', 'npc_dota_hero_antimage', 3, 2, NULL, [], true, true, false, false, false),
    ('fight-old', 4, 300, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 6, [], NULL, NULL, false, false, false),

    ('fight-latest', 1, 90, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 4, [], NULL, NULL, false, false, false),
    ('fight-latest', 2, 100, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 5, [], NULL, NULL, false, false, false),
    ('fight-latest', 3, 105, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_antimage', 'npc_dota_hero_antimage', 3, 2, 120, [], true, true, false, false, false),
    ('fight-latest', 4, 108, 'DOTA_COMBATLOG_XP', 'npc_dota_hero_antimage', NULL, NULL, NULL, NULL, 50, [], NULL, NULL, false, false, false),
    ('fight-latest', 5, 109, 'DOTA_COMBATLOG_HEAL', 'npc_dota_hero_antimage', 'npc_dota_hero_antimage', 'npc_dota_hero_antimage', 2, 2, 25, [], true, true, false, false, false),
    ('fight-latest', 6, 110, 'DOTA_COMBATLOG_DEATH', 'npc_dota_hero_axe', 'npc_dota_hero_antimage', 'npc_dota_hero_antimage', 3, 2, NULL, [], true, true, false, false, false),
    ('fight-latest', 7, 115, 'DOTA_COMBATLOG_DEATH', 'npc_dota_badguys_tower1_mid', 'npc_dota_hero_antimage', 'npc_dota_hero_antimage', 3, 2, NULL, [], true, false, true, false, false),
    ('fight-latest', 10, 300, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 6, [], NULL, NULL, false, false, false),
    ('fight-latest', 11, 301, 'DOTA_COMBATLOG_DEATH', 'npc_dota_hero_antimage', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 2, 3, NULL, [], true, true, false, false, false),

    ('fight-no-positions', 1, 90, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 4, [], NULL, NULL, false, false, false),
    ('fight-no-positions', 2, 100, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 5, [], NULL, NULL, false, false, false),
    ('fight-no-positions', 3, 110, 'DOTA_COMBATLOG_DEATH', 'npc_dota_hero_axe', 'npc_dota_hero_antimage', 'npc_dota_hero_antimage', 3, 2, NULL, [], true, true, false, false, false),
    ('fight-no-positions', 4, 300, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 6, [], NULL, NULL, false, false, false),

    ('fight-empty', 1, 90, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 4, [], NULL, NULL, false, false, false),
    ('fight-empty', 2, 100, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 5, [], NULL, NULL, false, false, false),
    ('fight-empty', 3, 300, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, 6, [], NULL, NULL, false, false, false);

  INSERT INTO analysis.hero_position_samples
  SELECT
    'fight-latest', (game_time_ms * 10 + player_slot)::UBIGINT,
    game_time_ms::UINTEGER, player_slot::UINTEGER,
    CASE player_slot WHEN 0 THEN 1 ELSE 2 END,
    CASE player_slot WHEN 0 THEN 2 ELSE 3 END,
    CASE player_slot WHEN 0 THEN 100 ELSE 200 END,
    CASE player_slot WHEN 0 THEN 300 ELSE 400 END
  FROM range(5_000, 10_001, 100) AS time(game_time_ms)
  CROSS JOIN (VALUES (0), (128)) AS player(player_slot);

  INSERT INTO analysis.player_gold_events VALUES
    ('fight-latest', 1, 0, 0, 2, 0, 100),
    ('fight-latest', 2, 0, 0, 2, 10, 250),
    ('fight-latest', 3, 5, 128, 3, 0, 100),
    ('fight-latest', 4, 5, 128, 3, 10, 130);

  INSERT INTO analysis.team_time_series VALUES
    ('fight-latest', 2, 0, 1_000, 1_000, 1_000),
    ('fight-latest', 3, 0, 1_000, 1_000, 1_000);

  INSERT INTO analysis.win_probability_samples VALUES
    ('fight-latest', 0, 0, 0.5, 'graph_history'),
    ('fight-latest', 1, 10, 0.6, 'graph_history');
`);
warehouse.close();
after(() => rm(root, { recursive: true, force: true }));

const {
  fightDetailInputSchema,
  fightsListInputSchema,
  getMatchFightDetail,
  getMatchFights,
} = await import("../src/server/fights.js");

test("fight inputs reject invalid match IDs, fight IDs, and extra fields", () => {
  assert.equal(fightsListInputSchema.safeParse({ matchId: "420" }).success, true);
  assert.equal(fightDetailInputSchema.safeParse({ matchId: "420", fightId: "6" }).success, true);
  for (const input of [
    { matchId: "0" },
    { matchId: "420", extra: true },
    { matchId: "420", fightId: "-1" },
    { matchId: "420", fightId: "01" },
    { matchId: "420", fightId: "18446744073709551616" },
  ]) {
    const schema = "fightId" in input ? fightDetailInputSchema : fightsListInputSchema;
    assert.equal(schema.safeParse(input).success, false, JSON.stringify(input));
  }
});

test("fight list uses the latest successful extraction and rejects post-game deaths", async () => {
  const result = await getMatchFights({ matchId: "420" });
  assert.equal(result.available, true);
  assert.equal(result.fights.length, 1);
  const fight = result.fights[0]!;
  assert.equal(fight.fightId, "6");
  assert.equal(fight.type, "pickoff");
  assert.equal(fight.firstAnchorTimeSeconds, 10);
  assert.deepEqual(fight.anchorTimesSeconds, [10]);
  assert.deepEqual(fight.participants.map((participant) => participant.playerSlot), [0, 128]);
  assert.equal(fight.teams[0].heroDamage, 120);
  assert.equal(fight.teams[0].heroHealing, 25);
  assert.equal(fight.teams[0].earnedGoldChange, "150");
  assert.equal(fight.teams[0].experienceChange, "50");
  assert.ok(Math.abs((fight.radiantWinProbabilityChange ?? 0) - 0.1) < 1e-12);
  assert.deepEqual(fight.objectives.map((objective) => objective.kind), ["tower"]);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("detail returns exact 100 ms frames, player metrics, and bounded JSON", async () => {
  const result = await getMatchFightDetail({ matchId: "420", fightId: "6" });
  assert.notEqual(result.fight, null);
  const fight = result.fight!;
  assert.equal(fight.positionState, "available");
  assert.equal(fight.frames[0]?.gameTimeMilliseconds, 5_000);
  assert.equal(fight.frames.at(-1)?.gameTimeMilliseconds, 10_000);
  for (let index = 1; index < fight.frames.length; index++) {
    assert.equal(fight.frames[index]!.gameTimeMilliseconds - fight.frames[index - 1]!.gameTimeMilliseconds, 100);
  }
  assert.equal(fight.playerResults.find((player) => player.playerSlot === 0)?.earnedGoldChange, "150");
  assert.equal(fight.deathMarkers.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") < 500_000);
});

test("old combat-only extractions retain fights and return a position unavailable state", async () => {
  const list = await getMatchFights({ matchId: "421" });
  assert.equal(list.fights.length, 1);
  assert.equal(list.fights[0]?.location, null);
  assert.equal(list.fights[0]?.availability.earnedGold, false);
  assert.equal(list.fights[0]?.teams[0].earnedGoldChange, null);
  const detail = await getMatchFightDetail({ matchId: "421", fightId: "3" });
  assert.equal(detail.fight?.positionState, "unavailable");
  assert.deepEqual(detail.fight?.frames, []);
});

test("empty combat and missing fight IDs return explicit empty/not-found results", async () => {
  assert.deepEqual(await getMatchFights({ matchId: "422" }), {
    matchId: "422", available: true, fights: [],
  });
  assert.deepEqual(await getMatchFightDetail({ matchId: "420", fightId: "11" }), {
    matchId: "420", fight: null,
  });
});
