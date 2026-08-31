import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { MatchOverviewPlayer } from "../server/overview.js";
import { heroAsset } from "./dota-assets.js";
import { HeroHeatmap } from "./hero-heatmap.js";
import { matchHeroHeatmapQuery } from "./overview-data.js";
import type { MatchLens } from "./match-lens.js";
import { lensPlayerSlot, lensTeamId } from "./match-lens.js";

const TIME_STEP_MILLISECONDS = 100;
const QUERY_DEBOUNCE_MILLISECONDS = 200;

export function formatHeatmapTime(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, Math.round(milliseconds / TIME_STEP_MILLISECONDS) * TIME_STEP_MILLISECONDS);
  const totalTenths = safeMilliseconds / TIME_STEP_MILLISECONDS;
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`
    : `${totalMinutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export function parseHeatmapTime(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!parts.every((part) => /^\d+(?:\.\d)?$/.test(part))) return null;

  const secondsText = parts.at(-1)!;
  if (!/^\d{1,2}(?:\.\d)?$/.test(secondsText)) return null;
  const seconds = Number(secondsText);
  if (seconds >= 60) return null;

  let totalSeconds: number;
  if (parts.length === 2) {
    if (!/^\d+$/.test(parts[0]!)) return null;
    totalSeconds = Number(parts[0]) * 60 + seconds;
  } else {
    if (!/^\d+$/.test(parts[0]!) || !/^\d{1,2}$/.test(parts[1]!)) return null;
    const minutes = Number(parts[1]);
    if (minutes >= 60) return null;
    totalSeconds = Number(parts[0]) * 3_600 + minutes * 60 + seconds;
  }
  const milliseconds = totalSeconds * 1_000;
  return Number.isSafeInteger(milliseconds) && milliseconds % TIME_STEP_MILLISECONDS === 0 ? milliseconds : null;
}

export function HeroHeatmapSection({ matchId, durationSeconds, players, lens }: {
  matchId: string;
  durationSeconds: number | null;
  players: MatchOverviewPlayer[];
  lens?: MatchLens;
}) {
  const durationMilliseconds = durationSeconds === null || !Number.isFinite(durationSeconds)
    ? 0
    : Math.max(0, Math.floor(durationSeconds * 1_000 / TIME_STEP_MILLISECONDS) * TIME_STEP_MILLISECONDS);
  const [startMilliseconds, setStartMilliseconds] = useState(0);
  const [endMilliseconds, setEndMilliseconds] = useState(durationMilliseconds);
  const [startText, setStartText] = useState(formatHeatmapTime(0));
  const [endText, setEndText] = useState(formatHeatmapTime(durationMilliseconds));
  const [startError, setStartError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const [playerSlot, setPlayerSlot] = useState<number | null>(null);
  const debouncedStart = useDebouncedValue(startMilliseconds, QUERY_DEBOUNCE_MILLISECONDS);
  const debouncedEnd = useDebouncedValue(endMilliseconds, QUERY_DEBOUNCE_MILLISECONDS);
  const queryStart = lens === undefined ? debouncedStart : lens.startSeconds * 1_000;
  const queryEnd = lens === undefined ? debouncedEnd : lens.endSeconds * 1_000;
  const queryPlayerSlot = lens === undefined ? playerSlot : lensPlayerSlot(lens);
  const queryTeamId = lens === undefined || queryPlayerSlot !== null ? null : lensTeamId(lens);
  const query = useQuery({
    ...matchHeroHeatmapQuery(matchId, queryStart, queryEnd, queryPlayerSlot, queryTeamId),
    placeholderData: keepPreviousData,
  });

  const changeRange = (which: "start" | "end", rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const value = Math.round(parsed / TIME_STEP_MILLISECONDS) * TIME_STEP_MILLISECONDS;
    if (which === "start") {
      const next = Math.min(Math.max(0, value), endMilliseconds);
      setStartMilliseconds(next);
      setStartText(formatHeatmapTime(next));
      setStartError(null);
    } else {
      const next = Math.max(startMilliseconds, Math.min(durationMilliseconds, value));
      setEndMilliseconds(next);
      setEndText(formatHeatmapTime(next));
      setEndError(null);
    }
  };

  const commitText = (which: "start" | "end") => {
    const text = which === "start" ? startText : endText;
    const parsed = parseHeatmapTime(text);
    const outsideDuration = parsed !== null && parsed > durationMilliseconds;
    const crossesRange = parsed !== null && (which === "start" ? parsed > endMilliseconds : parsed < startMilliseconds);
    if (parsed === null || outsideDuration || crossesRange) {
      const message = parsed === null
        ? "Use m:ss.s or h:mm:ss.s with 100 ms precision."
        : outsideDuration
          ? `Enter a time from 0:00.0 through ${formatHeatmapTime(durationMilliseconds)}.`
          : which === "start" ? "The start time must not be after the end time." : "The end time must not be before the start time.";
      if (which === "start") setStartError(message);
      else setEndError(message);
      return;
    }
    if (which === "start") {
      setStartMilliseconds(parsed);
      setStartText(formatHeatmapTime(parsed));
      setStartError(null);
    } else {
      setEndMilliseconds(parsed);
      setEndText(formatHeatmapTime(parsed));
      setEndError(null);
    }
  };

  const selectedPlayer = queryPlayerSlot === null ? undefined : players.find((player) => player.playerSlot === queryPlayerSlot);
  const selectedLabel = selectedPlayer !== undefined
    ? playerOptionLabel(selectedPlayer)
    : queryTeamId === 2 ? "Radiant heroes" : queryTeamId === 3 ? "Dire heroes" : "All heroes";

  return <section className="card min-w-0 overflow-hidden p-5 sm:p-6" aria-labelledby="hero-heatmap-title">
    <div>
      <p className="eyebrow">Position analysis</p>
      <h2 id="hero-heatmap-title" className="mt-1 text-lg font-semibold">Hero location heat map</h2>
      <p className="mt-1 text-sm text-[#526158]">Living main-hero locations sampled every 100 ms on pause-safe game time.</p>
    </div>

    <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
      <div className="min-w-0 space-y-4">
        {lens === undefined ? <><label className="block text-sm font-semibold text-[#405047]">
          Hero
          <select
            aria-label="Heat map hero"
            value={playerSlot ?? "all"}
            onChange={(event) => setPlayerSlot(event.target.value === "all" ? null : Number(event.target.value))}
            className="mt-1 h-11 w-full rounded-xl border border-[#cdd3ca] bg-white px-3 text-[#263a30]"
          >
            <option value="all">All heroes</option>
            {players.map((player) => <option key={player.playerSlot} value={player.playerSlot}>{playerOptionLabel(player)}</option>)}
          </select>
        </label>

        <TimeControl
          label="Start time"
          value={startMilliseconds}
          text={startText}
          minimum={0}
          maximum={endMilliseconds}
          error={startError}
          onRangeChange={(value) => changeRange("start", value)}
          onTextChange={setStartText}
          onTextCommit={() => commitText("start")}
        />
        <TimeControl
          label="End time"
          value={endMilliseconds}
          text={endText}
          minimum={startMilliseconds}
          maximum={durationMilliseconds}
          error={endError}
          onRangeChange={(value) => changeRange("end", value)}
          onTextChange={setEndText}
          onTextCommit={() => commitText("end")}
        />

        <p className="rounded-xl bg-[#eef0e9] p-3 text-sm leading-6 text-[#405047]">
          Selection: <strong>{selectedLabel}</strong>, {formatHeatmapTime(startMilliseconds)}–{formatHeatmapTime(endMilliseconds)}.
        </p>
        </> : <p className="rounded-xl bg-[#eef0e9] p-4 text-sm leading-6 text-[#405047]">
          Showing <strong>{selectedLabel}</strong> from {formatHeatmapTime(queryStart)} through {formatHeatmapTime(queryEnd)}. Adjust the match lens above to update this map.
        </p>}
      </div>

      <div className="min-w-0">
        {query.isPending && <HeatmapStatus kind="loading">Loading hero locations…</HeatmapStatus>}
        {query.isError && <div className="rounded-xl border border-[#e1b8ad] bg-[#fff0ec] p-5 text-sm text-[#74362d]" role="alert">
          <p className="font-semibold">Hero locations could not be loaded.</p>
          <p className="mt-1">{query.error instanceof Error ? query.error.message : "An unknown error occurred."}</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-3 min-h-10 rounded-lg bg-[#74362d] px-3 font-semibold text-white">Try again</button>
        </div>}
        {query.isSuccess && !query.data.available && <HeatmapStatus kind="unavailable">
          Hero position data is unavailable for this extraction. Re-extract the replay with the current parser to enable this heat map.
        </HeatmapStatus>}
        {query.isSuccess && query.data.available && query.data.sampleCount === 0 && <HeatmapStatus kind="empty">
          No living hero locations are available for {formatHeatmapTime(query.data.startMilliseconds)}–{formatHeatmapTime(query.data.endMilliseconds)}.
        </HeatmapStatus>}
        {query.isSuccess && query.data.available && query.data.sampleCount > 0 && <div>
          <HeroHeatmap cells={query.data.cells} maximumCellCount={query.data.maximumCellCount} />
          <p className="mt-3 text-sm leading-6 text-[#405047]" aria-live="polite">
            Showing <strong>{query.data.sampleCount.toLocaleString("en")}</strong> position samples from {formatHeatmapTime(query.data.startMilliseconds)} through {formatHeatmapTime(query.data.endMilliseconds)}.
          </p>
        </div>}
        {query.isFetching && !query.isPending && <p className="mt-3 text-xs font-semibold text-[#526158]" role="status" aria-live="polite">Updating heat map…</p>}
      </div>
    </div>
  </section>;
}

function TimeControl({ label, value, text, minimum, maximum, error, onRangeChange, onTextChange, onTextCommit }: {
  label: string;
  value: number;
  text: string;
  minimum: number;
  maximum: number;
  error: string | null;
  onRangeChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onTextCommit: () => void;
}) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return <fieldset className="min-w-0 rounded-xl border border-[#d8ddd5] p-3">
    <legend className="px-1 text-sm font-semibold text-[#405047]">{label}</legend>
    <input
      type="range"
      aria-label={`${label} range`}
      min={minimum}
      max={maximum}
      step={TIME_STEP_MILLISECONDS}
      value={value}
      onChange={(event) => onRangeChange(event.target.value)}
      className="h-11 w-full cursor-pointer accent-[#315f4a]"
    />
    <label htmlFor={`${id}-text`} className="mt-1 block text-xs font-semibold text-[#526158]">Exact time</label>
    <input
      id={`${id}-text`}
      type="text"
      inputMode="decimal"
      value={text}
      aria-invalid={error !== null}
      aria-describedby={error === null ? undefined : `${id}-error`}
      onChange={(event) => onTextChange(event.target.value)}
      onBlur={onTextCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onTextCommit();
        }
      }}
      className="mt-1 h-11 w-full rounded-xl border border-[#cdd3ca] bg-white px-3 font-mono text-[#263a30]"
    />
    {error !== null && <p id={`${id}-error`} className="mt-2 text-xs font-semibold text-[#9b3f31]" role="alert">{error}</p>}
  </fieldset>;
}

function HeatmapStatus({ kind, children }: { kind: "loading" | "unavailable" | "empty"; children: React.ReactNode }) {
  const warning = kind === "unavailable";
  return <div
    className={`rounded-xl border p-5 text-sm leading-6 ${warning ? "border-[#e1c784] bg-[#fff8e4] text-[#614d1c]" : "border-[#d8ddd5] bg-[#eef0e9] text-[#405047]"}`}
    role="status"
  >{children}</div>;
}

function playerOptionLabel(player: MatchOverviewPlayer): string {
  const anonymousIndex = (player.teamSlot ?? player.playerSlot) + 1;
  const playerName = player.playerName?.trim() || `Anonymous player ${anonymousIndex}`;
  return `${playerName} · ${heroAsset(player.heroId).name}`;
}

function useDebouncedValue<T>(value: T, delayMilliseconds: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMilliseconds);
    return () => window.clearTimeout(timeout);
  }, [delayMilliseconds, value]);
  return debouncedValue;
}
