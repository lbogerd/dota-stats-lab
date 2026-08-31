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

export interface CatalogStats {
  storedMatches: string;
  totalRecords: string;
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

export async function getCatalogStats(): Promise<CatalogStats> {
  return withReadOnlyWarehouse(async (connection) => {
    const result = await connection.runAndReadAll(CATALOG_STATS_SQL);
    const row = result.getRowObjectsJson()[0];
    if (row === undefined) throw new Error("Catalog statistics query returned no rows");
    return {
      storedMatches: stringValue(row.stored_matches),
      totalRecords: stringValue(row.total_records),
    };
  });
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

const CATALOG_STATS_SQL = `
WITH match_ids AS (
  SELECT match_id FROM catalog.replay_acquisitions
  UNION
  SELECT match_id FROM catalog.extractions
), latest_successful_extraction AS (
  SELECT match_id, record_counts, row_number() OVER (
    PARTITION BY match_id ORDER BY started_at DESC, extraction_id DESC
  ) AS row_number
  FROM catalog.extractions
  WHERE status = 'succeeded'
)
SELECT
  count(*)::VARCHAR AS stored_matches,
  coalesce(sum(try_cast(
    json_extract_string(extraction.record_counts, '$.total') AS UBIGINT
  )), 0)::VARCHAR AS total_records
FROM match_ids AS match
LEFT JOIN latest_successful_extraction AS extraction
  ON extraction.match_id = match.match_id AND extraction.row_number = 1`;

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
