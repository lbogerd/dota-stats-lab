import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(os.tmpdir(), "dota-fetch-"));
process.env.REPLAY_ROOT = path.join(directory, "replays");
process.env.MAX_REPLAY_BYTES = "3";
const { fetchReplay } = await import("../src/fetch/fetch-replay.js");

test("direct-file acquisition is checksummed, published atomically, and cached", async () => {
  const source = path.join(directory, "source.dem.bz2");
  await writeFile(source, "abc");
  const first = await fetchReplay(1n, source);
  assert.equal(first.status, "available");
  assert.equal(first.source, "direct_file");
  assert.equal(first.replaySha256, createHash("sha256").update("abc").digest("hex"));
  assert.equal(await readFile(path.join(process.env.REPLAY_ROOT!, "1", "replay.dem.bz2"), "utf8"), "abc");

  await writeFile(source, "changed");
  const second = await fetchReplay(1n, source);
  assert.equal(second.source, "cache");
  assert.equal(second.replayBytes, 3);
});

test("direct-file acquisition enforces the replay size limit", async () => {
  const source = path.join(directory, "large.dem.bz2");
  await writeFile(source, "four");
  await assert.rejects(fetchReplay(2n, source), /MAX_REPLAY_BYTES/);
});
