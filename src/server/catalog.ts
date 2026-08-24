import type { DuckDBConnection } from "@duckdb/node-api";
import { parseMatchId } from "../lib/match-id.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

export interface ExtractionCounts {
  records: string;
  combatEvents: string;
  blobs: string;
  entityInstances: string;
  entityEvents: string;
  propertyUpdates: string;
  checkpoints: string;
  total: string;
}

export interface CatalogMatchSummary {
  matchId: string;
  status: string;
  acquiredAt: string;
  replayBytes: string | null;
  extractionId: string | null;
  exporterVersion: string | null;
  extractionCount: number;
  acquisitionCount: number;
  counts: ExtractionCounts;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CatalogAcquisition {
  acquisitionId: string;
  requestedAt: string;
  completedAt: string | null;
  source: string;
  sourceUrl: string | null;
  replayPath: string | null;
  replaySha256: string | null;
  replayBytes: string | null;
  status: string;
  elapsedMs: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: JsonValue;
}

export interface CatalogExtraction {
  extractionId: string;
  replaySha256: string;
  parserName: string;
  parserVersion: string;
  exporterVersion: string;
  extractionConfig: JsonValue;
  checkpointIntervalSeconds: number;
  outputLimitBytes: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  parseElapsedMs: string | null;
  loadElapsedMs: string | null;
  outputSizeBytes: string | null;
  counts: ExtractionCounts;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CatalogError {
  source: "acquisition" | "extraction";
  id: string;
  occurredAt: string;
  code: string | null;
  message: string;
}

export interface CatalogMatchDetail {
  matchId: string;
  acquisitions: CatalogAcquisition[];
  extractions: CatalogExtraction[];
  errors: CatalogError[];
}

export interface ListMatchesOptions {
  limit?: number;
  offset?: number;
}

export async function listMatches(options: ListMatchesOptions = {}): Promise<CatalogMatchSummary[]> {
  const limit = boundedInteger("limit", options.limit ?? 100, 1, 500);
  const offset = boundedInteger("offset", options.offset ?? 0, 0, 1_000_000);
  return withReadOnlyWarehouse(async (connection) => {
    const result = await connection.runAndReadAll(LIST_MATCHES_SQL, { limit, offset });
    return result.getRowObjectsJson().map(mapMatchSummary);
  });
}

export async function getMatchDetail(matchId: string): Promise<CatalogMatchDetail | null> {
  const id = parseBrowserMatchId(matchId);
  return withReadOnlyWarehouse(async (connection) => {
    const acquisitions = await queryAcquisitions(connection, id);
    const extractions = await queryExtractions(connection, id);
    if (acquisitions.length === 0 && extractions.length === 0) return null;
    const errors: CatalogError[] = [
      ...acquisitions.flatMap<CatalogError>((item) => item.errorMessage === null ? [] : [{
        source: "acquisition",
        id: item.acquisitionId,
        occurredAt: item.completedAt ?? item.requestedAt,
        code: item.errorCode,
        message: item.errorMessage,
      }]),
      ...extractions.flatMap<CatalogError>((item) => item.errorMessage === null ? [] : [{
        source: "extraction",
        id: item.extractionId,
        occurredAt: item.completedAt ?? item.startedAt,
        code: item.errorCode,
        message: item.errorMessage,
      }]),
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    return { matchId: id.toString(), acquisitions, extractions, errors };
  });
}

async function queryAcquisitions(connection: DuckDBConnection, matchId: bigint): Promise<CatalogAcquisition[]> {
  const result = await connection.runAndReadAll(ACQUISITIONS_SQL, { matchId });
  return result.getRowObjectsJson().map((row) => ({
    acquisitionId: stringValue(row.acquisition_id),
    requestedAt: stringValue(row.requested_at),
    completedAt: nullableString(row.completed_at),
    source: stringValue(row.source),
    sourceUrl: nullableString(row.source_url),
    replayPath: nullableString(row.replay_path),
    replaySha256: nullableString(row.replay_sha256),
    replayBytes: nullableString(row.replay_bytes),
    status: stringValue(row.status),
    elapsedMs: nullableString(row.elapsed_ms),
    errorCode: nullableString(row.error_code),
    errorMessage: nullableString(row.error_message),
    metadata: jsonValue(row.metadata),
  }));
}

async function queryExtractions(connection: DuckDBConnection, matchId: bigint): Promise<CatalogExtraction[]> {
  const result = await connection.runAndReadAll(EXTRACTIONS_SQL, { matchId });
  return result.getRowObjectsJson().map((row) => ({
    extractionId: stringValue(row.extraction_id),
    replaySha256: stringValue(row.replay_sha256),
    parserName: stringValue(row.parser_name),
    parserVersion: stringValue(row.parser_version),
    exporterVersion: stringValue(row.exporter_version),
    extractionConfig: jsonValue(row.extraction_config),
    checkpointIntervalSeconds: numberValue(row.checkpoint_interval_seconds),
    outputLimitBytes: stringValue(row.output_limit_bytes),
    startedAt: stringValue(row.started_at),
    completedAt: nullableString(row.completed_at),
    status: stringValue(row.status),
    parseElapsedMs: nullableString(row.parse_elapsed_ms),
    loadElapsedMs: nullableString(row.load_elapsed_ms),
    outputSizeBytes: nullableString(row.output_size_bytes),
    counts: countsFromRow(row),
    errorCode: nullableString(row.error_code),
    errorMessage: nullableString(row.error_message),
  }));
}

function mapMatchSummary(row: Record<string, JsonValue>): CatalogMatchSummary {
  return {
    matchId: stringValue(row.match_id),
    status: stringValue(row.status),
    acquiredAt: stringValue(row.acquired_at),
    replayBytes: nullableString(row.replay_bytes),
    extractionId: nullableString(row.extraction_id),
    exporterVersion: nullableString(row.exporter_version),
    extractionCount: numberValue(row.extraction_count),
    acquisitionCount: numberValue(row.acquisition_count),
    counts: countsFromRow(row),
    errorCode: nullableString(row.error_code),
    errorMessage: nullableString(row.error_message),
  };
}

function countsFromRow(row: Record<string, JsonValue>): ExtractionCounts {
  return {
    records: stringValue(row.records),
    combatEvents: stringValue(row.combat_events),
    blobs: stringValue(row.blobs),
    entityInstances: stringValue(row.entity_instances),
    entityEvents: stringValue(row.entity_events),
    propertyUpdates: stringValue(row.property_updates),
    checkpoints: stringValue(row.checkpoints),
    total: stringValue(row.total),
  };
}

function parseBrowserMatchId(value: string): bigint {
  try {
    return parseMatchId(value);
  } catch (error) {
    throw new Error("Match ID must be a positive decimal integer in the DuckDB UBIGINT range.", { cause: error });
  }
}

function stringValue(value: JsonValue | undefined): string {
  if (typeof value !== "string") throw new Error("Unexpected catalog value");
  return value;
}

function nullableString(value: JsonValue | undefined): string | null {
  return value === null ? null : stringValue(value);
}

function numberValue(value: JsonValue | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Unexpected catalog number");
  return value;
}

function jsonValue(value: JsonValue | undefined): JsonValue {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as JsonValue;
  } catch (error) {
    throw new Error("Unexpected catalog JSON", { cause: error });
  }
}

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

const COUNT_COLUMNS = `
  coalesce(json_extract_string(e.record_counts, '$.records'), '0') AS records,
  coalesce(json_extract_string(e.record_counts, '$.combatEvents'), '0') AS combat_events,
  coalesce(json_extract_string(e.record_counts, '$.blobs'), '0') AS blobs,
  coalesce(json_extract_string(e.record_counts, '$.entityInstances'), '0') AS entity_instances,
  coalesce(json_extract_string(e.record_counts, '$.entityEvents'), '0') AS entity_events,
  coalesce(json_extract_string(e.record_counts, '$.propertyUpdates'), '0') AS property_updates,
  coalesce(json_extract_string(e.record_counts, '$.checkpoints'), '0') AS checkpoints,
  coalesce(json_extract_string(e.record_counts, '$.total'), '0') AS total`;

const LIST_MATCHES_SQL = `
WITH match_ids AS (
  SELECT match_id FROM catalog.replay_acquisitions
  UNION
  SELECT match_id FROM catalog.extractions
), latest_acquisition AS (
  SELECT *, row_number() OVER (
    PARTITION BY match_id ORDER BY requested_at DESC, acquisition_id DESC
  ) AS row_number
  FROM catalog.replay_acquisitions
), latest_extraction AS (
  SELECT *, row_number() OVER (
    PARTITION BY match_id ORDER BY started_at DESC, extraction_id DESC
  ) AS row_number
  FROM catalog.extractions
), acquisition_counts AS (
  SELECT match_id, count(*)::INTEGER AS acquisition_count
  FROM catalog.replay_acquisitions GROUP BY match_id
), extraction_counts AS (
  SELECT match_id, count(*)::INTEGER AS extraction_count
  FROM catalog.extractions GROUP BY match_id
)
SELECT
  ids.match_id::VARCHAR AS match_id,
  coalesce(e.status, a.status) AS status,
  coalesce(e.completed_at, e.started_at, a.completed_at, a.requested_at)::VARCHAR AS acquired_at,
  a.replay_size_bytes::VARCHAR AS replay_bytes,
  e.extraction_id,
  e.exporter_version,
  coalesce(ec.extraction_count, 0)::INTEGER AS extraction_count,
  coalesce(ac.acquisition_count, 0)::INTEGER AS acquisition_count,
  ${COUNT_COLUMNS},
  coalesce(e.error_code, a.error_code) AS error_code,
  coalesce(e.error_message, a.error_message) AS error_message
FROM match_ids AS ids
LEFT JOIN latest_acquisition AS a ON a.match_id = ids.match_id AND a.row_number = 1
LEFT JOIN latest_extraction AS e ON e.match_id = ids.match_id AND e.row_number = 1
LEFT JOIN acquisition_counts AS ac ON ac.match_id = ids.match_id
LEFT JOIN extraction_counts AS ec ON ec.match_id = ids.match_id
ORDER BY coalesce(e.completed_at, e.started_at, a.completed_at, a.requested_at) DESC, ids.match_id DESC
LIMIT $limit OFFSET $offset`;

const ACQUISITIONS_SQL = `
SELECT
  acquisition_id::VARCHAR AS acquisition_id,
  requested_at::VARCHAR AS requested_at,
  completed_at::VARCHAR AS completed_at,
  source, source_url, replay_path, replay_sha256,
  replay_size_bytes::VARCHAR AS replay_bytes,
  status, elapsed_ms::VARCHAR AS elapsed_ms, error_code, error_message, metadata
FROM catalog.replay_acquisitions
WHERE match_id = $matchId
ORDER BY requested_at DESC, acquisition_id DESC`;

const EXTRACTIONS_SQL = `
SELECT
  e.extraction_id, e.replay_sha256, e.parser_name, e.parser_version, e.exporter_version,
  e.extraction_config, e.checkpoint_interval_seconds,
  e.output_limit_bytes::VARCHAR AS output_limit_bytes,
  e.started_at::VARCHAR AS started_at,
  e.completed_at::VARCHAR AS completed_at,
  e.status,
  e.parse_elapsed_ms::VARCHAR AS parse_elapsed_ms,
  e.load_elapsed_ms::VARCHAR AS load_elapsed_ms,
  e.output_size_bytes::VARCHAR AS output_size_bytes,
  ${COUNT_COLUMNS},
  e.error_code, e.error_message
FROM catalog.extractions AS e
WHERE e.match_id = $matchId
ORDER BY e.started_at DESC, e.extraction_id DESC`;
