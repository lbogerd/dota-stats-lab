import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-loader-"));
process.env.STAGING_ROOT = path.join(root, "staging");
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");
process.env.MIGRATION_ROOT = path.resolve("src/db/migrations");

const { loadExtraction } = await import("../src/load/load-extraction.js");
const { extractionAlreadyLoaded } = await import("../src/load/preflight.js");
const { DuckDBInstance } = await import("@duckdb/node-api");

const matchId = 42n;
const extractionId = "a".repeat(64);
const replaySha256 = "b".repeat(64);

const goodRows: Record<string, string> = {
  "records.ndjson": JSON.stringify({ extractionId, sequence: 1, demoTick: 10, netTick: 20, gameTime: 1, category: "message", recordType: "test.Message", payload: { native: true } }) + "\n",
  "blobs.ndjson": JSON.stringify({ extractionId, sequence: 2, demoTick: 10, netTick: 20, gameTime: 1, blobId: createHash("sha256").update("x").digest("hex"), recordSequence: 1, fieldPath: "bytes", valueBase64: "eA==" }) + "\n",
  "entity_instances.ndjson": JSON.stringify({ extractionId, sequence: 3, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "1", entityIndex: 7, serial: 1, handle: 16391, classId: 2, className: "CTest" }) + "\n",
  "entity_events.ndjson": JSON.stringify({ extractionId, sequence: 4, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "1", eventType: "create", changedPropertyPaths: [], synthetic: false }) + "\n",
  "property_updates.ndjson": JSON.stringify({ extractionId, sequence: 5, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "1", propertyPath: "m_value", valueType: "int32", value: 7 }) + "\n",
  "checkpoints.ndjson": JSON.stringify({ extractionId, sequence: 6, demoTick: 10, netTick: 20, gameTime: 1, entityInstanceId: "1", checkpointKind: "creation", checkpointGameTime: 1, properties: [{ propertyPath: "m_value", valueType: "int32", value: 7 }] }) + "\n",
};

test("loader imports atomically, supports analysis macros, and is idempotent", async () => {
  await stage(extractionId, goodRows);
  assert.equal((await loadExtraction(matchId)).status, "loaded");

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const counts = await connection.runAndReadAll("SELECT (SELECT count(*) FROM raw.records)::INTEGER n, (SELECT count(*) FROM raw.entity_property_updates)::INTEGER u");
    assert.deepEqual(counts.getRowObjectsJson(), [{ n: 1, u: 1 }]);
    const state = await connection.runAndReadAll(`SELECT property_path, value::VARCHAR AS value FROM analysis.entity_state_at_game_time('${extractionId}', 1, 2)`);
    assert.deepEqual(state.getRowObjectsJson(), [{ property_path: "m_value", value: "7" }]);
  } finally { connection.closeSync(); }

  await stage(extractionId, goodRows);
  assert.equal((await loadExtraction(matchId)).status, "already_loaded");
  assert.equal(await extractionAlreadyLoaded(matchId, replaySha256), true);
});

test("malformed staged JSON rolls back raw data and retains failed staging", async () => {
  const failedId = "c".repeat(64);
  const malformed = Object.fromEntries(Object.keys(goodRows).map((name) => [name, ""])) as Record<string, string>;
  malformed["records.ndjson"] = "{not-json}\n";
  await stage(failedId, malformed);
  await assert.rejects(loadExtraction(matchId));

  const instance = await DuckDBInstance.create(process.env.WAREHOUSE_PATH!);
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll("SELECT count(*)::INTEGER AS n FROM raw.records");
    assert.equal((result.getRowObjectsJson()[0] as { n: number }).n, 1);
  } finally { connection.closeSync(); }
});

async function stage(id: string, rows: Record<string, string>): Promise<void> {
  const directory = path.join(process.env.STAGING_ROOT!, matchId.toString(), id);
  await mkdir(directory, { recursive: true });
  const files: Record<string, unknown> = {};
  const logical: Record<string, string> = {
    records: "records.ndjson", blobs: "blobs.ndjson", entityInstances: "entity_instances.ndjson",
    entityEvents: "entity_events.ndjson", propertyUpdates: "property_updates.ndjson", checkpoints: "checkpoints.ndjson",
  };
  for (const [key, name] of Object.entries(logical)) {
    const body = rows[name]!;
    await writeFile(path.join(directory, name), body);
    files[key] = { path: name, sha256: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body), records: body === "" ? 0 : 1 };
  }
  const now = new Date().toISOString();
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1, extractionId: id, matchId: matchId.toString(), replaySha256,
    parser: { name: "clarity", version: "4.0.1" }, exporterVersion: "0.1.2",
    config: { checkpointIntervalSeconds: 30, maxInputBytes: 2_147_483_648, maxOutputBytes: 12_884_901_888, maxRecords: 50_000_000, timeoutSeconds: 1_800 },
    startedAt: now, completedAt: now, elapsedMs: 1, files, counts: {},
  }));
}
