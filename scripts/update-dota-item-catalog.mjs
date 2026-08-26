#!/usr/bin/env node

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERATED_PATH,
  ITEM_SOURCE_URL,
  PATCH_SOURCE_URL,
  SNAPSHOT_DIRECTORY,
  buildCatalog,
  catalogVersion,
  compareSnapshots,
  imageUrl,
  loadOverrides,
  loadSnapshots,
  parseSourceSnapshot,
  sha256,
  snapshotFilename,
  stableJson,
} from "./dota-item-catalog-lib.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_IMAGE_REQUESTS = 6;
const MAX_ATTEMPTS = 3;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
      if (![408, 425, 429].includes(response.status) && response.status < 500) return response;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) await wait(250 * attempt);
  }
  throw new Error(`The request failed after ${MAX_ATTEMPTS} attempts: ${url}\n${lastError?.message}`);
}

async function getCurrentSources() {
  const [itemResponse, patchResponse] = await Promise.all([
    fetchWithRetry(ITEM_SOURCE_URL),
    fetchWithRetry(PATCH_SOURCE_URL),
  ]);
  if (!itemResponse.ok) throw new Error(`The item-list request failed with status ${itemResponse.status}.`);
  if (!patchResponse.ok) throw new Error(`The patch-list request failed with status ${patchResponse.status}.`);
  const raw = Buffer.from(await itemResponse.arrayBuffer());
  parseSourceSnapshot(raw, "The downloaded item snapshot");
  const patchDocument = await patchResponse.json();
  if (!Array.isArray(patchDocument.patches) || patchDocument.patches.length === 0) {
    throw new Error("The Valve patch list does not contain a patch.");
  }
  const patch = [...patchDocument.patches]
    .filter((entry) => typeof entry.patch_number === "string" && Number.isFinite(entry.patch_timestamp))
    .sort((left, right) => left.patch_timestamp - right.patch_timestamp)
    .at(-1);
  if (patch === undefined) throw new Error("The Valve patch list does not contain a valid patch.");
  return { raw, gamePatch: patch.patch_number };
}

async function mapWithLimit(values, limit, operation) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function checkImages(items) {
  const itemsByUrl = new Map();
  for (const item of items) {
    const url = imageUrl(item.imageSlug);
    const matchingItems = itemsByUrl.get(url) ?? [];
    matchingItems.push(item);
    itemsByUrl.set(url, matchingItems);
  }
  const urls = [...itemsByUrl.keys()];
  const checks = await mapWithLimit(urls, MAX_IMAGE_REQUESTS, async (url) => {
    try {
      const response = await fetchWithRetry(url, { method: "HEAD" });
      const contentType = response.headers.get("content-type") ?? "";
      return { url, available: response.ok && contentType.toLowerCase().startsWith("image/"), status: response.status, contentType };
    } catch (error) {
      return { url, available: false, status: null, contentType: "", error: error.message };
    }
  });
  return checks.flatMap((check) => check.available ? [] : itemsByUrl.get(check.url).map((item) => ({
    id: item.id,
    internalName: item.internalName,
    url: check.url,
    status: check.status,
    contentType: check.contentType,
    error: check.error,
  })));
}

function printChanges(changes) {
  console.log(`Added items: ${changes.added.length}`);
  for (const id of changes.added) console.log(`  ADD ${id}`);
  console.log(`Removed items: ${changes.removed.length}`);
  for (const id of changes.removed) console.log(`  REMOVE ${id}`);
  console.log(`Changed items: ${changes.changed.length}`);
  for (const item of changes.changed) console.log(`  CHANGE ${item.id} ${JSON.stringify(item.changes)}`);
}

async function writeAtomic(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, value);
  await rename(temporary, filename);
}

async function main() {
  const overrides = await loadOverrides(rootDirectory);
  const existingSnapshots = await loadSnapshots(rootDirectory);
  const { raw, gamePatch } = await getCurrentSources();
  const sourceSha256 = sha256(raw);
  const version = catalogVersion(gamePatch, sourceSha256);
  const existing = existingSnapshots.find((snapshot) => snapshot.catalogVersion === version);
  const sequence = existing?.sequence ?? ((existingSnapshots.at(-1)?.sequence ?? 0) + 1);
  const filename = snapshotFilename(sequence, version);
  const candidate = existing ?? {
    sequence,
    catalogVersion: version,
    gamePatch,
    hashPrefix: sourceSha256.slice(0, 12),
    filename,
    raw,
    sourceSha256,
    sourceItems: parseSourceSnapshot(raw, filename),
  };
  if (existing !== undefined && existingSnapshots.at(-1)?.catalogVersion !== version) {
    throw new Error("The downloaded source matches an older snapshot. Refuse to change the active catalog.");
  }
  const snapshots = existing === undefined ? [...existingSnapshots, candidate] : existingSnapshots;
  const catalog = buildCatalog(snapshots, version, overrides);
  const changes = compareSnapshots(existingSnapshots.at(-1), candidate, overrides);

  console.log(`Catalog version: ${version}`);
  console.log(`Source SHA-256: ${sourceSha256}`);
  console.log(`Catalog items: ${catalog.itemCount}`);
  printChanges(changes);
  console.log(`Check ${new Set(catalog.items.map((item) => item.imageSlug)).size} unique CDN image URLs (limit ${MAX_IMAGE_REQUESTS}).`);
  const unavailableImages = await checkImages(catalog.items);
  console.log(`Unavailable images: ${unavailableImages.length}`);
  for (const image of unavailableImages) {
    console.log(`  IMAGE ${image.id} ${image.internalName} status=${image.status ?? "network-error"} type=${image.contentType || "none"} ${image.url}`);
    if (image.error !== undefined) console.log(`    ${image.error}`);
  }

  await mkdir(path.join(rootDirectory, SNAPSHOT_DIRECTORY), { recursive: true });
  if (existing === undefined) {
    await writeAtomic(path.join(rootDirectory, SNAPSHOT_DIRECTORY, filename), raw);
  }
  await writeAtomic(path.join(rootDirectory, GENERATED_PATH), stableJson(catalog));
  console.log(`Wrote ${filename} and ${GENERATED_PATH}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
