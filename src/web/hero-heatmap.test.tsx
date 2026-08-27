import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MatchHeroHeatmap } from "../server/hero-positions";
import { heatCellIntensity, HeroHeatmap } from "./hero-heatmap";

describe("HeroHeatmap", () => {
  it("uses a square-root density scale", () => {
    expect(heatCellIntensity(0, 100)).toBe(0);
    expect(heatCellIntensity(25, 100)).toBe(0.5);
    expect(heatCellIntensity(100, 100)).toBe(1);
    expect(heatCellIntensity(200, 100)).toBe(1);
  });

  it("renders density cells with TanStack Charts over the map", () => {
    const cells: MatchHeroHeatmap["cells"] = [{ cellX: 2, cellY: 3, sampleCount: 25 }];

    const { container } = render(<HeroHeatmap cells={cells} maximumCellCount={100} />);

    const mapImage = container.querySelector("img")!;
    const chart = screen.getByRole("img", { name: /hero position density heat map/i });
    const densityCell = container.querySelector('[data-ts-key*="2-3"]');
    expect(chart.getAttribute("aria-roledescription")).toBe("chart");
    expect(densityCell?.getAttribute("x")).toBe("20");
    expect(densityCell?.getAttribute("y")).toBe("30");
    expect(densityCell?.getAttribute("width")).toBe("10");
    expect(densityCell?.getAttribute("height")).toBe("10");
    expect(densityCell?.getAttribute("fill")).toBe("rgba(247, 167, 65, 0.54)");
    expect(mapImage.style.filter).toBe("saturate(0.15)");
  });
});
