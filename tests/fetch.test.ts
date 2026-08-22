import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import os from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(os.tmpdir(), "dota-fetch-"));
process.env.REPLAY_ROOT = path.join(directory, "replays");
process.env.MAX_REPLAY_BYTES = "3";
process.env.FETCH_RETRY_ATTEMPTS = "3";
process.env.FETCH_RETRY_BASE_MS = "1";
process.env.FETCH_RETRY_MAX_MS = "2";
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

test("HTTP replay downloads retry transient server responses with bounded Pacer backoff", async () => {
  let requests = 0;
  await withServer((_, response) => {
    requests += 1;
    if (requests < 3) { response.writeHead(503); response.end(); return; }
    response.writeHead(200, { "content-length": "3" });
    response.end("abc");
  }, async (url) => {
    const acquisition = await fetchReplay(3n, url);
    assert.equal(acquisition.status, "available");
    assert.equal(acquisition.replayBytes, 3);
    assert.equal(requests, 3);
    assert.equal(await readFile(path.join(process.env.REPLAY_ROOT!, "3", "replay.dem.bz2"), "utf8"), "abc");
  });
});

test("exhausted network retries preserve the underlying socket error in the job-facing message", async () => {
  let requests = 0;
  await withServer((request) => {
    requests += 1;
    request.socket.destroy();
  }, async (url) => {
    await assert.rejects(fetchReplay(4n, url), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Replay download failed after 3 attempts/);
      assert.match(error.message, /Replay network error/);
      assert.match(error.message, /fetch failed|UND_ERR_SOCKET|other side closed/);
      assert.ok(error.cause instanceof Error);
      return true;
    });
    assert.equal(requests, 3);
    const acquisition = JSON.parse(await readFile(path.join(process.env.REPLAY_ROOT!, "4", "acquisition.json"), "utf8")) as { error: string };
    assert.match(acquisition.error, /Replay download failed after 3 attempts/);
    assert.match(acquisition.error, /fetch failed|UND_ERR_SOCKET|other side closed/);
  });
});

test("permanent replay HTTP errors do not retry", async () => {
  let unavailableRequests = 0;
  await withServer((_, response) => {
    unavailableRequests += 1;
    response.writeHead(404); response.end();
  }, async (url) => {
    const acquisition = await fetchReplay(5n, url);
    assert.equal(acquisition.status, "replay_unavailable");
    assert.equal(unavailableRequests, 1);
  });

  let forbiddenRequests = 0;
  await withServer((_, response) => {
    forbiddenRequests += 1;
    response.writeHead(403); response.end();
  }, async (url) => {
    await assert.rejects(fetchReplay(6n, url), /Replay download failed: HTTP 403/);
    assert.equal(forbiddenRequests, 1);
  });
});

async function withServer(listener: RequestListener, run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}/replay.dem.bz2`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
