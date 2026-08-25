import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withWarehouseLock } from "../src/db/lock.js";

test("warehouse lock queues a second writer and is released", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dota-lock-"));
  const warehouse = path.join(directory, "test.duckdb");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const order: string[] = [];
  const first = withWarehouseLock(warehouse, async () => { order.push("first"); await gate; });
  while (order.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = withWarehouseLock(warehouse, async () => { order.push("second"); });
  assert.deepEqual(order, ["first"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
  await withWarehouseLock(warehouse, async () => undefined);
});
