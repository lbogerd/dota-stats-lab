import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchRollingGpm } from "../server/gpm";
import type { MatchOverviewPlayer } from "../server/overview";
import { GpmSection } from "./gpm-section";

const getRollingGpm = vi.hoisted(() => vi.fn());

vi.mock("./overview-data.js", () => ({
  matchRollingGpmQuery: (matchId: string, windowSeconds: number, outputStepSeconds = 1) => ({
    queryKey: ["match-rolling-gpm", matchId, windowSeconds, outputStepSeconds],
    queryFn: () => getRollingGpm({ matchId, windowSeconds, outputStepSeconds }),
    retry: false,
  }),
}));

const players = [player(0, 2, "Ari", 2), player(128, 3, "Dara", 3)];

describe("GpmSection", () => {
  beforeEach(() => {
    getRollingGpm.mockReset();
  });

  it("defaults to 60 seconds and shows a loading state", () => {
    getRollingGpm.mockReturnValue(new Promise(() => undefined));
    renderSection();

    expect((screen.getByLabelText("Rolling GPM window") as HTMLSelectElement).value).toBe("60");
    expect(screen.getByRole("status").textContent).toContain("Loading rolling GPM");
  });

  it("changes the query key with the window and switches the five-line team view", async () => {
    getRollingGpm.mockImplementation(({ windowSeconds }: { windowSeconds: number }) => Promise.resolve(gpmData(windowSeconds)));
    renderSection();

    expect(await screen.findByText("Rolling GPM - last 60 seconds")).toBeTruthy();
    expect(screen.getByText("Ari · Axe")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Rolling GPM window"), { target: { value: "10" } });
    expect(await screen.findByText("Rolling GPM - last 10 seconds")).toBeTruthy();
    expect(getRollingGpm).toHaveBeenCalledWith({ matchId: "42", windowSeconds: 10, outputStepSeconds: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Dire" }));
    expect(screen.getByText("Dire player rolling GPM")).toBeTruthy();
    expect(screen.getByText("Dara · Bane")).toBeTruthy();
    expect(screen.queryByText("Ari · Axe")).toBeNull();
  });

  it("explains when an older extraction has no granular data", async () => {
    getRollingGpm.mockResolvedValue({
      matchId: "42", windowSeconds: 60, outputStepSeconds: 1, players: [], teams: [],
    } satisfies MatchRollingGpm);
    renderSection();
    expect(await screen.findByText(/Re-extract the replay with the current parser/)).toBeTruthy();
  });

  it("shows a retryable error state", async () => {
    getRollingGpm.mockRejectedValue(new Error("warehouse unavailable"));
    renderSection();
    expect((await screen.findByRole("alert")).textContent).toContain("warehouse unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <GpmSection matchId="42" players={players} radiantName="Radiant" direName="Dire" />
  </QueryClientProvider>);
}

function gpmData(windowSeconds: number): MatchRollingGpm {
  if (![1, 5, 10, 30, 60, 300].includes(windowSeconds)) throw new Error("invalid test window");
  const points = [{ gameTimeSeconds: windowSeconds, gpm: 500 }];
  return {
    matchId: "42",
    windowSeconds: windowSeconds as MatchRollingGpm["windowSeconds"],
    outputStepSeconds: 1,
    teams: [{ teamId: 2, points }, { teamId: 3, points }],
    players: [{ playerSlot: 0, teamId: 2, points }, { playerSlot: 128, teamId: 3, points }],
  };
}

function player(playerSlot: number, teamId: number, playerName: string, heroId: number): MatchOverviewPlayer {
  return {
    playerSlot, teamId, playerName, heroId,
    team: teamId === 2 ? "Radiant" : "Dire", teamSlot: teamId === 2 ? playerSlot : playerSlot - 128,
    accountId: null, level: null, kills: null, deaths: null, assists: null, lastHits: null, denies: null,
    goldPerMin: null, xpPerMin: null, netWorth: null, heroDamage: null, towerDamage: null, heroHealing: null,
    items: [],
  };
}
