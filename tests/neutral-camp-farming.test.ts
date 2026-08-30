import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveNeutralCampFarmingActions,
  NEUTRAL_CAMP_FARMING_V1_CONFIG,
  type NeutralCampFarmingCreepFact,
  type NeutralCampFarmingDamageEvent,
  type NeutralCampFarmingFacts,
  type NeutralCampFarmingHeroPosition,
  type NeutralCampFarmingSpawnerFact,
} from "../src/load/neutral-camp-farming.js";

function spawner(
  handle: bigint,
  overrides: Partial<NeutralCampFarmingSpawnerFact> = {},
): NeutralCampFarmingSpawnerFact {
  return {
    entityInstanceId: handle + 1_000n,
    handle,
    campType: 3,
    worldX: 100,
    worldY: 200,
    creationGameTimeMs: 0,
    deletionGameTimeMs: null,
    ...overrides,
  };
}

function creep(
  entityInstanceId: bigint,
  overrides: Partial<NeutralCampFarmingCreepFact> = {},
): NeutralCampFarmingCreepFact {
  return {
    entityInstanceId,
    handle: entityInstanceId + 10_000n,
    className: "CDOTA_BaseNPC_Creep_Neutral",
    neutralSpawnerHandle: 10n,
    teamNumber: 4,
    creationGameTimeMs: 0,
    deathGameTimeMs: null,
    deletionGameTimeMs: null,
    ...overrides,
  };
}

function damage(
  gameTimeMs: number,
  overrides: Partial<NeutralCampFarmingDamageEvent> = {},
): NeutralCampFarmingDamageEvent {
  return {
    sourceSequence: BigInt(gameTimeMs),
    gameTimeSeconds: gameTimeMs / 1_000,
    eventType: "DOTA_COMBATLOG_DAMAGE",
    targetName: "npc_dota_neutral_centaur_khan",
    attackerName: "npc_dota_hero_axe",
    targetTeam: 4,
    damageValue: 100,
    attackerIllusion: false,
    ...overrides,
  };
}

function position(
  gameTimeMs: number,
  overrides: Partial<NeutralCampFarmingHeroPosition> = {},
): NeutralCampFarmingHeroPosition {
  return { playerSlot: 0, gameTimeMs, worldX: 100, worldY: 200, ...overrides };
}

function facts(overrides: Partial<NeutralCampFarmingFacts> = {}): NeutralCampFarmingFacts {
  return {
    extractionId: "extraction-1",
    rosterPlayers: [{ playerSlot: 0, heroId: 2 }],
    damageEvents: [damage(10_000)],
    heroPositions: [position(10_000)],
    campSpawners: [spawner(10n)],
    campCreeps: [creep(1n)],
    ...overrides,
  };
}

test("version 1 uses the plan's single named configuration", () => {
  assert.deepEqual(NEUTRAL_CAMP_FARMING_V1_CONFIG, {
    definitionName: "neutral-camp-farming-v1",
    positionTimeToleranceMs: 250,
    campRadiusWorldUnits: 1_200,
    damageGapMs: 8_000,
    neutralTeamNumber: 4,
    invalidEntityHandle: 16_777_215n,
    neutralCreepClassName: "CDOTA_BaseNPC_Creep_Neutral",
    damageEventType: "DOTA_COMBATLOG_DAMAGE",
    neutralTargetNamePrefix: "npc_dota_neutral_",
  });
});

test("one player clears one camp", () => {
  const actions = deriveNeutralCampFarmingActions(facts({
    damageEvents: [damage(10_000, { damageValue: 70 }), damage(10_500, { damageValue: 80 })],
    heroPositions: [position(10_000), position(10_500)],
    campCreeps: [
      creep(1n, { deathGameTimeMs: 10_700 }),
      creep(2n, { deathGameTimeMs: 10_900 }),
    ],
  }));

  assert.deepEqual(actions, [{
    extractionId: "extraction-1",
    actionIndex: 0,
    definitionName: "neutral-camp-farming-v1",
    playerSlot: 0,
    campId: 0,
    spawnerHandle: 10n,
    campType: 3,
    campWorldX: 100,
    campWorldY: 200,
    startGameTimeMs: 10_000,
    endGameTimeMs: 10_900,
    result: "cleared",
    damageEventCount: 2,
    totalDamage: 150,
    initialCreepCount: 2,
    deadInitialCreepCount: 2,
  }]);
});

test("one player leaves a camp alive", () => {
  const [action] = deriveNeutralCampFarmingActions(facts({
    damageEvents: [damage(10_000), damage(10_300)],
    heroPositions: [position(10_000), position(10_300)],
    campCreeps: [creep(1n, { deathGameTimeMs: 10_500 }), creep(2n)],
  }));
  assert.equal(action?.result, "not_cleared");
  assert.equal(action?.endGameTimeMs, 10_300);
  assert.equal(action?.initialCreepCount, 2);
  assert.equal(action?.deadInitialCreepCount, 1);
});

test("one damage event is retained as a not-cleared action", () => {
  const [action] = deriveNeutralCampFarmingActions(facts());
  assert.equal(action?.damageEventCount, 1);
  assert.equal(action?.startGameTimeMs, 10_000);
  assert.equal(action?.endGameTimeMs, 10_000);
  assert.equal(action?.result, "not_cleared");
});

test("a gap of exactly 8,000 ms remains one action", () => {
  const actions = deriveNeutralCampFarmingActions(facts({
    damageEvents: [damage(10_000), damage(18_000)],
    heroPositions: [position(10_000), position(18_000)],
  }));
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.damageEventCount, 2);
});

test("a gap larger than 8,000 ms creates two actions", () => {
  const actions = deriveNeutralCampFarmingActions(facts({
    damageEvents: [damage(10_000), damage(18_001)],
    heroPositions: [position(10_000), position(18_001)],
  }));
  assert.deepEqual(actions.map((action) => [action.actionIndex, action.startGameTimeMs]), [
    [0, 10_000], [1, 18_001],
  ]);
});

test("an invalid or unresolved spawner handle creates no camp creep", () => {
  for (const neutralSpawnerHandle of [16_777_215n, 99n]) {
    assert.deepEqual(deriveNeutralCampFarmingActions(facts({
      campCreeps: [creep(1n, { neutralSpawnerHandle })],
    })), []);
  }
});

test("a missing hero position creates no action", () => {
  assert.deepEqual(deriveNeutralCampFarmingActions(facts({ heroPositions: [] })), []);
  assert.deepEqual(deriveNeutralCampFarmingActions(facts({
    heroPositions: [position(10_251)],
  })), []);
});

test("a hero outside the camp radius creates no action", () => {
  assert.deepEqual(deriveNeutralCampFarmingActions(facts({
    heroPositions: [position(10_000, { worldX: 1_301, worldY: 200 })],
  })), []);
});

test("the nearest applicable camp receives the damage event", () => {
  const actions = deriveNeutralCampFarmingActions(facts({
    campSpawners: [
      spawner(10n, { worldX: 0, worldY: 0, campType: 1 }),
      spawner(20n, { worldX: 500, worldY: 0, campType: 2 }),
      spawner(30n, { worldX: 510, worldY: 0, campType: 9 }),
    ],
    campCreeps: [
      creep(1n, { neutralSpawnerHandle: 10n }),
      creep(2n, { neutralSpawnerHandle: 20n }),
      // The geometrically nearest spawner is not applicable because it has no live creep.
      creep(3n, { neutralSpawnerHandle: 30n, deathGameTimeMs: 9_000 }),
    ],
    heroPositions: [position(10_000, { worldX: 510, worldY: 0 })],
  }));
  assert.equal(actions[0]?.spawnerHandle, 20n);
  assert.equal(actions[0]?.campId, 1);
});

test("an equal-distance camp tie uses the lower deterministic camp ID", () => {
  const [action] = deriveNeutralCampFarmingActions(facts({
    campSpawners: [
      spawner(20n, { worldX: -100, worldY: 0 }),
      spawner(10n, { worldX: 100, worldY: 0 }),
    ],
    campCreeps: [
      creep(1n, { neutralSpawnerHandle: 10n }),
      creep(2n, { neutralSpawnerHandle: 20n }),
    ],
    heroPositions: [position(10_000, { worldX: 0, worldY: 0 })],
  }));
  assert.equal(action?.campId, 0);
  assert.equal(action?.spawnerHandle, 20n);
});

test("damage from a controlled unit creates no version 1 action", () => {
  assert.deepEqual(deriveNeutralCampFarmingActions(facts({
    damageEvents: [damage(10_000, { attackerName: "npc_dota_neutral_centaur_khan" })],
  })), []);
});

test("two players can have overlapping actions", () => {
  const actions = deriveNeutralCampFarmingActions(facts({
    rosterPlayers: [{ playerSlot: 0, heroId: 2 }, { playerSlot: 1, heroId: 5 }],
    damageEvents: [
      damage(10_000, { attackerName: "npc_dota_hero_axe", sourceSequence: 2n }),
      damage(10_100, { attackerName: "npc_dota_hero_crystal_maiden", sourceSequence: 1n }),
    ],
    heroPositions: [position(10_000), position(10_100, { playerSlot: 1 })],
    campCreeps: [creep(1n, { deathGameTimeMs: 10_500 })],
  }));
  assert.deepEqual(actions.map((action) => ({ player: action.playerSlot, result: action.result })), [
    { player: 0, result: "cleared" },
    { player: 1, result: "cleared" },
  ]);
});

test("deletion without a death does not clear a camp", () => {
  const [action] = deriveNeutralCampFarmingActions(facts({
    campCreeps: [creep(1n, { deletionGameTimeMs: 11_000 })],
  }));
  assert.equal(action?.result, "not_cleared");
  assert.equal(action?.deadInitialCreepCount, 0);
});

test("a later creep spawn does not join an open action", () => {
  const [action] = deriveNeutralCampFarmingActions(facts({
    damageEvents: [damage(10_000), damage(11_000)],
    heroPositions: [position(10_000), position(11_000)],
    campCreeps: [
      creep(1n, { deathGameTimeMs: 12_000 }),
      creep(2n, { creationGameTimeMs: 10_500 }),
    ],
  }));
  assert.equal(action?.initialCreepCount, 1);
  assert.equal(action?.deadInitialCreepCount, 1);
  assert.equal(action?.result, "cleared");
  assert.equal(action?.endGameTimeMs, 12_000);
});

test("a clear after the deadline is not cleared and ends at last damage", () => {
  const [action] = deriveNeutralCampFarmingActions(facts({
    campCreeps: [creep(1n, { deathGameTimeMs: 18_001 })],
  }));
  assert.equal(action?.result, "not_cleared");
  assert.equal(action?.endGameTimeMs, 10_000);
  assert.equal(action?.deadInitialCreepCount, 1);
});

test("an equally near position selects the earlier sample", () => {
  const [action] = deriveNeutralCampFarmingActions(facts({
    campSpawners: [
      spawner(10n, { worldX: 0, worldY: 0 }),
      spawner(20n, { worldX: 2_000, worldY: 0 }),
    ],
    campCreeps: [
      creep(1n, { neutralSpawnerHandle: 10n }),
      creep(2n, { neutralSpawnerHandle: 20n }),
    ],
    heroPositions: [
      position(10_100, { worldX: 2_000, worldY: 0 }),
      position(9_900, { worldX: 0, worldY: 0 }),
    ],
  }));
  assert.equal(action?.spawnerHandle, 10n);
});

test("normalized pause-safe combat seconds use round-to-nearest milliseconds", () => {
  const [action] = deriveNeutralCampFarmingActions(facts({
    damageEvents: [damage(10_000, { gameTimeSeconds: 10.0006 })],
    heroPositions: [position(10_001)],
  }));
  assert.equal(action?.startGameTimeMs, 10_001);
});

test("camp IDs and action indexes use the required deterministic sort orders", () => {
  const actions = deriveNeutralCampFarmingActions(facts({
    rosterPlayers: [{ playerSlot: 1, heroId: 5 }, { playerSlot: 0, heroId: 2 }],
    campSpawners: [
      spawner(30n, { worldX: 100, worldY: 100 }),
      spawner(20n, { worldX: 0, worldY: 100 }),
      spawner(10n, { worldX: 0, worldY: 0 }),
    ],
    campCreeps: [
      creep(1n, { neutralSpawnerHandle: 10n }),
      creep(2n, { neutralSpawnerHandle: 20n }),
      creep(3n, { neutralSpawnerHandle: 30n }),
    ],
    damageEvents: [
      damage(10_000, { attackerName: "npc_dota_hero_crystal_maiden", sourceSequence: 10n }),
      damage(10_000, { attackerName: "npc_dota_hero_axe", sourceSequence: 20n }),
    ],
    heroPositions: [
      position(10_000, { playerSlot: 0, worldX: 0, worldY: 100 }),
      position(10_000, { playerSlot: 1, worldX: 100, worldY: 100 }),
    ],
  }));
  assert.deepEqual(actions.map((action) => ({
    index: action.actionIndex, player: action.playerSlot, camp: action.campId, handle: action.spawnerHandle,
  })), [
    { index: 0, player: 0, camp: 1, handle: 20n },
    { index: 1, player: 1, camp: 2, handle: 30n },
  ]);
});

test("direct-damage requirements and exactly-one roster mapping are enforced", () => {
  const rejected: NeutralCampFarmingDamageEvent[] = [
    damage(10_000, { eventType: "DOTA_COMBATLOG_HEAL" }),
    damage(10_000, { damageValue: 0 }),
    damage(10_000, { targetTeam: 3 }),
    damage(10_000, { targetName: "npc_dota_roshan" }),
    damage(10_000, { attackerIllusion: true }),
    damage(10_000, { attackerName: "npc_dota_hero_sven" }),
  ];
  for (const event of rejected) {
    assert.deepEqual(deriveNeutralCampFarmingActions(facts({ damageEvents: [event] })), []);
  }
  assert.deepEqual(deriveNeutralCampFarmingActions(facts({
    rosterPlayers: [{ playerSlot: 0, heroId: 2 }, { playerSlot: 1, heroId: 2 }],
  })), []);
});

test("only existing team-4 camp creeps make a spawner applicable", () => {
  for (const campCreeps of [
    [creep(1n, { teamNumber: 3 })],
    [creep(1n, { creationGameTimeMs: 10_001 })],
    [creep(1n, { deletionGameTimeMs: 10_000 })],
    [creep(1n, { className: "CDOTA_BaseNPC_Creep_Lane" })],
  ]) {
    assert.deepEqual(deriveNeutralCampFarmingActions(facts({ campCreeps })), []);
  }
});

test("the camp radius and position tolerance boundaries are inclusive", () => {
  const actions = deriveNeutralCampFarmingActions(facts({
    heroPositions: [position(10_250, { worldX: 1_300, worldY: 200 })],
  }));
  assert.equal(actions.length, 1);
});
