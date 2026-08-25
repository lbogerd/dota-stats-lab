import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { manifestParserIdentity, parserIdentity } from "../src/load/parser-identity.js";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-loader-"));
process.env.STAGING_ROOT = path.join(root, "staging");
process.env.STAGING_CLAIMED_ROOT = path.join(root, "staging", "claimed");
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { loadClaimedExtraction } = await import("../src/load/load-extraction.js");
const { extractionAlreadyLoaded } = await import("../src/load/preflight.js");
const { DuckDBInstance } = await import("@duckdb/node-api");

const matchId = 42n;
const extractionId = "a".repeat(64);
const replaySha256 = "b".repeat(64);

const goodRows: Record<string, string> = {
  "records.ndjson": JSON.stringify({ extractionId, sequence: 1, demoTick: 10, netTick: 20, gameTime: 1, category: "message", recordType: "test.Message", payload: { native: true } }) + "\n",
  "combat_events.ndjson": "",
  "blobs.ndjson": JSON.stringify({ extractionId, sequence: 2, demoTick: 10, netTick: 20, gameTime: 1, blobId: createHash("sha256").update("x").digest("hex"), recordSequence: 1, fieldPath: "bytes", valueBase64: "eA==" }) + "\n",
  "entity_instances.ndjson": JSON.stringify({ extractionId, sequence: 3, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "1", entityIndex: 7, serial: 1, handle: 16391, classId: 2, className: "CTest" }) + "\n",
  "entity_events.ndjson": JSON.stringify({ extractionId, sequence: 4, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "1", eventType: "create", changedPropertyPaths: [], synthetic: false }) + "\n",
  "property_updates.ndjson": JSON.stringify({ extractionId, sequence: 5, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "1", propertyPath: "m_value", valueType: "int32", value: 7 }) + "\n",
  "checkpoints.ndjson": JSON.stringify({ extractionId, sequence: 6, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "1", checkpointKind: "creation", checkpointGameTime: 1, properties: [{ propertyPath: "m_value", valueType: "int32", value: 7 }] }) + "\n",
};

test("loader imports atomically, supports analysis macros, and is idempotent", async () => {
  assert.equal((await loadClaimedExtraction(await stage(extractionId, goodRows))).status, "loaded");

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const counts = await connection.runAndReadAll("SELECT (SELECT count(*) FROM raw.records)::INTEGER n, (SELECT count(*) FROM raw.entity_property_updates)::INTEGER u");
    assert.deepEqual(counts.getRowObjectsJson(), [{ n: 1, u: 1 }]);
    const state = await connection.runAndReadAll(`SELECT property_path, value::VARCHAR AS value FROM analysis.entity_state_at_game_time('${extractionId}', 1, 2)`);
    assert.deepEqual(state.getRowObjectsJson(), [{ property_path: "m_value", value: "7" }]);
  } finally { connection.closeSync(); }

  assert.equal((await loadClaimedExtraction(await stage(extractionId, goodRows))).status, "already_loaded");
  assert.equal(await extractionAlreadyLoaded(matchId, replaySha256), true);
});

test("preflight and storage distinguish parser identities for the same replay", async () => {
  const identityMatchId = 45n;
  const oldExtractionId = "f".repeat(64);
  const currentExtractionId = "0".repeat(64);
  const rowsFor = (id: string): Record<string, string> => Object.fromEntries(
    Object.entries(goodRows).map(([name, body]) => [name, body.replaceAll(extractionId, id)]),
  );

  await loadClaimedExtraction(await stage(oldExtractionId, rowsFor(oldExtractionId), identityMatchId, {
    parser: { name: parserIdentity.name, version: "different-fork-revision" },
    exporterVersion: parserIdentity.exporterVersion,
  }));
  assert.equal(await extractionAlreadyLoaded(identityMatchId, replaySha256), false);

  await loadClaimedExtraction(await stage(currentExtractionId, rowsFor(currentExtractionId), identityMatchId));
  assert.equal(await extractionAlreadyLoaded(identityMatchId, replaySha256), true);

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      "SELECT count(*)::INTEGER AS n FROM catalog.extractions WHERE match_id = $matchId AND replay_sha256 = $sha AND status = 'succeeded'",
      { matchId: identityMatchId, sha: replaySha256 },
    );
    assert.deepEqual(result.getRowObjectsJson(), [{ n: 2 }]);
  } finally { connection.closeSync(); }
});

test("loader normalizes valid draft events and counts them as analysis rows", async () => {
  const draftExtractionId = "7".repeat(64);
  const draftMatchId = 47n;
  const row = (value: Record<string, unknown>): string => `${JSON.stringify({
    extractionId: draftExtractionId,
    ...value,
  })}\n`;
  const rows: Record<string, string> = {
    ...Object.fromEntries(Object.keys(goodRows).map((name) => [name, ""])),
    "records.ndjson": [
      row({
        sequence: 1, demoTick: 1, netTick: null, gameTime: 60,
        category: "match_overview", recordType: "CMsgDOTAMatch",
        payload: {
          match_id: draftMatchId.toString(), duration: 60,
          players: [{
            player_slot: 0, team_number: "DOTA_GC_TEAM_GOOD_GUYS",
            team_slot: 0, hero_id: 1, gold_per_min: 500, xp_per_min: 600,
          }],
          picks_bans: [
            { hero_id: 1, is_pick: true, team: 0 },
            { hero_id: 2, is_pick: false, team: 1 },
            { hero_id: 0, is_pick: false, team: 0 },
            { hero_id: 3, is_pick: "false", team: 0 },
            { hero_id: 4, is_pick: false, team: 2 },
            { hero_id: "5", is_pick: false, team: 0 },
            { hero_id: 6, is_pick: false, team: "1" },
          ],
        },
      }),
      row({
        sequence: 2, demoTick: 2, netTick: null, gameTime: 60,
        category: "match_metadata", recordType: "CDOTAMatchMetadataFile",
        payload: { version: 1, metadata: { teams: [] } },
      }),
    ].join(""),
  };

  let logs = "";
  const stderrWrite = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    logs += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;
  try {
    assert.equal((await loadClaimedExtraction(
      await stage(draftExtractionId, rows, draftMatchId),
    )).status, "loaded");
  } finally {
    process.stderr.write = stderrWrite;
  }

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      `SELECT draft_order, hero_id, is_pick, team_index
       FROM analysis.hero_draft_events
       WHERE extraction_id = $id
       ORDER BY draft_order`,
      { id: draftExtractionId },
    );
    assert.deepEqual(result.getRowObjectsJson(), [
      { draft_order: 0, hero_id: 1, is_pick: true, team_index: 0 },
      { draft_order: 1, hero_id: 2, is_pick: false, team_index: 1 },
    ]);
  } finally { connection.closeSync(); }

  assert.match(logs, new RegExp(`ingestion=${draftExtractionId} phase=summary .* rows=14\\n`));
});

test("loader stores only retained rows and catalogs stored counts", async () => {
  const filteredId = "e".repeat(64);
  const filteredMatchId = 44n;
  const row = (value: Record<string, unknown>): string => `${JSON.stringify({ extractionId: filteredId, ...value })}\n`;
  const blob = (sequence: number, recordSequence: number, value: string): string => row({
    sequence, demoTick: 10, netTick: 20, gameTime: 1,
    blobId: createHash("sha256").update(value).digest("hex"), recordSequence,
    fieldPath: "bytes", valueBase64: Buffer.from(value).toString("base64"),
  });
  const rows: Record<string, string> = {
    "records.ndjson": [
      row({ sequence: 101, demoTick: 10, netTick: 20, gameTime: 1, category: "message", recordType: "CMsgDOTACombatLogEntry", payload: {} }),
      row({ sequence: 102, demoTick: 10, netTick: 20, gameTime: 1, category: "message", recordType: "CSVCMsg_VoiceData", payload: {} }),
      row({ sequence: 103, demoTick: 10, netTick: 20, gameTime: 1, category: "message", recordType: "CDOTAUserMsg_SpectatorPlayerUnitOrders", payload: {} }),
    ].join(""),
    "blobs.ndjson": [
      blob(201, 101, "record-retained"),
      blob(202, 102, "record-rejected"),
      blob(203, 501, "property-retained"),
      blob(204, 502, "entity-rejected"),
      blob(205, 601, "checkpoint-retained"),
      blob(206, 602, "checkpoint-interval"),
      blob(207, 999, "missing-owner"),
    ].join(""),
    "entity_instances.ndjson": [
      row({ sequence: 301, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "11", entityIndex: 11, serial: 1, handle: 16395, classId: 2, className: "CTest" }),
      row({ sequence: 302, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "12", entityIndex: 12, serial: 1, handle: 16396, classId: 3, className: "CParticleSystem" }),
      row({ sequence: 303, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "13", entityIndex: 13, serial: 1, handle: 16397, classId: 4, className: "CDOTA_NPC_Observer_Ward" }),
    ].join(""),
    "entity_events.ndjson": [
      row({ sequence: 401, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "11", eventType: "create", changedPropertyPaths: [], synthetic: false }),
      row({ sequence: 402, demoTick: 11, netTick: 21, gameTime: 2, entityInstanceId: "11", eventType: "update", changedPropertyPaths: ["m_value"], synthetic: false }),
      row({ sequence: 403, demoTick: 12, netTick: 22, gameTime: 3, entityInstanceId: "11", eventType: "delete", changedPropertyPaths: [], synthetic: true }),
      row({ sequence: 404, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "12", eventType: "create", changedPropertyPaths: [], synthetic: false }),
      row({ sequence: 405, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "13", eventType: "create", changedPropertyPaths: [], synthetic: false }),
    ].join(""),
    "property_updates.ndjson": [
      row({ sequence: 501, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "11", propertyPath: "m_value", valueType: "int32", value: 7 }),
      row({ sequence: 502, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "12", propertyPath: "m_value", valueType: "int32", value: 8 }),
      row({ sequence: 503, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "13", propertyPath: "m_value", valueType: "int32", value: 9 }),
    ].join(""),
    "checkpoints.ndjson": [
      row({ sequence: 601, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "11", checkpointKind: "creation", checkpointGameTime: 1, properties: [] }),
      row({ sequence: 602, demoTick: 11, netTick: 21, gameTime: 2, entityInstanceId: "11", checkpointKind: "interval", checkpointGameTime: 2, properties: [] }),
      row({ sequence: 603, demoTick: 12, netTick: 22, gameTime: 3, entityInstanceId: "11", checkpointKind: "completion", checkpointGameTime: 3, properties: [] }),
      row({ sequence: 604, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "12", checkpointKind: "creation", checkpointGameTime: 1, properties: [] }),
      row({ sequence: 605, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "13", checkpointKind: "completion", checkpointGameTime: 1, properties: [] }),
    ].join(""),
  };
  assert.equal((await loadClaimedExtraction(await stage(filteredId, rows, filteredMatchId))).status, "loaded");

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      `SELECT
         (SELECT list(record_type ORDER BY sequence) FROM raw.records WHERE extraction_id = $id) AS record_types,
         (SELECT list(class_name ORDER BY sequence) FROM raw.entity_instances WHERE extraction_id = $id) AS entity_classes,
         (SELECT list(event_type ORDER BY sequence) FROM raw.entity_events WHERE extraction_id = $id) AS event_types,
         (SELECT list(synthetic ORDER BY sequence) FROM raw.entity_events WHERE extraction_id = $id) AS synthetic_events,
         (SELECT count(*)::INTEGER FROM raw.entity_property_updates WHERE extraction_id = $id) AS property_updates,
         (SELECT list(checkpoint_kind ORDER BY sequence) FROM raw.entity_checkpoints WHERE extraction_id = $id) AS checkpoint_kinds,
         (SELECT count(*)::INTEGER FROM raw.record_blobs WHERE extraction_id = $id) AS blobs,
         (SELECT record_counts::VARCHAR FROM catalog.extractions WHERE extraction_id = $id) AS record_counts,
         (SELECT json_extract_string(manifest, '$.files.records.records') FROM catalog.extractions WHERE extraction_id = $id) AS exported_records`,
      { id: filteredId },
    );
    const stored = result.getRowObjectsJson()[0] as Record<string, unknown>;
    assert.deepEqual(stored.record_types, ["CMsgDOTACombatLogEntry", "CDOTAUserMsg_SpectatorPlayerUnitOrders"]);
    assert.deepEqual(stored.entity_classes, ["CTest", "CDOTA_NPC_Observer_Ward"]);
    assert.deepEqual(stored.event_types, ["create", "delete", "create"]);
    assert.deepEqual(stored.synthetic_events, [false, true, false]);
    assert.equal(stored.property_updates, 2);
    assert.deepEqual(stored.checkpoint_kinds, ["creation", "completion", "completion"]);
    assert.equal(stored.blobs, 3);
    assert.equal(stored.exported_records, "3");
    assert.deepEqual(JSON.parse(stored.record_counts as string), {
      records: 2, combatEvents: 0, blobs: 3, entityInstances: 2, entityEvents: 3,
      propertyUpdates: 2, checkpoints: 3, total: 15,
    });
  } finally { connection.closeSync(); }
});

test("loader materializes valid team-data gold updates using roster and metadata mappings", async () => {
  const granularMatchId = 46n;
  const granularId = "1".repeat(64);
  const missingMarkerId = "2".repeat(64);

  const granularRows = (id: string, includeStop: boolean): Record<string, string> => {
    const row = (value: Record<string, unknown>): string => `${JSON.stringify({ extractionId: id, ...value })}\n`;
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
    const combat = (sequence: number, gameTime: number, value: number): string => row({
      ...Object.fromEntries(combatFields.map((field) => [field, null])),
      sequence, gameTime, rawTime: gameTime,
      eventType: "DOTA_COMBATLOG_GAME_STATE", value,
    });
    const update = (
      sequence: number,
      gameTime: number,
      propertyPath: string,
      value: number,
      entityInstanceId = "1",
    ): string => row({
      sequence, demoTick: sequence, netTick: null, gameTime, entityInstanceId,
      propertyPath, valueType: "java.lang.Long", value,
    });
    const overview = {
      match_id: granularMatchId.toString(), duration: 60,
      players: [
        { player_slot: 0, team_number: "DOTA_GC_TEAM_GOOD_GUYS", team_slot: 0 },
        { player_slot: 128, team_number: "DOTA_GC_TEAM_BAD_GUYS", team_slot: 0 },
      ],
    };
    const metadata = {
      version: 1,
      metadata: { teams: [
        { dota_team: 2, players: [
          { game_player_id: 7, player_slot: 0 },
          { game_player_id: 8, player_slot: 1 },
        ], graph_net_worth: [] },
        { dota_team: 3, players: [
          { game_player_id: 1, player_slot: 128 },
          { game_player_id: 8, player_slot: 129 },
        ], graph_net_worth: [] },
      ] },
    };
    const goldPath = (teamSlot: string): string =>
      `m_vecDataTeam.${teamSlot}.m_iTotalEarnedGold`;

    return {
      "records.ndjson": [
        row({ sequence: 1, demoTick: 1, netTick: null, gameTime: 60, category: "match_overview", recordType: "CMsgDOTAMatch", payload: overview }),
        row({ sequence: 2, demoTick: 2, netTick: null, gameTime: 60, category: "match_metadata", recordType: "CDOTAMatchMetadataFile", payload: metadata }),
      ].join(""),
      "combat_events.ndjson": [
        combat(20, -5, 4),
        includeStop ? combat(100, 60, 6) : "",
      ].join(""),
      "blobs.ndjson": "",
      "entity_instances.ndjson": [
        row({ sequence: 1, demoTick: 1, netTick: null, gameTime: -5, entityInstanceId: "1", entityIndex: 1, serial: 1, handle: 16385, classId: 1, className: "CDOTA_DataRadiant" }),
        row({ sequence: 2, demoTick: 1, netTick: null, gameTime: -5, entityInstanceId: "2", entityIndex: 2, serial: 1, handle: 16386, classId: 2, className: "CDOTA_DataDire" }),
        row({ sequence: 3, demoTick: 1, netTick: null, gameTime: -5, entityInstanceId: "3", entityIndex: 3, serial: 1, handle: 16387, classId: 3, className: "CTest" }),
      ].join(""),
      "entity_events.ndjson": "",
      "property_updates.ndjson": [
        update(15, -10, goldPath("0000"), 50),
        update(21, -5, goldPath("0000"), 100),
        update(22, -5, goldPath("0000"), 110),
        update(30, 0, goldPath("0000"), 120),
        update(40, 10, goldPath("0001"), 130),
        update(41, 10, "m_vecDataTeam.0000.m_iTotalEarnedXP", 140),
        update(42, 10, goldPath("0000"), 200, "2"),
        update(43, 10, goldPath("0000"), 150, "3"),
        update(99, 59, goldPath("0000"), -1),
        update(100, 60, goldPath("0000"), 160),
        update(101, 61, goldPath("0000"), 170),
      ].join(""),
      "checkpoints.ndjson": "",
    };
  };

  assert.equal((await loadClaimedExtraction(
    await stage(granularId, granularRows(granularId, true), granularMatchId),
  )).status, "loaded");

  assert.equal((await loadClaimedExtraction(
    await stage(missingMarkerId, granularRows(missingMarkerId, false), granularMatchId),
  )).status, "loaded");

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const events = await connection.runAndReadAll(
      `SELECT sequence::INTEGER AS sequence, game_player_id,
              player_slot, team_id, game_time_seconds, total_gold_earned
       FROM analysis.player_gold_events
       WHERE extraction_id = $id
       ORDER BY sequence`,
      { id: granularId },
    );
    assert.deepEqual(events.getRowObjectsJson(), [
      { sequence: 21, game_player_id: 7, player_slot: 0, team_id: 2, game_time_seconds: -5, total_gold_earned: "100" },
      { sequence: 22, game_player_id: 7, player_slot: 0, team_id: 2, game_time_seconds: -5, total_gold_earned: "110" },
      { sequence: 30, game_player_id: 7, player_slot: 0, team_id: 2, game_time_seconds: 0, total_gold_earned: "120" },
      { sequence: 42, game_player_id: 1, player_slot: 128, team_id: 3, game_time_seconds: 10, total_gold_earned: "200" },
    ]);

    const incomplete = await connection.runAndReadAll(
      "SELECT count(*)::INTEGER AS n FROM analysis.player_gold_events WHERE extraction_id = $id",
      { id: missingMarkerId },
    );
    assert.deepEqual(incomplete.getRowObjectsJson(), [{ n: 0 }]);
  } finally { connection.closeSync(); }
});

test("malformed staged JSON rolls back raw data and retains failed staging", async () => {
  const failedId = "c".repeat(64);
  const malformed = Object.fromEntries(Object.keys(goodRows).map((name) => [name, ""])) as Record<string, string>;
  malformed["records.ndjson"] = "{not-json}\n";
  const failed = await stage(failedId, malformed);
  await assert.rejects(loadClaimedExtraction(failed));

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      `SELECT
         (SELECT count(*)::INTEGER FROM raw.records WHERE extraction_id = '${failedId}') AS n,
         (SELECT completed_at IS NOT NULL FROM catalog.extractions WHERE extraction_id = '${failedId}') AS failure_completed`,
    );
    assert.deepEqual(result.getRowObjectsJson(), [{ n: 0, failure_completed: true }]);
  } finally { connection.closeSync(); }
  assert.equal(await (await import("node:fs/promises")).stat(failed.directory).then(() => true, () => false), true);
});

test("duplicate property-update sequences roll back the extraction", async () => {
  const duplicateId = "d".repeat(64);
  const duplicateMatchId = 43n;
  const rows = Object.fromEntries(Object.entries(goodRows).map(
    ([name, body]) => [name, body.replaceAll(extractionId, duplicateId)],
  ));
  const propertyRows = rows["property_updates.ndjson"]!;
  rows["property_updates.ndjson"] = propertyRows + propertyRows;
  const duplicate = await stage(duplicateId, rows, duplicateMatchId);
  await assert.rejects(loadClaimedExtraction(duplicate), /sequences are not unique/);

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll(
      `SELECT count(*)::INTEGER AS n FROM raw.entity_property_updates WHERE extraction_id = '${duplicateId}'`,
    );
    assert.deepEqual(result.getRowObjectsJson(), [{ n: 0 }]);
  } finally { connection.closeSync(); }
});

async function stage(
  id: string,
  rows: Record<string, string>,
  stagedMatchId = matchId,
  identity: {
    parser?: { name: string; version: string; upstreamRelease?: string; forkRevision?: string };
    exporterVersion?: string;
  } = {},
): Promise<{
  matchId: bigint;
  claimId: string;
  extractionId: string;
  directory: string;
}> {
  const claimId = `cli-${stagedMatchId}`;
  const directory = path.join(process.env.STAGING_CLAIMED_ROOT!, claimId, id);
  await mkdir(directory, { recursive: true });
  const files: Record<string, unknown> = {};
  const logical: Record<string, string> = {
    records: "records.ndjson", combatEvents: "combat_events.ndjson", blobs: "blobs.ndjson", entityInstances: "entity_instances.ndjson",
    entityEvents: "entity_events.ndjson", propertyUpdates: "property_updates.ndjson", checkpoints: "checkpoints.ndjson",
  };
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
    schemaVersion: 1, extractionId: id, matchId: stagedMatchId.toString(), replaySha256,
    parser: identity.parser ?? manifestParserIdentity,
    exporterVersion: identity.exporterVersion ?? parserIdentity.exporterVersion,
    config: { checkpointIntervalSeconds: 30, maxInputBytes: 2_147_483_648, maxOutputBytes: 12_884_901_888, maxRecords: 50_000_000, timeoutSeconds: 1_800 },
    startedAt: now, completedAt: now, elapsedMs: 1, files, counts: {},
  }));
  return { matchId: stagedMatchId, claimId, extractionId: id, directory };
}
