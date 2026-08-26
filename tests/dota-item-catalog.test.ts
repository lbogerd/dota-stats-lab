import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const rootDirectory = process.cwd();
const generatedPath = path.join(rootDirectory, "src/web/dota-items.generated.json");
const snapshotDirectory = path.join(rootDirectory, "data/dota/items/snapshots");

async function readCatalog(): Promise<Record<string, unknown> & { items: Array<Record<string, unknown>> }> {
  return JSON.parse(await readFile(generatedPath, "utf8"));
}

async function readCurrentSnapshot(catalogVersion: unknown): Promise<Buffer> {
  const filenames = await readdir(snapshotDirectory);
  const filename = filenames.find((name) => name.endsWith(`-${catalogVersion}.json`));
  assert.ok(filename, `No snapshot exists for ${catalogVersion}.`);
  return readFile(path.join(snapshotDirectory, filename));
}

test("the source snapshot has the Valve item-list schema", async () => {
  const catalog = await readCatalog();
  const raw = await readCurrentSnapshot(catalog.catalogVersion);
  const source = JSON.parse(raw.toString("utf8"));
  assert.ok(Array.isArray(source.result?.data?.itemabilities));
  const activeItems = catalog.items.filter((item) => item.active === true);
  assert.equal(source.result.data.itemabilities.length, activeItems.length);
  assert.ok(catalog.items.length >= activeItems.length);
  for (const item of source.result.data.itemabilities) {
    assert.ok(Number.isSafeInteger(item.id) && item.id > 0);
    assert.ok(typeof item.name === "string" && item.name.length > 0);
    assert.ok(Number.isInteger(item.neutral_item_tier));
    assert.ok(Array.isArray(item.recipes));
  }
});

test("the generated catalog has unique, complete, stable records", async () => {
  const catalog = await readCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.itemCount, catalog.items.length);
  const ids = catalog.items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort((left, right) => Number(left) - Number(right)));
  for (const item of catalog.items) {
    assert.ok(typeof item.name === "string" && item.name.trim() !== "");
    assert.ok(typeof item.imageSlug === "string" && item.imageSlug.trim() !== "");
  }
});

test("the source hash agrees and offline regeneration is deterministic", async () => {
  const catalog = await readCatalog();
  const raw = await readCurrentSnapshot(catalog.catalogVersion);
  assert.equal(createHash("sha256").update(raw).digest("hex"), catalog.sourceSha256);
  const output = execFileSync(process.execPath, ["scripts/verify-dota-item-catalog.mjs"], {
    cwd: rootDirectory,
    encoding: "utf8",
  });
  assert.match(output, new RegExp(`Verified ${catalog.itemCount} items`));
});
