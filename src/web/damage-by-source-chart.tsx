import { barY, defineChart, stack, type ChartPoint } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo, useState } from "react";

/** The subset of a server damage interval that the chart needs. */
export interface DamageBySourceChartInterval {
  startSeconds: number;
  endSeconds: number;
  totalDamage: number;
  sources: readonly {
    rawName: string;
    label: string;
    damage: number;
  }[];
}

interface DamageSeries {
  id: string;
  label: string;
  color: string;
  sourceNames: ReadonlySet<string>;
}

interface DamageChartRow {
  intervalStartSeconds: number;
  intervalEndSeconds: number;
  intervalCenterSeconds: number;
  intervalTotalDamage: number;
  seriesId: string;
  seriesLabel: string;
  seriesOrder: number;
  damage: number;
  color: string;
}

const MAX_NAMED_SERIES = 7;
const OTHER_SERIES_ID = "__other__";
const INITIAL_CHART_WIDTH = 760;
const COLORS = [
  "#315f4a",
  "#d45f4a",
  "#356a8a",
  "#a36b12",
  "#77558f",
  "#26756d",
  "#9b4f74",
  "#68736d",
] as const;

export function DamageBySourceChart({ intervals, selectedStartSeconds, onSelectInterval }: {
  intervals: readonly DamageBySourceChartInterval[];
  selectedStartSeconds?: number;
  onSelectInterval?: (startSeconds: number) => void;
}) {
  const orderedIntervals = useMemo(() => [...intervals]
    .filter((interval) => Number.isFinite(interval.startSeconds) && Number.isFinite(interval.endSeconds))
    .sort((left, right) => left.startSeconds - right.startSeconds), [intervals]);
  const series = useMemo(() => buildSeries(orderedIntervals), [orderedIntervals]);
  const rows = useMemo(() => buildRows(orderedIntervals, series), [orderedIntervals, series]);
  const [focusedSelection, setFocusedSelection] = useState<{
    intervals: readonly DamageBySourceChartInterval[];
    startSeconds: number;
  } | null>(null);
  const localStartSeconds = focusedSelection?.intervals === intervals
    ? focusedSelection.startSeconds
    : undefined;
  const requestedStartSeconds = selectedStartSeconds ?? localStartSeconds;
  const activeInterval = (requestedStartSeconds === undefined
    ? undefined
    : orderedIntervals.find((interval) => interval.startSeconds === requestedStartSeconds))
    ?? [...orderedIntervals].reverse().find((interval) => interval.totalDamage > 0)
    ?? orderedIntervals.at(-1)
    ?? null;
  const minimumTime = orderedIntervals[0]?.startSeconds ?? 0;
  const maximumTime = Math.max(orderedIntervals.at(-1)?.endSeconds ?? 0, minimumTime + 30);
  const maximumDamage = Math.max(...orderedIntervals.map((interval) => interval.totalDamage), 1);
  const intervalThickness = INITIAL_CHART_WIDTH * 0.8 * 30 / (maximumTime - minimumTime);
  const definition = useMemo(() => defineChart({
    marks: [
      barY(rows, {
        id: "damage-by-source",
        x: "intervalCenterSeconds",
        y: "damage",
        z: "seriesId",
        key: (row) => `${row.intervalStartSeconds}-${row.seriesId}`,
        fill: (row) => row.color,
        layout: stack({ order: series.map((item) => item.id) }),
        inset: 1,
        maxThickness: intervalThickness,
        radius: 1,
      }),
      crosshair({ x: { label: false }, y: false }),
    ],
    scales: {
      x: {
        scale: scaleLinear().domain([minimumTime, maximumTime]),
        grid: false,
        axis: {
          label: "Game time",
          ticks: { format: formatDamageTime },
        },
      },
      y: {
        scale: scaleLinear().domain([0, maximumDamage * 1.06]),
        grid: true,
        axis: {
          label: "Combat-log damage",
          ticks: { format: formatAxisDamage },
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
      formatGroup: formatTooltipGroup,
    },
    theme: {
      foreground: "#526158",
      muted: "#68736d",
      grid: "#e2e5dd",
      background: "transparent",
    },
  }), [intervalThickness, maximumDamage, maximumTime, minimumTime, rows, series]);

  const updateSelectedInterval = (points: readonly ChartPoint<DamageChartRow, number, number>[]) => {
    const nextStartSeconds = points[0]?.datum.intervalStartSeconds;
    if (nextStartSeconds === undefined) return;
    const nextInterval = orderedIntervals.find((interval) => interval.startSeconds === nextStartSeconds);
    if (nextInterval === undefined) return;
    setFocusedSelection({ intervals, startSeconds: nextStartSeconds });
    onSelectInterval?.(nextInterval.startSeconds);
  };
  const activeValues = activeInterval === null ? [] : series.map((item) => ({
    ...item,
    damage: damageForSeries(activeInterval, item),
  }));
  const description = descriptionText(orderedIntervals);

  return <figure className="min-w-0 rounded-xl border border-[#e0e3da] bg-white p-3 sm:p-4">
    {activeInterval !== null && <p className="font-mono text-xs text-[#405047]" aria-live="polite">
      {formatIntervalRange(activeInterval)} · {formatDamage(activeInterval.totalDamage)} combat-log damage
      {activeValues.map((item) => ` · ${item.label} ${formatDamage(item.damage)}`).join("")}
    </p>}
    <Chart
      definition={definition}
      height={300}
      initialWidth={INITIAL_CHART_WIDTH}
      className="dota-damage-by-source-chart mt-3 rounded-lg outline-none focus-within:ring-2 focus-within:ring-[#4f765f] focus-within:ring-offset-2"
      ariaLabel="Damage taken by source, interactive stacked bar chart"
      ariaDescription={description}
      onFocusGroupChange={updateSelectedInterval}
    />
    <ul className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-[#526158]" aria-label="Damage source series">
      {series.map((item) => <li key={item.id} className="min-w-0 max-w-full truncate">
        <span className="mr-1.5 inline-block size-2 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden="true" />
        {item.label}
      </li>)}
    </ul>
  </figure>;
}

export function formatDamageTime(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const milliseconds = Math.round(Math.abs(seconds) * 1_000);
  const minutes = Math.floor(milliseconds / 60_000);
  const secondsPart = Math.floor(milliseconds / 1_000) % 60;
  const millisecondsPart = milliseconds % 1_000;
  return `${sign}${minutes}:${String(secondsPart).padStart(2, "0")}${millisecondsPart === 0 ? "" : `.${String(millisecondsPart).padStart(3, "0")}`}`;
}

function buildSeries(intervals: readonly DamageBySourceChartInterval[]): DamageSeries[] {
  const totals = new Map<string, { label: string; damage: number }>();
  for (const interval of intervals) {
    for (const source of interval.sources) {
      const current = totals.get(source.rawName);
      totals.set(source.rawName, {
        label: current?.label ?? source.label,
        damage: (current?.damage ?? 0) + source.damage,
      });
    }
  }
  const orderedSources = [...totals]
    .sort(([leftName, left], [rightName, right]) => right.damage - left.damage
      || left.label.localeCompare(right.label)
      || leftName.localeCompare(rightName));
  const named = orderedSources.slice(0, MAX_NAMED_SERIES).map(([id, source], index) => ({
    id,
    label: source.label,
    color: COLORS[index]!,
    sourceNames: new Set([id]) as ReadonlySet<string>,
  }));
  const remaining = orderedSources.slice(MAX_NAMED_SERIES);
  if (remaining.length === 0) return named;
  return [...named, {
    id: OTHER_SERIES_ID,
    label: "Other",
    color: COLORS[MAX_NAMED_SERIES]!,
    sourceNames: new Set(remaining.map(([id]) => id)),
  }];
}

function buildRows(intervals: readonly DamageBySourceChartInterval[], series: readonly DamageSeries[]): DamageChartRow[] {
  return intervals.flatMap((interval) => series.map((item, seriesOrder) => ({
    intervalStartSeconds: interval.startSeconds,
    intervalEndSeconds: interval.endSeconds,
    intervalCenterSeconds: interval.startSeconds + (interval.endSeconds - interval.startSeconds) / 2,
    intervalTotalDamage: interval.totalDamage,
    seriesId: item.id,
    seriesLabel: item.label,
    seriesOrder,
    damage: damageForSeries(interval, item),
    color: item.color,
  })));
}

function damageForSeries(interval: DamageBySourceChartInterval, series: DamageSeries): number {
  return interval.sources.reduce((total, source) => series.sourceNames.has(source.rawName) ? total + source.damage : total, 0);
}

function formatIntervalRange(interval: DamageBySourceChartInterval): string {
  return `${formatDamageTime(interval.startSeconds)}–${formatDamageTime(interval.endSeconds)}`;
}

function formatDamage(value: number): string {
  return value.toLocaleString("en", { maximumFractionDigits: 3 });
}

function formatAxisDamage(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(rounded) >= 1_000 ? `${(rounded / 1_000).toFixed(1)}k` : String(rounded);
}

function formatTooltipGroup(points: readonly ChartPoint<DamageChartRow, number, number>[]): string {
  const first = points[0]?.datum;
  if (first === undefined) return "";
  const values = [...points].sort((left, right) => left.datum.seriesOrder - right.datum.seriesOrder);
  return [
    `${formatDamageTime(first.intervalStartSeconds)}–${formatDamageTime(first.intervalEndSeconds)}`,
    `Total: ${formatDamage(first.intervalTotalDamage)} combat-log damage`,
    ...values.map((point) => `${point.datum.seriesLabel}: ${formatDamage(point.datum.damage)}`),
  ].join("\n");
}

function descriptionText(intervals: readonly DamageBySourceChartInterval[]): string {
  if (intervals.length === 0) {
    return "Stacked combat-log damage in 30-second intervals. No intervals are available. Use the left and right arrow keys after focusing the chart to inspect intervals.";
  }
  return `Stacked combat-log damage in 30-second intervals from ${formatDamageTime(intervals[0]!.startSeconds)} to ${formatDamageTime(intervals.at(-1)!.endSeconds)}. Quiet game-time gaps remain visible. Use the left and right arrow keys after focusing the chart to inspect intervals.`;
}
