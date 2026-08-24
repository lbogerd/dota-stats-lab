import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readManifest, stagedFiles, validateManifest } from "../src/load/manifest.js";

async function fixture(): Promise<{ dir: string; manifest: Record<string, unknown> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dota-manifest-"));
  const files: Record<string, unknown> = {};
  for (const [logical, name] of Object.entries(stagedFiles)) {
    const body = "";
    await writeFile(path.join(dir, name), body);
    files[logical] = { path: name, sha256: createHash("sha256").update(body).digest("hex"), bytes: 0, records: 0 };
  }
  const manifest = {
    schemaVersion: 1, extractionId: "a".repeat(64), matchId: "42", replaySha256: "b".repeat(64),
    parser: { name: "clarity", version: "1" }, exporterVersion: "1",
    config: { maxOutputBytes: 100, maxRecords: 10 },
    startedAt: new Date(0).toISOString(), completedAt: new Date(1).toISOString(), elapsedMs: 1,
    files, counts: {},
  };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  return { dir, manifest };
}

async function setStagedFile(
  dir: string,
  manifest: Record<string, unknown>,
  logical: keyof typeof stagedFiles,
  body: string,
  records: number,
): Promise<void> {
  await writeFile(path.join(dir, stagedFiles[logical]), body);
  (manifest.files as Record<string, Record<string, unknown>>)[logical] = {
    path: stagedFiles[logical],
    sha256: createHash("sha256").update(body).digest("hex"),
    bytes: Buffer.byteLength(body),
    records,
  };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
}

test("validateManifest accepts the fixed staged-file contract", async () => {
  const { dir } = await fixture();
  assert.equal((await validateManifest(dir, 42n)).matchId, "42");
});

test("validateManifest accepts checksums, bytes, and records from one staged file", async () => {
  const { dir, manifest } = await fixture();
  (manifest.config as Record<string, unknown>).maxOutputBytes = 100;
  (manifest.config as Record<string, unknown>).maxRecords = 10;
  await setStagedFile(dir, manifest, "records", "{\"id\":1}\n{\"id\":2}\n", 2);

  const result = await validateManifest(dir, 42n);
  assert.equal(result.files.records.bytes, 18);
  assert.equal(result.files.records.records, 2);
});

test("validateManifest rejects path injection", async () => {
  const { dir, manifest } = await fixture();
  (manifest.files as Record<string, Record<string, unknown>>).records!.path = "../records.ndjson";
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(validateManifest(dir, 42n), /Invalid manifest file entry/);
});

test("validateManifest rejects a changed staged file", async () => {
  const { dir } = await fixture();
  await writeFile(path.join(dir, stagedFiles.records), "tampered\n");
  await assert.rejects(validateManifest(dir, 42n), /Size mismatch/);
});

test("readManifest inspects metadata without scanning staged files", async () => {
  const { dir } = await fixture();
  await writeFile(path.join(dir, stagedFiles.records), "tampered\n");

  assert.equal((await readManifest(dir, 42n)).matchId, "42");
});

test("validateManifest rejects a checksum mismatch when the size is unchanged", async () => {
  const { dir, manifest } = await fixture();
  await setStagedFile(dir, manifest, "records", "one\n", 1);
  (manifest.files as Record<string, Record<string, unknown>>).records!.sha256 = "c".repeat(64);
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));

  await assert.rejects(validateManifest(dir, 42n), /Checksum mismatch for records\.ndjson/);
});

test("validateManifest rejects a record count mismatch", async () => {
  const { dir, manifest } = await fixture();
  await setStagedFile(dir, manifest, "records", "one\ntwo\n", 1);

  await assert.rejects(validateManifest(dir, 42n), /Record count mismatch for records\.ndjson/);
});

test("validateManifest rejects a non-empty file without a final newline", async () => {
  const { dir, manifest } = await fixture();
  await setStagedFile(dir, manifest, "records", "one", 0);

  await assert.rejects(validateManifest(dir, 42n), /NDJSON file does not end with a newline: records\.ndjson/);
});
