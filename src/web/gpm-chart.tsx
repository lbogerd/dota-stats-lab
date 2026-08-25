import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

export interface GpmChartPoint {
  gameTimeSeconds: number;
  gpm: number;
}

export interface GpmChartSeries {
  id: string;
  label: string;
  points: GpmChartPoint[];
}

const WIDTH = 760;
const HEIGHT = 280;
const PLOT = { left: 58, right: 744, top: 18, bottom: 226 } as const;
const COLORS = ["#315f4a", "#d45f4a", "#356a8a", "#a36b12", "#77558f"] as const;

export function GpmChart({ title, series }: { title: string; series: GpmChartSeries[] }) {
  const descriptionId = useId();
  const availableTimes = useMemo(() => [...new Set(series.flatMap((line) => line.points.map((point) => point.gameTimeSeconds)))]
    .filter(Number.isFinite)
    .sort((left, right) => left - right), [series]);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const activeTime = selectedTime !== null && availableTimes.includes(selectedTime)
    ? selectedTime
    : availableTimes.at(-1) ?? null;
  const allPoints = series.flatMap((line) => line.points);
  const maxTime = Math.max(...allPoints.map((point) => point.gameTimeSeconds), 1);
  const rawMinimum = Math.min(...allPoints.map((point) => point.gpm), 0);
  const rawMaximum = Math.max(...allPoints.map((point) => point.gpm), 1);
  const padding = Math.max((rawMaximum - rawMinimum) * 0.06, 1);
  const minimum = rawMinimum < 0 ? rawMinimum - padding : 0;
  const maximum = rawMaximum + padding;
  const range = Math.max(maximum - minimum, 1);
  const values = activeTime === null ? [] : series.flatMap((line) => {
    const point = line.points.find((candidate) => candidate.gameTimeSeconds === activeTime);
    return point === undefined ? [] : [{ ...point, id: line.id, label: line.label }];
  });

  const selectOffset = (offset: number) => {
    if (availableTimes.length === 0) return;
    const currentIndex = activeTime === null ? availableTimes.length - 1 : availableTimes.indexOf(activeTime);
    const nextIndex = Math.max(0, Math.min(availableTimes.length - 1, currentIndex + offset));
    setSelectedTime(availableTimes[nextIndex]!);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectOffset(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectOffset(1);
    } else if (event.key === "Home" && availableTimes.length > 0) {
      event.preventDefault();
      setSelectedTime(availableTimes[0]!);
    } else if (event.key === "End" && availableTimes.length > 0) {
      event.preventDefault();
      setSelectedTime(availableTimes.at(-1)!);
    }
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (availableTimes.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const viewBoxX = (event.clientX - bounds.left) / bounds.width * WIDTH;
    const fraction = Math.max(0, Math.min(1, (viewBoxX - PLOT.left) / (PLOT.right - PLOT.left)));
    const target = fraction * maxTime;
    setSelectedTime(nearestTime(availableTimes, target));
  };

  const x = (seconds: number) => PLOT.left + seconds / maxTime * (PLOT.right - PLOT.left);
  const y = (gpm: number) => PLOT.bottom - (gpm - minimum) / range * (PLOT.bottom - PLOT.top);
  const yTicks = [minimum, minimum + range / 2, maximum];

  return <figure className="min-w-0 rounded-xl border border-[#e0e3da] bg-white p-3 sm:p-4">
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {activeTime !== null && <p className="shrink-0 font-mono text-xs text-[#526158]" aria-live="polite">
        {formatChartTime(activeTime)} · {values.map((point) => `${point.label} ${formatGpm(point.gpm)}`).join(" · ")}
      </p>}
    </div>
    <div
      className="mt-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#4f765f] focus-visible:ring-offset-2"
      tabIndex={0}
      role="group"
      aria-label={`${title}, interactive line chart`}
      aria-describedby={descriptionId}
      onKeyDown={onKeyDown}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto max-w-full touch-none"
        aria-hidden="true"
        onPointerDown={onPointerMove}
        onPointerMove={onPointerMove}
      >
        {yTicks.map((tick) => <g key={tick}>
          <line x1={PLOT.left} y1={y(tick)} x2={PLOT.right} y2={y(tick)} stroke="#e2e5dd" />
          <text x={PLOT.left - 8} y={y(tick) + 4} textAnchor="end" fill="#68736d" fontSize="11">{formatAxisGpm(tick)}</text>
        </g>)}
        <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.bottom} stroke="#bdc5ba" />
        <line x1={PLOT.left} y1={PLOT.bottom} x2={PLOT.right} y2={PLOT.bottom} stroke="#bdc5ba" />
        <text x={PLOT.left} y={PLOT.bottom + 22} textAnchor="start" fill="#68736d" fontSize="11">0:00</text>
        <text x={PLOT.right} y={PLOT.bottom + 22} textAnchor="end" fill="#68736d" fontSize="11">{formatChartTime(maxTime)}</text>
        <text x={12} y={(PLOT.top + PLOT.bottom) / 2} textAnchor="middle" fill="#68736d" fontSize="11" transform={`rotate(-90 12 ${(PLOT.top + PLOT.bottom) / 2})`}>GPM</text>
        {series.map((line, index) => <polyline
          key={line.id}
          fill="none"
          stroke={COLORS[index % COLORS.length]}
          strokeWidth="2.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          points={line.points.map((point) => `${x(point.gameTimeSeconds)},${y(point.gpm)}`).join(" ")}
        />)}
        {activeTime !== null && <>
          <line x1={x(activeTime)} y1={PLOT.top} x2={x(activeTime)} y2={PLOT.bottom} stroke="#1d2923" strokeDasharray="4 4" />
          {values.map((point) => <circle key={point.id} cx={x(point.gameTimeSeconds)} cy={y(point.gpm)} r="4" fill={COLORS[series.findIndex((line) => line.id === point.id) % COLORS.length]} stroke="white" strokeWidth="2" />)}
        </>}
      </svg>
    </div>
    <p id={descriptionId} className="sr-only">
      {series.length} series from {availableTimes.length === 0 ? "no available times" : `${formatChartTime(availableTimes[0]!)} to ${formatChartTime(availableTimes.at(-1)!)}`}. Use left and right arrow keys, Home, or End after focusing the chart to inspect exact values.
    </p>
    <ul className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-[#68736d]" aria-label={`${title} series`}>
      {series.map((line, index) => <li key={line.id} className="min-w-0 max-w-full truncate">
        <span className="mr-1.5 inline-block size-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} aria-hidden="true" />
        {line.label}
      </li>)}
    </ul>
  </figure>;
}

export function nearestTime(times: number[], target: number): number {
  if (times.length === 0) throw new Error("nearestTime requires at least one time");
  let nearest = times[0]!;
  for (const time of times) {
    if (Math.abs(time - target) < Math.abs(nearest - target)) nearest = time;
  }
  return nearest;
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
