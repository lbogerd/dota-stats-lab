import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FightListRecord, MatchFights } from "../server/fights.js";
import type { MatchOverviewPlayer } from "../server/overview.js";
import type { MatchLens } from "./match-lens.js";
import { FightsList } from "./fights-list.js";

const getFights = vi.hoisted(() => vi.fn());

vi.mock("./functions.js", () => ({
  getMatchFightsFn: ({ data }: { data: { matchId: string } }) => getFights(data),
  getMatchFightDetailFn: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params, search, ...props }: {
    children: React.ReactNode;
    params: { matchId: string; fightId: string };
    search: (previous: Record<string, unknown>) => Record<string, unknown>;
    [key: string]: unknown;
  }) => {
    const query = new URLSearchParams(search({ scope: "team-2", start: 10 }) as Record<string, string>).toString();
    return <a {...props} href={`/matches/${params.matchId}/fights/${params.fightId}?${query}`}>{children}</a>;
  },
}));

describe("FightsList", () => {
  beforeEach(() => getFights.mockReset());

  it("shows a loading state", async () => {
    let resolveRequest!: (value: MatchFights) => void;
    const request = new Promise<MatchFights>((resolve) => { resolveRequest = resolve; });
    getFights.mockReturnValue(request);
    const view = renderList();
    expect(screen.getByRole("status").textContent).toContain("Loading engagements");
    view.unmount();
    resolveRequest(result());
    await request;
  });

  it("keeps combat-unavailable and lens-empty states distinct", async () => {
    getFights.mockResolvedValueOnce(result({ available: false }));
    const unavailable = renderList();
    expect(await screen.findByTestId("fights-unavailable")).toBeTruthy();
    unavailable.unmount();

    getFights.mockResolvedValueOnce(result());
    renderList();
    expect(await screen.findByTestId("fights-empty")).toBeTruthy();
    expect(screen.getByText(/does not include fights without a hero death/)).toBeTruthy();
  });

  it("shows a retryable server error", async () => {
    getFights.mockRejectedValueOnce(new Error("warehouse unavailable")).mockResolvedValue(result());
    renderList();
    expect((await screen.findByRole("alert")).textContent).toContain("warehouse unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(getFights).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("fights-empty")).toBeTruthy();
  });

  it("orders ready cards and preserves the lens search in detail links", async () => {
    getFights.mockResolvedValue(result({ fights: [fight("20", 80), fight("10", 20)] }));
    renderList();
    const links = await screen.findAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Skirmish at 0:20",
      "Skirmish at 1:20",
    ]);
    expect(links[0]?.getAttribute("href")).toBe("/matches/42/fights/10?scope=team-2&start=10");
  });
});

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <FightsList
      matchId="42"
      players={players}
      lens={lens}
      radiantTeamName={null}
      direTeamName={null}
    />
  </QueryClientProvider>);
}

const players = [
  { playerSlot: 0, teamId: 2, heroId: 2, playerName: "Ari" },
  { playerSlot: 128, teamId: 3, heroId: 3, playerName: "Dara" },
] as MatchOverviewPlayer[];

const lens: MatchLens = {
  scope: { kind: "all" },
  startSeconds: 0,
  endSeconds: 100,
  durationSeconds: 100,
};

function result(overrides: Partial<MatchFights> = {}): MatchFights {
  return { matchId: "42", available: true, fights: [], ...overrides };
}

function fight(fightId: string, firstAnchorTimeSeconds: number): FightListRecord {
  return {
    fightId,
    detectionVersion: "death-anchored-fights-v1",
    type: "skirmish",
    firstAnchorTimeSeconds,
    anchorTimesSeconds: [firstAnchorTimeSeconds],
    combatStartSeconds: firstAnchorTimeSeconds - 5,
    combatEndSeconds: firstAnchorTimeSeconds + 5,
    durationSeconds: 10,
    outcomeEndSeconds: firstAnchorTimeSeconds + 35,
    location: { x: 10, y: 20 },
    locationAvailable: true,
    participants: [
      { playerSlot: 0, teamId: 2, heroId: 2, kills: 1, deaths: 0, assists: 0 },
      { playerSlot: 128, teamId: 3, heroId: 3, kills: 0, deaths: 1, assists: 0 },
    ],
    teams: [
      { teamId: 2, participantSlots: [0], kills: 1, deaths: 0, heroDamage: 500, heroHealing: 0, earnedGoldChange: "200", experienceChange: null, netWorthChange: "180" },
      { teamId: 3, participantSlots: [128], kills: 0, deaths: 1, heroDamage: 100, heroHealing: 0, earnedGoldChange: "0", experienceChange: null, netWorthChange: "-180" },
    ],
    radiantWinProbabilityChange: null,
    winProbabilitySource: null,
    objectives: [],
    availability: { combat: true, healing: true, earnedGold: true, experience: false, netWorth: true, winProbability: false, positions: true },
  };
}
