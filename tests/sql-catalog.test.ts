import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-sql-catalog-"));
const warehousePath = path.join(root, "warehouse", "dota.duckdb");
process.env.WAREHOUSE_PATH = warehousePath;

await mkdir(path.dirname(warehousePath), { recursive: true });
const writer = await DuckDBInstance.create(warehousePath);
const connection = await writer.connect();
await connection.run(`
  CREATE SCHEMA raw;
  CREATE SCHEMA catalog;
  CREATE SCHEMA analysis;
  CREATE SCHEMA private_data;

  CREATE TABLE raw.z_events (event_id BIGINT, payload JSON);
  CREATE TABLE raw.records (match_id UBIGINT, label VARCHAR, score DECIMAL(10,2));
  CREATE TABLE catalog.extractions (extraction_id VARCHAR);
  CREATE VIEW analysis.record_scores AS
    SELECT match_id, score FROM raw.records;

  CREATE MACRO analysis.add_score(score, bonus := 1) AS score + bonus;
  CREATE MACRO analysis.recent_records(row_limit) AS TABLE
    SELECT * FROM raw.records LIMIT row_limit;
  CREATE MACRO private_data.hidden_macro(value) AS value;
`);
connection.closeSync();
writer.closeSync();

const { getSqlCatalog } = await import("../src/server/sql-catalog.js");
const { withReadOnlyWarehouse } = await import("../src/server/warehouse.js");

test("SQL catalog returns sorted project schemas, tables, and views", async () => {
  const catalog = await getSqlCatalog();

  assert.deepEqual(catalog.schemas.map((schema) => schema.name), ["analysis", "catalog", "raw"]);
  assert.deepEqual(catalog.schemas[0]!.relations, [{
    name: "record_scores",
    kind: "view",
    columns: [
      { name: "match_id", dataType: "UBIGINT" },
      { name: "score", dataType: "DECIMAL(10,2)" },
    ],
  }]);
  assert.deepEqual(catalog.schemas[2]!.relations.map((relation) => relation.name), ["records", "z_events"]);
});

test("SQL catalog preserves column ordinal positions and DuckDB data types", async () => {
  const catalog = await getSqlCatalog();
  const raw = catalog.schemas.find((schema) => schema.name === "raw");
  const records = raw?.relations.find((relation) => relation.name === "records");

  assert.deepEqual(records, {
    name: "records",
    kind: "table",
    columns: [
      { name: "match_id", dataType: "UBIGINT" },
      { name: "label", dataType: "VARCHAR" },
      { name: "score", dataType: "DECIMAL(10,2)" },
    ],
  });
});

test("SQL catalog returns sorted scalar and table macros with ordered parameters", async () => {
  const catalog = await getSqlCatalog();
  const analysis = catalog.schemas.find((schema) => schema.name === "analysis");

  assert.deepEqual(analysis?.macros, [
    { name: "add_score", kind: "scalar", parameters: ["score", "bonus"] },
    { name: "recent_records", kind: "table", parameters: ["row_limit"] },
  ]);
});

test("SQL catalog excludes non-project schemas and built-in functions", async () => {
  const catalog = await getSqlCatalog();

  assert.equal(catalog.schemas.some((schema) => schema.name === "private_data"), false);
  assert.equal(catalog.schemas.some((schema) => schema.name === "information_schema"), false);
  assert.equal(catalog.schemas.flatMap((schema) => schema.macros).some((macro) => macro.name === "hidden_macro"), false);
  assert.equal(catalog.schemas.flatMap((schema) => schema.macros).some((macro) => macro.name === "abs"), false);
});

test("SQL catalog uses the existing locked, read-only warehouse connection", async () => {
  await withReadOnlyWarehouse(async (readOnlyConnection) => {
    const settings = await readOnlyConnection.runAndReadAll(`
      SELECT name, value
      FROM duckdb_settings()
      WHERE name IN ('access_mode', 'enable_external_access', 'lock_configuration')`);

    assert.deepEqual(Object.fromEntries(settings.getRowsJson()), {
      access_mode: "read_only",
      enable_external_access: "false",
      lock_configuration: "true",
    });
    await assert.rejects(getSqlCatalog(), /Warehouse is in use/);
  });
});
