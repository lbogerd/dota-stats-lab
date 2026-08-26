import { useCallback, useEffect, useRef } from "react";
import type { MatchHeroHeatmap } from "../server/hero-positions.js";

const GRID_SIZE = 64;

export function heatCellIntensity(sampleCount: number, maximumCellCount: number): number {
  if (!Number.isFinite(sampleCount) || !Number.isFinite(maximumCellCount) || sampleCount <= 0 || maximumCellCount <= 0) return 0;
  return Math.sqrt(Math.min(sampleCount / maximumCellCount, 1));
}

export function HeroHeatmap({ cells, maximumCellCount }: {
  cells: MatchHeroHeatmap["cells"];
  maximumCellCount: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container === null || canvas === null) return;

    const cssSize = container.getBoundingClientRect().width;
    if (cssSize <= 0) return;
    const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
    const bitmapSize = Math.max(1, Math.round(cssSize * pixelRatio));
    if (canvas.width !== bitmapSize || canvas.height !== bitmapSize) {
      canvas.width = bitmapSize;
      canvas.height = bitmapSize;
    }

    const context = canvas.getContext("2d");
    if (context === null) return;
    context.clearRect(0, 0, bitmapSize, bitmapSize);
    const cellSize = bitmapSize / GRID_SIZE;
    for (const cell of cells) {
      const intensity = heatCellIntensity(cell.sampleCount, maximumCellCount);
      if (intensity === 0) continue;
      const red = Math.round(255 - 17 * intensity);
      const green = Math.round(224 - 114 * intensity);
      const blue = Math.round(86 - 42 * intensity);
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${0.18 + 0.72 * intensity})`;
      context.fillRect(cell.cellX * cellSize, cell.cellY * cellSize, cellSize + 0.5, cellSize + 0.5);
    }
  }, [cells, maximumCellCount]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw);
    if (containerRef.current !== null) observer?.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", draw);
      observer?.disconnect();
    };
  }, [draw]);

  return <figure aria-labelledby="hero-heatmap-caption">
    <div ref={containerRef} className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#23352c]">
      <img
        src="/assets/dota-map.webp"
        alt="Dota battlefield map"
        className="block h-full w-full object-cover"
        style={{ filter: "saturate(0.15)" }}
        onLoad={draw}
      />
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
    <figcaption id="hero-heatmap-caption" className="mt-3 flex items-center gap-3 text-xs font-semibold text-[#526158]">
      <span>Low density</span>
      <span className="h-2 flex-1 rounded-full bg-gradient-to-r from-[#ffe056]/25 via-[#f68f43]/70 to-[#ee6e2c]" aria-hidden="true" />
      <span>High density</span>
    </figcaption>
  </figure>;
}
