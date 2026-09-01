import assert from "node:assert/strict";
import test from "node:test";
import {
  detectFights,
  FIGHT_DETECTION_THRESHOLDS,
  FIGHT_DETECTION_VERSION,
  type FightCombatEvent,
  type FightDetectionInput,
  type FightRosterHero,
} from "../src/server/fight-detector.js";

const roster: FightRosterHero[] = [
  hero(0, 10, 2, 2),
  hero(1, 11, 5, 2),
  hero(2, 12, 7, 2),
  hero(3, 13, 8, 2),
  hero(4, 14, 9, 2),
  hero(5, 20, 18, 3),
  hero(6, 21, 19, 3),
  hero(7, 22, 25, 3),
  hero(8, 23, 26, 3),
  hero(9, 24, 27, 3),
];

function hero(
  playerSlot: number,
  gamePlayerId: number,
  heroId: number,
  teamId: 2 | 3,
): FightRosterHero {
  return { playerSlot, gamePlayerId, heroId, teamId };
}

function death(
  sequence: bigint,
  gameTimeSeconds: number,
  victim = "npc_dota_hero_sven",
  killer = "npc_dota_hero_axe",
  overrides: Partial<FightCombatEvent> = {},
): FightCombatEvent {
  return {
    sequence,
    eventType: "DOTA_COMBATLOG_DEATH",
    gameTimeSeconds,
    targetName: victim,
    targetTeam: victim === "npc_dota_hero_sven" || victim === "npc_dota_hero_tiny"
      || victim === "npc_dota_hero_lina" || victim === "npc_dota_hero_lion"
      || victim === "npc_dota_hero_shadow_shaman" ? 3 : 2,
    attackerName: killer,
    damageSourceName: killer,
    targetIllusion: false,
    assistPlayers: [],
    locationX: 0,
    locationY: 0,
    ...overrides,
  };
}

function damage(
  sequence: bigint,
  gameTimeSeconds: number,
  overrides: Partial<FightCombatEvent> = {},
): FightCombatEvent {
  return {
    sequence,
    eventType: "DOTA_COMBATLOG_DAMAGE",
    gameTimeSeconds,
    targetName: "npc_dota_hero_sven",
    attackerName: "npc_dota_hero_axe",
    damageSourceName: "npc_dota_hero_axe",
    targetTeam: 3,
    attackerTeam: 2,
    targetIllusion: false,
    locationX: 0,
    locationY: 0,
    ...overrides,
  };
}

function fights(
  combatEvents: FightCombatEvent[],
  overrides: Partial<FightDetectionInput> = {},
) {
  return detectFights({ roster, combatEvents, ...overrides });
}

test("version 1 keeps every threshold in one exported configuration", () => {
  assert.equal(FIGHT_DETECTION_VERSION, "death-anchored-fights-v1");
  assert.deepEqual(FIGHT_DETECTION_THRESHOLDS, {
    maximumLinkedDeathGapSeconds: 20,
    maximumLinkedDeathDistanceWorldUnits: 2_500,
    maximumCombatDamageIdleGapSeconds: 10,
    maximumPreludeSeconds: 60,
    maximumCombatEndSeconds: 20,
    outcomePeriodSeconds: 30,
    localMapRadiusWorldUnits: 3_500,
    minimumMapWidthWorldUnits: 2_400,
    minimumMapHeightWorldUnits: 2_400,
    maximumMapWidthWorldUnits: 6_500,
    maximumMapHeightWorldUnits: 6_500,
    mapPaddingWorldUnits: 800,
  });
});

test("one-versus-one is a pickoff", () => {
  const [fight] = fights([death(1n, 100)]);
  assert.equal(fight?.type, "pickoff");
  assert.deepEqual(fight?.radiantParticipants.map((entry) => entry.playerSlot), [0]);
  assert.deepEqual(fight?.direParticipants.map((entry) => entry.playerSlot), [5]);
});

test("two-versus-one is a pickoff", () => {
  const [fight] = fights([death(1n, 100, undefined, undefined, { assistPlayers: [11] })]);
  assert.equal(fight?.type, "pickoff");
  assert.deepEqual(fight?.radiantParticipants.map((entry) => entry.playerSlot), [0, 1]);
});

test("two-versus-two is a skirmish", () => {
  const [fight] = fights([
    death(1n, 100, undefined, undefined, { assistPlayers: [11] }),
    death(2n, 105, "npc_dota_hero_crystal_maiden", "npc_dota_hero_tiny", {
      assistPlayers: [20],
    }),
  ]);
  assert.equal(fight?.type, "skirmish");
  assert.deepEqual(fight?.radiantParticipants.map((entry) => entry.playerSlot), [0, 1]);
  assert.deepEqual(fight?.direParticipants.map((entry) => entry.playerSlot), [5, 6]);
});

test("three-versus-three is a team fight", () => {
  const [fight] = fights([
    death(1n, 100, undefined, undefined, { assistPlayers: [11, 12] }),
    death(2n, 105, "npc_dota_hero_crystal_maiden", "npc_dota_hero_tiny", {
      assistPlayers: [20, 22],
    }),
  ]);
  assert.equal(fight?.type, "team_fight");
  assert.equal(fight?.radiantParticipants.length, 3);
  assert.equal(fight?.direParticipants.length, 3);
});

test("uneven three-versus-two is a skirmish", () => {
  const [fight] = fights([
    death(1n, 100, undefined, undefined, { assistPlayers: [11, 12] }),
    death(2n, 105, "npc_dota_hero_crystal_maiden", "npc_dota_hero_tiny", {
      assistPlayers: [20],
    }),
  ]);
  assert.equal(fight?.type, "skirmish");
  assert.equal(fight?.radiantParticipants.length, 3);
  assert.equal(fight?.direParticipants.length, 2);
});

test("deaths at the 20-second boundary stay linked", () => {
  const detected = fights([death(1n, 100), death(2n, 120)]);
  assert.equal(detected.length, 1);
  assert.equal(detected[0]?.anchorDeaths.length, 2);
});

test("deaths beyond the 20-second boundary are separate", () => {
  const detected = fights([death(1n, 100), death(2n, 120.001)]);
  assert.equal(detected.length, 2);
});

test("deaths at the 2,500-unit boundary stay linked", () => {
  const detected = fights([
    death(1n, 100, undefined, undefined, { locationX: 0, locationY: 0 }),
    death(2n, 110, undefined, undefined, { locationX: 1_500, locationY: 2_000 }),
  ]);
  assert.equal(detected.length, 1);
});

test("simultaneous deaths in different map areas stay separate", () => {
  const detected = fights([
    death(1n, 100, undefined, undefined, { locationX: -4_000, locationY: -4_000 }),
    death(2n, 100, undefined, undefined, { locationX: 4_000, locationY: 4_000 }),
  ]);
  assert.equal(detected.length, 2);
});

test("a remote global participant does not link located fights", () => {
  const detected = fights([
    death(1n, 100, undefined, undefined, {
      assistPlayers: [12], locationX: -4_000, locationY: -4_000,
    }),
    death(2n, 105, "npc_dota_hero_tiny", undefined, {
      assistPlayers: [12], locationX: 4_000, locationY: 4_000,
    }),
  ]);
  assert.equal(detected.length, 2);
});

test("a remote damage location does not move the engagement's combat area", () => {
  const [fight] = fights([
    damage(1n, 95, { locationX: 8_000, locationY: 8_000 }),
    death(2n, 100, undefined, undefined, { locationX: 100, locationY: 200 }),
  ]);
  assert.deepEqual(fight?.combatPoints, [{ x: 100, y: 200 }]);
});

test("missing locations require a shared active participant", () => {
  const detected = fights([
    death(1n, 100, undefined, undefined, { locationX: null, locationY: null }),
    death(2n, 105, "npc_dota_hero_tiny", "npc_dota_hero_axe", {
      locationX: null, locationY: null,
    }),
  ]);
  assert.equal(detected.length, 1);
  assert.equal(detected[0]?.anchorDeaths.length, 2);
});

test("transitive death links form one engagement", () => {
  const detected = fights([
    death(1n, 100, undefined, undefined, { locationX: 0 }),
    death(2n, 115, undefined, undefined, { locationX: 2_000 }),
    death(3n, 130, undefined, undefined, { locationX: 4_000 }),
  ]);
  assert.equal(detected.length, 1);
  assert.equal(detected[0]?.anchorDeaths.length, 3);
});

test("prelude never extends more than 60 seconds", () => {
  const [fight] = fights([
    damage(1n, 39.9),
    damage(2n, 40),
    damage(3n, 50),
    damage(4n, 60),
    damage(5n, 70),
    damage(6n, 80),
    damage(7n, 90),
    death(8n, 100),
  ]);
  assert.equal(fight?.combatStartTimeSeconds, 40);
});

test("a combat-damage idle gap above 10 seconds stops the prelude", () => {
  const [fight] = fights([
    damage(1n, 78),
    damage(2n, 89),
    damage(3n, 99),
    death(4n, 100),
  ]);
  assert.equal(fight?.combatStartTimeSeconds, 89);
});

test("combat end never extends more than 20 seconds", () => {
  const [fight] = fights([
    death(1n, 100),
    damage(2n, 110),
    damage(3n, 120),
    damage(4n, 121),
  ]);
  assert.equal(fight?.combatEndTimeSeconds, 120);
  assert.equal(fight?.outcomeEndTimeSeconds, 150);
});

test("unknown killer is retained when an enemy assist is credited", () => {
  const [fight] = fights([death(1n, 100, undefined, "unknown", {
    damageSourceName: "unknown", assistPlayers: [11],
  })]);
  assert.equal(fight?.anchorDeaths[0]?.killer, null);
  assert.deepEqual(fight?.anchorDeaths[0]?.assists.map((entry) => entry.playerSlot), [1]);
});

test("an ambiguous assist mapping is rejected instead of guessed", () => {
  const ambiguousRoster = [...roster, hero(10, 11, 3, 2)];
  assert.deepEqual(fights([death(1n, 100, undefined, "unknown", {
    damageSourceName: "unknown", assistPlayers: [11],
  })], { roster: ambiguousRoster }), []);
});

test("illusion deaths and damage are excluded", () => {
  assert.deepEqual(fights([death(1n, 100, undefined, undefined, {
    targetIllusion: true,
  })]), []);
  const [fight] = fights([
    damage(1n, 95, { targetIllusion: true }),
    death(2n, 100),
  ]);
  assert.equal(fight?.combatStartTimeSeconds, 100);
});

test("controlled-unit damage is included when its credited owner is active", () => {
  const [fight] = fights([
    damage(1n, 95, {
      attackerName: "npc_dota_neutral_centaur_khan",
      damageSourceName: "npc_dota_hero_axe",
    }),
    death(2n, 100),
  ]);
  assert.equal(fight?.combatStartTimeSeconds, 95);
});

test("same-team, self, and damage by a non-participant do not extend combat", () => {
  const [fight] = fights([
    damage(1n, 97, { targetName: "npc_dota_hero_crystal_maiden" }),
    damage(2n, 98, { targetName: "npc_dota_hero_axe" }),
    damage(3n, 99, { damageSourceName: "npc_dota_hero_earthshaker" }),
    death(4n, 100),
  ]);
  assert.equal(fight?.combatStartTimeSeconds, 100);
});

test("a match without a hero death has no engagement", () => {
  assert.deepEqual(fights([damage(1n, 100)]), []);
});

test("the first time-and-sequence ordered anchor supplies a deterministic fight ID", () => {
  const [fight] = fights([death(20n, 100), death(10n, 100)]);
  assert.equal(fight?.fightId, "10");
  assert.deepEqual(fight?.anchorDeaths.map((entry) => entry.sequence), [10n, 20n]);
});

test("credited damage source takes precedence, with attacker as fallback", () => {
  const [credited] = fights([death(1n, 100, undefined, "npc_dota_hero_axe", {
    damageSourceName: "npc_dota_hero_crystal_maiden",
  })]);
  assert.equal(credited?.anchorDeaths[0]?.killer?.playerSlot, 1);

  const [fallback] = fights([death(1n, 100, undefined, "npc_dota_hero_axe", {
    damageSourceName: "unknown",
  })]);
  assert.equal(fallback?.anchorDeaths[0]?.killer?.playerSlot, 0);
});

test("event location wins over keyed victim position, then position, then no location", () => {
  const positioned = fights([death(1n, 100, undefined, undefined, {
    locationX: null, locationY: null,
  })], { deathPositions: [{ deathSequence: 1n, worldX: 40, worldY: 50 }] });
  assert.deepEqual(positioned[0]?.anchorDeaths[0]?.location, { x: 40, y: 50 });

  const located = fights([death(1n, 100, undefined, undefined, {
    locationX: 10, locationY: 20,
  })], { deathPositions: [{ deathSequence: 1n, worldX: 40, worldY: 50 }] });
  assert.deepEqual(located[0]?.anchorDeaths[0]?.location, { x: 10, y: 20 });

  const absent = fights([death(1n, 100, undefined, undefined, {
    locationX: null, locationY: null,
  })]);
  assert.equal(absent[0]?.anchorDeaths[0]?.location, null);
});

test("ambiguous hero-name mapping rejects a victim", () => {
  const ambiguousRoster = [...roster, {
    ...hero(10, 30, 3, 3), combatLogName: "npc_dota_hero_sven",
  }];
  assert.deepEqual(fights([death(1n, 100)], { roster: ambiguousRoster }), []);
});

test("non-finite event times and locations are not invented", () => {
  assert.deepEqual(fights([death(1n, Number.NaN)]), []);
  const [fight] = fights([death(1n, 100, undefined, undefined, {
    locationX: Number.NaN, locationY: 0,
  })]);
  assert.equal(fight?.anchorDeaths[0]?.location, null);
});
