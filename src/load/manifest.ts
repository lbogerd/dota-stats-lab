import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sha256File } from "../lib/hash.js";

export const stagedFiles = {
  records: "records.ndjson",
  blobs: "blobs.ndjson",
  entityInstances: "entity_instances.ndjson",
  entityEvents: "entity_events.ndjson",
  propertyUpdates: "property_updates.ndjson",
  checkpoints: "checkpoints.ndjson",
} as const;

type FileEntry = { path: string; sha256: string; bytes: number; records: number };
export type Manifest = {
  schemaVersion: 1;
  extractionId: string;
  matchId: string;
  replaySha256: string;
  parser: { name: string; version: string };
  exporterVersion: string;
  config: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  files: Record<keyof typeof stagedFiles, FileEntry>;
  counts: Record<string, number>;
  acquisition?: Record<string, unknown>;
};

export async function validateManifest(extractionDir: string, expectedMatchId: bigint): Promise<Manifest> {
  const raw = await readFile(path.join(extractionDir, "manifest.json"), "utf8");
  const value: unknown = JSON.parse(raw);
  if (!isObject(value)) throw new Error("Manifest must be a JSON object");
  if (value.schemaVersion !== 1) throw new Error("Unsupported manifest schemaVersion");
  const extractionId = stringField(value, "extractionId");
  if (!/^[a-f0-9]{64}$/.test(extractionId)) throw new Error("Invalid extractionId");
  if (stringField(value, "matchId") !== expectedMatchId.toString()) throw new Error("Manifest matchId mismatch");
  if (!/^[a-f0-9]{64}$/.test(stringField(value, "replaySha256"))) throw new Error("Invalid replaySha256");
  if (!isObject(value.parser) || !isObject(value.config) || !isObject(value.files) || !isObject(value.counts)) {
    throw new Error("Manifest is missing required objects");
  }
  stringField(value.parser, "name"); stringField(value.parser, "version");
  stringField(value, "exporterVersion"); stringField(value, "startedAt"); stringField(value, "completedAt");
  numberField(value, "elapsedMs");

  let totalBytes = 0;
  let totalRecords = 0;
  for (const [logical, expectedName] of Object.entries(stagedFiles)) {
    const entry = value.files[logical];
    if (!isObject(entry) || stringField(entry, "path") !== expectedName) throw new Error(`Invalid manifest file entry: ${logical}`);
    const expectedHash = stringField(entry, "sha256");
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error(`Invalid checksum for ${logical}`);
    const bytes = numberField(entry, "bytes");
    const records = numberField(entry, "records");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(records) || records < 0) throw new Error(`Invalid counts for ${logical}`);
    const file = path.join(extractionDir, expectedName);
    const info = await stat(file);
    if (!info.isFile() || info.size !== bytes) throw new Error(`Size mismatch for ${expectedName}`);
    if (await sha256File(file) !== expectedHash) throw new Error(`Checksum mismatch for ${expectedName}`);
    if (await lineCount(file) !== records) throw new Error(`Record count mismatch for ${expectedName}`);
    totalBytes += bytes;
    totalRecords += records;
  }
  const maxOutputBytes = numberField(value.config, "maxOutputBytes");
  const maxRecords = numberField(value.config, "maxRecords");
  if (totalBytes > maxOutputBytes) throw new Error("Staged files exceed manifest output limit");
  if (totalRecords > maxRecords) throw new Error("Staged files exceed manifest record limit");
  return value as unknown as Manifest;
}

async function lineCount(file: string): Promise<number> {
  let count = 0;
  let bytes = 0;
  let last = 0;
  for await (const chunk of createReadStream(file)) {
    const data = chunk as Buffer;
    bytes += data.length;
    for (const byte of data) if (byte === 10) count++;
    if (data.length > 0) last = data[data.length - 1]!;
  }
  if (bytes > 0 && last !== 10) throw new Error(`NDJSON file does not end with a newline: ${path.basename(file)}`);
  return count;
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
