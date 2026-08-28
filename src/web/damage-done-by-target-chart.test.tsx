import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DamageDoneByTargetChart,
  formatDamageTime,
  type DamageDoneByTargetChartInterval,
} from "./damage-done-by-target-chart";

const intervals: DamageDoneByTargetChartInterval[] = [
  {
    startSeconds: -30,
    endSeconds: 0,
    totalDamage: 120,
    targets: [
      { rawName: "npc_dota_hero_axe", label: "Axe", teamId: 3, damage: 80 },
      { rawName: "npc_dota_neutral_centaur_khan", label: "Centaur Conqueror", teamId: 4, damage: 40 },
    ],
  },
  {
    startSeconds: 30,
    endSeconds: 60,
    totalDamage: 250,
    targets: [
      { rawName: "npc_dota_hero_axe", label: "Axe", teamId: 3, damage: 200 },
      { rawName: "npc_dota_neutral_centaur_khan", label: "Centaur Conqueror", teamId: 4, damage: 50 },
    ],
  },
];

describe("DamageDoneByTargetChart", () => {
  it("renders stacked target bars and selects the last damaged interval by default", () => {
    const { container } = render(<DamageDoneByTargetChart intervals={intervals} />);

    expect(container.querySelector(".ts-chart__bar-y")).toBeTruthy();
    expect(container.querySelectorAll(".ts-chart__bar-y rect").length).toBeGreaterThan(1);
    expect(screen.getByText(/0:30–1:00 · 250 combat-log damage · Axe 200 · Centaur Conqueror 50/)).toBeTruthy();
  });

  it("is keyboard focusable and reports interval changes", () => {
    const onSelectInterval = vi.fn();
    render(<DamageDoneByTargetChart intervals={intervals} onSelectInterval={onSelectInterval} />);

    const chart = screen.getByRole("img", { name: /damage done by target, interactive stacked bar chart/i });
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
    const { container } = render(<DamageDoneByTargetChart intervals={intervals} onSelectInterval={onSelectInterval} />);
    const svg = container.querySelector("svg");
    if (svg === null) throw new Error("chart SVG missing");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 760, bottom: 300, width: 760, height: 300, toJSON: () => ({}),
    });

    fireEvent.pointerMove(svg, { clientX: 62 });
    expect(onSelectInterval).toHaveBeenLastCalledWith(-30);
  });

  it("limits named target series to seven and combines the rest as Other", () => {
    const manyTargets: DamageDoneByTargetChartInterval[] = [{
      startSeconds: 0,
      endSeconds: 30,
      totalDamage: 360,
      targets: Array.from({ length: 8 }, (_, index) => ({
        rawName: `target-${index + 1}`,
        label: `Target ${index + 1}`,
        teamId: 3,
        damage: 80 - index * 10,
      })),
    }];
    render(<DamageDoneByTargetChart intervals={manyTargets} />);

    const legend = screen.getByRole("list", { name: "Damage target series" });
    expect(legend.querySelectorAll("li")).toHaveLength(8);
    expect(screen.getByText("Other")).toBeTruthy();
    expect(screen.queryByText("Target 8")).toBeNull();
    expect(screen.getByText(/Other 10/)).toBeTruthy();
  });

  it("keeps same-name targets on different teams distinct and qualifies their labels", () => {
    const duplicateTargets: DamageDoneByTargetChartInterval[] = [{
      startSeconds: 0,
      endSeconds: 30,
      totalDamage: 100,
      targets: [
        { rawName: "npc_dota_hero_axe", label: "Axe", teamId: 2, damage: 60 },
        { rawName: "npc_dota_hero_axe", label: "Axe", teamId: 3, damage: 40 },
      ],
    }];
    render(<DamageDoneByTargetChart intervals={duplicateTargets} />);

    expect(screen.getAllByText("Axe (Radiant)")).toHaveLength(1);
    expect(screen.getAllByText("Axe (Dire)")).toHaveLength(1);
    expect(screen.getByText(/Axe \(Radiant\) 60 · Axe \(Dire\) 40/)).toBeTruthy();
  });

  it("describes the signed range, quiet gaps, and keyboard controls", () => {
    render(<DamageDoneByTargetChart intervals={intervals} />);
    const chart = screen.getByRole("img", { name: /damage done by target/i });
    expect(chart.querySelector("desc")?.textContent).toMatch(/damage done by target/i);
    expect(chart.querySelector("desc")?.textContent).toMatch(/from -0:30 to 1:00/i);
    expect(chart.querySelector("desc")?.textContent).toMatch(/quiet game-time gaps remain visible/i);
    expect(chart.querySelector("desc")?.textContent).toMatch(/left and right arrow keys/i);
  });
});

describe("damage-done chart time formatting", () => {
  it("formats negative and positive time with millisecond precision", () => {
    expect(formatDamageTime(-30.125)).toBe("-0:30.125");
    expect(formatDamageTime(0)).toBe("0:00");
    expect(formatDamageTime(3_725.75)).toBe("62:05.750");
  });
});
