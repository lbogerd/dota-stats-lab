import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { paths } from "../config.js";
import { migrate, openWarehouse } from "../db/database.js";
import { withWarehouseLock } from "../db/lock.js";
import { jsonStringify } from "../lib/json.js";
import { stagedFiles, validateManifest, type Manifest } from "./manifest.js";
import {
  REJECTED_ENTITY_CLASSES,
  REJECTED_RECORD_TYPES,
  STORED_CHECKPOINT_KINDS,
  STORED_ENTITY_EVENT_TYPES,
} from "./storage-policy.js";

export type LoadResult = { extractionId: string; status: "loaded" | "already_loaded" };

export async function migrateOnly(): Promise<void> {
  await withWarehouseLock(paths.warehousePath, async () => {
    const database = await openWarehouse();
    try { await migrate(database.connection); } finally { database.close(); }
  });
}

export async function loadExtraction(matchId: bigint): Promise<LoadResult> {
  const extractionDir = await findExtractionDir(matchId);
  const manifest = await validateManifest(extractionDir, matchId);
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
        await database.connection.run(
          `UPDATE catalog.extractions SET status = 'succeeded', completed_at = current_timestamp,
             load_elapsed_ms = $elapsed, record_counts = $counts::JSON WHERE extraction_id = $id`,
          {
            elapsed: BigInt(Math.max(0, Math.round(performance.now() - loadStarted))),
            counts: jsonStringify(storedCounts),
            id: manifest.extractionId,
          },
        );
        await database.connection.run("COMMIT");
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

async function findExtractionDir(matchId: bigint): Promise<string> {
  const matchDir = path.join(paths.stagingRoot, matchId.toString());
  const entries = await readdir(matchDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name));
  if (directories.length !== 1) throw new Error(`Expected exactly one staged extraction for match ${matchId}, found ${directories.length}`);
  return path.join(matchDir, directories[0]!.name);
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
      replayPath: `/data/replays/${manifest.matchId}/replay.dem.bz2`, sha: manifest.replaySha256,
      bytes: typeof acquisition.replayBytes === "number" ? BigInt(acquisition.replayBytes) : null,
      metadata: jsonStringify(acquisition),
    },
  );
  await connection.run(
    `INSERT INTO catalog.extractions
      (extraction_id, match_id, replay_sha256, parser_name, parser_version, exporter_version,
       extraction_config, checkpoint_interval_seconds, output_limit_bytes, started_at, status,
       parse_elapsed_ms, output_size_bytes, record_counts, manifest)
     VALUES ($id, $matchId, $sha, $parserName, $parserVersion, $exporterVersion,
       $config::JSON, $interval, $limit, $startedAt::TIMESTAMPTZ, 'started', $parseMs, $outputBytes,
       $counts::JSON, $manifest::JSON)
     ON CONFLICT (extraction_id) DO UPDATE SET
       match_id = excluded.match_id, replay_sha256 = excluded.replay_sha256,
       parser_name = excluded.parser_name, parser_version = excluded.parser_version,
       exporter_version = excluded.exporter_version, extraction_config = excluded.extraction_config,
       checkpoint_interval_seconds = excluded.checkpoint_interval_seconds,
       output_limit_bytes = excluded.output_limit_bytes, started_at = excluded.started_at,
       status = 'started', completed_at = NULL, parse_elapsed_ms = excluded.parse_elapsed_ms,
       load_elapsed_ms = NULL, output_size_bytes = excluded.output_size_bytes,
       record_counts = excluded.record_counts, error_code = NULL, error_message = NULL,
       manifest = excluded.manifest`,
    {
      id: manifest.extractionId, matchId: BigInt(manifest.matchId), sha: manifest.replaySha256,
      parserName: manifest.parser.name, parserVersion: manifest.parser.version,
      exporterVersion: manifest.exporterVersion, config: jsonStringify(manifest.config),
      interval: checkpointInterval, limit: BigInt(outputLimit), startedAt: manifest.startedAt,
      parseMs: BigInt(Math.max(0, Math.round(manifest.elapsedMs))), outputBytes: BigInt(totalBytes),
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
    blobs: Number(importedCount("blobs")),
    entityInstances: Number(importedCount("entity_instances")),
    entityEvents: Number(importedCount("entity_events")),
    propertyUpdates: Number(importedCount("property_updates")),
    checkpoints: Number(importedCount("checkpoints")),
  };
  const total = counts.records + counts.blobs + counts.entityInstances + counts.entityEvents
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
