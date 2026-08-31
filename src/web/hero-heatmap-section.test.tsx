import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchHeroHeatmap } from "../server/hero-positions";
import type { MatchOverviewPlayer } from "../server/overview";
import { formatHeatmapTime, HeroHeatmapSection, parseHeatmapTime } from "./hero-heatmap-section";

const getHeatmap = vi.hoisted(() => vi.fn());

vi.mock("./overview-data.js", () => ({
  matchHeroHeatmapQuery: (matchId: string, startMilliseconds: number, endMilliseconds: number, playerSlot: number | null) => ({
    queryKey: ["match-hero-heatmap", matchId, startMilliseconds, endMilliseconds, playerSlot],
    queryFn: () => getHeatmap({ matchId, startMilliseconds, endMilliseconds, playerSlot }),
    retry: false,
  }),
}));

const players = [player(0, 2, "Ari", 2), player(128, 3, "Dara", 3)];

describe("heat-map time text", () => {
  it("formats time with 100 ms precision", () => {
    expect(formatHeatmapTime(0)).toBe("0:00.0");
    expect(formatHeatmapTime(61_200)).toBe("1:01.2");
    expect(formatHeatmapTime(3_661_900)).toBe("1:01:01.9");
  });

  it("parses supported values and rejects invalid precision", () => {
    expect(parseHeatmapTime("12:34.5")).toBe(754_500);
    expect(parseHeatmapTime("1:02:03.4")).toBe(3_723_400);
    expect(parseHeatmapTime("0:01")).toBe(1_000);
    expect(parseHeatmapTime("1:60.0")).toBeNull();
    expect(parseHeatmapTime("1:02.34")).toBeNull();
  });
});

describe("HeroHeatmapSection", () => {
  beforeEach(() => {
    getHeatmap.mockReset();
  });

  it("uses the complete range and shows loading", () => {
    getHeatmap.mockReturnValue(new Promise(() => undefined));
    renderSection();

    expect((screen.getByLabelText("Heat map hero") as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("Start time range") as HTMLInputElement).step).toBe("100");
    expect((screen.getByLabelText("End time range") as HTMLInputElement).value).toBe("120000");
    expect(screen.getByRole("status").textContent).toContain("Loading hero locations");
  });

  it("shows unavailable, empty, and ready states", async () => {
    getHeatmap.mockResolvedValueOnce(heatmap({ available: false }));
    const first = renderSection();
    expect(await screen.findByText(/Re-extract the replay/)).toBeTruthy();
    first.unmount();

    getHeatmap.mockResolvedValueOnce(heatmap({ sampleCount: 0, maximumCellCount: 0, cells: [] }));
    const second = renderSection();
    expect(await screen.findByText(/No living hero locations/)).toBeTruthy();
    second.unmount();

    getHeatmap.mockResolvedValueOnce(heatmap());
    renderSection();
    expect((await screen.findByText(/Showing/)).textContent).toContain("Showing 12 position samples from 0:00.0 through 2:00.0.");
    expect(screen.getByAltText("Dota battlefield map")).toBeTruthy();
  });

  it("shows an error and offers a retry", async () => {
    getHeatmap.mockRejectedValue(new Error("warehouse unavailable"));
    renderSection();
    expect((await screen.findByRole("alert")).textContent).toContain("warehouse unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("debounces range queries and changes the query key for a hero", async () => {
    vi.useFakeTimers();
    getHeatmap.mockImplementation((input: HeatmapInput) => Promise.resolve(heatmap({
      startMilliseconds: input.startMilliseconds,
      endMilliseconds: input.endMilliseconds,
      playerSlot: input.playerSlot,
    })));
    renderSection();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    fireEvent.change(screen.getByLabelText("Start time range"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Start time range"), { target: { value: "20000" } });
    expect(getHeatmap).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(199); });
    expect(getHeatmap).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(getHeatmap).toHaveBeenCalledWith({ matchId: "42", startMilliseconds: 20_000, endMilliseconds: 120_000, playerSlot: null });

    fireEvent.change(screen.getByLabelText("Heat map hero"), { target: { value: "128" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getHeatmap).toHaveBeenCalledWith({ matchId: "42", startMilliseconds: 20_000, endMilliseconds: 120_000, playerSlot: 128 });
    vi.useRealTimers();
  });

  it("accepts keyboard time input and reports invalid ranges", async () => {
    getHeatmap.mockResolvedValue(heatmap());
    renderSection();
    await screen.findByText(/Showing/);
    const start = screen.getByLabelText("Exact time", { selector: "#start-time-text" });
    fireEvent.change(start, { target: { value: "0:10.1" } });
    fireEvent.keyDown(start, { key: "Enter" });
    expect(screen.getByText(/Selection:/).textContent).toContain("0:10.1–2:00.0");

    const end = screen.getByLabelText("Exact time", { selector: "#end-time-text" });
    fireEvent.change(end, { target: { value: "0:01.0" } });
    fireEvent.keyDown(end, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("end time must not be before");
  });
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <HeroHeatmapSection matchId="42" durationSeconds={120} players={players} />
  </QueryClientProvider>);
}

type HeatmapInput = Pick<MatchHeroHeatmap, "startMilliseconds" | "endMilliseconds" | "playerSlot"> & { matchId: string };

function heatmap(overrides: Partial<MatchHeroHeatmap> = {}): MatchHeroHeatmap {
  return {
    matchId: "42", available: true, startMilliseconds: 0, endMilliseconds: 120_000, playerSlot: null,
    sampleCount: 12, maximumCellCount: 8, cells: [{ cellX: 1, cellY: 2, sampleCount: 8 }], ...overrides,
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
