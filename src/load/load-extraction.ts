import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { paths } from "../config.js";
import { migrate, openWarehouse } from "../db/database.js";
import { withWarehouseLock } from "../db/lock.js";
import { jsonStringify } from "../lib/json.js";
import { stagedFiles, validateManifest, type Manifest } from "./manifest.js";

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
        await validateImportedRows(database.connection, manifest);
        await database.connection.run(
          `UPDATE catalog.extractions SET status = 'succeeded', completed_at = current_timestamp,
             load_elapsed_ms = $elapsed WHERE extraction_id = $id`,
          { elapsed: BigInt(Math.max(0, Math.round(performance.now() - loadStarted))), id: manifest.extractionId },
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
      counts: jsonStringify(manifest.counts), manifest: jsonStringify(manifest),
    },
  );
}

async function importStagedFiles(connection: DuckDBConnection, dir: string, manifest: Manifest): Promise<void> {
  const imports: Array<[keyof typeof stagedFiles, string]> = [
    ["records", `INSERT INTO raw.records SELECT extractionId, sequence::UBIGINT, demoTick, netTick, gameTime, category, recordType, payload::JSON FROM read_ndjson_auto('__FILE__')`],
    ["blobs", `INSERT INTO raw.record_blobs SELECT extractionId, sequence::UBIGINT, demoTick, netTick, gameTime, blobId, recordSequence::UBIGINT, fieldPath, from_base64(valueBase64) FROM read_ndjson_auto('__FILE__')`],
    ["entityInstances", `INSERT INTO raw.entity_instances SELECT extractionId, sequence::UBIGINT, entityInstanceId::UBIGINT, entityIndex::UINTEGER, serial::UINTEGER, handle::UBIGINT, classId::INTEGER, className, demoTick, netTick, gameTime FROM read_ndjson_auto('__FILE__')`],
    ["entityEvents", `INSERT INTO raw.entity_events SELECT extractionId, sequence::UBIGINT, entityInstanceId::UBIGINT, eventType, demoTick, netTick, gameTime, to_json(changedPropertyPaths), synthetic FROM read_ndjson_auto('__FILE__')`],
    ["propertyUpdates", `INSERT INTO raw.entity_property_updates SELECT extractionId, sequence::UBIGINT, entityInstanceId::UBIGINT, propertyPath, valueType, coalesce(to_json(value), 'null'::JSON), demoTick, netTick, gameTime FROM read_ndjson_auto('__FILE__')`],
    ["checkpoints", `INSERT INTO raw.entity_checkpoints SELECT extractionId, sequence::UBIGINT, entityInstanceId::UBIGINT, checkpointKind, demoTick, netTick, gameTime, checkpointGameTime, to_json(properties) FROM read_ndjson_auto('__FILE__')`],
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

async function validateImportedRows(connection: DuckDBConnection, manifest: Manifest): Promise<void> {
  const result = await connection.runAndReadAll(
    `SELECT
       (SELECT count(*) FROM raw.records WHERE extraction_id = $id) AS records,
       (SELECT count(*) FROM raw.record_blobs WHERE extraction_id = $id) AS blobs,
       (SELECT count(*) FROM raw.entity_instances WHERE extraction_id = $id) AS entity_instances,
       (SELECT count(*) FROM raw.entity_events WHERE extraction_id = $id) AS entity_events,
       (SELECT count(*) FROM raw.entity_property_updates WHERE extraction_id = $id) AS property_updates,
       (SELECT count(DISTINCT sequence) FROM raw.entity_property_updates WHERE extraction_id = $id) AS property_update_sequences,
       (SELECT count(*) FROM raw.entity_checkpoints WHERE extraction_id = $id) AS checkpoints`,
    { id: manifest.extractionId },
  );
  const row = result.getRowObjects()[0] as Record<string, bigint>;
  const expected: Record<string, bigint> = {
    records: BigInt(manifest.files.records.records),
    blobs: BigInt(manifest.files.blobs.records),
    entity_instances: BigInt(manifest.files.entityInstances.records),
    entity_events: BigInt(manifest.files.entityEvents.records),
    property_updates: BigInt(manifest.files.propertyUpdates.records),
    checkpoints: BigInt(manifest.files.checkpoints.records),
  };
  for (const [name, count] of Object.entries(expected)) {
    if (row[name] !== count) throw new Error(`Imported ${name} count does not match manifest`);
  }
  if (row.property_update_sequences !== expected.property_updates) {
    throw new Error("Imported property update sequences are not unique");
  }
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
