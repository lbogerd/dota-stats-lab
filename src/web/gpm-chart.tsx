import { defineChart, lineY, type ChartPoint } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo, useState } from "react";

export interface GpmChartPoint {
  gameTimeSeconds: number;
  gpm: number;
}

export interface GpmChartSeries {
  id: string;
  label: string;
  points: GpmChartPoint[];
}

interface GpmChartRow extends GpmChartPoint {
  seriesId: string;
  seriesLabel: string;
  color: string;
}

const COLORS = ["#315f4a", "#d45f4a", "#356a8a", "#a36b12", "#77558f"] as const;

export function GpmChart({ title, series }: { title: string; series: GpmChartSeries[] }) {
  const rows = useMemo<GpmChartRow[]>(() => series.flatMap((line, index) => line.points.map((point) => ({
    ...point,
    seriesId: line.id,
    seriesLabel: line.label,
    color: COLORS[index % COLORS.length]!,
  }))), [series]);
  const availableTimes = useMemo(() => [...new Set(rows.map((point) => point.gameTimeSeconds))]
    .filter(Number.isFinite)
    .sort((left, right) => left - right), [rows]);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const activeTime = selectedTime !== null && availableTimes.includes(selectedTime)
    ? selectedTime
    : availableTimes.at(-1) ?? null;
  const maxTime = Math.max(...rows.map((point) => point.gameTimeSeconds), 1);
  const rawMinimum = Math.min(...rows.map((point) => point.gpm), 0);
  const rawMaximum = Math.max(...rows.map((point) => point.gpm), 1);
  const padding = Math.max((rawMaximum - rawMinimum) * 0.06, 1);
  const minimum = rawMinimum < 0 ? rawMinimum - padding : 0;
  const maximum = rawMaximum + padding;
  const values = activeTime === null ? [] : rows.filter((point) => point.gameTimeSeconds === activeTime);
  const definition = useMemo(() => defineChart({
    marks: [
      lineY(rows, {
        id: "rolling-gpm",
        x: "gameTimeSeconds",
        y: "gpm",
        z: "seriesId",
        key: (row) => `${row.seriesId}-${row.gameTimeSeconds}`,
        stroke: (row) => row.color,
        strokeWidth: 2.5,
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
          ticks: { format: formatChartTime },
        },
      },
      y: {
        scale: scaleLinear().domain([minimum, maximum]),
        grid: true,
        axis: {
          label: "GPM",
          ticks: { format: formatAxisGpm },
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
      formatGroup: (points) => formatTooltipGroup(points),
    },
    theme: {
      foreground: "#526158",
      muted: "#68736d",
      grid: "#e2e5dd",
      background: "transparent",
    },
  }), [maximum, maxTime, minimum, rows]);

  const updateSelectedTime = (points: readonly ChartPoint<GpmChartRow, number, number>[]) => {
    const nextTime = points[0]?.xValue;
    if (typeof nextTime === "number" && Number.isFinite(nextTime)) setSelectedTime(nextTime);
  };

  return <figure className="min-w-0 rounded-xl border border-[#e0e3da] bg-white p-3 sm:p-4">
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {activeTime !== null && <p className="shrink-0 font-mono text-xs text-[#526158]" aria-live="polite">
        {formatChartTime(activeTime)} · {values.map((point) => `${point.seriesLabel} ${formatGpm(point.gpm)}`).join(" · ")}
      </p>}
    </div>
    <Chart
      definition={definition}
      height={280}
      initialWidth={760}
      className="dota-gpm-chart mt-3 rounded-lg outline-none focus-within:ring-2 focus-within:ring-[#4f765f] focus-within:ring-offset-2"
      ariaLabel={`${title}, interactive line chart`}
      ariaDescription={`Use the left and right arrow keys after focusing the chart to inspect exact values. ${descriptionText(series.length, availableTimes)}`}
      onFocusGroupChange={updateSelectedTime}
    />
    <ul className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-[#68736d]" aria-label={`${title} series`}>
      {series.map((line, index) => <li key={line.id} className="min-w-0 max-w-full truncate">
        <span className="mr-1.5 inline-block size-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} aria-hidden="true" />
        {line.label}
      </li>)}
    </ul>
  </figure>;
}

export function formatChartTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function formatGpm(value: number): string {
  return `${Math.round(value).toLocaleString("en")} GPM`;
}

function formatAxisGpm(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(rounded) >= 1_000 ? `${(rounded / 1_000).toFixed(1)}k` : String(rounded);
}

function formatTooltipGroup(points: readonly ChartPoint<GpmChartRow, number, number>[]): string {
  if (points.length === 0) return "";
  return [
    formatChartTime(points[0]!.xValue),
    ...points.map((point) => `${point.datum.seriesLabel}: ${formatGpm(point.datum.gpm)}`),
  ].join("\n");
}

function descriptionText(seriesCount: number, availableTimes: number[]): string {
  return `${seriesCount} series from ${availableTimes.length === 0 ? "no available times" : `${formatChartTime(availableTimes[0]!)} to ${formatChartTime(availableTimes.at(-1)!)}`}.`;
}
