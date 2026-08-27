import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

export interface WinProbabilityChartPoint {
  gameTimeSeconds: number;
  radiantProbability: number;
  direProbability: number;
}

const WIDTH = 760;
const HEIGHT = 286;
const PLOT = { left: 58, right: 744, top: 18, bottom: 226 } as const;
const RADIANT_COLOR = "#315f4a";
const DIRE_COLOR = "#d45f4a";

export function WinProbabilityChart({ points, radiantName, direName }: {
  points: WinProbabilityChartPoint[];
  radiantName: string;
  direName: string;
}) {
  const descriptionId = useId();
  const orderedPoints = useMemo(() => [...points]
    .filter((point) => Number.isFinite(point.gameTimeSeconds))
    .sort((left, right) => left.gameTimeSeconds - right.gameTimeSeconds), [points]);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const selectedIndex = selectedTime === null
    ? orderedPoints.length - 1
    : orderedPoints.findIndex((point) => point.gameTimeSeconds === selectedTime);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : orderedPoints.length - 1;
  const activePoint = orderedPoints[activeIndex] ?? null;
  const maxTime = Math.max(orderedPoints.at(-1)?.gameTimeSeconds ?? 0, 1);

  const selectIndex = (index: number) => {
    if (orderedPoints.length === 0) return;
    const nextIndex = Math.max(0, Math.min(orderedPoints.length - 1, index));
    setSelectedTime(orderedPoints[nextIndex]!.gameTimeSeconds);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectIndex(activeIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      selectIndex(activeIndex + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectIndex(orderedPoints.length - 1);
    }
  };

  const onPointerSelect = (event: PointerEvent<SVGSVGElement>) => {
    if (orderedPoints.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const viewBoxX = (event.clientX - bounds.left) / bounds.width * WIDTH;
    const fraction = Math.max(0, Math.min(1, (viewBoxX - PLOT.left) / (PLOT.right - PLOT.left)));
    const targetTime = fraction * maxTime;
    let nearestIndex = 0;
    for (let index = 1; index < orderedPoints.length; index += 1) {
      if (Math.abs(orderedPoints[index]!.gameTimeSeconds - targetTime)
        < Math.abs(orderedPoints[nearestIndex]!.gameTimeSeconds - targetTime)) nearestIndex = index;
    }
    selectIndex(nearestIndex);
  };

  const x = (seconds: number) => PLOT.left + seconds / maxTime * (PLOT.right - PLOT.left);
  const y = (probability: number) => PLOT.bottom - probability * (PLOT.bottom - PLOT.top);
  const radiantPoints = orderedPoints.map((point) => `${x(point.gameTimeSeconds)},${y(point.radiantProbability)}`).join(" ");
  const direPoints = orderedPoints.map((point) => `${x(point.gameTimeSeconds)},${y(point.direProbability)}`).join(" ");

  return <figure className="min-w-0 rounded-xl border border-[#e0e3da] bg-white p-3 sm:p-4">
    {activePoint !== null && <p className="font-mono text-xs text-[#405047]" aria-live="polite">
      {formatProbabilityTime(activePoint.gameTimeSeconds)} · {radiantName} {formatProbability(activePoint.radiantProbability)} · {direName} {formatProbability(activePoint.direProbability)}
    </p>}
    <div
      className="mt-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#4f765f] focus-visible:ring-offset-2"
      tabIndex={0}
      role="group"
      aria-label="Valve win probability, interactive line chart"
      aria-describedby={descriptionId}
      onKeyDown={onKeyDown}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full max-w-full touch-none"
        aria-hidden="true"
        onPointerDown={onPointerSelect}
        onPointerMove={onPointerSelect}
      >
        {[0, 0.5, 1].map((tick) => <g key={tick}>
          <line
            x1={PLOT.left}
            y1={y(tick)}
            x2={PLOT.right}
            y2={y(tick)}
            stroke={tick === 0.5 ? "#9ca69d" : "#e2e5dd"}
            strokeDasharray={tick === 0.5 ? "5 4" : undefined}
          />
          <text x={PLOT.left - 8} y={y(tick) + 4} textAnchor="end" fill="#68736d" fontSize="11">{tick * 100}%</text>
        </g>)}
        <text x={PLOT.right - 4} y={y(0.5) - 7} textAnchor="end" fill="#68736d" fontSize="10">Even chance</text>
        <line x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.bottom} stroke="#bdc5ba" />
        <line x1={PLOT.left} y1={PLOT.bottom} x2={PLOT.right} y2={PLOT.bottom} stroke="#bdc5ba" />
        <text x={PLOT.left} y={PLOT.bottom + 22} textAnchor="start" fill="#68736d" fontSize="11">0:00</text>
        <text x={PLOT.right} y={PLOT.bottom + 22} textAnchor="end" fill="#68736d" fontSize="11">{formatProbabilityTime(maxTime)}</text>
        <text x={12} y={(PLOT.top + PLOT.bottom) / 2} textAnchor="middle" fill="#68736d" fontSize="11" transform={`rotate(-90 12 ${(PLOT.top + PLOT.bottom) / 2})`}>Win probability</text>
        <polyline fill="none" stroke={RADIANT_COLOR} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={radiantPoints} />
        <polyline fill="none" stroke={DIRE_COLOR} strokeWidth="2.5" strokeDasharray="7 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={direPoints} />
        {activePoint !== null && <>
          <line x1={x(activePoint.gameTimeSeconds)} y1={PLOT.top} x2={x(activePoint.gameTimeSeconds)} y2={PLOT.bottom} stroke="#1d2923" strokeDasharray="3 4" />
          <circle cx={x(activePoint.gameTimeSeconds)} cy={y(activePoint.radiantProbability)} r="4" fill={RADIANT_COLOR} stroke="white" strokeWidth="2" />
          <rect x={x(activePoint.gameTimeSeconds) - 4} y={y(activePoint.direProbability) - 4} width="8" height="8" fill={DIRE_COLOR} stroke="white" strokeWidth="2" />
        </>}
      </svg>
    </div>
    <p id={descriptionId} className="sr-only">
      Win probability for {radiantName} and {direName} from {formatProbabilityTime(orderedPoints[0]?.gameTimeSeconds ?? 0)} to {formatProbabilityTime(orderedPoints.at(-1)?.gameTimeSeconds ?? 0)}. The vertical scale is 0 to 100 percent and includes an even-chance line at 50 percent. Use the left and right arrow keys, Home, or End after focusing the chart to inspect exact values.
    </p>
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
