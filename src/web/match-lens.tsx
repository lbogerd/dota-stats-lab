import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { createContext, useContext } from "react";
import type { MatchOverview, MatchOverviewPlayer } from "../server/overview.js";
import { heroAsset } from "./dota-assets.js";
import { teamName } from "./overview-data.js";

export interface MatchLensSearch {
  scope?: string;
  start?: number;
  end?: number;
}

export type MatchLensScope =
  | { kind: "all" }
  | { kind: "team"; teamId: 2 | 3 }
  | { kind: "player"; playerSlot: number; teamId: 2 | 3 };

export interface MatchLens {
  scope: MatchLensScope;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

interface MatchLensContextValue {
  lens: MatchLens;
  match: MatchOverview;
}

const MatchLensContext = createContext<MatchLensContextValue | null>(null);

export function parseMatchLensSearch(search: Record<string, unknown>): MatchLensSearch {
  const scope = typeof search.scope === "string" ? search.scope : undefined;
  const start = searchInteger(search.start);
  const end = searchInteger(search.end);
  return { scope, start, end };
}

export function resolveMatchLens(search: MatchLensSearch, match: MatchOverview): MatchLens {
  const durationSeconds = match.summary.durationSeconds === null || !Number.isFinite(match.summary.durationSeconds)
    ? 0
    : Math.max(0, Math.floor(match.summary.durationSeconds));
  const rawStart = clamp(search.start ?? 0, 0, durationSeconds);
  const rawEnd = clamp(search.end ?? durationSeconds, 0, durationSeconds);
  const startSeconds = Math.min(rawStart, rawEnd);
  const endSeconds = Math.max(rawStart, rawEnd);
  const scope = resolveScope(search.scope, match.players);
  return { scope, startSeconds, endSeconds, durationSeconds };
}

export function matchLensSearch(lens: MatchLens): MatchLensSearch {
  return {
    scope: lens.scope.kind === "all"
      ? undefined
      : lens.scope.kind === "team"
        ? `team-${lens.scope.teamId}`
        : `player-${lens.scope.playerSlot}`,
    start: lens.startSeconds === 0 ? undefined : lens.startSeconds,
    end: lens.endSeconds === lens.durationSeconds ? undefined : lens.endSeconds,
  };
}

export function MatchLensProvider({ lens, match, children }: MatchLensContextValue & { children: React.ReactNode }) {
  return <MatchLensContext.Provider value={{ lens, match }}>{children}</MatchLensContext.Provider>;
}

export function useMatchLens(): MatchLensContextValue {
  const value = useContext(MatchLensContext);
  if (value === null) throw new Error("useMatchLens must be used inside MatchLensProvider");
  return value;
}

export function MatchLensControls({ lens, match, onChange }: {
  lens: MatchLens;
  match: MatchOverview;
  onChange: (lens: MatchLens) => void;
}) {
  const radiantName = teamName(2, match.summary.radiantTeamName);
  const direName = teamName(3, match.summary.direTeamName);
  const selectedScope = scopeValue(lens.scope);
  const isDefault = lens.scope.kind === "all" && lens.startSeconds === 0 && lens.endSeconds === lens.durationSeconds;

  const setScope = (value: string) => {
    onChange({ ...lens, scope: resolveScope(value, match.players) });
  };
  const setStart = (value: number) => {
    onChange({ ...lens, startSeconds: Math.min(value, lens.endSeconds) });
  };
  const setEnd = (value: number) => {
    onChange({ ...lens, endSeconds: Math.max(value, lens.startSeconds) });
  };

  return <section className="mt-5 rounded-2xl border border-[#cfd7cd] bg-[#e8eee3] p-4 sm:p-5" aria-labelledby="match-lens-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.09em] text-[#315f4a]"><SlidersHorizontal size={14} aria-hidden="true" /> Match lens</p>
        <h2 id="match-lens-title" className="mt-1 text-base font-semibold">Filter every section from one place</h2>
        <p className="mt-1 text-sm text-[#526158]">The lens stays with this match while you move between sections.</p>
      </div>
      <button
        type="button"
        disabled={isDefault}
        onClick={() => onChange({ ...lens, scope: { kind: "all" }, startSeconds: 0, endSeconds: lens.durationSeconds })}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-semibold text-[#405047] shadow-sm disabled:cursor-not-allowed disabled:opacity-45"
      >
        <RotateCcw size={14} aria-hidden="true" /> Reset lens
      </button>
    </div>

    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.2fr)]">
      <label className="block text-sm font-semibold text-[#405047]">
        Data scope
        <select
          aria-label="Match lens data scope"
          value={selectedScope}
          onChange={(event) => setScope(event.target.value)}
          className="mt-1 h-11 w-full rounded-xl border border-[#c5cec2] bg-white px-3 text-[#263a30]"
        >
          <option value="all">Both teams</option>
          <TeamOptions teamId={2} teamLabel={radiantName} players={match.players} />
          <TeamOptions teamId={3} teamLabel={direName} players={match.players} />
        </select>
      </label>

      <fieldset className="min-w-0 rounded-xl border border-[#c5cec2] bg-white px-3 pb-3 pt-2">
        <legend className="px-1 text-sm font-semibold text-[#405047]">Game time</legend>
        <div className="flex items-center justify-between gap-3 font-mono text-xs font-semibold text-[#315f4a]">
          <output htmlFor="match-lens-start">{formatLensTime(lens.startSeconds)}</output>
          <span aria-hidden="true">to</span>
          <output htmlFor="match-lens-end">{formatLensTime(lens.endSeconds)}</output>
        </div>
        <label htmlFor="match-lens-start" className="mt-2 block text-xs font-semibold text-[#526158]">Start</label>
        <input
          id="match-lens-start"
          type="range"
          min={0}
          max={lens.durationSeconds}
          step={1}
          value={lens.startSeconds}
          onChange={(event) => setStart(Number(event.target.value))}
          className="h-8 w-full cursor-pointer accent-[#315f4a]"
        />
        <label htmlFor="match-lens-end" className="block text-xs font-semibold text-[#526158]">End</label>
        <input
          id="match-lens-end"
          type="range"
          min={0}
          max={lens.durationSeconds}
          step={1}
          value={lens.endSeconds}
          onChange={(event) => setEnd(Number(event.target.value))}
          className="h-8 w-full cursor-pointer accent-[#315f4a]"
        />
      </fieldset>
    </div>
  </section>;
}

function TeamOptions({ teamId, teamLabel, players }: {
  teamId: number;
  teamLabel: string;
  players: MatchOverviewPlayer[];
}) {
  return <optgroup label={teamLabel}>
    <option value={`team-${teamId}`}>{teamLabel} · all players</option>
    {players.filter((player) => player.teamId === teamId).map((player) => <option key={player.playerSlot} value={`player-${player.playerSlot}`}>
      {playerLabel(player)}
    </option>)}
  </optgroup>;
}

function resolveScope(value: string | undefined, players: MatchOverviewPlayer[]): MatchLensScope {
  const teamMatch = /^team-(\d+)$/.exec(value ?? "");
  if (teamMatch !== null) {
    const teamId = Number(teamMatch[1]);
    if (teamId === 2 || teamId === 3) return { kind: "team", teamId };
  }
  const playerMatch = /^player-(\d+)$/.exec(value ?? "");
  if (playerMatch !== null) {
    const playerSlot = Number(playerMatch[1]);
    const player = players.find((candidate) => candidate.playerSlot === playerSlot);
    if (player !== undefined && (player.teamId === 2 || player.teamId === 3)) {
      return { kind: "player", playerSlot, teamId: player.teamId };
    }
  }
  return { kind: "all" };
}

export function playersInLens(players: MatchOverviewPlayer[], lens: MatchLens): MatchOverviewPlayer[] {
  if (lens.scope.kind === "all") return players;
  if (lens.scope.kind === "team") {
    const teamId = lens.scope.teamId;
    return players.filter((player) => player.teamId === teamId);
  }
  const playerSlot = lens.scope.playerSlot;
  return players.filter((player) => player.playerSlot === playerSlot);
}

export function lensTeamId(lens: MatchLens): 2 | 3 | null {
  return lens.scope.kind === "all" ? null : lens.scope.teamId;
}

export function lensPlayerSlot(lens: MatchLens): number | null {
  return lens.scope.kind === "player" ? lens.scope.playerSlot : null;
}

export function isTimeInLens(seconds: number, lens: MatchLens): boolean {
  return seconds >= lens.startSeconds && seconds <= lens.endSeconds;
}

function formatLensTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor(wholeSeconds / 60) % 60;
  const remainder = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function playerLabel(player: MatchOverviewPlayer): string {
  const anonymousIndex = (player.teamSlot ?? player.playerSlot) + 1;
  const name = player.playerName?.trim() || `Anonymous player ${anonymousIndex}`;
  return `${name} · ${heroAsset(player.heroId).name}`;
}

function scopeValue(scope: MatchLensScope): string {
  if (scope.kind === "all") return "all";
  if (scope.kind === "team") return `team-${scope.teamId}`;
  return `player-${scope.playerSlot}`;
}

function searchInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
