import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DamageBySourceChart, type DamageBySourceChartInterval } from "./damage-by-source-chart";
import { formatDamageTime } from "./stacked-damage-interval-chart";

const intervals: DamageBySourceChartInterval[] = [
  {
    startSeconds: -30,
    endSeconds: 0,
    totalDamage: 120,
    sources: [
      { rawName: "axe", label: "Axe", damage: 80 },
      { rawName: "centaur", label: "Centaur Conqueror", damage: 40 },
    ],
  },
  {
    startSeconds: 30,
    endSeconds: 60,
    totalDamage: 250,
    sources: [
      { rawName: "axe", label: "Axe", damage: 200 },
      { rawName: "centaur", label: "Centaur Conqueror", damage: 50 },
    ],
  },
];

describe("DamageBySourceChart", () => {
  it("renders stacked bars and selects the last damaged interval by default", () => {
    const { container } = render(<DamageBySourceChart intervals={intervals} />);

    expect(container.querySelector(".ts-chart__bar-y")).toBeTruthy();
    expect(container.querySelectorAll(".ts-chart__bar-y rect").length).toBeGreaterThan(1);
    expect(screen.getByText(/0:30–1:00 · 250 combat-log damage · Axe 200 · Centaur Conqueror 50/)).toBeTruthy();
  });

  it("is keyboard focusable and reports interval changes", () => {
    const onSelectInterval = vi.fn();
    render(<DamageBySourceChart intervals={intervals} onSelectInterval={onSelectInterval} />);

    const chart = screen.getByRole("img", { name: /interactive stacked bar chart/i });
    expect(chart.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByText(/-0:30–0:00 · 120 combat-log damage/)).toBeTruthy();
    expect(onSelectInterval).toHaveBeenLastCalledWith(-30);
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByText(/0:30–1:00 · 250 combat-log damage/)).toBeTruthy();
    expect(onSelectInterval).toHaveBeenLastCalledWith(30);
  });

  it("selects an interval from pointer focus", () => {
    const onSelectInterval = vi.fn();
    const { container } = render(<DamageBySourceChart intervals={intervals} onSelectInterval={onSelectInterval} />);
    const svg = container.querySelector("svg");
    if (svg === null) throw new Error("chart SVG missing");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 760, bottom: 300, width: 760, height: 300, toJSON: () => ({}),
    });

    fireEvent.pointerMove(svg, { clientX: 62 });
    expect(onSelectInterval).toHaveBeenLastCalledWith(-30);
  });

  it("limits named source series to seven and combines the rest as Other", () => {
    const manySources: DamageBySourceChartInterval[] = [{
      startSeconds: 0,
      endSeconds: 30,
      totalDamage: 360,
      sources: Array.from({ length: 8 }, (_, index) => ({
        rawName: `source-${index + 1}`,
        label: `Source ${index + 1}`,
        damage: 80 - index * 10,
      })),
    }];
    render(<DamageBySourceChart intervals={manySources} />);

    const legend = screen.getByRole("list", { name: "Damage source series" });
    expect(legend.querySelectorAll("li")).toHaveLength(8);
    expect(screen.getByText("Other")).toBeTruthy();
    expect(screen.queryByText("Source 8")).toBeNull();
    expect(screen.getByText(/Other 10/)).toBeTruthy();
  });

  it("describes the signed range, quiet gaps, and keyboard controls", () => {
    render(<DamageBySourceChart intervals={intervals} />);
    const chart = screen.getByRole("img", { name: /Damage taken by source/i });
    expect(chart.querySelector("desc")?.textContent).toMatch(/from -0:30 to 1:00/i);
    expect(chart.querySelector("desc")?.textContent).toMatch(/quiet game-time gaps remain visible/i);
    expect(chart.querySelector("desc")?.textContent).toMatch(/left and right arrow keys/i);
  });
});

describe("damage chart time formatting", () => {
  it("formats negative and positive time with millisecond precision", () => {
    expect(formatDamageTime(-30.125)).toBe("-0:30.125");
    expect(formatDamageTime(0)).toBe("0:00");
    expect(formatDamageTime(3_725.75)).toBe("62:05.750");
    expect(formatDamageTime(-5.25, true)).toBe("-0:05.250");
    expect(formatDamageTime(30, true)).toBe("0:30.000");
  });
});
