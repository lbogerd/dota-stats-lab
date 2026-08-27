import { defineChart, lineY, ruleY, type ChartPoint } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo, useState } from "react";

export interface WinProbabilityChartPoint {
  gameTimeSeconds: number;
  radiantProbability: number;
  direProbability: number;
}

interface ProbabilityRow {
  gameTimeSeconds: number;
  probability: number;
  seriesId: "radiant" | "dire";
  seriesLabel: string;
}

const RADIANT_COLOR = "#315f4a";
const DIRE_COLOR = "#d45f4a";

export function WinProbabilityChart({ points, radiantName, direName }: {
  points: WinProbabilityChartPoint[];
  radiantName: string;
  direName: string;
}) {
  const orderedPoints = useMemo(() => [...points]
    .filter((point) => Number.isFinite(point.gameTimeSeconds))
    .sort((left, right) => left.gameTimeSeconds - right.gameTimeSeconds), [points]);
  const radiantRows = useMemo<ProbabilityRow[]>(() => orderedPoints.map((point) => ({
    gameTimeSeconds: point.gameTimeSeconds,
    probability: point.radiantProbability,
    seriesId: "radiant",
    seriesLabel: radiantName,
  })), [orderedPoints, radiantName]);
  const direRows = useMemo<ProbabilityRow[]>(() => orderedPoints.map((point) => ({
    gameTimeSeconds: point.gameTimeSeconds,
    probability: point.direProbability,
    seriesId: "dire",
    seriesLabel: direName,
  })), [direName, orderedPoints]);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const activePoint = selectedTime === null
    ? orderedPoints.at(-1) ?? null
    : orderedPoints.find((point) => point.gameTimeSeconds === selectedTime) ?? orderedPoints.at(-1) ?? null;
  const maxTime = Math.max(orderedPoints.at(-1)?.gameTimeSeconds ?? 0, 1);
  const definition = useMemo(() => defineChart({
    marks: [
      ruleY([0.5], {
        id: "even-chance",
        stroke: "#9ca69d",
        strokeDasharray: "5 4",
      }),
      lineY(radiantRows, {
        id: "radiant-win-probability",
        x: "gameTimeSeconds",
        y: "probability",
        z: "seriesId",
        key: (row) => `radiant-${row.gameTimeSeconds}`,
        stroke: RADIANT_COLOR,
        strokeWidth: 2.5,
        points: true,
      }),
      lineY(direRows, {
        id: "dire-win-probability",
        x: "gameTimeSeconds",
        y: "probability",
        z: "seriesId",
        key: (row) => `dire-${row.gameTimeSeconds}`,
        stroke: DIRE_COLOR,
        strokeWidth: 2.5,
        strokeDasharray: "7 4",
        points: true,
      }),
      crosshair({ x: { label: false }, y: false }),
    ],
    scales: {
      x: {
        scale: scaleLinear().domain([0, maxTime]),
        grid: false,
        axis: {
          label: "Game time",
          ticks: { format: formatProbabilityTime },
        },
      },
      y: {
        scale: scaleLinear().domain([0, 1]),
        grid: true,
        axis: {
          label: "Win probability",
          ticks: {
            values: [0, 0.5, 1],
            format: formatProbability,
          },
        },
      },
    },
    clip: true,
    focus: "group-x",
    maxFocusDistance: Number.POSITIVE_INFINITY,
    focusRing: true,
    tooltip: {
      use: tooltip,
      className: "dota-chart-tooltip",
      formatGroup: (focusedPoints) => formatTooltipGroup(focusedPoints),
    },
    theme: {
      foreground: "#526158",
      muted: "#68736d",
      grid: "#e2e5dd",
      background: "transparent",
    },
  }), [direRows, maxTime, radiantRows]);

  const updateSelectedTime = (focusedPoints: readonly ChartPoint<ProbabilityRow, number, number>[]) => {
    const nextTime = focusedPoints[0]?.xValue;
    if (typeof nextTime === "number" && Number.isFinite(nextTime)) setSelectedTime(nextTime);
  };
  const description = `Win probability for ${radiantName} and ${direName} from ${formatProbabilityTime(orderedPoints[0]?.gameTimeSeconds ?? 0)} to ${formatProbabilityTime(orderedPoints.at(-1)?.gameTimeSeconds ?? 0)}. The vertical scale is 0 to 100 percent and includes an even-chance line at 50 percent. Use the left and right arrow keys after focusing the chart to inspect exact values.`;

  return <figure className="min-w-0 rounded-xl border border-[#e0e3da] bg-white p-3 sm:p-4">
    {activePoint !== null && <p className="font-mono text-xs text-[#405047]" aria-live="polite">
      {formatProbabilityTime(activePoint.gameTimeSeconds)} · {radiantName} {formatProbability(activePoint.radiantProbability)} · {direName} {formatProbability(activePoint.direProbability)}
    </p>}
    <Chart
      definition={definition}
      height={286}
      initialWidth={760}
      className="dota-win-probability-chart mt-3 rounded-lg outline-none focus-within:ring-2 focus-within:ring-[#4f765f] focus-within:ring-offset-2"
      ariaLabel="Valve win probability, interactive line chart"
      ariaDescription={description}
      onFocusGroupChange={updateSelectedTime}
    />
    <ul className="mt-2 flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-xs text-[#526158]" aria-label="Win probability series">
      <li className="min-w-0 truncate"><span className="mr-1.5 inline-block h-0 w-4 border-t-[3px] border-[#315f4a] align-middle" aria-hidden="true" />{radiantName} (Radiant)</li>
      <li className="min-w-0 truncate"><span className="mr-1.5 inline-block h-2 w-2 bg-[#d45f4a] align-middle" aria-hidden="true" />{direName} (Dire)</li>
    </ul>
  </figure>;
}

export function formatProbabilityTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export function formatProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTooltipGroup(points: readonly ChartPoint<ProbabilityRow, number, number>[]): string {
  if (points.length === 0) return "";
  return [
    formatProbabilityTime(points[0]!.xValue),
    ...points.map((point) => `${point.datum.seriesLabel}: ${formatProbability(point.datum.probability)}`),
  ].join("\n");
}
