import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withWarehouseLock } from "../src/db/lock.js";

test("warehouse lock excludes a second writer and is released", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dota-lock-"));
  const warehouse = path.join(directory, "test.duckdb");
  await withWarehouseLock(warehouse, async () => {
    await assert.rejects(withWarehouseLock(warehouse, async () => undefined), /Warehouse is in use/);
  });
  await withWarehouseLock(warehouse, async () => undefined);
});
