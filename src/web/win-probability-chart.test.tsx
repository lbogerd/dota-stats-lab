import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatProbability, formatProbabilityTime, WinProbabilityChart } from "./win-probability-chart";

const points = [
  { gameTimeSeconds: 10, radiantProbability: 0.4, direProbability: 0.6 },
  { gameTimeSeconds: 20, radiantProbability: 0.55, direProbability: 0.45 },
  { gameTimeSeconds: 30, radiantProbability: 0.8, direProbability: 0.2 },
];

describe("WinProbabilityChart", () => {
  it("selects the last point by default and supports TanStack keyboard focus", () => {
    render(<WinProbabilityChart points={points} radiantName="Team Spirit" direName="Liquid" />);

    const chart = screen.getByRole("img", { name: /Valve win probability.*interactive line chart/i });
    expect(chart.getAttribute("tabindex")).toBe("0");
    expect(screen.getByText("0:30 · Team Spirit 80.0% · Liquid 20.0%")).toBeTruthy();

    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByText("0:10 · Team Spirit 40.0% · Liquid 60.0%")).toBeTruthy();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByText("0:20 · Team Spirit 55.0% · Liquid 45.0%")).toBeTruthy();
    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByText("0:30 · Team Spirit 80.0% · Liquid 20.0%")).toBeTruthy();
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByText("0:10 · Team Spirit 40.0% · Liquid 60.0%")).toBeTruthy();
  });

  it("selects the nearest sample with pointer input", () => {
    const { container } = render(<WinProbabilityChart points={points} radiantName="Radiant" direName="Dire" />);
    const svg = container.querySelector("svg");
    if (svg === null) throw new Error("chart SVG missing");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 760, bottom: 286, width: 760, height: 286, toJSON: () => ({}),
    });

    fireEvent.pointerMove(svg, { clientX: 58 + (744 - 58) * 0.36 });
    expect(screen.getByText("0:10 · Radiant 40.0% · Dire 60.0%")).toBeTruthy();
  });

  it("uses labels and line patterns in addition to color", () => {
    const { container } = render(<WinProbabilityChart points={points} radiantName="Spirit" direName="Liquid" />);
    expect(screen.getByText("Spirit (Radiant)")).toBeTruthy();
    expect(screen.getByText("Liquid (Dire)")).toBeTruthy();
    expect(container.querySelector('path[stroke-dasharray="7 4"]')).toBeTruthy();
  });

  it("describes the fixed scale, even line, time range, and controls", () => {
    render(<WinProbabilityChart points={points} radiantName="Radiant" direName="Dire" />);
    const chart = screen.getByRole("img", { name: /Valve win probability/i });
    expect(chart.querySelector("desc")?.textContent).toMatch(/vertical scale is 0 to 100 percent.*50 percent.*left and right arrow keys/i);
  });
});

describe("win probability chart formatting", () => {
  it("formats replay time and probability", () => {
    expect(formatProbabilityTime(3_725)).toBe("62:05");
    expect(formatProbability(0.53628)).toBe("53.6%");
  });
});
