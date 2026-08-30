import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchNeutralCampFarming } from "../server/neutral-camp-farming";
import type { MatchOverviewPlayer } from "../server/overview";
import {
  formatActionDuration,
  formatActionTime,
  NeutralCampFarmingSection,
} from "./neutral-camp-farming-section";

const getNeutralCampFarming = vi.hoisted(() => vi.fn());

vi.mock("./overview-data.js", () => ({
  matchNeutralCampFarmingQuery: (matchId: string) => ({
    queryKey: ["match-neutral-camp-farming", matchId],
    queryFn: () => getNeutralCampFarming({ matchId }),
    retry: false,
  }),
}));

const players = [player(0, "Ari", 2), player(128, "Dara", 3)];

describe("neutral camp farming formatting", () => {
  it("formats signed game time and millisecond duration", () => {
    expect(formatActionTime(-1_250)).toBe("-0:01.250");
    expect(formatActionTime(61_001)).toBe("1:01.001");
    expect(formatActionDuration(8_000)).toBe("0:08.000");
  });
});

describe("NeutralCampFarmingSection", () => {
  beforeEach(() => {
    getNeutralCampFarming.mockReset();
  });

  it("shows the loading state", () => {
    getNeutralCampFarming.mockReturnValue(new Promise(() => undefined));
    renderSection();

    expect(screen.getByRole("heading", { name: "Neutral camp farming" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading neutral camp farming actions");
  });

  it("distinguishes unavailable and empty extractions", async () => {
    getNeutralCampFarming.mockResolvedValueOnce(response({ available: false }));
    const unavailable = renderSection();
    expect(await screen.findByText(/unavailable for this extraction/)).toBeTruthy();
    unavailable.unmount();

    getNeutralCampFarming.mockResolvedValueOnce(response());
    renderSection();
    expect(await screen.findByText(/no neutral camp farming actions/)).toBeTruthy();
  });

  it("shows every required value in the action table", async () => {
    getNeutralCampFarming.mockResolvedValue(response({
      actions: [{
        extractionId: "ready",
        actionIndex: 0,
        definitionName: "neutral-camp-farming-v1",
        playerSlot: 0,
        campId: 7,
        spawnerHandle: "123",
        campType: 2,
        campWorldX: 50,
        campWorldY: 75,
        startGameTimeMilliseconds: 61_250,
        endGameTimeMilliseconds: 69_250,
        result: "cleared",
        damageEventCount: 4,
        totalDamage: 1_250,
        initialCreepCount: 3,
        deadInitialCreepCount: 3,
      }],
    }));
    renderSection();

    const table = await screen.findByRole("table", { name: "Neutral camp farming actions" });
    for (const heading of [
      "Player", "Start time", "End time", "Duration", "Camp number", "Camp type value",
      "Result", "Damage", "Creep count",
    ]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeTruthy();
    }
    const row = within(table).getAllByRole("row")[1]!;
    expect(row.textContent).toContain("Ari");
    expect(row.textContent).toContain("Axe");
    expect(row.textContent).toContain("1:01.250");
    expect(row.textContent).toContain("1:09.250");
    expect(row.textContent).toContain("0:08.000");
    expect(row.textContent).toContain("7");
    expect(row.textContent).toContain("2");
    expect(row.textContent).toContain("Cleared");
    expect(row.textContent).toContain("1,250");
    expect(row.textContent).toContain("3 / 3");
  });

  it("keeps the phone-width table keyboard-scrollable with a visible focus style", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    getNeutralCampFarming.mockResolvedValue(response({
      actions: [{
        extractionId: "ready", actionIndex: 0, definitionName: "neutral-camp-farming-v1",
        playerSlot: 128, campId: 1, spawnerHandle: "12", campType: 0,
        campWorldX: 0, campWorldY: 0, startGameTimeMilliseconds: 1_000,
        endGameTimeMilliseconds: 1_000, result: "not_cleared", damageEventCount: 1,
        totalDamage: 10, initialCreepCount: 1, deadInitialCreepCount: 0,
      }],
    }));
    renderSection();

    const region = await screen.findByLabelText(
      "Neutral camp farming actions, scroll horizontally for all values",
    );
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain("overflow-x-auto");
    expect(region.className).toContain("focus-visible:outline-2");
    expect(within(region).getByRole("table").className).toContain("min-w-[1040px]");
    region.focus();
    expect(document.activeElement).toBe(region);
  });

  it("shows an error and retries", async () => {
    getNeutralCampFarming
      .mockRejectedValueOnce(new Error("warehouse unavailable"))
      .mockResolvedValueOnce(response());
    renderSection();

    expect((await screen.findByRole("alert")).textContent).toContain("warehouse unavailable");
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry.className).toContain("focus-visible:outline-2");
    fireEvent.click(retry);
    expect((await screen.findByRole("status")).textContent).toContain("no neutral camp farming actions");
    expect(getNeutralCampFarming).toHaveBeenCalledTimes(2);
  });
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <NeutralCampFarmingSection matchId="42" players={players} />
  </QueryClientProvider>);
}

function response(overrides: Partial<MatchNeutralCampFarming> = {}): MatchNeutralCampFarming {
  return { matchId: "42", available: true, actions: [], ...overrides };
}

function player(playerSlot: number, playerName: string, heroId: number): MatchOverviewPlayer {
  const teamId = playerSlot < 128 ? 2 : 3;
  return {
    playerSlot, teamId, playerName, heroId,
    team: teamId === 2 ? "Radiant" : "Dire", teamSlot: teamId === 2 ? playerSlot : playerSlot - 128,
    accountId: null, level: null, kills: null, deaths: null, assists: null, lastHits: null, denies: null,
    goldPerMin: null, xpPerMin: null, netWorth: null, heroDamage: null, towerDamage: null,
    heroHealing: null, items: [],
  };
}
