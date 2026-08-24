import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { paths } from "../config.js";

export async function openWarehouse(readOnly = false): Promise<{ connection: DuckDBConnection; close: () => void }> {
  await mkdir(path.dirname(paths.warehousePath), { recursive: true });
  const commonOptions = { threads: "1", memory_limit: "3GB" };
  const instance = await DuckDBInstance.create(
    paths.warehousePath,
    readOnly ? { ...commonOptions, access_mode: "READ_ONLY" } : commonOptions,
  );
  const connection = await instance.connect();
  return {
    connection,
    close: () => {
      try { connection.closeSync(); } finally { instance.closeSync(); }
    },
  };
}

export async function migrate(connection: DuckDBConnection): Promise<void> {
  await connection.run(`CREATE SCHEMA IF NOT EXISTS catalog;
    CREATE TABLE IF NOT EXISTS catalog.schema_migrations (
      version VARCHAR PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
    )`);
  const files = (await readdir(paths.migrationRoot)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const found = await connection.runAndReadAll("SELECT count(*)::INTEGER AS n FROM catalog.schema_migrations WHERE version = $version", { version: file });
    if ((found.getRowObjects()[0] as { n: number } | undefined)?.n === 1) continue;
    const sql = await readFile(path.join(paths.migrationRoot, file), "utf8");
    await connection.run("BEGIN TRANSACTION");
    try {
      await connection.run(sql);
      await connection.run("INSERT INTO catalog.schema_migrations(version) VALUES ($version)", { version: file });
      await connection.run("COMMIT");
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error;
    }
  }
}
