import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { manifestParserIdentity, parserIdentity } from "../src/load/parser-identity.js";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-neutral-loader-"));
process.env.STAGING_ROOT = path.join(root, "staging");
process.env.STAGING_CLAIMED_ROOT = path.join(root, "staging", "claimed");
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { loadClaimedExtraction } = await import("../src/load/load-extraction.js");
const { DuckDBInstance } = await import("@duckdb/node-api");

test("match-analysis-v4 loads neutral facts, derives one action, counts it, and is idempotent", async () => {
  const id = createHash("sha256").update("neutral-loader-ready").digest("hex");
  const matchId = 80_001n;
  const fixture = neutralFixture(id, matchId);

  assert.equal((await loadClaimedExtraction(await stage(id, matchId, fixture, "match-analysis-v4"))).status, "loaded");

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      `SELECT
         (SELECT count(*)::INTEGER FROM raw.entity_instances
          WHERE extraction_id = $id AND class_name IN
            ('CDOTA_NeutralSpawner', 'CDOTA_BaseNPC_Creep_Neutral')) AS neutral_entities,
         (SELECT count(*)::INTEGER FROM raw.entity_checkpoints
          WHERE extraction_id = $id) AS neutral_checkpoints,
         (SELECT count(*)::INTEGER FROM raw.entity_property_updates
          WHERE extraction_id = $id) AS neutral_updates,
         (SELECT list({
            action_index: action_index,
            player_slot: player_slot,
            camp_id: camp_id,
            spawner_handle: spawner_handle,
            camp_type: camp_type,
            camp_world_x: camp_world_x,
            camp_world_y: camp_world_y,
            start_game_time_ms: start_game_time_ms,
            end_game_time_ms: end_game_time_ms,
            result: result,
            damage_event_count: damage_event_count,
            total_damage: total_damage,
            initial_creep_count: initial_creep_count,
            dead_initial_creep_count: dead_initial_creep_count
          } ORDER BY action_index)
          FROM analysis.neutral_camp_farming_actions WHERE extraction_id = $id) AS actions,
         (SELECT record_counts::VARCHAR FROM catalog.extractions
          WHERE extraction_id = $id) AS record_counts`,
      { id },
    );
    const stored = result.getRowObjectsJson()[0] as {
      neutral_entities: number;
      neutral_checkpoints: number;
      neutral_updates: number;
      actions: unknown;
      record_counts: string;
    };
    assert.equal(stored.neutral_entities, 2);
    assert.equal(stored.neutral_checkpoints, 2);
    assert.equal(stored.neutral_updates, 2);
    assert.deepEqual(stored.actions, [{
      action_index: 0,
      player_slot: 0,
      camp_id: 0,
      spawner_handle: "100",
      camp_type: 3,
      camp_world_x: 100,
      camp_world_y: 200,
      start_game_time_ms: "10000",
      end_game_time_ms: "12000",
      result: "cleared",
      damage_event_count: 1,
      total_damage: "100",
      initial_creep_count: 1,
      dead_initial_creep_count: 1,
    }]);
    assert.deepEqual(JSON.parse(stored.record_counts), {
      records: 2,
      combatEvents: 1,
      blobs: 0,
      entityInstances: 2,
      entityEvents: 3,
      propertyUpdates: 2,
      checkpoints: 2,
      heroPositions: 1,
      neutralCampFarmingActions: 1,
      winProbability: 0,
      total: 14,
    });
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  assert.equal((await loadClaimedExtraction(await stage(id, matchId, fixture, "match-analysis-v4"))).status, "already_loaded");
  await withConnection(async (connection) => {
    const repeated = await connection.runAndReadAll(
      "SELECT count(*)::INTEGER AS count FROM analysis.neutral_camp_farming_actions WHERE extraction_id = $id",
      { id },
    );
    assert.deepEqual(repeated.getRowObjectsJson(), [{ count: 1 }]);
  });
});

test("neutral action derivation is gated strictly to match-analysis-v4", async () => {
  const id = createHash("sha256").update("neutral-loader-old-profile").digest("hex");
  const matchId = 80_002n;
  assert.equal((await loadClaimedExtraction(await stage(
    id,
    matchId,
    neutralFixture(id, matchId),
    "match-analysis-v3",
  ))).status, "loaded");

  await withConnection(async (connection) => {
    const result = await connection.runAndReadAll(
      `SELECT
         (SELECT count(*)::INTEGER FROM raw.entity_instances WHERE extraction_id = $id) AS raw_entities,
         (SELECT count(*)::INTEGER FROM analysis.neutral_camp_farming_actions
          WHERE extraction_id = $id) AS actions,
         (SELECT json_extract(record_counts, '$.neutralCampFarmingActions')::INTEGER
          FROM catalog.extractions WHERE extraction_id = $id) AS stored_count`,
      { id },
    );
    assert.deepEqual(result.getRowObjectsJson(), [{ raw_entities: 2, actions: 0, stored_count: 0 }]);
  });
});

test("a derivation failure rolls back the complete ingestion", async () => {
  const id = createHash("sha256").update("neutral-loader-invalid-action").digest("hex");
  const matchId = 80_003n;
  await assert.rejects(
    loadClaimedExtraction(await stage(
      id,
      matchId,
      neutralFixture(id, matchId, { spawnerCampType: null }),
      "match-analysis-v4",
    )),
    /spawner camp type is invalid/i,
  );
  await assertRolledBack(id);
});

test("the loader rejects malformed neutral creep creation contracts", async (context) => {
  const cases: Array<{
    name: string;
    override: NeutralFixtureOverride;
    error: RegExp;
  }> = [
    {
      name: "invalid spawner handle",
      override: { creepSpawnerHandle: 16_777_215 },
      error: /invalid spawner handle/,
    },
    {
      name: "unresolved spawner handle",
      override: { creepSpawnerHandle: 101 },
      error: /does not resolve exactly once/,
    },
    {
      name: "missing team number",
      override: { creepTeam: null },
      error: /creep team number is invalid/,
    },
  ];
  for (const [index, fixtureCase] of cases.entries()) {
    await context.test(fixtureCase.name, async () => {
      const id = createHash("sha256").update(`neutral-loader-contract-${index}`).digest("hex");
      const matchId = 80_010n + BigInt(index);
      await assert.rejects(
        loadClaimedExtraction(await stage(
          id,
          matchId,
          neutralFixture(id, matchId, fixtureCase.override),
          "match-analysis-v4",
        )),
        fixtureCase.error,
      );
      await assertRolledBack(id);
    });
  }
});

type NeutralFixtureOverride = {
  creepSpawnerHandle?: number;
  creepTeam?: number | null;
  spawnerCampType?: number | null;
};

function neutralFixture(
  extractionId: string,
  matchId: bigint,
  override: NeutralFixtureOverride = {},
): Record<string, string> {
  const row = (value: Record<string, unknown>): string => `${JSON.stringify({ extractionId, ...value })}\n`;
  const property = (propertyPath: string, value: unknown): Record<string, unknown> => ({
    propertyPath,
    valueType: typeof value,
    value,
  });
  const combatFields = `targetName attackerName damageSourceName inflictorName
    targetTeam attackerTeam health locationX locationY eventLocation stunDuration
    slowDuration modifierDuration goldReason xpReason lastHits netWorth gpm xpm
    attackerHeroLevel targetHeroLevel damageType damageCategory runeType stackCount
    observerWardsPlaced assistPlayers attackerHero targetHero targetBuilding
    attackerIllusion targetIllusion healSave longRangeKill targetSourceName valueName
    modifierElapsedDuration abilityLevel neutralCampType buildingType modifierPurgeAbility
    modifierPurgeNpc totalUnitDeathCount modifierAbility killEaterEvent unitStatusLabel
    neutralCampTeam regeneratedHealth trackedStatId modifierPurgedDuration visibleRadiant
    visibleDire abilityToggleOn abilityToggleOff hiddenModifier ultimateAbility targetSelf
    invisibilityModifier silenceModifier healFromLifesteal modifierPurged spellEvaded
    motionControllerModifier rootModifier auraModifier armorDebuffModifier
    noPhysicalDamageModifier modifierHidden inflictorIsStolenAbility spellGeneratedAttack
    atNightTime attackerHasScepter willReincarnate usesCharges healFromRegen`.split(/\s+/);
  const combat = {
    ...Object.fromEntries(combatFields.map((field) => [field, null])),
    sequence: 50,
    gameTime: 10,
    rawTime: 959.033,
    eventType: "DOTA_COMBATLOG_DAMAGE",
    targetName: "npc_dota_neutral_centaur_khan",
    attackerName: "npc_dota_hero_antimage",
    targetTeam: 4,
    value: 100,
    attackerIllusion: false,
  };
  const spawnerHandle = 100;
  const creepSpawnerHandle = override.creepSpawnerHandle ?? spawnerHandle;
  const creepTeam = override.creepTeam === undefined ? 4 : override.creepTeam;

  return {
    "records.ndjson": [
      row({
        sequence: 1,
        demoTick: 1,
        netTick: null,
        gameTime: 13,
        category: "match_overview",
        recordType: "CMsgDOTAMatch",
        payload: {
          match_id: matchId.toString(),
          duration: 13,
          players: [{
            player_slot: 0,
            team_number: "DOTA_GC_TEAM_GOOD_GUYS",
            team_slot: 0,
            hero_id: 1,
          }],
        },
      }),
      row({
        sequence: 2,
        demoTick: 2,
        netTick: null,
        gameTime: 13,
        category: "match_metadata",
        recordType: "CDOTAMatchMetadataFile",
        payload: {
          version: 1,
          metadata: { teams: [{
            dota_team: 2,
            players: [{ game_player_id: 0, player_slot: 0 }],
          }] },
        },
      }),
    ].join(""),
    "combat_events.ndjson": row(combat),
    "blobs.ndjson": "",
    "entity_instances.ndjson": [
      row({
        sequence: 10,
        demoTick: 10,
        netTick: null,
        gameTime: null,
        entityInstanceId: "10",
        entityIndex: 10,
        serial: 0,
        handle: spawnerHandle,
        classId: 10,
        className: "CDOTA_NeutralSpawner",
      }),
      row({
        sequence: 20,
        demoTick: 20,
        netTick: null,
        gameTime: 5,
        entityInstanceId: "20",
        entityIndex: 20,
        serial: 0,
        handle: 200,
        classId: 20,
        className: "CDOTA_BaseNPC_Creep_Neutral",
      }),
    ].join(""),
    "entity_events.ndjson": [
      row({ sequence: 11, demoTick: 10, netTick: null, gameTime: null, entityInstanceId: "10", eventType: "create", synthetic: false }),
      row({ sequence: 21, demoTick: 20, netTick: null, gameTime: 5, entityInstanceId: "20", eventType: "create", synthetic: false }),
      row({ sequence: 24, demoTick: 40, netTick: null, gameTime: 13, entityInstanceId: "20", eventType: "delete", synthetic: false }),
    ].join(""),
    "property_updates.ndjson": [
      row({ sequence: 22, demoTick: 30, netTick: null, gameTime: 12, entityInstanceId: "20", propertyPath: "m_iHealth", valueType: "java.lang.Integer", value: 0 }),
      row({ sequence: 23, demoTick: 30, netTick: null, gameTime: 12, entityInstanceId: "20", propertyPath: "m_lifeState", valueType: "java.lang.Integer", value: 1 }),
    ].join(""),
    "checkpoints.ndjson": [
      row({
        sequence: 12,
        demoTick: 10,
        netTick: null,
        gameTime: null,
        checkpointGameTime: null,
        entityInstanceId: "10",
        checkpointKind: "creation",
        properties: [
          property("worldX", 100),
          property("worldY", 200),
          property("m_Type", override.spawnerCampType === undefined ? 3 : override.spawnerCampType),
        ],
      }),
      row({
        sequence: 21,
        demoTick: 20,
        netTick: null,
        gameTime: 5,
        checkpointGameTime: 5,
        entityInstanceId: "20",
        checkpointKind: "creation",
        properties: [
          property("m_hNeutralSpawner", creepSpawnerHandle),
          property("m_iTeamNum", creepTeam),
          property("m_iHealth", 100),
          property("m_lifeState", 0),
          property("m_bIsSummoned", false),
        ],
      }),
    ].join(""),
    "hero_positions.ndjson": row({
      sequence: 40,
      demoTick: 30,
      gameTimeMilliseconds: 10_000,
      gamePlayerId: 0,
      heroId: 1,
      teamId: 2,
      worldX: 100,
      worldY: 200,
    }),
    "win_probability.ndjson": "",
  };
}

async function assertRolledBack(extractionId: string): Promise<void> {
  await withConnection(async (connection) => {
    const result = await connection.runAndReadAll(
      `SELECT
         (SELECT count(*)::INTEGER FROM raw.records WHERE extraction_id = $id) AS raw_rows,
         (SELECT count(*)::INTEGER FROM analysis.matches WHERE extraction_id = $id) AS matches,
         (SELECT count(*)::INTEGER FROM analysis.hero_position_samples WHERE extraction_id = $id) AS positions,
         (SELECT count(*)::INTEGER FROM analysis.neutral_camp_farming_actions
          WHERE extraction_id = $id) AS actions,
         (SELECT status FROM catalog.extractions WHERE extraction_id = $id) AS status`,
      { id: extractionId },
    );
    assert.deepEqual(result.getRowObjectsJson(), [{
      raw_rows: 0,
      matches: 0,
      positions: 0,
      actions: 0,
      status: "failed",
    }]);
  });
}

async function withConnection(work: (connection: import("@duckdb/node-api").DuckDBConnection) => Promise<void>): Promise<void> {
  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    await work(connection);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

async function stage(
  extractionId: string,
  matchId: bigint,
  rows: Record<string, string>,
  profile: string,
): Promise<{ matchId: bigint; claimId: string; extractionId: string; directory: string }> {
  const claimId = `neutral-${matchId}`;
  const directory = path.join(process.env.STAGING_CLAIMED_ROOT!, claimId, extractionId);
  await mkdir(directory, { recursive: true });
  const logical: Record<string, string> = {
    records: "records.ndjson",
    combatEvents: "combat_events.ndjson",
    blobs: "blobs.ndjson",
    entityInstances: "entity_instances.ndjson",
    entityEvents: "entity_events.ndjson",
    propertyUpdates: "property_updates.ndjson",
    checkpoints: "checkpoints.ndjson",
    heroPositions: "hero_positions.ndjson",
    winProbability: "win_probability.ndjson",
  };
  const files: Record<string, unknown> = {};
  for (const [key, name] of Object.entries(logical)) {
    const body = rows[name] ?? "";
    await writeFile(path.join(directory, name), body);
    files[key] = {
      path: name,
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: Buffer.byteLength(body),
      records: body.match(/\n/g)?.length ?? 0,
    };
  }
  const now = new Date().toISOString();
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 3,
    extractionId,
    matchId: matchId.toString(),
    replaySha256: "d".repeat(64),
    parser: manifestParserIdentity,
    exporterVersion: parserIdentity.exporterVersion,
    profile,
    config: {
      checkpointIntervalSeconds: 30,
      maxInputBytes: 2_147_483_648,
      maxOutputBytes: 12_884_901_888,
      maxRecords: 50_000_000,
      timeoutSeconds: 1_800,
    },
    startedAt: now,
    completedAt: now,
    elapsedMs: 1,
    files,
    counts: {},
  }));
  return { matchId, claimId, extractionId, directory };
}
