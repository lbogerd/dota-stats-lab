import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchHeroDamageTimeline } from "../server/damage-by-source";
import type { MatchOverviewPlayer } from "../server/overview";
import { DamageBySourceSection, formatDamageTime } from "./damage-by-source-section";

const getDamageBySource = vi.hoisted(() => vi.fn());

vi.mock("./overview-data.js", () => ({
  matchDamageBySourceQuery: (matchId: string, playerSlot: number) => ({
    queryKey: ["match-damage-by-source", matchId, playerSlot],
    queryFn: () => getDamageBySource({ matchId, playerSlot }),
    retry: false,
  }),
}));

vi.mock("./damage-by-source-chart.js", () => ({
  DamageBySourceChart: ({ intervals, selectedStartSeconds, onSelectInterval }: {
    intervals: MatchHeroDamageTimeline["intervals"];
    selectedStartSeconds?: number;
    onSelectInterval: (startSeconds: number) => void;
  }) => <div data-testid="damage-chart" data-selected={selectedStartSeconds}>
    {intervals.map((interval) => <button
      key={interval.startSeconds}
      type="button"
      onClick={() => onSelectInterval(interval.startSeconds)}
    >Select {interval.startSeconds}</button>)}
  </div>,
}));

const players = [player(0, 2, "Ari", 2), player(128, 3, "Dara", 3)];

describe("damage time", () => {
  it("formats negative and positive game time with optional milliseconds", () => {
    expect(formatDamageTime(-5.25, true)).toBe("-0:05.250");
    expect(formatDamageTime(65.125, true)).toBe("1:05.125");
    expect(formatDamageTime(30)).toBe("0:30");
  });
});

describe("DamageBySourceSection", () => {
  beforeEach(() => {
    getDamageBySource.mockReset();
  });

  it("selects the first roster player by default and shows loading", () => {
    getDamageBySource.mockReturnValue(new Promise(() => undefined));
    renderSection();

    expect((screen.getByLabelText("Damage target hero") as HTMLSelectElement).value).toBe("0");
    expect(screen.getByRole("option", { name: "Ari · Axe · Radiant" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading damage by source");
    expect(getDamageBySource).toHaveBeenCalledWith({ matchId: "42", playerSlot: 0 });
  });

  it("uses a new query key and result when the hero changes", async () => {
    getDamageBySource.mockImplementation(({ playerSlot }: { playerSlot: number }) => Promise.resolve(
      timeline({
        playerSlot,
        target: { heroId: playerSlot === 0 ? 2 : 3, heroName: playerSlot === 0 ? "Axe" : "Bane", playerName: null, teamId: playerSlot === 0 ? 2 : 3 },
      }),
    ));
    renderSection();
    expect((await screen.findByText(/Showing/)).textContent).toContain("Axe");

    fireEvent.change(screen.getByLabelText("Damage target hero"), { target: { value: "128" } });

    await waitFor(() => expect(getDamageBySource).toHaveBeenCalledWith({ matchId: "42", playerSlot: 128 }));
    expect((await screen.findByText(/Showing/)).textContent).toContain("Bane");
  });

  it("shows unavailable and empty states", async () => {
    getDamageBySource.mockResolvedValueOnce(timeline({ available: false, target: null, intervals: [], totalDamage: 0 }));
    const unavailable = renderSection();
    expect(await screen.findByText(/no usable combat-log timeline/)).toBeTruthy();
    unavailable.unmount();

    getDamageBySource.mockResolvedValueOnce(timeline({ intervals: [], totalDamage: 0 }));
    renderSection();
    expect(await screen.findByText(/no recorded combat-log damage events/)).toBeTruthy();
  });

  it("shows an error and retries the request", async () => {
    getDamageBySource
      .mockRejectedValueOnce(new Error("warehouse unavailable"))
      .mockResolvedValueOnce(timeline());
    renderSection();

    expect((await screen.findByRole("alert")).textContent).toContain("warehouse unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("damage-chart")).toBeTruthy();
    expect(getDamageBySource).toHaveBeenCalledTimes(2);
  });

  it("shows the chart, complete hierarchy, and exact events for the selected interval", async () => {
    getDamageBySource.mockResolvedValue(timeline());
    renderSection();

    const chart = await screen.findByTestId("damage-chart");
    expect(chart.getAttribute("data-selected")).toBe("30");
    expect(screen.getByText("Interval 0:30–1:00")).toBeTruthy();
    expect(screen.getByText("Phantom Lancer")).toBeTruthy();
    expect(screen.getByText("via Phantom Lancer illusion")).toBeTruthy();
    expect(screen.getByText("Attack")).toBeTruthy();
    expect(screen.getByText("0:35.125")).toBeTruthy();
    expect(screen.getAllByText("80 combat-log damage").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Select -30" }));
    expect(screen.getByText("Interval -0:30–0:00")).toBeTruthy();
    expect(screen.getByText("Enchantress")).toBeTruthy();
    expect(screen.getByText("via Centaur Conqueror")).toBeTruthy();
    expect(screen.getByText("War Stomp")).toBeTruthy();
    expect(screen.getByText("-0:05.250")).toBeTruthy();
    expect(screen.getAllByText("120 combat-log damage").length).toBeGreaterThan(0);
  });
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <DamageBySourceSection matchId="42" players={players} />
  </QueryClientProvider>);
}

function timeline(overrides: Partial<MatchHeroDamageTimeline> = {}): MatchHeroDamageTimeline {
  return {
    matchId: "42",
    playerSlot: 0,
    intervalSeconds: 30,
    available: true,
    target: { heroId: 2, heroName: "Axe", playerName: "Ari", teamId: 2 },
    totalDamage: 200,
    intervals: [
      {
        startSeconds: -30,
        endSeconds: 0,
        totalDamage: 120,
        sources: [{
          rawName: "npc_dota_hero_enchantress",
          label: "Enchantress",
          damage: 120,
          via: [{
            rawName: "npc_dota_neutral_centaur_khan",
            label: "Centaur Conqueror",
            kind: "unit",
            damage: 120,
            mechanisms: [{
              rawName: "enchantress_war_stomp",
              label: "War Stomp",
              damage: 120,
              events: [{ sequence: "10", gameTimeSeconds: -5.25, rawTimeSeconds: 85.25, damage: 120, attackerTeam: 2, damageType: 2, spellGeneratedAttack: false }],
            }],
          }],
        }],
      },
      {
        startSeconds: 30,
        endSeconds: 60,
        totalDamage: 80,
        sources: [{
          rawName: "npc_dota_hero_phantom_lancer",
          label: "Phantom Lancer",
          damage: 80,
          via: [{
            rawName: "npc_dota_hero_phantom_lancer",
            label: "Phantom Lancer illusion",
            kind: "illusion",
            damage: 80,
            mechanisms: [{
              rawName: null,
              label: "Attack",
              damage: 80,
              events: [{ sequence: "20", gameTimeSeconds: 35.125, rawTimeSeconds: 125.125, damage: 80, attackerTeam: 3, damageType: 1, spellGeneratedAttack: false }],
            }],
          }],
        }],
      },
    ],
    ...overrides,
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
