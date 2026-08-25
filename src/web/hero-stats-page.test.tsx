import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HeroStatistic } from "../server/hero-stats";
import { HeroesError, HeroesOverview, HeroesPending, formatAverage, formatRate } from "../routes/heroes";

describe("hero statistics page", () => {
  it("shows its loading state", () => {
    render(<HeroesPending />);
    expect(screen.getByRole("status").textContent).toContain("Loading hero statistics");
  });

  it("shows an error and offers a retry", () => {
    const retry = vi.fn();
    render(<HeroesError error={new Error("warehouse unavailable")} retry={retry} />);

    expect(screen.getByRole("alert").textContent).toContain("warehouse unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows an explicit empty state and zero-match scope", () => {
    render(<HeroesOverview overview={{ matchCount: 0, heroes: [] }} />);

    expect(screen.getByRole("heading", { name: "Hero overview" })).toBeTruthy();
    expect(screen.getByText("Metric scope: 0 matches")).toBeTruthy();
    expect(screen.getByText("No hero statistics yet")).toBeTruthy();
  });

  it("renders the complete desktop table and equivalent mobile card content", () => {
    render(<HeroesOverview overview={{ matchCount: 4, heroes: [axe] }} />);

    expect(screen.getByText("Metric scope: 4 matches")).toBeTruthy();
    const table = screen.getByRole("table");
    for (const heading of [
      "Hero", "Average GPM", "Average XPM", "Wins-Losses", "Win-Loss rate",
      "Picks and pick rate", "Bans and ban rate",
    ]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeTruthy();
    }
    expect(within(table).getByText("Axe")).toBeTruthy();
    expect(within(table).getByText("512.4")).toBeTruthy();
    expect(within(table).getByText("601.0")).toBeTruthy();
    expect(within(table).getByText("2–1")).toBeTruthy();
    expect(within(table).getByText("66.7% win · 33.3% loss")).toBeTruthy();
    expect(within(table).getByText("3 · 75.0%")).toBeTruthy();
    expect(within(table).getByText("1 · 25.0%")).toBeTruthy();

    const card = screen.getByRole("article");
    expect(within(card).getByText("Axe")).toBeTruthy();
    expect(within(card).getByText("Hero ID 2")).toBeTruthy();
    expect(within(card).getByText("Average GPM")).toBeTruthy();
    expect(within(card).getByText("Win-Loss rate")).toBeTruthy();
    expect(within(card).getByText("Picks and pick rate")).toBeTruthy();
    expect(within(card).getByText("Bans and ban rate")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Axe" })).toBeNull();
  });

  it("keeps missing averages and undecided rates unknown", () => {
    render(<HeroesOverview overview={{ matchCount: 1, heroes: [{
      ...axe,
      heroId: 9_999,
      matchCount: 1,
      picks: 0,
      wins: 0,
      losses: 0,
      pickRate: 0,
      averageGpm: null,
      averageXpm: null,
      winRate: null,
      lossRate: null,
    }] }} />);

    const table = screen.getByRole("table");
    expect(within(table).getByText("Hero #9999")).toBeTruthy();
    expect(within(table).getAllByText("Unknown")).toHaveLength(3);
    expect(within(table).getByRole("img", { name: "Hero #9999 image unavailable" })).toBeTruthy();
  });
});

describe("hero metric formatting", () => {
  it("uses one decimal place for averages and percentages", () => {
    expect(formatAverage(500)).toBe("500.0");
    expect(formatAverage(null)).toBe("Unknown");
    expect(formatRate(0.125)).toBe("12.5%");
    expect(formatRate(null)).toBe("Unknown");
  });
});

const axe: HeroStatistic = {
  heroId: 2,
  matchCount: 4,
  picks: 3,
  bans: 1,
  wins: 2,
  losses: 1,
  pickRate: 0.75,
  banRate: 0.25,
  winRate: 2 / 3,
  lossRate: 1 / 3,
  averageGpm: 512.4,
  averageXpm: 601,
};
