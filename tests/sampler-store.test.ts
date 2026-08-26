import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { selectMatches } from "../src/sampler/selector.js";
import { SamplerStore } from "../src/sampler/store.js";
import type { MatchCandidate } from "../src/sampler/types.js";

const windowStart = "2026-08-26T10:00:00.000Z";

test("sampler store deduplicates candidates and preserves finalized selections across restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dota-sampler-store-"));
  const database = path.join(root, "sampler.duckdb");
  const candidates = Array.from({ length: 32 }, (_, index) => candidate(index + 1, index + 30));

  const first = new SamplerStore(database);
  await first.open();
  await first.upsertCandidates([...candidates, candidates[0]!]);
  await first.setState("latest_seen_match_id", "32");
  assert.deepEqual(await first.listFinalizableWindows("2026-08-26T12:00:00.000Z"), [windowStart]);
  const selections = selectMatches(await first.getCandidates(windowStart), {
    target: 30, priority: 24, control: 6, samplingVersion: "test-v1", windowStart,
  });
  assert.equal(await first.finalizeWindow(windowStart, selections, 30), true);
  assert.equal(await first.finalizeWindow(windowStart, selections, 30), false);
  assert.equal((await first.summary()).candidates, 32);
  first.close();

  const restarted = new SamplerStore(database);
  await restarted.open();
  assert.equal(await restarted.getState("latest_seen_match_id"), "32");
  assert.equal((await restarted.listPendingSelections()).length, 30);
  await restarted.markEnqueued(selections[0]!.matchId, "00000000-0000-4000-8000-000000000000");
  assert.equal((await restarted.listPendingSelections()).length, 29);
  assert.deepEqual(await restarted.listFinalizableWindows("2026-08-27T00:00:00.000Z"), []);
  const summary = await restarted.summary();
  assert.deepEqual(summary, { candidates: 32, rankedCandidates: 32, selected: 30, enqueued: 1, windowsUnderTarget: 0 });
  restarted.close();
});

test("sampler store records a closed hour with no visible ranked candidates as under target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dota-sampler-empty-window-"));
  const store = new SamplerStore(path.join(root, "sampler.duckdb"));
  await store.open();
  const emptyWindow = "2026-08-26T09:00:00.000Z";
  await store.ensureWindows([emptyWindow]);
  assert.deepEqual(await store.listFinalizableWindows("2026-08-26T10:30:00.000Z"), [emptyWindow]);
  assert.equal(await store.finalizeWindow(emptyWindow, [], 30), true);
  assert.equal((await store.summary()).windowsUnderTarget, 1);
  store.close();
});

function candidate(matchId: number, avgRankTier: number): MatchCandidate {
  return {
    matchId: String(matchId),
    startTime: 1_777_264_400,
    windowStart,
    lobbyType: 7,
    avgRankTier,
    source: "test",
  };
}
