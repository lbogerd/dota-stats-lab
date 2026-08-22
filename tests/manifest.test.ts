import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stagedFiles, validateManifest } from "../src/load/manifest.js";

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
    config: { maxOutputBytes: 1, maxRecords: 1 },
    startedAt: new Date(0).toISOString(), completedAt: new Date(1).toISOString(), elapsedMs: 1,
    files, counts: {},
  };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  return { dir, manifest };
}

test("validateManifest accepts the fixed staged-file contract", async () => {
  const { dir } = await fixture();
  assert.equal((await validateManifest(dir, 42n)).matchId, "42");
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
