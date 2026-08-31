import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MatchOverview, MatchOverviewPlayer } from "../server/overview";
import { MatchScoreboard } from "./match-scoreboard";
import type { MatchLens } from "./match-lens";

const match: MatchOverview = {
  matchId: "42",
  status: "succeeded",
  summary: {
    matchId: "42",
    extractionId: "extraction-42",
    startTime: null,
    durationSeconds: 120,
    gameMode: null,
    lobbyType: null,
    lobbyTypeName: null,
    winnerTeamId: 2,
    winnerTeam: "Radiant",
    radiantScore: 20,
    direScore: 10,
    radiantTeamName: null,
    direTeamName: null,
    cluster: null,
    firstBloodSeconds: null,
  },
  players: [player(0, 2, "Radiant player"), player(128, 3, "Dire player")],
  teamTotals: [],
  netWorthAnalysis: {
    radiantNetWorth: null,
    direNetWorth: null,
    advantage: null,
    leader: null,
  },
};

describe("MatchScoreboard", () => {
  it("keeps the final scoreboard available for a partial time lens", () => {
    const lens: MatchLens = {
      scope: { kind: "all" },
      startSeconds: 0,
      endSeconds: 10,
      durationSeconds: 120,
    };

    render(<MatchScoreboard match={match} lens={lens} />);

    expect(screen.getByRole("heading", { name: "Radiant" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dire" })).toBeTruthy();
    expect(screen.queryByText("The final scoreboard is outside the selected time range.")).toBeNull();
  });
});

function player(playerSlot: number, teamId: number, playerName: string): MatchOverviewPlayer {
  return {
    playerSlot,
    teamId,
    team: teamId === 2 ? "Radiant" : "Dire",
    teamSlot: teamId === 2 ? playerSlot : playerSlot - 128,
    accountId: null,
    playerName,
    heroId: null,
    level: 1,
    kills: 0,
    deaths: 0,
    assists: 0,
    lastHits: 0,
    denies: 0,
    goldPerMin: 0,
    xpPerMin: 0,
    netWorth: 0,
    heroDamage: 0,
    towerDamage: 0,
    heroHealing: 0,
    items: [],
  };
}
