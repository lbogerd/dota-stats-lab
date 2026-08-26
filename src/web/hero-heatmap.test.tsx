import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MatchHeroHeatmap } from "../server/hero-positions";
import { heatCellIntensity, HeroHeatmap } from "./hero-heatmap";

describe("HeroHeatmap", () => {
  it("uses a square-root density scale", () => {
    expect(heatCellIntensity(0, 100)).toBe(0);
    expect(heatCellIntensity(25, 100)).toBe(0.5);
    expect(heatCellIntensity(100, 100)).toBe(1);
    expect(heatCellIntensity(200, 100)).toBe(1);
  });

  it("draws cells on a device-pixel-ratio canvas", () => {
    const fillRect = vi.fn();
    const clearRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect, clearRect } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 640, height: 640, x: 0, y: 0, top: 0, right: 640, bottom: 640, left: 0, toJSON: () => ({}),
    });
    const cells: MatchHeroHeatmap["cells"] = [{ cellX: 2, cellY: 3, sampleCount: 25 }];

    const { container } = render(<HeroHeatmap cells={cells} maximumCellCount={100} />);

    const canvas = container.querySelector("canvas")!;
    const mapImage = container.querySelector("img")!;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(640);
    expect(fillRect).toHaveBeenCalledWith(20, 30, 10.5, 10.5);
    expect(mapImage.style.filter).toBe("saturate(0.15)");
  });
});
