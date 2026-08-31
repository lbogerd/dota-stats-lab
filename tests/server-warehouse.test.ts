import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-browser-sql-"));
const warehousePath = path.join(root, "warehouse", "dota.duckdb");
process.env.WAREHOUSE_PATH = warehousePath;
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

await mkdir(path.dirname(warehousePath), { recursive: true });
const writer = await DuckDBInstance.create(warehousePath);
const writerConnection = await writer.connect();
await writerConnection.run(`
  CREATE SCHEMA catalog;
  CREATE TABLE catalog.replay_acquisitions (
    acquisition_id UUID PRIMARY KEY, match_id UBIGINT, requested_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ, source VARCHAR, source_url VARCHAR, replay_path VARCHAR,
    replay_sha256 VARCHAR, replay_size_bytes UBIGINT, status VARCHAR, elapsed_ms UBIGINT,
    error_code VARCHAR, error_message VARCHAR, metadata JSON
  );
  CREATE TABLE catalog.extractions (
    extraction_id VARCHAR PRIMARY KEY, match_id UBIGINT, replay_sha256 VARCHAR,
    parser_name VARCHAR, parser_version VARCHAR, exporter_version VARCHAR,
    extraction_config JSON, checkpoint_interval_seconds DOUBLE, output_limit_bytes UBIGINT,
    started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, status VARCHAR,
    parse_elapsed_ms UBIGINT, load_elapsed_ms UBIGINT, output_size_bytes UBIGINT,
    record_counts JSON, error_code VARCHAR, error_message VARCHAR
  );
  INSERT INTO catalog.replay_acquisitions VALUES
    ('11111111-1111-1111-1111-111111111111', 8953222159,
     '2026-08-20T10:00:00Z', '2026-08-20T10:01:00Z', 'test', NULL,
     '/replay.dem', '${"a".repeat(64)}', 9007199254740993, 'succeeded', 60000,
     NULL, NULL, '{"region":"test"}'),
    ('22222222-2222-2222-2222-222222222222', 77,
     '2026-08-21T10:00:00Z', '2026-08-21T10:01:00Z', 'test', NULL,
     NULL, NULL, NULL, 'failed', 12, 'unavailable', 'Replay unavailable', NULL);
  INSERT INTO catalog.extractions VALUES
    ('${"b".repeat(64)}', 8953222159, '${"a".repeat(64)}', 'clarity', '4.0.1', '0.1.3',
     '{"checkpointIntervalSeconds":30}', 30, 12884901888,
     '2026-08-20T10:01:00Z', '2026-08-20T10:02:00Z', 'succeeded', 50000, 10000,
     123456789, '{"records":3,"blobs":4,"entityInstances":5,"entityEvents":6,"propertyUpdates":7,"checkpoints":8,"total":33}',
     NULL, NULL),
    ('${"c".repeat(64)}', 8953222159, '${"a".repeat(64)}', 'clarity', '4.0.1', '0.1.4',
     '{}', 30, 12884901888, '2026-08-21T10:01:00Z', '2026-08-21T10:02:00Z',
     'failed', 100, NULL, 10, '{}', 'parse_failed', 'Malformed replay');
`);
writerConnection.closeSync();
writer.closeSync();

const { BrowserSqlError, executeReadOnlySql, withReadOnlyWarehouse } = await import("../src/server/warehouse.js");
const { getCatalogStats, listMatches } = await import("../src/server/catalog.js");

test("browser SQL returns normalized JSON-safe values and enforces row limits", async () => {
  const result = await executeReadOnlySql(
    "SELECT i::UBIGINT AS big_id, TIMESTAMPTZ '2026-08-22 12:30:00Z' AS at FROM range(5) t(i) ORDER BY i",
    { rowLimit: 3 },
  );
  assert.deepEqual(result.columns, ["big_id", "at"]);
  assert.deepEqual(result.rows.map((row) => row.big_id), ["0", "1", "2"]);
  assert.equal(typeof result.rows[0]!.at, "string");
  assert.equal(result.totalRows, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.truncationReason, "row_limit");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("browser SQL caps the serialized response size", async () => {
  const result = await executeReadOnlySql(
    "SELECT repeat('x', 180) AS value FROM range(20)",
    { rowLimit: 100, maxResponseBytes: 500 },
  );
  assert.equal(result.truncated, true);
  assert.equal(result.truncationReason, "response_size");
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 500);
  assert.ok(result.rows.length < 20);
});

test("browser SQL accepts exactly one SELECT statement", async () => {
  const valid = await executeReadOnlySql("-- one query\nWITH n AS (SELECT 42 AS answer) SELECT * FROM n;");
  assert.deepEqual(valid.rows, [{ answer: 42 }]);
  await assert.rejects(executeReadOnlySql(""), isCode("INVALID_SQL"));
  await assert.rejects(executeReadOnlySql("SELEC broken"), isCode("INVALID_SQL"));
  await assert.rejects(executeReadOnlySql("SELECT 1; SELECT 2"), isCode("ONLY_ONE_STATEMENT"));
});

test("browser SQL rejects database writes and configuration changes", async () => {
  for (const sql of [
    "INSERT INTO catalog.extractions(extraction_id) VALUES ('x')",
    "UPDATE catalog.extractions SET status = 'failed'",
    "DELETE FROM catalog.extractions",
    "CREATE TABLE nope(i INTEGER)",
    "DROP TABLE catalog.extractions",
    "SET threads = 4",
    "PRAGMA database_size",
  ]) {
    await assert.rejects(executeReadOnlySql(sql), isCode("READ_ONLY_REQUIRED"), sql);
  }
});

test("browser SQL rejects ATTACH, COPY, file reads, and extension loading", async () => {
  const copiedPath = path.join(root, "copied.csv");
  for (const sql of [
    "ATTACH ':memory:' AS other",
    `COPY (SELECT 1) TO '${copiedPath}'`,
    "INSTALL httpfs",
    "LOAD httpfs",
  ]) {
    await assert.rejects(executeReadOnlySql(sql), isCode("READ_ONLY_REQUIRED"), sql);
  }
  await assert.rejects(
    executeReadOnlySql("SELECT * FROM read_csv('/etc/passwd')"),
    /file system operations are disabled|external access|Permission Error/i,
  );
  await assert.rejects(readFile(copiedPath), /ENOENT/);
});

test("read-only configuration is locked and warehouse work is serialized", async () => {
  let queued: ReturnType<typeof executeReadOnlySql> | undefined;
  await withReadOnlyWarehouse(async (connection) => {
    const settings = await connection.runAndReadAll(`
      SELECT name, value FROM duckdb_settings()
      WHERE name IN ('access_mode', 'enable_external_access', 'lock_configuration', 'threads')`);
    assert.deepEqual(Object.fromEntries(settings.getRowsJson()), {
      access_mode: "read_only",
      enable_external_access: "false",
      lock_configuration: "true",
      threads: "1",
    });
    queued = executeReadOnlySql("SELECT 1");
    await assert.rejects(connection.run("SET threads = 2"), /configuration has been locked/i);
  });
  assert.deepEqual((await queued!).rows, [{ "1": 1 }]);
});

test("catalog lists latest match state with string-safe counts", async () => {
  const matches = await listMatches();
  assert.equal(matches.length, 2);
  assert.equal(matches[0]!.matchId, "8953222159");
  assert.equal(matches[0]!.status, "failed");
  assert.equal(matches[0]!.replayBytes, "9007199254740993");
  assert.equal(matches[0]!.extractionCount, 2);
  assert.deepEqual(matches[0]!.counts, {
    records: "0", combatEvents: "0", blobs: "0", entityInstances: "0", entityEvents: "0",
    propertyUpdates: "0", checkpoints: "0", total: "0",
  });
  assert.equal(matches[1]!.errorCode, "unavailable");
});

test("catalog statistics are independent of list pagination and failed retries", async () => {
  assert.deepEqual(await getCatalogStats(), {
    storedMatches: "2",
    totalRecords: "33",
  });
});

function isCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof BrowserSqlError && error.code === code;
}
