import { cell, defineChart } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";
import type { MatchHeroHeatmap } from "../server/hero-positions.js";

const GRID_SIZE = 64;
const DENSITY_STEPS = 100;
const GRID_DOMAIN = Array.from({ length: GRID_SIZE }, (_, index) => index);
const DENSITY_DOMAIN = Array.from({ length: DENSITY_STEPS + 1 }, (_, index) => index);
const DENSITY_COLORS = DENSITY_DOMAIN.map((step) => densityColor(step / DENSITY_STEPS));

interface HeatmapCell {
  cellX: number;
  cellY: number;
  sampleCount: number;
  densityStep: number;
}

export function heatCellIntensity(sampleCount: number, maximumCellCount: number): number {
  if (!Number.isFinite(sampleCount) || !Number.isFinite(maximumCellCount) || sampleCount <= 0 || maximumCellCount <= 0) return 0;
  return Math.sqrt(Math.min(sampleCount / maximumCellCount, 1));
}

export function HeroHeatmap({ cells, maximumCellCount }: {
  cells: MatchHeroHeatmap["cells"];
  maximumCellCount: number;
}) {
  const rows = useMemo<HeatmapCell[]>(() => cells.flatMap((heatmapCell) => {
    const intensity = heatCellIntensity(heatmapCell.sampleCount, maximumCellCount);
    return intensity === 0 ? [] : [{
      ...heatmapCell,
      densityStep: Math.round(intensity * DENSITY_STEPS),
    }];
  }), [cells, maximumCellCount]);
  const definition = useMemo(() => defineChart({
    marks: [
      cell(rows, {
        id: "hero-position-density",
        x: "cellX",
        y: "cellY",
        color: "densityStep",
        key: (row) => `${row.cellX}-${row.cellY}`,
        inset: 0,
      }),
    ],
    scales: {
      x: {
        scale: scaleBand<number>().domain(GRID_DOMAIN).padding(0),
        axis: false,
      },
      y: {
        scale: scaleBand<number>().domain(GRID_DOMAIN).padding(0),
        axis: false,
      },
    },
    color: {
      domain: DENSITY_DOMAIN,
      range: DENSITY_COLORS,
    },
    margin: 0,
    clip: true,
    tooltip: {
      use: tooltip,
      className: "dota-chart-tooltip",
      format: (point) => `${point.datum.sampleCount.toLocaleString("en")} position samples in this map cell`,
    },
    theme: { background: "transparent" },
  }), [rows]);

  return <figure aria-labelledby="hero-heatmap-caption">
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#23352c]">
      <img
        src="/assets/dota-map.webp"
        alt="Dota battlefield map"
        className="block h-full w-full object-cover"
        style={{ filter: "saturate(0.15)" }}
      />
      <Chart
        definition={definition}
        aspectRatio={1}
        initialWidth={640}
        className="dota-heatmap-chart"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        ariaLabel="Hero position density heat map"
        ariaDescription="A 64 by 64 grid overlays the Dota battlefield map. Brighter orange cells contain more position samples."
      />
    </div>
    <figcaption id="hero-heatmap-caption" className="mt-3 flex items-center gap-3 text-xs font-semibold text-[#526158]">
      <span>Low density</span>
      <span className="h-2 flex-1 rounded-full bg-gradient-to-r from-[#ffe056]/25 via-[#f68f43]/70 to-[#ee6e2c]" aria-hidden="true" />
      <span>High density</span>
    </figcaption>
  </figure>;
}

function densityColor(intensity: number): string {
  const red = Math.round(255 - 17 * intensity);
  const green = Math.round(224 - 114 * intensity);
  const blue = Math.round(86 - 42 * intensity);
  return `rgba(${red}, ${green}, ${blue}, ${0.18 + 0.72 * intensity})`;
}
