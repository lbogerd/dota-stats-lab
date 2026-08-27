import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const stagedFiles = {
  records: "records.ndjson",
  combatEvents: "combat_events.ndjson",
  blobs: "blobs.ndjson",
  entityInstances: "entity_instances.ndjson",
  entityEvents: "entity_events.ndjson",
  propertyUpdates: "property_updates.ndjson",
  checkpoints: "checkpoints.ndjson",
  heroPositions: "hero_positions.ndjson",
  winProbability: "win_probability.ndjson",
} as const;

type FileEntry = { path: string; sha256: string; bytes: number; records: number };
type StagedFile = keyof typeof stagedFiles;
type LegacyStagedFile = Exclude<StagedFile, "heroPositions" | "winProbability">;
type ManifestFiles = Record<LegacyStagedFile, FileEntry>
  & Partial<Record<"heroPositions" | "winProbability", FileEntry>>;
export type Manifest = {
  schemaVersion: 1 | 2 | 3;
  extractionId: string;
  matchId: string;
  replaySha256: string;
  parser: {
    name: string;
    version: string;
    upstreamRelease?: string;
    forkRevision?: string;
  };
  exporterVersion: string;
  config: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  preparationElapsedMs?: number;
  parsingElapsedMs?: number;
  profile?: string;
  files: ManifestFiles;
  counts: Record<string, number>;
  acquisition?: Record<string, unknown>;
};

export async function readManifest(extractionDir: string, expectedMatchId: bigint): Promise<Manifest> {
  const raw = await readFile(path.join(extractionDir, "manifest.json"), "utf8");
  const value: unknown = JSON.parse(raw);
  if (!isObject(value)) throw new Error("Manifest must be a JSON object");
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) {
    throw new Error("Unsupported manifest schemaVersion");
  }
  const schemaVersion = value.schemaVersion;
  const extractionId = stringField(value, "extractionId");
  if (!/^[a-f0-9]{64}$/.test(extractionId)) throw new Error("Invalid extractionId");
  if (stringField(value, "matchId") !== expectedMatchId.toString()) throw new Error("Manifest matchId mismatch");
  if (!/^[a-f0-9]{64}$/.test(stringField(value, "replaySha256"))) throw new Error("Invalid replaySha256");
  if (!isObject(value.parser) || !isObject(value.config) || !isObject(value.files) || !isObject(value.counts)) {
    throw new Error("Manifest is missing required objects");
  }
  stringField(value.parser, "name");
  const parserVersion = stringField(value.parser, "version");
  if ("upstreamRelease" in value.parser || "forkRevision" in value.parser) {
    stringField(value.parser, "upstreamRelease");
    if (stringField(value.parser, "forkRevision") !== parserVersion) {
      throw new Error("Manifest parser version and fork revision differ");
    }
  }
  stringField(value, "exporterVersion"); stringField(value, "startedAt"); stringField(value, "completedAt");
  numberField(value, "elapsedMs");

  let totalBytes = 0;
  let totalRecords = 0;
  const requiredFiles = Object.entries(stagedFiles).filter(([logical]) => (
    logical !== "heroPositions" && logical !== "winProbability"
  ) || (logical === "heroPositions" && schemaVersion >= 2)
    || (logical === "winProbability" && schemaVersion >= 3));
  for (const [logical, expectedName] of requiredFiles) {
    const entry = value.files[logical];
    if (!isObject(entry) || stringField(entry, "path") !== expectedName) throw new Error(`Invalid manifest file entry: ${logical}`);
    const expectedHash = stringField(entry, "sha256");
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error(`Invalid checksum for ${logical}`);
    const bytes = numberField(entry, "bytes");
    const records = numberField(entry, "records");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(records) || records < 0) throw new Error(`Invalid counts for ${logical}`);
    totalBytes += bytes;
    totalRecords += records;
  }
  const maxOutputBytes = numberField(value.config, "maxOutputBytes");
  const maxRecords = numberField(value.config, "maxRecords");
  if (totalBytes > maxOutputBytes) throw new Error("Staged files exceed manifest output limit");
  if (totalRecords > maxRecords) throw new Error("Staged files exceed manifest record limit");
  if (value.schemaVersion === 1) delete value.files.heroPositions;
  if (value.schemaVersion < 3) delete value.files.winProbability;
  return value as unknown as Manifest;
}

export async function validateManifest(extractionDir: string, expectedMatchId: bigint): Promise<Manifest> {
  const manifest = await readManifest(extractionDir, expectedMatchId);
  for (const [logical, expectedName] of manifestFileEntries(manifest)) {
    const expected = manifest.files[logical];
    if (expected === undefined) continue;
    const file = path.join(extractionDir, expectedName);
    const info = await stat(file);
    if (!info.isFile() || info.size !== expected.bytes) throw new Error(`Size mismatch for ${expectedName}`);
    const actual = await inspectFile(file);
    if (actual.bytes !== expected.bytes) throw new Error(`Size mismatch for ${expectedName}`);
    if (actual.sha256 !== expected.sha256) throw new Error(`Checksum mismatch for ${expectedName}`);
    if (actual.bytes > 0 && !actual.endsWithNewline) throw new Error(`NDJSON file does not end with a newline: ${expectedName}`);
    if (actual.records !== expected.records) throw new Error(`Record count mismatch for ${expectedName}`);
  }
  return manifest;
}

export function manifestFileEntries(manifest: Manifest): Array<[StagedFile, string]> {
  return Object.entries(stagedFiles).filter(
    ([logical]) => (logical !== "heroPositions" || manifest.schemaVersion >= 2)
      && (logical !== "winProbability" || manifest.schemaVersion >= 3),
  ) as Array<[StagedFile, string]>;
}

async function inspectFile(file: string): Promise<{
  sha256: string;
  bytes: number;
  records: number;
  endsWithNewline: boolean;
}> {
  const hash = createHash("sha256");
  let bytes = 0;
  let records = 0;
  let endsWithNewline = false;
  for await (const chunk of createReadStream(file)) {
    const data = chunk as Buffer;
    hash.update(data);
    bytes += data.length;
    for (const byte of data) if (byte === 10) records++;
    if (data.length > 0) endsWithNewline = data[data.length - 1] === 10;
  }
  return { sha256: hash.digest("hex"), bytes, records, endsWithNewline };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringField(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string" || value[key] === "") throw new Error(`Manifest ${key} must be a non-empty string`);
  return value[key];
}
function numberField(value: Record<string, unknown>, key: string): number {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) throw new Error(`Manifest ${key} must be a finite number`);
  return value[key];
}
