#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERATED_PATH,
  buildCatalog,
  loadOverrides,
  loadSnapshots,
  stableJson,
} from "./dota-item-catalog-lib.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function verifyCatalogSchema(catalog) {
  assert.equal(catalog.schemaVersion, 1, "The catalog schema version must be 1.");
  assert.match(catalog.catalogVersion, /^dota-[0-9]+\.[0-9]+[a-z]?\+[a-f0-9]{12}$/);
  assert.match(catalog.gamePatch, /^[0-9]+\.[0-9]+[a-z]?$/);
  assert.match(catalog.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(catalog.sourceUrl, "https://www.dota2.com/datafeed/itemlist?language=english");
  assert.equal(catalog.itemCount, catalog.items.length, "itemCount must equal the item array length.");
  const ids = new Set();
  let previousId = 0;
  for (const item of catalog.items) {
    assert.ok(Number.isSafeInteger(item.id) && item.id > 0, `Item ${item.id} has an invalid ID.`);
    assert.ok(!ids.has(item.id), `Item ID ${item.id} is not unique.`);
    assert.ok(item.id > previousId, `Item ${item.id} is not in stable numeric order.`);
    assert.ok(typeof item.name === "string" && item.name.trim() !== "", `Item ${item.id} has an empty name.`);
    assert.ok(typeof item.internalName === "string" && item.internalName.startsWith("item_"), `Item ${item.id} has an invalid internal name.`);
    assert.ok(typeof item.imageSlug === "string" && item.imageSlug.trim() !== "", `Item ${item.id} has an empty image slug.`);
    assert.ok(Number.isInteger(item.neutralTier), `Item ${item.id} has an invalid neutral tier.`);
    assert.equal(typeof item.recipe, "boolean", `Item ${item.id} has an invalid recipe flag.`);
    assert.equal(typeof item.active, "boolean", `Item ${item.id} has an invalid active flag.`);
    assert.match(item.firstSeenVersion, /^dota-/);
    assert.match(item.lastSeenVersion, /^dota-/);
    ids.add(item.id);
    previousId = item.id;
  }
}

function verifyRetirement(overrides) {
  const firstVersion = "dota-1.00+111111111111";
  const secondVersion = "dota-1.01+222222222222";
  const item = { id: 7, name: "item_test", name_loc: "Test Item", name_english_loc: "Test Item", neutral_item_tier: -1, recipes: [] };
  const base = { sequence: 1, catalogVersion: firstVersion, gamePatch: "1.00", sourceSha256: "1".repeat(64), sourceItems: [item] };
  const next = { sequence: 2, catalogVersion: secondVersion, gamePatch: "1.01", sourceSha256: "2".repeat(64), sourceItems: [] };
  const retired = buildCatalog([base, next], secondVersion, overrides).items[0];
  assert.equal(retired.active, false, "An absent historical item must be inactive.");
  assert.equal(retired.firstSeenVersion, firstVersion);
  assert.equal(retired.lastSeenVersion, firstVersion);
}

async function main() {
  const overrides = await loadOverrides(rootDirectory);
  const snapshots = await loadSnapshots(rootDirectory);
  assert.ok(snapshots.length > 0, "At least one source snapshot is required.");
  const current = snapshots.at(-1);
  const generatedPath = path.join(rootDirectory, GENERATED_PATH);
  const generatedText = await readFile(generatedPath, "utf8");
  const generated = JSON.parse(generatedText);
  const firstGeneration = buildCatalog(snapshots, current.catalogVersion, overrides);
  const secondGeneration = buildCatalog(snapshots, current.catalogVersion, overrides);

  verifyCatalogSchema(generated);
  assert.equal(generated.sourceSha256, current.sourceSha256, "The source hash does not agree with the current snapshot.");
  assert.equal(stableJson(firstGeneration), stableJson(secondGeneration), "A second generation changed the catalog.");
  assert.equal(generatedText, stableJson(firstGeneration), "The generated catalog does not agree with its snapshots.");
  verifyRetirement(overrides);
  console.log(`Verified ${generated.itemCount} items in ${generated.catalogVersion}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
