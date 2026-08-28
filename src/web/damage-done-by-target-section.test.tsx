import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchHeroDamageDoneTimeline } from "../server/damage-done-by-target";
import type { MatchOverviewPlayer } from "../server/overview";
import { DamageDoneByTargetSection, formatDamageDoneTime } from "./damage-done-by-target-section";

const getDamageDoneByTarget = vi.hoisted(() => vi.fn());

vi.mock("./overview-data.js", () => ({
  matchDamageDoneByTargetQuery: (matchId: string, playerSlot: number) => ({
    queryKey: ["match-damage-done-by-target", matchId, playerSlot],
    queryFn: () => getDamageDoneByTarget({ matchId, playerSlot }),
    retry: false,
  }),
}));

vi.mock("./damage-done-by-target-chart.js", () => ({
  DamageDoneByTargetChart: ({ intervals, selectedStartSeconds, onSelectInterval }: {
    intervals: MatchHeroDamageDoneTimeline["intervals"];
    selectedStartSeconds?: number;
    onSelectInterval: (startSeconds: number) => void;
  }) => <div data-testid="damage-done-chart" data-selected={selectedStartSeconds}>
    {intervals.map((interval) => <button
      key={interval.startSeconds}
      type="button"
      onClick={() => onSelectInterval(interval.startSeconds)}
    >Select {interval.startSeconds}</button>)}
  </div>,
}));

const players = [player(0, 2, "Ari", 2), player(128, 3, "Dara", 3)];

describe("damage-done time", () => {
  it("formats negative and positive game time with optional milliseconds", () => {
    expect(formatDamageDoneTime(-5.25, true)).toBe("-0:05.250");
    expect(formatDamageDoneTime(65.125, true)).toBe("1:05.125");
    expect(formatDamageDoneTime(30)).toBe("0:30");
  });
});

describe("DamageDoneByTargetSection", () => {
  beforeEach(() => {
    getDamageDoneByTarget.mockReset();
  });

  it("selects the first roster player by default and shows loading", () => {
    getDamageDoneByTarget.mockReturnValue(new Promise(() => undefined));
    renderSection();

    expect((screen.getByLabelText("Damage dealer hero") as HTMLSelectElement).value).toBe("0");
    expect(screen.getByRole("option", { name: "Ari · Axe · Radiant" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading damage done by target");
    expect(getDamageDoneByTarget).toHaveBeenCalledWith({ matchId: "42", playerSlot: 0 });
  });

  it("uses a new query key and result when the hero changes", async () => {
    getDamageDoneByTarget.mockImplementation(({ playerSlot }: { playerSlot: number }) => Promise.resolve(
      timeline({
        playerSlot,
        dealer: { heroId: playerSlot === 0 ? 2 : 3, heroName: playerSlot === 0 ? "Axe" : "Bane", playerName: null, teamId: playerSlot === 0 ? 2 : 3 },
      }),
    ));
    renderSection();
    expect((await screen.findByText(/Showing/)).textContent).toContain("Axe");

    fireEvent.change(screen.getByLabelText("Damage dealer hero"), { target: { value: "128" } });

    await waitFor(() => expect(getDamageDoneByTarget).toHaveBeenCalledWith({ matchId: "42", playerSlot: 128 }));
    expect((await screen.findByText(/Showing/)).textContent).toContain("Bane");
  });

  it("shows unavailable and empty states", async () => {
    getDamageDoneByTarget.mockResolvedValueOnce(timeline({ available: false, dealer: null, intervals: [], totalDamage: 0 }));
    const unavailable = renderSection();
    expect(await screen.findByText(/no usable combat-log timeline or the selected hero cannot be resolved/)).toBeTruthy();
    unavailable.unmount();

    getDamageDoneByTarget.mockResolvedValueOnce(timeline({ intervals: [], totalDamage: 0 }));
    renderSection();
    expect(await screen.findByText(/no recorded combat-log damage done/)).toBeTruthy();
  });

  it("shows an error and retries the request", async () => {
    getDamageDoneByTarget
      .mockRejectedValueOnce(new Error("warehouse unavailable"))
      .mockResolvedValueOnce(timeline());
    renderSection();

    expect((await screen.findByRole("alert")).textContent).toContain("warehouse unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("damage-done-chart")).toBeTruthy();
    expect(getDamageDoneByTarget).toHaveBeenCalledTimes(2);
  });

  it("shows the chart, complete target hierarchy, and dealer attribution", async () => {
    getDamageDoneByTarget.mockResolvedValue(timeline());
    renderSection();

    const chart = await screen.findByTestId("damage-done-chart");
    expect(chart.getAttribute("data-selected")).toBe("30");
    expect(screen.getByText("Interval 0:30–1:00")).toBeTruthy();
    expect(screen.getByText("Lone Druid")).toBeTruthy();
    expect(screen.getByText("via Spirit Bear")).toBeTruthy();
    expect(screen.getByText("Impetus")).toBeTruthy();
    expect(screen.getByText("dealt by Centaur Conqueror")).toBeTruthy();
    expect(screen.getByText("dealt by Phantom Lancer illusion")).toBeTruthy();
    expect(screen.queryByText("dealt by Axe")).toBeNull();
    expect(screen.getByText("0:35.125")).toBeTruthy();
    expect(screen.getAllByText("100 combat-log damage").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Select -30" }));
    expect(screen.getByText("Interval -0:30–0:00")).toBeTruthy();
    expect(screen.getByText("-0:05.250")).toBeTruthy();
    expect(screen.getAllByText("40 combat-log damage").length).toBeGreaterThan(0);
  });
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <DamageDoneByTargetSection matchId="42" players={players} />
  </QueryClientProvider>);
}

function timeline(overrides: Partial<MatchHeroDamageDoneTimeline> = {}): MatchHeroDamageDoneTimeline {
  return {
    matchId: "42",
    playerSlot: 0,
    intervalSeconds: 30,
    available: true,
    dealer: { heroId: 2, heroName: "Axe", playerName: "Ari", teamId: 2 },
    totalDamage: 240,
    intervals: [
      {
        startSeconds: -30,
        endSeconds: 0,
        totalDamage: 40,
        targets: [{
          rawName: "npc_dota_neutral_froglet_mage",
          label: "Neutral Froglet Mage",
          teamId: 4,
          damage: 40,
          via: [{
            rawName: null,
            label: "Direct",
            kind: "direct",
            damage: 40,
            mechanisms: [{
              rawName: null,
              label: "Attack",
              damage: 40,
              events: [damageEvent("10", -5.25, 40, { rawName: null, label: "Direct", kind: "direct" })],
            }],
          }],
        }],
      },
      {
        startSeconds: 30,
        endSeconds: 60,
        totalDamage: 200,
        targets: [{
          rawName: "npc_dota_hero_lone_druid",
          label: "Lone Druid",
          teamId: 3,
          damage: 200,
          via: [{
            rawName: "npc_dota_lone_druid_bear",
            label: "Spirit Bear",
            kind: "unit",
            damage: 200,
            mechanisms: [{
              rawName: "enchantress_impetus",
              label: "Impetus",
              damage: 200,
              events: [
                damageEvent("20", 35.125, 100, { rawName: "npc_dota_neutral_centaur_khan", label: "Centaur Conqueror", kind: "unit" }),
                damageEvent("21", 36.25, 60, { rawName: "npc_dota_hero_phantom_lancer", label: "Phantom Lancer illusion", kind: "illusion" }),
                damageEvent("22", 37.5, 40, { rawName: null, label: "Direct", kind: "direct" }),
              ],
            }],
          }],
        }],
      },
    ],
    ...overrides,
  };
}

function damageEvent(
  sequence: string,
  gameTimeSeconds: number,
  damage: number,
  dealerVia: MatchHeroDamageDoneTimeline["intervals"][number]["targets"][number]["via"][number]["mechanisms"][number]["events"][number]["dealerVia"],
) {
  return {
    sequence,
    gameTimeSeconds,
    rawTimeSeconds: gameTimeSeconds + 90,
    damage,
    attackerTeam: 2,
    targetTeam: 3,
    damageType: 1,
    spellGeneratedAttack: false,
    dealerVia,
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
