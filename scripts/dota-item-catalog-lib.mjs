import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const ITEM_SOURCE_URL = "https://www.dota2.com/datafeed/itemlist?language=english";
export const PATCH_SOURCE_URL = "https://www.dota2.com/datafeed/patchnoteslist?language=english";
export const ITEM_CDN_ROOT = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items";
export const SNAPSHOT_DIRECTORY = "data/dota/items/snapshots";
export const OVERRIDES_PATH = "data/dota/items/overrides.json";
export const GENERATED_PATH = "src/web/dota-items.generated.json";

const SNAPSHOT_NAME = /^(\d+)-(dota-([0-9]+\.[0-9]+[a-z]?)\+([a-f0-9]{12}))\.json$/;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function catalogVersion(gamePatch, sourceSha256) {
  if (!/^[0-9]+\.[0-9]+[a-z]?$/.test(gamePatch)) {
    throw new Error(`The game patch is not valid: ${gamePatch}`);
  }
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw new Error("The source SHA-256 hash is not valid.");
  }
  return `dota-${gamePatch}+${sourceSha256.slice(0, 12)}`;
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

export function parseSourceSnapshot(raw, label = "The source snapshot") {
  let document;
  try {
    document = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }

  assertObject(document, label);
  assertObject(document.result, `${label} result`);
  assertObject(document.result.data, `${label} result.data`);
  const sourceItems = document.result.data.itemabilities;
  if (!Array.isArray(sourceItems)) {
    throw new Error(`${label} result.data.itemabilities must be an array.`);
  }
  if (sourceItems.length === 0) {
    throw new Error(`${label} does not contain an item.`);
  }

  const ids = new Set();
  for (const [index, item] of sourceItems.entries()) {
    const itemLabel = `${label} item ${index}`;
    assertObject(item, itemLabel);
    if (!Number.isSafeInteger(item.id) || item.id <= 0) {
      throw new Error(`${itemLabel} has an invalid ID.`);
    }
    if (ids.has(item.id)) {
      throw new Error(`${label} has duplicate item ID ${item.id}.`);
    }
    ids.add(item.id);
    if (typeof item.name !== "string" || item.name.trim() === "") {
      throw new Error(`${itemLabel} has an empty internal name.`);
    }
    if (typeof item.neutral_item_tier !== "number" || !Number.isInteger(item.neutral_item_tier)) {
      throw new Error(`${itemLabel} has an invalid neutral item tier.`);
    }
    if (!Array.isArray(item.recipes)) {
      throw new Error(`${itemLabel} has an invalid recipes field.`);
    }
  }
  return sourceItems;
}

export function parseSnapshotFilename(filename) {
  const match = SNAPSHOT_NAME.exec(filename);
  if (match === null) return null;
  return {
    sequence: Number(match[1]),
    catalogVersion: match[2],
    gamePatch: match[3],
    hashPrefix: match[4],
  };
}

export function snapshotFilename(sequence, version) {
  return `${String(sequence).padStart(4, "0")}-${version}.json`;
}

export async function loadOverrides(rootDirectory) {
  const filename = path.join(rootDirectory, OVERRIDES_PATH);
  const overrides = JSON.parse(await readFile(filename, "utf8"));
  assertObject(overrides, "The item overrides");
  if (overrides.schemaVersion !== 1) {
    throw new Error("The item overrides schema version must be 1.");
  }
  assertObject(overrides.imageSlugs, "The image-slug overrides");
  assertObject(overrides.imageSlugs.byId, "The image-slug ID overrides");
  assertObject(overrides.imageSlugs.byInternalNamePrefix, "The image-slug prefix overrides");
  assertObject(overrides.internalNameChanges, "The internal-name overrides");
  return overrides;
}

export async function loadSnapshots(rootDirectory) {
  const directory = path.join(rootDirectory, SNAPSHOT_DIRECTORY);
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  const snapshots = [];
  for (const filename of filenames) {
    const metadata = parseSnapshotFilename(filename);
    if (metadata === null) {
      throw new Error(`The snapshot filename is not valid: ${filename}`);
    }
    const filenamePath = path.join(directory, filename);
    const raw = await readFile(filenamePath);
    const sourceSha256 = sha256(raw);
    if (!sourceSha256.startsWith(metadata.hashPrefix)) {
      throw new Error(`The snapshot hash does not agree with its filename: ${filename}`);
    }
    if (catalogVersion(metadata.gamePatch, sourceSha256) !== metadata.catalogVersion) {
      throw new Error(`The snapshot version does not agree with its filename: ${filename}`);
    }
    snapshots.push({ ...metadata, filename, raw, sourceSha256, sourceItems: parseSourceSnapshot(raw, filename) });
  }
  snapshots.sort((left, right) => left.sequence - right.sequence);
  const sequences = new Set();
  for (const snapshot of snapshots) {
    if (sequences.has(snapshot.sequence)) {
      throw new Error(`More than one snapshot has sequence ${snapshot.sequence}.`);
    }
    sequences.add(snapshot.sequence);
  }
  return snapshots;
}

function wordsFromInternalName(internalName) {
  return internalName
    .replace(/^item_/, "")
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fallbackName(internalName) {
  if (internalName.startsWith("item_recipe_")) {
    return `${wordsFromInternalName(internalName.replace(/^item_recipe_/, "item_"))} Recipe`;
  }
  return wordsFromInternalName(internalName);
}

export function resolveImageSlug(itemId, internalName, overrides) {
  const idOverride = overrides.imageSlugs.byId[String(itemId)];
  if (idOverride !== undefined) {
    assertObject(idOverride, `The image-slug override for item ${itemId}`);
    if (typeof idOverride.imageSlug !== "string" || idOverride.imageSlug.trim() === "") {
      throw new Error(`The image-slug override for item ${itemId} is not valid.`);
    }
    if (typeof idOverride.reason !== "string" || idOverride.reason.trim() === "") {
      throw new Error(`The image-slug override for item ${itemId} needs a reason.`);
    }
    return idOverride.imageSlug;
  }

  const matchingPrefixes = Object.entries(overrides.imageSlugs.byInternalNamePrefix)
    .filter(([prefix]) => internalName.startsWith(prefix))
    .sort(([left], [right]) => right.length - left.length);
  if (matchingPrefixes.length > 0) {
    const [prefix, prefixOverride] = matchingPrefixes[0];
    assertObject(prefixOverride, `The image-slug override for prefix ${prefix}`);
    if (typeof prefixOverride.imageSlug !== "string" || prefixOverride.imageSlug.trim() === "") {
      throw new Error(`The image-slug override for prefix ${prefix} is not valid.`);
    }
    if (typeof prefixOverride.reason !== "string" || prefixOverride.reason.trim() === "") {
      throw new Error(`The image-slug override for prefix ${prefix} needs a reason.`);
    }
    return prefixOverride.imageSlug;
  }

  return internalName.replace(/^item_/, "");
}

export function normalizeSourceItem(sourceItem, overrides) {
  const internalName = sourceItem.name.trim();
  const localizedName = [sourceItem.name_english_loc, sourceItem.name_loc]
    .find((value) => typeof value === "string" && value.trim() !== "");
  return {
    id: sourceItem.id,
    name: localizedName?.trim() ?? fallbackName(internalName),
    internalName,
    imageSlug: resolveImageSlug(sourceItem.id, internalName, overrides),
    neutralTier: sourceItem.neutral_item_tier,
    recipe: internalName.startsWith("item_recipe_"),
  };
}

function renameIsAllowed(itemId, from, to, overrides) {
  const changes = overrides.internalNameChanges[String(itemId)] ?? [];
  if (!Array.isArray(changes)) {
    throw new Error(`The internal-name override for item ${itemId} must be an array.`);
  }
  return changes.some((change) => {
    assertObject(change, `An internal-name override for item ${itemId}`);
    if (typeof change.reason !== "string" || change.reason.trim() === "") {
      throw new Error(`An internal-name override for item ${itemId} needs a reason.`);
    }
    return change.from === from && change.to === to;
  });
}

export function buildCatalog(snapshots, currentVersion, overrides) {
  if (snapshots.length === 0) {
    throw new Error("At least one item snapshot is required.");
  }
  const currentSnapshot = snapshots.at(-1);
  if (currentSnapshot.catalogVersion !== currentVersion) {
    throw new Error("The selected item snapshot must be the most recent snapshot.");
  }

  const histories = new Map();
  for (const snapshot of snapshots) {
    for (const sourceItem of snapshot.sourceItems) {
      const item = normalizeSourceItem(sourceItem, overrides);
      const history = histories.get(item.id);
      if (history !== undefined && history.item.internalName !== item.internalName
          && !renameIsAllowed(item.id, history.item.internalName, item.internalName, overrides)) {
        throw new Error(
          `Item ${item.id} changed its internal name from ${history.item.internalName} to ${item.internalName}. `
          + "Add a documented internalNameChanges override to continue.",
        );
      }
      histories.set(item.id, {
        firstSeenVersion: history?.firstSeenVersion ?? snapshot.catalogVersion,
        lastSeenVersion: snapshot.catalogVersion,
        item,
      });
    }
  }

  const activeIds = new Set(currentSnapshot.sourceItems.map((item) => item.id));
  const items = [...histories.values()]
    .map(({ item, firstSeenVersion, lastSeenVersion }) => ({
      ...item,
      active: activeIds.has(item.id),
      firstSeenVersion,
      lastSeenVersion,
    }))
    .sort((left, right) => left.id - right.id);

  return {
    schemaVersion: 1,
    catalogVersion: currentSnapshot.catalogVersion,
    gamePatch: currentSnapshot.gamePatch,
    sourceSha256: currentSnapshot.sourceSha256,
    sourceUrl: ITEM_SOURCE_URL,
    itemCount: items.length,
    items,
  };
}

export function compareSnapshots(previousSnapshot, currentSnapshot, overrides) {
  const previous = new Map((previousSnapshot?.sourceItems ?? []).map((item) => {
    const normalized = normalizeSourceItem(item, overrides);
    return [normalized.id, normalized];
  }));
  const current = new Map(currentSnapshot.sourceItems.map((item) => {
    const normalized = normalizeSourceItem(item, overrides);
    return [normalized.id, normalized];
  }));
  const added = [...current.keys()].filter((id) => !previous.has(id)).sort((a, b) => a - b);
  const removed = [...previous.keys()].filter((id) => !current.has(id)).sort((a, b) => a - b);
  const changed = [];
  for (const [id, currentItem] of current) {
    const previousItem = previous.get(id);
    if (previousItem === undefined) continue;
    const changes = {};
    for (const field of ["name", "internalName", "imageSlug", "neutralTier", "recipe"]) {
      if (previousItem[field] !== currentItem[field]) {
        changes[field] = { from: previousItem[field], to: currentItem[field] };
      }
    }
    if (Object.keys(changes).length > 0) changed.push({ id, changes });
  }
  changed.sort((left, right) => left.id - right.id);
  return { added, removed, changed };
}

export function imageUrl(imageSlug) {
  return `${ITEM_CDN_ROOT}/${encodeURIComponent(imageSlug)}.png`;
}
