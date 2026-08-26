import test from "node:test";
import assert from "node:assert/strict";
import { selectMatches } from "../src/sampler/selector.js";
import type { MatchCandidate } from "../src/sampler/types.js";

const windowStart = "2026-08-26T10:00:00.000Z";
const options = { target: 30, priority: 24, control: 6, samplingVersion: "test-v1", windowStart };

test("selector takes the 24 highest known ranks and a deterministic control group", () => {
  const candidates = Array.from({ length: 60 }, (_, index) => candidate(index + 1, index + 20));
  const selected = selectMatches(candidates, options);
  const priority = selected.filter((item) => item.selectionGroup === "priority");
  const control = selected.filter((item) => item.selectionGroup === "control");
  assert.equal(selected.length, 30);
  assert.equal(priority.length, 24);
  assert.equal(control.length, 6);
  assert.deepEqual(priority.map((item) => item.avgRankTier).sort((a, b) => b! - a!),
    Array.from({ length: 24 }, (_, index) => 79 - index));
  assert.equal(new Set(selected.map((item) => item.matchId)).size, 30);

  const reversed = selectMatches([...candidates].reverse(), options);
  assert.deepEqual(reversed.map(identity), selected.map(identity));
});

test("selector fills the target when rank metadata or priority candidates are scarce", () => {
  const candidates = Array.from({ length: 35 }, (_, index) =>
    candidate(index + 1, index < 4 ? 80 - index : undefined));
  const selected = selectMatches(candidates, options);
  assert.equal(selected.length, 30);
  assert.equal(selected.filter((item) => item.selectionGroup === "priority").length, 4);
  assert.equal(selected.filter((item) => item.selectionGroup === "control").length, 6);
  assert.equal(selected.filter((item) => item.selectionGroup === "fill").length, 20);
});

test("selector handles provider shortfalls, duplicate IDs, and foreign windows", () => {
  const correct = Array.from({ length: 8 }, (_, index) => candidate(index + 1, 50));
  const input = [...correct, correct[0]!, { ...candidate(100, 90), windowStart: "2026-08-26T11:00:00.000Z" }];
  const selected = selectMatches(input, options);
  assert.equal(selected.length, 8);
  assert.equal(new Set(selected.map((item) => item.matchId)).size, 8);
});

function candidate(matchId: number, avgRankTier: number | undefined): MatchCandidate {
  return {
    matchId: String(matchId),
    startTime: 1_777_198_400,
    windowStart,
    lobbyType: 7,
    source: "test",
    ...(avgRankTier === undefined ? {} : { avgRankTier }),
  };
}

function identity(item: { matchId: string; selectionGroup: string; selectionHash: string }): string {
  return `${item.matchId}:${item.selectionGroup}:${item.selectionHash}`;
}

