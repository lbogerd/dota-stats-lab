import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import os from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(os.tmpdir(), "dota-fetch-"));
process.env.REPLAY_ROOT = path.join(directory, "replays");
process.env.MAX_REPLAY_BYTES = "64";
process.env.FETCH_RETRY_ATTEMPTS = "3";
process.env.FETCH_RETRY_BASE_MS = "1";
process.env.FETCH_RETRY_MAX_MS = "2";
const { fetchReplay } = await import("../src/fetch/fetch-replay.js");
const compressedReplay = Buffer.from("BZh-test-replay");
const uncompressedReplay = Buffer.from("PBDEMS2\0test-replay");

test("direct-file acquisition uses magic, preserves provenance, and validates cache hits", async () => {
  const source = path.join(directory, "source.dem");
  await writeFile(source, compressedReplay);
  const first = await fetchReplay(1n, source);
  assert.equal(first.status, "available");
  assert.equal(first.source, "direct_file");
  assert.equal(first.replaySha256, createHash("sha256").update(compressedReplay).digest("hex"));
  assert.deepEqual(await readFile(path.join(process.env.REPLAY_ROOT!, "1", "replay.dem.bz2")), compressedReplay);

  await writeFile(source, uncompressedReplay);
  const second = await fetchReplay(1n, source);
  assert.equal(second.source, "direct_file");
  assert.equal(second.cacheHit, true);
  assert.equal(second.acquiredAt, first.acquiredAt);
  assert.equal(second.replayBytes, compressedReplay.length);
});

test("uncompressed replay content is published as .dem regardless of input filename", async () => {
  const source = path.join(directory, "misnamed.dem.bz2");
  await writeFile(source, uncompressedReplay);
  const acquisition = await fetchReplay(2n, source);
  assert.equal(acquisition.status, "available");
  assert.equal(acquisition.replayPath, path.join(process.env.REPLAY_ROOT!, "2", "replay.dem"));
  assert.deepEqual(await readFile(path.join(process.env.REPLAY_ROOT!, "2", "replay.dem")), uncompressedReplay);
  await assert.rejects(stat(path.join(process.env.REPLAY_ROOT!, "2", "replay.dem.bz2")), /ENOENT/);
});

test("sampled acquisitions store the selection metadata for the parser manifest", async () => {
  const source = path.join(directory, "sampled.dem.bz2");
  await writeFile(source, compressedReplay);
  const sampling = {
    windowStart: "2026-08-26T10:00:00.000Z",
    selectionGroup: "priority" as const,
    avgRankTier: 82,
    source: "opendota-public-matches",
    samplingVersion: "ranked-v1",
  };
  const acquisition = await fetchReplay(13n, source, sampling);
  assert.deepEqual(acquisition.sampling, sampling);
  const stored = JSON.parse(await readFile(
    path.join(process.env.REPLAY_ROOT!, "13", "acquisition.json"),
    "utf8",
  ));
  assert.deepEqual(stored.sampling, sampling);
});

test("direct-file acquisition enforces the replay size limit", async () => {
  const source = path.join(directory, "large.dem.bz2");
  await writeFile(source, Buffer.concat([Buffer.from("BZh"), Buffer.alloc(62)]));
  await assert.rejects(fetchReplay(3n, source), /MAX_REPLAY_BYTES/);
});

test("a corrupt cache entry is rejected against acquisition metadata and reacquired", async () => {
  const firstSource = path.join(directory, "cache-first.dem.bz2");
  const replacementSource = path.join(directory, "cache-replacement.dem.bz2");
  await writeFile(firstSource, compressedReplay);
  await writeFile(replacementSource, Buffer.from("BZh-replacement"));
  await fetchReplay(4n, firstSource);
  const sameSizeCorruption = Buffer.from(compressedReplay);
  sameSizeCorruption[sameSizeCorruption.length - 1] = sameSizeCorruption.at(-1)! ^ 1;
  await writeFile(path.join(process.env.REPLAY_ROOT!, "4", "replay.dem.bz2"), sameSizeCorruption);

  const reacquired = await fetchReplay(4n, replacementSource);
  assert.equal(reacquired.cacheHit, undefined);
  assert.equal(reacquired.source, "direct_file");
  assert.deepEqual(
    await readFile(path.join(process.env.REPLAY_ROOT!, "4", "replay.dem.bz2")),
    Buffer.from("BZh-replacement"),
  );
});

test("unsupported and empty local replay inputs fail clearly", async () => {
  const unsupported = path.join(directory, "unsupported.dem");
  const empty = path.join(directory, "empty.dem");
  await writeFile(unsupported, "not a replay");
  await writeFile(empty, "");
  await assert.rejects(fetchReplay(5n, unsupported), /unsupported file format/);
  await assert.rejects(fetchReplay(6n, empty), /Replay is empty/);
});

test("HTTP replay downloads retry transient server responses with bounded Retry-After-aware backoff", async () => {
  let requests = 0;
  await withServer((_, response) => {
    requests += 1;
    if (requests < 3) { response.writeHead(503, { "retry-after": "1" }); response.end(); return; }
    response.writeHead(200, { "content-length": String(compressedReplay.length) });
    response.end(compressedReplay);
  }, async (url) => {
    const acquisition = await fetchReplay(7n, url);
    assert.equal(acquisition.status, "available");
    assert.equal(acquisition.replayBytes, compressedReplay.length);
    assert.equal(requests, 3);
    assert.deepEqual(await readFile(path.join(process.env.REPLAY_ROOT!, "7", "replay.dem.bz2")), compressedReplay);

    const cached = await fetchReplay(7n, "http://127.0.0.1:1/not-used");
    assert.equal(cached.cacheHit, true);
    assert.equal(cached.source, "direct_url");
    assert.equal(cached.replayUrl, url);
    assert.equal(cached.acquiredAt, acquisition.acquiredAt);
    const stored = JSON.parse(await readFile(path.join(process.env.REPLAY_ROOT!, "7", "acquisition.json"), "utf8"));
    assert.equal(stored.source, "direct_url");
    assert.equal(stored.replayUrl, url);
  });
});

test("exhausted network retries preserve the underlying socket error in the job-facing message", async () => {
  let requests = 0;
  await withServer((request) => {
    requests += 1;
    request.socket.destroy();
  }, async (url) => {
    await assert.rejects(fetchReplay(8n, url), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Replay download temporarily failed after 3 attempts/);
      assert.match(error.message, /Replay download network error/);
      assert.match(error.message, /fetch failed|UND_ERR_SOCKET|other side closed/);
      assert.ok(error.cause instanceof Error);
      return true;
    });
    assert.equal(requests, 3);
    const acquisition = JSON.parse(await readFile(path.join(process.env.REPLAY_ROOT!, "8", "acquisition.json"), "utf8")) as { status: string; error: string };
    assert.equal(acquisition.status, "error");
    assert.match(acquisition.error, /Replay download temporarily failed after 3 attempts/);
    assert.match(acquisition.error, /fetch failed|UND_ERR_SOCKET|other side closed/);
  });
});

test("permanent replay HTTP errors do not retry", async () => {
  let unavailableRequests = 0;
  await withServer((_, response) => {
    unavailableRequests += 1;
    response.writeHead(404); response.end();
  }, async (url) => {
    const acquisition = await fetchReplay(9n, url);
    assert.equal(acquisition.status, "replay_unavailable");
    assert.equal(unavailableRequests, 1);
  });

  let forbiddenRequests = 0;
  await withServer((_, response) => {
    forbiddenRequests += 1;
    response.writeHead(403); response.end();
  }, async (url) => {
    await assert.rejects(fetchReplay(10n, url), /Replay download failed: HTTP 403/);
    assert.equal(forbiddenRequests, 1);
  });
});

test("OpenDota metadata retries temporary failures and distinguishes unavailable matches", async () => {
  let metadataRequests = 0;
  await withServer((request, response) => {
    if (request.url === "/matches/11") {
      metadataRequests += 1;
      if (metadataRequests === 1) {
        response.writeHead(429, { "retry-after": "1" }); response.end(); return;
      }
      const address = request.headers.host;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ replay_url: `http://${address}/replay` }));
      return;
    }
    if (request.url === "/matches/12") {
      response.writeHead(404); response.end(); return;
    }
    if (request.url === "/replay") {
      response.writeHead(200, { "content-length": String(compressedReplay.length) });
      response.end(compressedReplay); return;
    }
    response.writeHead(500); response.end();
  }, async (url) => {
    process.env.OPENDOTA_API_BASE_URL = new URL(url).origin;
    try {
      const available = await fetchReplay(11n);
      assert.equal(available.status, "available");
      assert.equal(available.source, "opendota");
      assert.equal(metadataRequests, 2);

      const unavailable = await fetchReplay(12n);
      assert.equal(unavailable.status, "replay_unavailable");
      assert.equal(unavailable.source, "opendota");
    } finally { delete process.env.OPENDOTA_API_BASE_URL; }
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
