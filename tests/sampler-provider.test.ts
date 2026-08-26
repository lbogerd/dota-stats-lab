import test from "node:test";
import assert from "node:assert/strict";
import { parsePublicMatchesPage, PublicMatchesProvider } from "../src/sampler/provider.js";

test("public match parser rejects bad records and keeps only ranked lobbies", () => {
  const page = parsePublicMatchesPage([
    { match_id: 9001, start_time: 1_777_198_461, lobby_type: 7, avg_rank_tier: 81, duration: 2400 },
    { match_id: 9000, start_time: 1_777_198_400, lobby_type: 0, avg_rank_tier: null },
    { match_id: "8999", start_time: 1_777_198_300, lobby_type: 7, avg_rank_tier: null },
    { match_id: -1, start_time: "yesterday", lobby_type: 7 },
    null,
  ]);
  assert.equal(page.rawCount, 5);
  assert.equal(page.invalidCount, 2);
  assert.deepEqual(page.candidates.map((item) => item.matchId), ["9001", "8999"]);
  assert.equal(page.candidates[0]?.windowStart, "2026-04-26T10:00:00.000Z");
  assert.equal(page.oldestMatchId, "8999");
  assert.equal(page.oldestStartTime, 1_777_198_300);
});

test("provider retries transient failures and sends the pagination cursor", async () => {
  const urls: string[] = [];
  let requests = 0;
  const provider = new PublicMatchesProvider({
    baseUrl: "https://example.test/publicMatches",
    retryAttempts: 2,
    timeoutMs: 5_000,
    fetch: (async (input: string | URL | Request) => {
      urls.push(String(input));
      requests += 1;
      if (requests === 1) return new Response("busy", { status: 503 });
      return Response.json([{ match_id: 8000, start_time: 1_777_198_400, lobby_type: 7 }]);
    }) as typeof fetch,
  });
  const page = await provider.fetchPage("8100");
  assert.equal(page.candidates.length, 1);
  assert.equal(requests, 2);
  assert.ok(urls.every((url) => url.includes("less_than_match_id=8100")));
});

test("provider rejects a non-array response", () => {
  assert.throws(() => parsePublicMatchesPage({ matches: [] }), /must be an array/);
});
