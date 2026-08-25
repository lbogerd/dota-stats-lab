import { rm } from "node:fs/promises";
import path from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { paths } from "../config.js";
import { migrate, openWarehouse } from "../db/database.js";
import { withWarehouseLock } from "../db/lock.js";
import type { ClaimedExtraction } from "../jobs/extraction-claim.js";
import { jsonStringify } from "../lib/json.js";
import { stagedFiles, validateManifest, type Manifest } from "./manifest.js";
import {
  REJECTED_ENTITY_CLASSES,
  REJECTED_RECORD_TYPES,
  STORED_CHECKPOINT_KINDS,
  STORED_ENTITY_EVENT_TYPES,
} from "./storage-policy.js";

export type LoadResult = { extractionId: string; status: "loaded" | "already_loaded" };
export type ValidatedExtraction = ClaimedExtraction & { manifest: Manifest };

export async function migrateOnly(): Promise<void> {
  await withWarehouseLock(paths.warehousePath, async () => {
    const database = await openWarehouse();
    try { await migrate(database.connection); } finally { database.close(); }
  });
}

export async function validateClaimedExtraction(claimed: ClaimedExtraction): Promise<ValidatedExtraction> {
  const manifest = await validateManifest(claimed.directory, claimed.matchId);
  if (manifest.extractionId !== claimed.extractionId) {
    throw new Error("Claimed extraction directory does not match manifest extraction ID");
  }
  return { ...claimed, manifest };
}

export async function loadClaimedExtraction(claimed: ClaimedExtraction): Promise<LoadResult> {
  return loadValidatedExtraction(await validateClaimedExtraction(claimed));
}

export async function loadValidatedExtraction(validated: ValidatedExtraction): Promise<LoadResult> {
  const extractionDir = validated.directory;
  const manifest = validated.manifest;
  const acquisition = validateAcquisition(manifest);

  return withWarehouseLock(paths.warehousePath, async () => {
    const database = await openWarehouse();
    try {
      await migrate(database.connection);
      const existing = await database.connection.runAndReadAll(
        "SELECT status FROM catalog.extractions WHERE extraction_id = $id", { id: manifest.extractionId },
      );
      const status = (existing.getRowObjects()[0] as { status?: string } | undefined)?.status;
      if (status === "succeeded") {
        await rm(extractionDir, { recursive: true });
        return { extractionId: manifest.extractionId, status: "already_loaded" };
      }

      const loadStarted = performance.now();
      await database.connection.run("BEGIN TRANSACTION");
      try {
        await insertCatalog(database.connection, manifest, acquisition);
        await importStagedFiles(database.connection, extractionDir, manifest);
        const storedCounts = await validateImportedRows(database.connection, extractionDir, manifest);
        const importElapsed = Math.max(0, Math.round(performance.now() - loadStarted));
        logPhase(manifest.extractionId, "duckdb_write", importElapsed, storedCounts.total);
        const summaryStarted = performance.now();
        await materializeMatchAnalysis(database.connection, manifest);
        const summaryElapsed = Math.max(0, Math.round(performance.now() - summaryStarted));
        const summaryRows = await analysisRowCount(database.connection, manifest.extractionId);
        logPhase(manifest.extractionId, "summary", summaryElapsed, summaryRows);
        await database.connection.run(
          `UPDATE catalog.extractions SET status = 'succeeded', completed_at = current_timestamp,
             load_elapsed_ms = $elapsed, summary_elapsed_ms = $summaryElapsed,
             record_counts = $counts::JSON WHERE extraction_id = $id`,
          {
            elapsed: BigInt(Math.max(0, Math.round(performance.now() - loadStarted))),
            summaryElapsed: BigInt(summaryElapsed),
            counts: jsonStringify(storedCounts),
            id: manifest.extractionId,
          },
        );
        await database.connection.run("COMMIT");
        logPhase(
          manifest.extractionId,
          "commit",
          Math.max(0, Math.round(performance.now() - loadStarted)),
          storedCounts.total + summaryRows,
        );
      } catch (error) {
        try { await database.connection.run("ROLLBACK"); }
        catch (rollbackError) {
          if (!(rollbackError instanceof Error && /no transaction is active/i.test(rollbackError.message))) {
            if (error instanceof Error) error.cause = rollbackError;
          }
        }
        try { await recordFailure(database.connection, manifest, error); }
        catch (catalogError) {
          if (error instanceof Error) error.cause = catalogError;
        }
        throw error;
      }
      await rm(extractionDir, { recursive: true });
      return { extractionId: manifest.extractionId, status: "loaded" };
    } finally { database.close(); }
  });
}

async function analysisRowCount(connection: DuckDBConnection, extractionId: string): Promise<number> {
  const result = await connection.runAndReadAll(
    `SELECT
       (SELECT count(*) FROM analysis.matches WHERE extraction_id = $id)
       + (SELECT count(*) FROM analysis.players WHERE extraction_id = $id)
       + (SELECT count(*) FROM analysis.player_items WHERE extraction_id = $id)
       + (SELECT count(*) FROM analysis.team_time_series WHERE extraction_id = $id)
       + (SELECT count(*) FROM analysis.player_gold_events WHERE extraction_id = $id)
       + (SELECT count(*) FROM analysis.hero_draft_events WHERE extraction_id = $id) AS rows`,
    { id: extractionId },
  );
  return Number((result.getRowObjects()[0] as { rows: bigint }).rows);
}

function logPhase(ingestionId: string, phase: string, elapsedMs: number, rows: number): void {
  process.stderr.write(`ingestion=${ingestionId} phase=${phase} elapsed_ms=${elapsedMs} rows=${rows}\n`);
}

function validateAcquisition(manifest: Manifest): Record<string, unknown> {
  const acquisition = manifest.acquisition ?? { source: "parser_manifest", status: "available" };
  if (acquisition.replaySha256 !== undefined && acquisition.replaySha256 !== manifest.replaySha256) {
    throw new Error("Acquisition and manifest replay checksums differ");
  }
  return acquisition;
}

async function insertCatalog(connection: DuckDBConnection, manifest: Manifest, acquisition: Record<string, unknown>): Promise<void> {
  const totalBytes = Object.values(manifest.files).reduce((sum, file) => sum + file.bytes, 0);
  const checkpointInterval = numberConfig(manifest.config, "checkpointIntervalSeconds", 30);
  const outputLimit = numberConfig(manifest.config, "maxOutputBytes", Math.max(totalBytes, 1));
  await connection.run(
    `INSERT INTO catalog.replay_acquisitions
      (match_id, completed_at, source, source_url, replay_path, replay_sha256, replay_size_bytes, status, metadata)
     VALUES ($matchId, current_timestamp, $source, $url, $replayPath, $sha, $bytes, 'succeeded', $metadata::JSON)`,
    {
      matchId: BigInt(manifest.matchId), source: String(acquisition.source ?? "parser_manifest"),
      url: typeof acquisition.replayUrl === "string" ? acquisition.replayUrl : null,
      replayPath: typeof acquisition.replayPath === "string"
        ? acquisition.replayPath
        : `/data/replays/${manifest.matchId}/replay.dem.bz2`,
      sha: manifest.replaySha256,
      bytes: typeof acquisition.replayBytes === "number" ? BigInt(acquisition.replayBytes) : null,
      metadata: jsonStringify(acquisition),
    },
  );
  await connection.run(
    `INSERT INTO catalog.extractions
      (extraction_id, match_id, replay_sha256, parser_name, parser_version, exporter_version,
       extraction_config, checkpoint_interval_seconds, output_limit_bytes, started_at, status,
       preparation_elapsed_ms, parse_elapsed_ms, output_size_bytes, record_counts, manifest)
     VALUES ($id, $matchId, $sha, $parserName, $parserVersion, $exporterVersion,
       $config::JSON, $interval, $limit, $startedAt::TIMESTAMPTZ, 'started', $preparationMs, $parseMs, $outputBytes,
       $counts::JSON, $manifest::JSON)
     ON CONFLICT (extraction_id) DO UPDATE SET
       match_id = excluded.match_id, replay_sha256 = excluded.replay_sha256,
       parser_name = excluded.parser_name, parser_version = excluded.parser_version,
       exporter_version = excluded.exporter_version, extraction_config = excluded.extraction_config,
       checkpoint_interval_seconds = excluded.checkpoint_interval_seconds,
       output_limit_bytes = excluded.output_limit_bytes, started_at = excluded.started_at,
       status = 'started', completed_at = NULL,
       preparation_elapsed_ms = excluded.preparation_elapsed_ms,
       parse_elapsed_ms = excluded.parse_elapsed_ms,
       load_elapsed_ms = NULL, output_size_bytes = excluded.output_size_bytes,
       record_counts = excluded.record_counts, error_code = NULL, error_message = NULL,
       manifest = excluded.manifest`,
    {
      id: manifest.extractionId, matchId: BigInt(manifest.matchId), sha: manifest.replaySha256,
      parserName: manifest.parser.name, parserVersion: manifest.parser.version,
      exporterVersion: manifest.exporterVersion, config: jsonStringify(manifest.config),
      interval: checkpointInterval, limit: BigInt(outputLimit), startedAt: manifest.startedAt,
      preparationMs: BigInt(Math.max(0, Math.round(manifest.preparationElapsedMs ?? 0))),
      parseMs: BigInt(Math.max(0, Math.round(manifest.parsingElapsedMs ?? manifest.elapsedMs))),
      outputBytes: BigInt(totalBytes),
      counts: jsonStringify({}), manifest: jsonStringify(manifest),
    },
  );
}

async function importStagedFiles(connection: DuckDBConnection, dir: string, manifest: Manifest): Promise<void> {
  const rejectedRecordTypes = sqlStringList(REJECTED_RECORD_TYPES);
  const rejectedEntityClasses = sqlStringList(REJECTED_ENTITY_CLASSES);
  const storedEntityEventTypes = sqlStringList(STORED_ENTITY_EVENT_TYPES);
  const storedCheckpointKinds = sqlStringList(STORED_CHECKPOINT_KINDS);
  const imports: Array<[keyof typeof stagedFiles, string]> = [
    ["records", `INSERT INTO raw.records
      SELECT extractionId, sequence::UBIGINT, demoTick, netTick, gameTime, category, recordType, payload::JSON
      FROM read_ndjson_auto('__FILE__')
      WHERE recordType NOT IN (${rejectedRecordTypes}) OR recordType IS NULL`],
    ["combatEvents", `INSERT INTO raw.combat_events
      SELECT extractionId, sequence::UBIGINT, gameTime, rawTime, eventType,
        targetName, attackerName, damageSourceName, inflictorName,
        targetTeam, attackerTeam, value, health, locationX, locationY,
        eventLocation, stunDuration, slowDuration, modifierDuration,
        goldReason, xpReason, lastHits, netWorth, gpm, xpm,
        attackerHeroLevel, targetHeroLevel, damageType, damageCategory,
        runeType, stackCount, observerWardsPlaced, assistPlayers::INTEGER[],
        attackerHero, targetHero, targetBuilding, attackerIllusion,
        targetIllusion, healSave, longRangeKill,
        targetSourceName, valueName, modifierElapsedDuration, abilityLevel,
        neutralCampType, buildingType, modifierPurgeAbility, modifierPurgeNpc,
        totalUnitDeathCount, modifierAbility, killEaterEvent, unitStatusLabel,
        neutralCampTeam, regeneratedHealth, trackedStatId, modifierPurgedDuration,
        visibleRadiant, visibleDire, abilityToggleOn, abilityToggleOff,
        hiddenModifier, ultimateAbility, targetSelf, invisibilityModifier,
        silenceModifier, healFromLifesteal, modifierPurged, spellEvaded,
        motionControllerModifier, rootModifier, auraModifier, armorDebuffModifier,
        noPhysicalDamageModifier, modifierHidden, inflictorIsStolenAbility,
        spellGeneratedAttack, atNightTime, attackerHasScepter, willReincarnate,
        usesCharges, healFromRegen
      FROM read_ndjson_auto('__FILE__')`],
    ["entityInstances", `INSERT INTO raw.entity_instances
      SELECT extractionId, sequence::UBIGINT, entityInstanceId::UBIGINT, entityIndex::UINTEGER, serial::UINTEGER,
        handle::UBIGINT, classId::INTEGER, className, demoTick, netTick, gameTime
      FROM read_ndjson_auto('__FILE__')
      WHERE className NOT IN (${rejectedEntityClasses}) OR className IS NULL`],
    ["entityEvents", `INSERT INTO raw.entity_events
      SELECT source.extractionId, source.sequence::UBIGINT, source.entityInstanceId::UBIGINT, source.eventType,
        source.demoTick, source.netTick, source.gameTime, source.synthetic
      FROM read_ndjson_auto('__FILE__') AS source
      JOIN raw.entity_instances AS instance
        ON instance.extraction_id = source.extractionId
       AND instance.entity_instance_id = source.entityInstanceId::UBIGINT
      WHERE source.eventType IN (${storedEntityEventTypes})`],
    ["propertyUpdates", `INSERT INTO raw.entity_property_updates
      SELECT source.extractionId, source.sequence::UBIGINT, source.entityInstanceId::UBIGINT, source.propertyPath,
        source.valueType, coalesce(to_json(source.value), 'null'::JSON), source.demoTick, source.netTick, source.gameTime
      FROM read_ndjson_auto('__FILE__') AS source
      JOIN raw.entity_instances AS instance
        ON instance.extraction_id = source.extractionId
       AND instance.entity_instance_id = source.entityInstanceId::UBIGINT`],
    ["checkpoints", `INSERT INTO raw.entity_checkpoints
      SELECT source.extractionId, source.sequence::UBIGINT, source.entityInstanceId::UBIGINT, source.checkpointKind,
        source.demoTick, source.netTick, source.gameTime, source.checkpointGameTime, to_json(source.properties)
      FROM read_ndjson_auto('__FILE__') AS source
      JOIN raw.entity_instances AS instance
        ON instance.extraction_id = source.extractionId
       AND instance.entity_instance_id = source.entityInstanceId::UBIGINT
      WHERE source.checkpointKind IN (${storedCheckpointKinds})`],
    ["blobs", `INSERT INTO raw.record_blobs
      SELECT source.extractionId, source.sequence::UBIGINT, source.demoTick, source.netTick, source.gameTime,
        source.blobId, source.recordSequence::UBIGINT, source.fieldPath, from_base64(source.valueBase64)
      FROM read_ndjson_auto('__FILE__') AS source
      WHERE EXISTS (
        SELECT 1 FROM raw.records AS owner
        WHERE owner.extraction_id = source.extractionId AND owner.sequence = source.recordSequence::UBIGINT
        UNION ALL
        SELECT 1 FROM raw.entity_property_updates AS owner
        WHERE owner.extraction_id = source.extractionId AND owner.sequence = source.recordSequence::UBIGINT
        UNION ALL
        SELECT 1 FROM raw.entity_checkpoints AS owner
        WHERE owner.extraction_id = source.extractionId AND owner.sequence = source.recordSequence::UBIGINT
      )`],
  ];
  for (const [logical, template] of imports) {
    if (manifest.files[logical].records === 0) continue;
    const file = path.join(dir, stagedFiles[logical]);
    try {
      await connection.run(template.replace("__FILE__", sqlLiteral(file)));
    } catch (error) {
      throw new Error(`Failed importing ${logical}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
}

type StoredCounts = {
  records: number;
  combatEvents: number;
  blobs: number;
  entityInstances: number;
  entityEvents: number;
  propertyUpdates: number;
  checkpoints: number;
  total: number;
};

async function validateImportedRows(
  connection: DuckDBConnection,
  dir: string,
  manifest: Manifest,
): Promise<StoredCounts> {
  const rejectedRecordTypes = sqlStringList(REJECTED_RECORD_TYPES);
  const rejectedEntityClasses = sqlStringList(REJECTED_ENTITY_CLASSES);
  const storedEntityEventTypes = sqlStringList(STORED_ENTITY_EVENT_TYPES);
  const storedCheckpointKinds = sqlStringList(STORED_CHECKPOINT_KINDS);
  const result = await connection.runAndReadAll(
    `SELECT
       (SELECT count(*) FROM raw.records WHERE extraction_id = $id) AS records,
       (SELECT count(*) FROM raw.combat_events WHERE extraction_id = $id) AS combat_events,
       (SELECT count(*) FROM raw.record_blobs WHERE extraction_id = $id) AS blobs,
       (SELECT count(*) FROM raw.entity_instances WHERE extraction_id = $id) AS entity_instances,
       (SELECT count(*) FROM raw.entity_events WHERE extraction_id = $id) AS entity_events,
       (SELECT count(*) FROM raw.entity_property_updates WHERE extraction_id = $id) AS property_updates,
       (SELECT count(DISTINCT sequence) FROM raw.entity_property_updates WHERE extraction_id = $id) AS property_update_sequences,
       (SELECT count(*) FROM raw.entity_checkpoints WHERE extraction_id = $id) AS checkpoints,
       (SELECT count(*) FROM raw.records WHERE extraction_id = $id AND record_type IN (${rejectedRecordTypes})) AS rejected_records,
       (SELECT count(*) FROM raw.entity_instances WHERE extraction_id = $id AND class_name IN (${rejectedEntityClasses})) AS rejected_entities,
       (SELECT count(*) FROM raw.entity_events WHERE extraction_id = $id AND event_type NOT IN (${storedEntityEventTypes})) AS rejected_events,
       (SELECT count(*) FROM raw.entity_checkpoints WHERE extraction_id = $id AND checkpoint_kind NOT IN (${storedCheckpointKinds})) AS rejected_checkpoints,
       (SELECT count(*) FROM raw.entity_events AS child
          LEFT JOIN raw.entity_instances AS owner
            ON owner.extraction_id = child.extraction_id
           AND owner.entity_instance_id = child.entity_instance_id
          WHERE child.extraction_id = $id AND owner.entity_instance_id IS NULL) AS orphaned_entity_events,
       (SELECT count(*) FROM raw.entity_property_updates AS child
          LEFT JOIN raw.entity_instances AS owner
            ON owner.extraction_id = child.extraction_id
           AND owner.entity_instance_id = child.entity_instance_id
          WHERE child.extraction_id = $id AND owner.entity_instance_id IS NULL) AS orphaned_property_updates,
       (SELECT count(*) FROM raw.entity_checkpoints AS child
          LEFT JOIN raw.entity_instances AS owner
            ON owner.extraction_id = child.extraction_id
           AND owner.entity_instance_id = child.entity_instance_id
          WHERE child.extraction_id = $id AND owner.entity_instance_id IS NULL) AS orphaned_checkpoints,
       (SELECT count(*) FROM raw.record_blobs AS blob
          WHERE blob.extraction_id = $id AND NOT EXISTS (
            SELECT 1 FROM raw.records AS owner
            WHERE owner.extraction_id = blob.extraction_id AND owner.sequence = blob.record_sequence
            UNION ALL
            SELECT 1 FROM raw.entity_property_updates AS owner
            WHERE owner.extraction_id = blob.extraction_id AND owner.sequence = blob.record_sequence
            UNION ALL
            SELECT 1 FROM raw.entity_checkpoints AS owner
            WHERE owner.extraction_id = blob.extraction_id AND owner.sequence = blob.record_sequence
          )) AS orphaned_blobs`,
    { id: manifest.extractionId },
  );
  const row = result.getRowObjects()[0] as Record<string, bigint>;
  const importedCount = (name: string): bigint => {
    const count = row[name];
    if (count === undefined) throw new Error(`Missing imported count: ${name}`);
    return count;
  };
  for (const name of [
    "rejected_records",
    "rejected_entities",
    "rejected_events",
    "rejected_checkpoints",
    "orphaned_entity_events",
    "orphaned_property_updates",
    "orphaned_checkpoints",
    "orphaned_blobs",
  ]) {
    if (importedCount(name) !== 0n) throw new Error(`Imported rows violate storage policy: ${name}`);
  }

  const expected: Record<string, bigint> = {
    records: await stagedCount(connection, dir, manifest, "records", `recordType NOT IN (${rejectedRecordTypes}) OR recordType IS NULL`),
    combat_events: await stagedCount(connection, dir, manifest, "combatEvents"),
    entity_instances: await stagedCount(connection, dir, manifest, "entityInstances", `className NOT IN (${rejectedEntityClasses}) OR className IS NULL`),
    entity_events: await stagedCount(connection, dir, manifest, "entityEvents", `eventType IN (${storedEntityEventTypes})`, true),
    property_updates: await stagedCount(connection, dir, manifest, "propertyUpdates", undefined, true),
    checkpoints: await stagedCount(connection, dir, manifest, "checkpoints", `checkpointKind IN (${storedCheckpointKinds})`, true),
    blobs: await stagedBlobCount(connection, dir, manifest),
  };
  for (const [name, count] of Object.entries(expected)) {
    if (importedCount(name) !== count) throw new Error(`Imported ${name} count does not match storage policy`);
  }
  if (importedCount("property_update_sequences") !== expected.property_updates) {
    throw new Error("Imported property update sequences are not unique");
  }
  const counts = {
    records: Number(importedCount("records")),
    combatEvents: Number(importedCount("combat_events")),
    blobs: Number(importedCount("blobs")),
    entityInstances: Number(importedCount("entity_instances")),
    entityEvents: Number(importedCount("entity_events")),
    propertyUpdates: Number(importedCount("property_updates")),
    checkpoints: Number(importedCount("checkpoints")),
  };
  const total = counts.records + counts.combatEvents + counts.blobs + counts.entityInstances + counts.entityEvents
    + counts.propertyUpdates + counts.checkpoints;
  return { ...counts, total };
}

async function stagedCount(
  connection: DuckDBConnection,
  dir: string,
  manifest: Manifest,
  logical: keyof typeof stagedFiles,
  predicate?: string,
  joinRetainedEntity = false,
): Promise<bigint> {
  if (manifest.files[logical].records === 0) return 0n;
  const source = sqlLiteral(path.join(dir, stagedFiles[logical]));
  const join = joinRetainedEntity
    ? `JOIN raw.entity_instances AS instance
         ON instance.extraction_id = staged.extractionId
        AND instance.entity_instance_id = staged.entityInstanceId::UBIGINT`
    : "";
  const where = predicate === undefined ? "" : `WHERE ${predicate}`;
  const result = await connection.runAndReadAll(
    `SELECT count(*) AS count FROM read_ndjson_auto('${source}') AS staged ${join} ${where}`,
  );
  return (result.getRowObjects()[0] as { count: bigint }).count;
}

async function stagedBlobCount(
  connection: DuckDBConnection,
  dir: string,
  manifest: Manifest,
): Promise<bigint> {
  if (manifest.files.blobs.records === 0) return 0n;
  const source = sqlLiteral(path.join(dir, stagedFiles.blobs));
  const result = await connection.runAndReadAll(
    `SELECT count(*) AS count FROM read_ndjson_auto('${source}') AS staged
     WHERE EXISTS (
       SELECT 1 FROM raw.records AS owner
       WHERE owner.extraction_id = staged.extractionId AND owner.sequence = staged.recordSequence::UBIGINT
       UNION ALL
       SELECT 1 FROM raw.entity_property_updates AS owner
       WHERE owner.extraction_id = staged.extractionId AND owner.sequence = staged.recordSequence::UBIGINT
       UNION ALL
       SELECT 1 FROM raw.entity_checkpoints AS owner
       WHERE owner.extraction_id = staged.extractionId AND owner.sequence = staged.recordSequence::UBIGINT
     )`,
  );
  return (result.getRowObjects()[0] as { count: bigint }).count;
}

async function materializeMatchAnalysis(connection: DuckDBConnection, manifest: Manifest): Promise<void> {
  const documents = await connection.runAndReadAll(
    `SELECT count(*) FILTER (WHERE record_type = 'CMsgDOTAMatch') AS matches,
            count(*) FILTER (WHERE record_type = 'CDOTAMatchMetadataFile') AS metadata
       FROM raw.records WHERE extraction_id = $id`,
    { id: manifest.extractionId },
  );
  const counts = documents.getRowObjects()[0] as { matches: bigint; metadata: bigint };
  if (counts.matches === 0n && counts.metadata === 0n) return;
  if (counts.matches !== 1n || counts.metadata !== 1n) {
    throw new Error("match-analysis profile requires one overview and one metadata document");
  }

  await connection.run(
    `INSERT INTO analysis.matches
     SELECT
       $id,
       try_cast(json_extract_string(payload, '$.match_id') AS UBIGINT),
       CASE WHEN json_extract_string(payload, '$.starttime') IS NULL THEN NULL
            ELSE to_timestamp(try_cast(json_extract_string(payload, '$.starttime') AS BIGINT)) END,
       try_cast(json_extract_string(payload, '$.duration') AS INTEGER),
       json_extract_string(payload, '$.game_mode'),
       CASE json_extract_string(payload, '$.lobby_type')
         WHEN 'DOTA_LOBBY_TYPE_NORMAL' THEN 0
         WHEN 'DOTA_LOBBY_TYPE_PRACTICE' THEN 1
         WHEN 'DOTA_LOBBY_TYPE_TOURNAMENT' THEN 2
         WHEN 'DOTA_LOBBY_TYPE_TUTORIAL' THEN 3
         WHEN 'DOTA_LOBBY_TYPE_COOP_BOTS' THEN 4
         WHEN 'DOTA_LOBBY_TYPE_TEAM_MATCH' THEN 5
         WHEN 'DOTA_LOBBY_TYPE_SOLO_QUEUE' THEN 6
         WHEN 'DOTA_LOBBY_TYPE_RANKED' THEN 7
         WHEN 'DOTA_LOBBY_TYPE_1V1MID' THEN 8
         WHEN 'DOTA_LOBBY_TYPE_WEEKEND_TOURNEY' THEN 9
         WHEN 'DOTA_LOBBY_TYPE_LOCAL_BOTS' THEN 10
         WHEN 'DOTA_LOBBY_TYPE_SPECTATOR' THEN 11
         WHEN 'DOTA_LOBBY_TYPE_EVENT' THEN 12
         WHEN 'DOTA_LOBBY_TYPE_GAUNTLET' THEN 13
         WHEN 'DOTA_LOBBY_TYPE_NEW_PLAYER' THEN 14
         WHEN 'DOTA_LOBBY_TYPE_FEATURED' THEN 15
         ELSE try_cast(json_extract_string(payload, '$.lobby_type') AS INTEGER)
       END,
       CASE
         WHEN lower(json_extract_string(payload, '$.match_outcome')) LIKE '%radiantvictory%'
           OR lower(json_extract_string(payload, '$.match_outcome')) LIKE '%radvictory%' THEN 2
         WHEN lower(json_extract_string(payload, '$.match_outcome')) LIKE '%direvictory%' THEN 3
       END,
       CASE
         WHEN lower(json_extract_string(payload, '$.match_outcome')) LIKE '%radiantvictory%'
           OR lower(json_extract_string(payload, '$.match_outcome')) LIKE '%radvictory%' THEN 'Radiant'
         WHEN lower(json_extract_string(payload, '$.match_outcome')) LIKE '%direvictory%' THEN 'Dire'
       END,
       try_cast(json_extract_string(payload, '$.radiant_team_score') AS INTEGER),
       try_cast(json_extract_string(payload, '$.dire_team_score') AS INTEGER),
       json_extract_string(payload, '$.radiant_team_name'),
       json_extract_string(payload, '$.dire_team_name'),
       try_cast(json_extract_string(payload, '$.cluster') AS INTEGER),
       try_cast(json_extract_string(payload, '$.first_blood_time') AS INTEGER),
       (SELECT try_cast(json_extract_string(metadata.payload, '$.version') AS INTEGER)
          FROM raw.records metadata
         WHERE metadata.extraction_id = $id
           AND metadata.record_type = 'CDOTAMatchMetadataFile')
     FROM raw.records
     WHERE extraction_id = $id AND record_type = 'CMsgDOTAMatch'`,
    { id: manifest.extractionId },
  );

  const reported = await connection.runAndReadAll(
    "SELECT match_id FROM analysis.matches WHERE extraction_id = $id", { id: manifest.extractionId },
  );
  const reportedId = (reported.getRowObjects()[0] as { match_id: bigint } | undefined)?.match_id;
  if (reportedId !== BigInt(manifest.matchId)) {
    throw new Error(`Replay match ID ${String(reportedId)} does not match requested ID ${manifest.matchId}`);
  }

  await connection.run(
    `INSERT INTO analysis.players
     SELECT
       $id,
       try_cast(json_extract_string(player.value, '$.player_slot') AS UINTEGER),
       CASE json_extract_string(player.value, '$.team_number')
         WHEN 'DOTA_GC_TEAM_GOOD_GUYS' THEN 2 WHEN 'DOTA_GC_TEAM_BAD_GUYS' THEN 3
       END,
       CASE json_extract_string(player.value, '$.team_number')
         WHEN 'DOTA_GC_TEAM_GOOD_GUYS' THEN 'Radiant' WHEN 'DOTA_GC_TEAM_BAD_GUYS' THEN 'Dire'
       END,
       try_cast(json_extract_string(player.value, '$.team_slot') AS UINTEGER),
       try_cast(json_extract_string(player.value, '$.account_id') AS UBIGINT),
       nullif(json_extract_string(player.value, '$.player_name'), ''),
       try_cast(json_extract_string(player.value, '$.hero_id') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.level') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.kills') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.deaths') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.assists') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.last_hits') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.denies') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.gold_per_min') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.xp_per_min') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.net_worth') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.hero_damage') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.tower_damage') AS INTEGER),
       try_cast(json_extract_string(player.value, '$.hero_healing') AS INTEGER)
     FROM raw.records overview, json_each(overview.payload, '$.players') player
     WHERE overview.extraction_id = $id AND overview.record_type = 'CMsgDOTAMatch'
       AND json_extract_string(player.value, '$.team_number') IN
           ('DOTA_GC_TEAM_GOOD_GUYS', 'DOTA_GC_TEAM_BAD_GUYS')`,
    { id: manifest.extractionId },
  );

  await connection.run(
    `INSERT INTO analysis.player_items
     SELECT $id,
       try_cast(json_extract_string(player.value, '$.player_slot') AS UINTEGER),
       item_slot::UINTEGER,
       try_cast(json_extract_string(player.value, format('$.item_{}', item_slot)) AS INTEGER)
     FROM raw.records overview,
          json_each(overview.payload, '$.players') player,
          range(10) slots(item_slot)
     WHERE overview.extraction_id = $id AND overview.record_type = 'CMsgDOTAMatch'
       AND json_extract_string(player.value, '$.team_number') IN
           ('DOTA_GC_TEAM_GOOD_GUYS', 'DOTA_GC_TEAM_BAD_GUYS')`,
    { id: manifest.extractionId },
  );

  await connection.run(
    `INSERT INTO analysis.hero_draft_events
     SELECT
       $id,
       draft.key::UINTEGER,
       try_cast(json_extract_string(draft.value, '$.hero_id') AS INTEGER),
       try_cast(json_extract_string(draft.value, '$.is_pick') AS BOOLEAN),
       try_cast(json_extract_string(draft.value, '$.team') AS INTEGER)
     FROM raw.records AS overview,
          json_each(overview.payload, '$.picks_bans') AS draft
     WHERE overview.extraction_id = $id
       AND overview.record_type = 'CMsgDOTAMatch'
       AND json_type(draft.value, '$.hero_id') IN ('BIGINT', 'UBIGINT')
       AND try_cast(json_extract_string(draft.value, '$.hero_id') AS INTEGER) > 0
       AND json_type(draft.value, '$.is_pick') = 'BOOLEAN'
       AND json_type(draft.value, '$.team') IN ('BIGINT', 'UBIGINT')
       AND try_cast(json_extract_string(draft.value, '$.team') AS INTEGER) IN (0, 1)`,
    { id: manifest.extractionId },
  );

  await connection.run(
    `INSERT INTO analysis.team_time_series
     SELECT $id,
       try_cast(json_extract_string(team.value, '$.dota_team') AS INTEGER),
       sample.key::UINTEGER,
       try_cast(sample.value AS DOUBLE),
       try_cast(json_extract(team.value, format('$.graph_gold_earned[{}]', sample.key)) AS DOUBLE),
       try_cast(json_extract(team.value, format('$.graph_experience[{}]', sample.key)) AS DOUBLE)
     FROM raw.records metadata,
          json_each(metadata.payload, '$.metadata.teams') team,
          json_each(team.value, '$.graph_net_worth') sample
     WHERE metadata.extraction_id = $id
       AND metadata.record_type = 'CDOTAMatchMetadataFile'
       AND try_cast(json_extract_string(team.value, '$.dota_team') AS INTEGER) IN (2, 3)`,
    { id: manifest.extractionId },
  );

  await connection.run(
    `INSERT INTO analysis.player_gold_events
     WITH metadata_player_candidates AS MATERIALIZED (
       SELECT
         try_cast(json_extract_string(player.value, '$.game_player_id') AS INTEGER)
           AS game_player_id,
         try_cast(json_extract_string(player.value, '$.player_slot') AS UINTEGER)
           AS player_slot,
         try_cast(json_extract_string(team.value, '$.dota_team') AS INTEGER)
           AS team_id
       FROM raw.records AS metadata,
            json_each(metadata.payload, '$.metadata.teams') AS team,
            json_each(team.value, '$.players') AS player
       WHERE metadata.extraction_id = $id
         AND metadata.record_type = 'CDOTAMatchMetadataFile'
     ),
     metadata_players AS MATERIALIZED (
       -- A repeated player slot is ambiguous even when one candidate looks
       -- usable. Skip it instead of duplicating a gold fact or guessing.
       SELECT
         player_slot,
         min(game_player_id) AS game_player_id,
         min(team_id) AS team_id
       FROM metadata_player_candidates
       WHERE game_player_id IS NOT NULL
         AND game_player_id >= 0
         AND player_slot IS NOT NULL
         AND team_id IN (2, 3)
       GROUP BY player_slot
       HAVING count(*) = 1
     ),
     roster_players AS MATERIALIZED (
       SELECT
         extraction_id,
         team_id,
         team_slot,
         min(player_slot) AS player_slot
       FROM analysis.players
       WHERE extraction_id = $id
         AND team_id IN (2, 3)
         AND team_slot IS NOT NULL
       GROUP BY extraction_id, team_id, team_slot
       HAVING count(*) = 1
     ),
     gold_updates AS MATERIALIZED (
       SELECT
         update.extraction_id,
         update.sequence,
         CASE instance.class_name
           WHEN 'CDOTA_DataRadiant' THEN 2
           WHEN 'CDOTA_DataDire' THEN 3
         END AS team_id,
         try_cast(
           regexp_extract(
             update.property_path,
             '^m_vecDataTeam\\.([0-9]+)\\.m_iTotalEarnedGold$',
             1
           ) AS UINTEGER
         ) AS team_slot,
         update.game_time AS game_time_seconds,
         try_cast(json_extract_string(update.value, '$') AS BIGINT)
           AS total_gold_earned
       FROM raw.entity_property_updates AS update
       JOIN raw.entity_instances AS instance
         ON instance.extraction_id = update.extraction_id
        AND instance.entity_instance_id = update.entity_instance_id
        AND instance.class_name IN ('CDOTA_DataRadiant', 'CDOTA_DataDire')
       WHERE update.extraction_id = $id
         AND regexp_full_match(
           update.property_path,
           'm_vecDataTeam\\.[0-9]+\\.m_iTotalEarnedGold'
         )
         AND update.game_time IS NOT NULL
         AND isfinite(update.game_time)
         AND analysis.is_actual_game(update.extraction_id, update.sequence)
     )
     SELECT
       update.extraction_id,
       update.sequence,
       metadata.game_player_id,
       roster.player_slot,
       update.team_id,
       update.game_time_seconds,
       update.total_gold_earned
     FROM gold_updates AS update
     JOIN roster_players AS roster
       ON roster.extraction_id = update.extraction_id
      AND roster.team_id = update.team_id
      AND roster.team_slot = update.team_slot
     JOIN metadata_players AS metadata
       ON metadata.player_slot = roster.player_slot
      AND metadata.team_id = roster.team_id
     WHERE update.team_id IN (2, 3)
       AND update.team_slot IS NOT NULL
       AND update.total_gold_earned >= 0
     ORDER BY update.sequence`,
    { id: manifest.extractionId },
  );
}

async function recordFailure(connection: DuckDBConnection, manifest: Manifest, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await connection.run(
    `INSERT INTO catalog.extractions
       (extraction_id, match_id, replay_sha256, parser_name, parser_version, exporter_version,
        extraction_config, checkpoint_interval_seconds, output_limit_bytes, completed_at,
        status, error_code, error_message, manifest)
     VALUES ($id, $matchId, $sha, $parserName, $parserVersion, $exporterVersion,
       $config::JSON, $interval, $limit, now(), 'failed', 'load_failed', $message, $manifest::JSON)
     ON CONFLICT (extraction_id) DO UPDATE SET status='failed', completed_at=now(),
       error_code='load_failed', error_message=excluded.error_message`,
    {
      id: manifest.extractionId, matchId: BigInt(manifest.matchId), sha: manifest.replaySha256,
      parserName: manifest.parser.name, parserVersion: manifest.parser.version,
      exporterVersion: manifest.exporterVersion, config: jsonStringify(manifest.config),
      interval: numberConfig(manifest.config, "checkpointIntervalSeconds", 30),
      limit: BigInt(numberConfig(manifest.config, "maxOutputBytes", 1)), message,
      manifest: jsonStringify(manifest),
    },
  );
}

function numberConfig(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sqlLiteral(value: string): string { return value.replaceAll("'", "''"); }
function sqlStringList(values: ReadonlySet<string>): string {
  return [...values].map((value) => `'${sqlLiteral(value)}'`).join(", ");
}
