import { describe, expect, it } from "vitest";
import type { MatchOverview } from "../server/overview";
import {
  matchLensSearch,
  parseMatchLensSearch,
  playersInLens,
  resolveMatchLens,
} from "./match-lens";

const match = {
  matchId: "42",
  status: "succeeded",
  summary: { durationSeconds: 120 },
  players: [
    { playerSlot: 0, teamId: 2 },
    { playerSlot: 128, teamId: 3 },
  ],
  teamTotals: [],
  netWorthAnalysis: {},
} as unknown as MatchOverview;

describe("match lens", () => {
  it("defaults to both teams and the entire match", () => {
    const lens = resolveMatchLens(parseMatchLensSearch({}), match);
    expect(lens).toEqual({ scope: { kind: "all" }, startSeconds: 0, endSeconds: 120, durationSeconds: 120 });
    expect(matchLensSearch(lens)).toEqual({ scope: undefined, start: undefined, end: undefined });
  });

  it("resolves a player scope and clamps time to the match", () => {
    const lens = resolveMatchLens(parseMatchLensSearch({ scope: "player-128", start: "20", end: "999" }), match);
    expect(lens).toEqual({
      scope: { kind: "player", playerSlot: 128, teamId: 3 },
      startSeconds: 20,
      endSeconds: 120,
      durationSeconds: 120,
    });
    expect(playersInLens(match.players, lens).map((player) => player.playerSlot)).toEqual([128]);
  });

  it("falls back safely for an unknown scope and inverted range", () => {
    expect(resolveMatchLens({ scope: "player-999", start: 100, end: 20 }, match)).toEqual({
      scope: { kind: "all" },
      startSeconds: 20,
      endSeconds: 100,
      durationSeconds: 120,
    });
  });
});
