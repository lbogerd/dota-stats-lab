import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-damage-by-source-server-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);

const replayHash = "a".repeat(64);
await warehouse.connection.run(`
  INSERT INTO catalog.extractions (
    extraction_id, match_id, replay_sha256, parser_name, parser_version,
    exporter_version, extraction_config, output_limit_bytes, started_at,
    completed_at, status
  ) VALUES
    ('old', 42, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded'),
    ('latest', 42, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z', 'succeeded'),
    ('failed-newer', 42, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-03T00:00:00Z', '2026-01-03T00:01:00Z', 'failed'),
    ('empty', 43, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded'),
    ('missing-markers', 44, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded'),
    ('unknown-hero', 45, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded');

  INSERT INTO analysis.players (
    extraction_id, player_slot, team_id, team, team_slot, player_name, hero_id
  ) VALUES
    ('old', 0, 3, 'Dire', 0, 'Old player', 2),
    ('latest', 0, 2, 'Radiant', 0, 'Aui', 58),
    ('failed-newer', 0, 3, 'Dire', 0, 'Failed player', 1),
    ('empty', 128, 3, 'Dire', 0, NULL, 2),
    ('missing-markers', 1, 2, 'Radiant', 1, 'No timeline', 5),
    ('unknown-hero', 2, 2, 'Radiant', 2, 'Future hero', 999);

  INSERT INTO raw.combat_events (
    extraction_id, sequence, game_time, raw_time, event_type, target_name,
    attacker_name, damage_source_name, inflictor_name, target_team,
    attacker_team, value, damage_type, attacker_illusion, target_illusion,
    spell_generated_attack
  ) VALUES
    ('old', 1, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('old', 2, 0, 1, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 9000, 1, false, false, false),
    ('old', 3, 100, 2, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL),

    ('latest', 90, -100, -1, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_axe', 'npc_dota_hero_axe', NULL, 2, 3, 999, 1, false, false, false),
    ('latest', 100, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('latest', 101, -61, 1, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_axe', 'npc_dota_hero_axe', NULL, 2, 3, 10, 1, false, false, false),
    ('latest', 117, 1, 2.7, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_neutral_centaur_khan', 'npc_dota_hero_chen', NULL, 2, 3, 22, 1, false, false, false),
    ('latest', 116, 1, 2.6, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_neutral_centaur_khan', 'npc_dota_hero_chen', NULL, 2, 3, 18, 1, false, false, true),
    ('latest', 118, 2, 3, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_neutral_centaur_khan', 'npc_dota_hero_chen', 'centaur_khan_war_stomp', 2, 3, 10, 2, false, false, false),
    ('latest', 119, 3, 4, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_neutral_satyr_hellcaller', NULL, NULL, 2, 4, 25, 1, false, false, false),
    ('latest', 120, 4, 5, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_phantom_lancer', 'npc_dota_hero_phantom_lancer', NULL, 2, 3, 30, 1, true, false, false),
    ('latest', 121, 5, 6, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_crystal_maiden', 'npc_dota_hero_crystal_maiden', 'crystal_maiden_crystal_nova', 2, 2, 20, 2, false, false, false),
    ('latest', 122, 6, 7, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', 'enchantress_impetus', 2, 2, 15, 4, false, false, false),
    ('latest', 123, 7, 8, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_axe', 'npc_dota_hero_axe', NULL, 2, 3, 888, 1, false, true, false),
    ('latest', 124, 8, 9, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_axe', 'npc_dota_hero_axe', NULL, 3, 3, 777, 1, false, false, false),
    ('latest', 125, 9, 10, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 2, 2, 666, 1, false, false, false),
    ('latest', 126, NULL, 11, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_axe', 'npc_dota_hero_axe', NULL, 2, 3, 555, 1, false, false, false),
    ('latest', 127, 10, 12, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_axe', 'npc_dota_hero_axe', NULL, 2, 3, NULL, 1, false, false, false),
    ('latest', 200, 100, 13, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL),
    ('latest', 201, 101, 14, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_axe', 'npc_dota_hero_axe', NULL, 2, 3, 444, 1, false, false, false),

    ('empty', 1, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('empty', 2, 100, 1, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL),
    ('missing-markers', 1, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('unknown-hero', 1, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('unknown-hero', 2, 100, 1, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL);
`);
warehouse.close();
after(() => rm(root, { recursive: true, force: true }));

const {
  damageBySourceInputSchema,
  getMatchHeroDamageTimeline,
} = await import("../src/server/damage-by-source.js");
const {
  getHeroCombatLogName,
  getHeroDisplayData,
} = await import("../src/lib/dota-heroes.js");

test("shared hero metadata provides display data and combat-log names", () => {
  assert.deepEqual(getHeroDisplayData(58), { name: "Enchantress", slug: "enchantress" });
  assert.equal(getHeroCombatLogName(58), "npc_dota_hero_enchantress");
  assert.equal(getHeroDisplayData(null), null);
  assert.equal(getHeroCombatLogName(999), null);
});

test("damage-by-source input rejects invalid IDs, slots, and extra fields", () => {
  assert.equal(damageBySourceInputSchema.safeParse({ matchId: "42", playerSlot: 0 }).success, true);
  assert.equal(damageBySourceInputSchema.safeParse({ matchId: "42", playerSlot: 255 }).success, true);
  for (const input of [
    { matchId: "0", playerSlot: 0 },
    { matchId: "18446744073709551616", playerSlot: 0 },
    { matchId: "42", playerSlot: -1 },
    { matchId: "42", playerSlot: 256 },
    { matchId: "42", playerSlot: 0.5 },
    { matchId: "42", playerSlot: 0, extra: true },
  ]) {
    assert.equal(damageBySourceInputSchema.safeParse(input).success, false, JSON.stringify(input));
  }
});

test("query selects the latest roster hero and filters its actual-game damage", async () => {
  const result = await getMatchHeroDamageTimeline({ matchId: "42", playerSlot: 0 });
  assert.equal(result.available, true);
  assert.deepEqual(result.target, {
    heroId: 58,
    heroName: "Enchantress",
    playerName: "Aui",
    teamId: 2,
  });
  assert.equal(result.intervalSeconds, 30);
  assert.equal(result.totalDamage, 150);
  assert.deepEqual(result.intervals.map((interval) => [
    interval.startSeconds,
    interval.endSeconds,
    interval.totalDamage,
  ]), [
    [-90, -60, 10],
    [0, 30, 140],
  ]);
});

test("query groups controllers, illusions, neutrals, mechanisms, and exact events", async () => {
  const result = await getMatchHeroDamageTimeline({ matchId: "42", playerSlot: 0 });
  const interval = result.intervals[1];
  assert.ok(interval);
  assert.deepEqual(interval.sources.map((source) => [source.label, source.damage]), [
    ["Chen", 50],
    ["Phantom Lancer", 30],
    ["Neutral Satyr Hellcaller", 25],
    ["Crystal Maiden", 20],
    ["Enchantress", 15],
  ]);

  const controlled = interval.sources[0];
  assert.ok(controlled);
  assert.equal(controlled.rawName, "npc_dota_hero_chen");
  assert.deepEqual(controlled.via.map((via) => [via.rawName, via.label, via.kind, via.damage]), [
    ["npc_dota_neutral_centaur_khan", "Neutral Centaur Khan", "unit", 50],
  ]);
  assert.deepEqual(controlled.via[0]?.mechanisms.map((mechanism) => [
    mechanism.rawName,
    mechanism.label,
    mechanism.damage,
  ]), [
    [null, "Attack", 40],
    ["centaur_khan_war_stomp", "Centaur Khan War Stomp", 10],
  ]);
  assert.deepEqual(controlled.via[0]?.mechanisms[0]?.events, [
    {
      sequence: "116",
      gameTimeSeconds: 1,
      rawTimeSeconds: 2.6,
      damage: 18,
      attackerTeam: 3,
      damageType: 1,
      spellGeneratedAttack: true,
    },
    {
      sequence: "117",
      gameTimeSeconds: 1,
      rawTimeSeconds: 2.7,
      damage: 22,
      attackerTeam: 3,
      damageType: 1,
      spellGeneratedAttack: false,
    },
  ]);

  const illusion = interval.sources[1]?.via[0];
  assert.deepEqual(illusion, {
    rawName: "npc_dota_hero_phantom_lancer",
    label: "Phantom Lancer illusion",
    kind: "illusion",
    damage: 30,
    mechanisms: [{
      rawName: null,
      label: "Attack",
      damage: 30,
      events: [{
        sequence: "120",
        gameTimeSeconds: 4,
        rawTimeSeconds: 5,
        damage: 30,
        attackerTeam: 3,
        damageType: 1,
        spellGeneratedAttack: false,
      }],
    }],
  });
  assert.equal(interval.sources[2]?.via[0]?.kind, "direct");
  assert.equal(interval.sources[3]?.via[0]?.mechanisms[0]?.label, "Crystal Maiden Crystal Nova");
});

test("allied, self, neutral, and enemy damage remain in the result", async () => {
  const result = await getMatchHeroDamageTimeline({ matchId: "42", playerSlot: 0 });
  const labels = result.intervals.flatMap((interval) => interval.sources.map((source) => source.label));
  assert.deepEqual(labels, [
    "Axe",
    "Chen",
    "Phantom Lancer",
    "Neutral Satyr Hellcaller",
    "Crystal Maiden",
    "Enchantress",
  ]);
});

test("an available timeline can have no matching damage", async () => {
  assert.deepEqual(await getMatchHeroDamageTimeline({ matchId: "43", playerSlot: 128 }), {
    matchId: "43",
    playerSlot: 128,
    intervalSeconds: 30,
    available: true,
    target: { heroId: 2, heroName: "Axe", playerName: null, teamId: 3 },
    totalDamage: 0,
    intervals: [],
  });
});

test("missing game-state markers make the timeline unavailable", async () => {
  const result = await getMatchHeroDamageTimeline({ matchId: "44", playerSlot: 1 });
  assert.equal(result.available, false);
  assert.equal(result.totalDamage, 0);
  assert.deepEqual(result.intervals, []);
});

test("an unknown roster hero returns a clear unavailable result", async () => {
  const result = await getMatchHeroDamageTimeline({ matchId: "45", playerSlot: 2 });
  assert.equal(result.available, false);
  assert.deepEqual(result.target, {
    heroId: 999,
    heroName: "Hero #999",
    playerName: "Future hero",
    teamId: 2,
  });
});

test("a missing roster slot returns a clear not-found error", async () => {
  await assert.rejects(
    getMatchHeroDamageTimeline({ matchId: "42", playerSlot: 99 }),
    /Player slot 99 was not found in match 42/,
  );
});
