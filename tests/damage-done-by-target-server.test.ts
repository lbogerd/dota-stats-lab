import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-damage-done-by-target-server-"));
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { migrate, openWarehouse } = await import("../src/db/database.js");
const warehouse = await openWarehouse();
await migrate(warehouse.connection);

const replayHash = "b".repeat(64);
await warehouse.connection.run(`
  INSERT INTO catalog.extractions (
    extraction_id, match_id, replay_sha256, parser_name, parser_version,
    exporter_version, extraction_config, output_limit_bytes, started_at,
    completed_at, status
  ) VALUES
    ('done-old', 52, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded'),
    ('done-latest', 52, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z', 'succeeded'),
    ('done-failed', 52, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-03T00:00:00Z', '2026-01-03T00:01:00Z', 'failed'),
    ('done-empty', 53, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded'),
    ('done-missing-markers', 54, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded'),
    ('done-unknown-hero', 55, '${replayHash}', 'test', '1', '1', '{}', 1,
      '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'succeeded');

  INSERT INTO analysis.players (
    extraction_id, player_slot, team_id, team, team_slot, player_name, hero_id
  ) VALUES
    ('done-old', 0, 3, 'Dire', 0, 'Old player', 2),
    ('done-latest', 0, 2, 'Radiant', 0, 'Aui', 58),
    ('done-failed', 0, 3, 'Dire', 0, 'Failed player', 1),
    ('done-empty', 128, 3, 'Dire', 0, NULL, 2),
    ('done-missing-markers', 1, 2, 'Radiant', 1, 'No timeline', 5),
    ('done-unknown-hero', 2, 2, 'Radiant', 2, 'Future hero', 999);

  INSERT INTO raw.combat_events (
    extraction_id, sequence, game_time, raw_time, event_type, target_name,
    target_source_name, attacker_name, damage_source_name, inflictor_name,
    target_team, attacker_team, value, damage_type, attacker_illusion,
    target_illusion, spell_generated_attack
  ) VALUES
    ('done-old', 1, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('done-old', 2, 0, 1, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_axe', NULL, 2, 3, 9000, 1, false, false, false),
    ('done-old', 3, 100, 2, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL),

    ('done-latest', 90, -100, -1, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 999, 1, false, false, false),
    ('done-latest', 100, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('done-latest', 101, -61, 1, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 10, 1, false, false, false),
    ('done-latest', 117, 1, 2.7, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 22, 1, false, false, false),
    ('done-latest', 116, 1, 2.6, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 18, 1, false, false, true),
    ('done-latest', 118, 2, 3, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_creep_badguys_melee', 'npc_dota_creep_badguys_melee', 'npc_dota_neutral_centaur_khan', 'npc_dota_hero_enchantress', NULL, 3, 2, 30, 1, false, false, false),
    ('done-latest', 119, 3, 4, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_phantom_lancer', 'npc_dota_hero_phantom_lancer', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 40, 1, true, false, false),
    ('done-latest', 120, 4, 5, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_lone_druid_bear', 'npc_dota_hero_lone_druid', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 50, 1, false, false, false),
    ('done-latest', 121, 5, 6, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_phantom_lancer', 'npc_dota_hero_phantom_lancer', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 60, 1, false, true, false),
    ('done-latest', 122, 6, 7, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_neutral_froglet', 'npc_dota_neutral_froglet', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 4, 2, 25, 1, false, false, false),
    ('done-latest', 123, 7, 8, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_badguys_tower1_mid', 'npc_dota_badguys_tower1_mid', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 35, 1, false, false, false),
    ('done-latest', 124, 8, 9, 'DOTA_COMBATLOG_DAMAGE', NULL, '', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, NULL, 2, 15, 1, false, false, false),
    ('done-latest', 125, 9, 10, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', 'enchantress_impetus', 3, 2, 12, 4, false, false, false),
    ('done-latest', 126, 10, 11, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 2, 2, 13, 1, false, false, false),
    ('done-latest', 127, 11, 12, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 2, 2, 14, 1, false, false, false),
    ('done-latest', 128, 12, 13, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_creep_badguys_ranged', 'npc_dota_creep_badguys_ranged', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 16, 1, false, false, false),
    ('done-latest', 129, 13, 14, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 3, 777, 1, false, false, false),
    ('done-latest', 130, 14, 15, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_chen', NULL, 3, 2, 666, 1, false, false, false),
    ('done-latest', 131, 15, 16, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_goodguys_siege', 'npc_dota_goodguys_siege', 'npc_dota_hero_enchantress', '', NULL, 2, 2, 17, 1, false, false, false),
    ('done-latest', 132, NULL, 17, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 555, 1, false, false, false),
    ('done-latest', 133, 16, 18, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, NULL, 1, false, false, false),
    ('done-latest', 200, 100, 19, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL),
    ('done-latest', 201, 101, 20, 'DOTA_COMBATLOG_DAMAGE', 'npc_dota_hero_axe', 'npc_dota_hero_axe', 'npc_dota_hero_enchantress', 'npc_dota_hero_enchantress', NULL, 3, 2, 444, 1, false, false, false),

    ('done-empty', 1, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('done-empty', 2, 100, 1, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL),
    ('done-missing-markers', 1, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('done-unknown-hero', 1, -90, 0, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 4, NULL, NULL, NULL, NULL),
    ('done-unknown-hero', 2, 100, 1, 'DOTA_COMBATLOG_GAME_STATE', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 6, NULL, NULL, NULL, NULL);
`);
warehouse.close();
after(() => rm(root, { recursive: true, force: true }));

const {
  damageDoneByTargetInputSchema,
  getMatchHeroDamageDoneTimeline,
} = await import("../src/server/damage-done-by-target.js");

test("damage-done input rejects invalid IDs, slots, and extra fields", () => {
  assert.equal(damageDoneByTargetInputSchema.safeParse({ matchId: "52", playerSlot: 0 }).success, true);
  assert.equal(damageDoneByTargetInputSchema.safeParse({ matchId: "52", playerSlot: 255 }).success, true);
  for (const input of [
    { matchId: "0", playerSlot: 0 },
    { matchId: "18446744073709551616", playerSlot: 0 },
    { matchId: "52", playerSlot: -1 },
    { matchId: "52", playerSlot: 256 },
    { matchId: "52", playerSlot: 0.5 },
    { matchId: "52", playerSlot: 0, extra: true },
  ]) {
    assert.equal(damageDoneByTargetInputSchema.safeParse(input).success, false, JSON.stringify(input));
  }
});

test("query selects the latest roster dealer and filters its actual-game damage", async () => {
  const result = await getMatchHeroDamageDoneTimeline({ matchId: "52", playerSlot: 0 });
  assert.equal(result.available, true);
  assert.deepEqual(result.dealer, {
    heroId: 58,
    heroName: "Enchantress",
    playerName: "Aui",
    teamId: 2,
  });
  assert.equal(result.intervalSeconds, 30);
  assert.equal(result.totalDamage, 377);
  assert.deepEqual(result.intervals.map((interval) => [
    interval.startSeconds,
    interval.endSeconds,
    interval.totalDamage,
  ]), [
    [-90, -60, 10],
    [0, 30, 367],
  ]);
});

test("query groups target controllers, target illusions, mechanisms, and teams", async () => {
  const result = await getMatchHeroDamageDoneTimeline({ matchId: "52", playerSlot: 0 });
  const interval = result.intervals[1];
  assert.ok(interval);

  const phantomLancer = interval.targets.find((target) =>
    target.rawName === "npc_dota_hero_phantom_lancer"
  );
  assert.deepEqual(phantomLancer, {
    rawName: "npc_dota_hero_phantom_lancer",
    label: "Phantom Lancer",
    teamId: 3,
    damage: 100,
    via: [
      {
        rawName: "npc_dota_hero_phantom_lancer",
        label: "Phantom Lancer illusion",
        kind: "illusion",
        damage: 60,
        mechanisms: [{
          rawName: null,
          label: "Attack",
          damage: 60,
          events: [assertEvent("121", 5, 60, "direct")],
        }],
      },
      {
        rawName: null,
        label: "Direct",
        kind: "direct",
        damage: 40,
        mechanisms: [{
          rawName: null,
          label: "Attack",
          damage: 40,
          events: [assertEvent("119", 3, 40, "illusion", "npc_dota_hero_enchantress", "Enchantress illusion")],
        }],
      },
    ],
  });

  const controlled = interval.targets.find((target) => target.rawName === "npc_dota_hero_lone_druid");
  assert.deepEqual(controlled?.via.map((via) => [via.rawName, via.label, via.kind, via.damage]), [
    ["npc_dota_lone_druid_bear", "Lone Druid Bear", "unit", 50],
  ]);

  const enemyAxe = interval.targets.find((target) =>
    target.rawName === "npc_dota_hero_axe" && target.teamId === 3
  );
  const alliedAxe = interval.targets.find((target) =>
    target.rawName === "npc_dota_hero_axe" && target.teamId === 2
  );
  assert.equal(enemyAxe?.damage, 52);
  assert.equal(alliedAxe?.damage, 13);
  assert.deepEqual(enemyAxe?.via[0]?.mechanisms.map((mechanism) => [
    mechanism.rawName,
    mechanism.label,
    mechanism.damage,
  ]), [
    [null, "Attack", 40],
    ["enchantress_impetus", "Enchantress Impetus", 12],
  ]);
  assert.deepEqual(enemyAxe?.via[0]?.mechanisms[0]?.events.map((event) => event.sequence), ["116", "117"]);
});

test("controlled attackers, fallback dealers, and exact fields are preserved", async () => {
  const result = await getMatchHeroDamageDoneTimeline({ matchId: "52", playerSlot: 0 });
  const events = result.intervals.flatMap((interval) =>
    interval.targets.flatMap((target) =>
      target.via.flatMap((via) => via.mechanisms.flatMap((mechanism) => mechanism.events))
    )
  );
  const controlled = events.find((event) => event.sequence === "118");
  assert.deepEqual(controlled, {
    sequence: "118",
    gameTimeSeconds: 2,
    rawTimeSeconds: 3,
    damage: 30,
    attackerTeam: 2,
    targetTeam: 3,
    damageType: 1,
    spellGeneratedAttack: false,
    dealerVia: {
      rawName: "npc_dota_neutral_centaur_khan",
      label: "Neutral Centaur Khan",
      kind: "unit",
    },
  });
  assert.ok(events.some((event) => event.sequence === "131"));
  assert.ok(!events.some((event) => event.damage === 777 || event.damage === 666));
});

test("all target classes and unknown targets remain in the result", async () => {
  const result = await getMatchHeroDamageDoneTimeline({ matchId: "52", playerSlot: 0 });
  const targets = result.intervals[1]?.targets ?? [];
  const labels = targets.map((target) => target.label);
  for (const label of [
    "Phantom Lancer",
    "Axe",
    "Lone Druid",
    "Badguys Tower1 Mid",
    "Creep Badguys Melee",
    "Neutral Froglet",
    "Goodguys Siege",
    "Creep Badguys Ranged",
    "Unknown target",
    "Enchantress",
  ]) assert.ok(labels.includes(label), label);
  const unknown = targets.find((target) => target.rawName === "Unknown target");
  assert.equal(unknown?.teamId, null);
  assert.equal(unknown?.via[0]?.kind, "direct");
});

test("an available timeline can have no matching damage", async () => {
  assert.deepEqual(await getMatchHeroDamageDoneTimeline({ matchId: "53", playerSlot: 128 }), {
    matchId: "53",
    playerSlot: 128,
    intervalSeconds: 30,
    available: true,
    dealer: { heroId: 2, heroName: "Axe", playerName: null, teamId: 3 },
    totalDamage: 0,
    intervals: [],
  });
});

test("missing game-state markers make the timeline unavailable", async () => {
  const result = await getMatchHeroDamageDoneTimeline({ matchId: "54", playerSlot: 1 });
  assert.equal(result.available, false);
  assert.equal(result.totalDamage, 0);
  assert.deepEqual(result.intervals, []);
});

test("an unknown roster hero returns a clear unavailable result", async () => {
  const result = await getMatchHeroDamageDoneTimeline({ matchId: "55", playerSlot: 2 });
  assert.equal(result.available, false);
  assert.deepEqual(result.dealer, {
    heroId: 999,
    heroName: "Hero #999",
    playerName: "Future hero",
    teamId: 2,
  });
});

test("a missing roster slot returns a clear not-found error", async () => {
  await assert.rejects(
    getMatchHeroDamageDoneTimeline({ matchId: "52", playerSlot: 99 }),
    /Player slot 99 was not found in match 52/,
  );
});

function assertEvent(
  sequence: string,
  gameTimeSeconds: number,
  damage: number,
  dealerKind: "direct" | "unit" | "illusion",
  dealerRawName: string | null = null,
  dealerLabel = "Direct",
) {
  return {
    sequence,
    gameTimeSeconds,
    rawTimeSeconds: gameTimeSeconds + 1,
    damage,
    attackerTeam: 2,
    targetTeam: 3,
    damageType: 1,
    spellGeneratedAttack: false,
    dealerVia: { rawName: dealerRawName, label: dealerLabel, kind: dealerKind },
  };
}
