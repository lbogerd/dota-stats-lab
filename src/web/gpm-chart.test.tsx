import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatChartTime, GpmChart, nearestTime } from "./gpm-chart";

const series = [
  {
    id: "radiant",
    label: "Radiant",
    points: [
      { gameTimeSeconds: 60, gpm: 1_000 },
      { gameTimeSeconds: 61, gpm: 1_100 },
      { gameTimeSeconds: 62, gpm: 1_200 },
    ],
  },
  {
    id: "dire",
    label: "Dire",
    points: [
      { gameTimeSeconds: 60, gpm: 900 },
      { gameTimeSeconds: 61, gpm: 950 },
      { gameTimeSeconds: 62, gpm: 1_050 },
    ],
  },
];

describe("GpmChart", () => {
  it("provides a keyboard-focusable exact-value inspection surface", () => {
    render(<GpmChart title="Rolling GPM - last 60 seconds" series={series} />);

    const chart = screen.getByRole("group", { name: /interactive line chart/i });
    expect(chart.getAttribute("tabindex")).toBe("0");
    expect(screen.getByText(/1:02 · Radiant 1,200 GPM · Dire 1,050 GPM/)).toBeTruthy();

    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByText(/1:01 · Radiant 1,100 GPM · Dire 950 GPM/)).toBeTruthy();
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByText(/1:00 · Radiant 1,000 GPM · Dire 900 GPM/)).toBeTruthy();
  });

  it("describes its time range and keyboard controls for assistive technology", () => {
    render(<GpmChart title="Player rolling GPM" series={series.slice(0, 1)} />);
    expect(screen.getByText(/1 series from 1:00 to 1:02.*left and right arrow keys/i)).toBeTruthy();
  });

  it("selects the nearest time from pointer input", () => {
    const { container } = render(<GpmChart title="Rolling GPM" series={series} />);
    const svg = container.querySelector("svg");
    if (svg === null) throw new Error("chart SVG missing");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 760, bottom: 280, width: 760, height: 280, toJSON: () => ({}),
    });

    fireEvent.pointerMove(svg, { clientX: 58 });
    expect(screen.getByText(/1:00 · Radiant 1,000 GPM · Dire 900 GPM/)).toBeTruthy();
  });
});

describe("GPM chart helpers", () => {
  it("selects the closest output time", () => {
    expect(nearestTime([1, 5, 10], 6)).toBe(5);
    expect(nearestTime([1, 5, 10], 9)).toBe(10);
  });

  it("formats graph time without overflowing seconds", () => {
    expect(formatChartTime(0)).toBe("0:00");
    expect(formatChartTime(3_725)).toBe("62:05");
  });
});
