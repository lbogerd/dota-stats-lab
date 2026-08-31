import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { DamageInterval } from "../server/damage-by-source.js";
import type { MatchOverviewPlayer } from "../server/overview.js";
import { DamageBySourceChart } from "./damage-by-source-chart.js";
import { heroAsset } from "./dota-assets.js";
import { matchDamageBySourceQuery } from "./overview-data.js";
import { formatDamageTime } from "./stacked-damage-interval-chart.js";
import type { MatchLens } from "./match-lens.js";
import { isTimeInLens } from "./match-lens.js";

export function DamageBySourceSection({ matchId, players, lens }: {
  matchId: string;
  players: MatchOverviewPlayer[];
  lens?: MatchLens;
}) {
  const [selectedPlayerSlot, setSelectedPlayerSlot] = useState<number | null>(
    players[0]?.playerSlot ?? null,
  );
  return <section className="card mt-6 min-w-0 overflow-hidden p-5 sm:p-6" aria-labelledby="damage-by-source-title">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">Combat timeline</p>
        <h2 id="damage-by-source-title" className="mt-1 text-lg font-semibold">Damage taken by source</h2>
        <p className="mt-1 text-sm text-[#526158]">Combat-log damage in fixed 30-second intervals.</p>
      </div>
      {players.length > 0 && <label className="block shrink-0 text-sm font-semibold text-[#405047]">
        Hero
        <select
          aria-label="Damage target hero"
          value={selectedPlayerSlot ?? ""}
          onChange={(event) => {
            setSelectedPlayerSlot(Number(event.target.value));
          }}
          className="mt-1 h-11 w-full rounded-xl border border-[#cdd3ca] bg-white px-3 text-[#263a30] sm:w-auto"
        >
          {players.map((player) => <option key={player.playerSlot} value={player.playerSlot}>
            {playerOptionLabel(player)}
          </option>)}
        </select>
      </label>}
    </div>

    {selectedPlayerSlot === null && <TimelineStatus kind="unavailable">
      Damage by source is unavailable because this match has no roster players.
    </TimelineStatus>}
    {selectedPlayerSlot !== null && <DamageBySourcePanel key={selectedPlayerSlot} matchId={matchId} selectedPlayerSlot={selectedPlayerSlot} lens={lens} />}
  </section>;
}

export function DamageBySourcePanel({ matchId, selectedPlayerSlot, lens }: {
  matchId: string;
  selectedPlayerSlot: number;
  lens?: MatchLens;
}) {
  const [selectedStartSeconds, setSelectedStartSeconds] = useState<number>();
  const query = useQuery(matchDamageBySourceQuery(matchId, selectedPlayerSlot));
  const intervals = query.data === undefined ? [] : lens === undefined
    ? query.data.intervals
    : filterIntervals(query.data.intervals, lens);
  const selectedInterval = intervals.find(
    (interval) => interval.startSeconds === selectedStartSeconds,
  ) ?? intervals.at(-1);
  const totalDamage = intervals.reduce((sum, interval) => sum + interval.totalDamage, 0);

  return <>
    {query.isPending && <TimelineStatus kind="loading">
      Loading damage by source…
    </TimelineStatus>}
    {query.isError && <div className="mt-5 rounded-xl border border-[#e1b8ad] bg-[#fff0ec] p-5 text-sm text-[#74362d]" role="alert">
      <p className="font-semibold">Damage by source could not be loaded.</p>
      <p className="mt-1">{query.error instanceof Error ? query.error.message : "An unknown error occurred."}</p>
      <button type="button" onClick={() => void query.refetch()} className="mt-3 min-h-10 rounded-lg bg-[#74362d] px-3 font-semibold text-white">Try again</button>
    </div>}
    {query.isSuccess && !query.data.available && <TimelineStatus kind="unavailable">
      Damage by source is unavailable because this extraction has no usable combat-log timeline. Re-extract the replay with the current parser.
    </TimelineStatus>}
    {query.isSuccess && query.data.available && intervals.length === 0 && <TimelineStatus kind="empty">
      The selected hero has no recorded combat-log damage events inside the lens.
    </TimelineStatus>}
    {query.isSuccess && query.data.available && intervals.length > 0 && selectedInterval !== undefined && <div className="mt-5 min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-[#405047]">
          Showing <strong>{query.data.target?.heroName ?? "selected hero"}</strong>.
        </p>
        <p className="rounded-lg bg-[#eef0e9] px-2.5 py-1 font-mono text-xs font-semibold text-[#526158]">
          {formatDamage(totalDamage)} combat-log damage in lens
        </p>
      </div>
      <DamageBySourceChart
        key={selectedPlayerSlot}
        intervals={intervals}
        selectedStartSeconds={selectedInterval.startSeconds}
        onSelectInterval={setSelectedStartSeconds}
      />
      <IntervalDetail interval={selectedInterval} />
    </div>}
  </>;
}

function filterIntervals(intervals: DamageInterval[], lens: MatchLens): DamageInterval[] {
  return intervals.flatMap((interval) => {
    const sources = interval.sources.flatMap((source) => {
      const via = source.via.flatMap((viaEntry) => {
        const mechanisms = viaEntry.mechanisms.flatMap((mechanism) => {
          const events = mechanism.events.filter((event) => isTimeInLens(event.gameTimeSeconds, lens));
          if (events.length === 0) return [];
          return [{ ...mechanism, events, damage: events.reduce((sum, event) => sum + event.damage, 0) }];
        });
        if (mechanisms.length === 0) return [];
        return [{ ...viaEntry, mechanisms, damage: mechanisms.reduce((sum, mechanism) => sum + mechanism.damage, 0) }];
      });
      if (via.length === 0) return [];
      return [{ ...source, via, damage: via.reduce((sum, viaEntry) => sum + viaEntry.damage, 0) }];
    });
    if (sources.length === 0) return [];
    return [{ ...interval, sources, totalDamage: sources.reduce((sum, source) => sum + source.damage, 0) }];
  });
}

function IntervalDetail({ interval }: { interval: DamageInterval }) {
  const intervalId = interval.startSeconds < 0
    ? `negative-${Math.abs(interval.startSeconds)}`
    : String(interval.startSeconds);
  const titleId = `damage-interval-${intervalId}`;
  return <section className="rounded-xl border border-[#d8ddd5] bg-white p-4 sm:p-5" aria-labelledby={titleId}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id={titleId} className="text-base font-semibold">
        Interval {formatDamageTime(interval.startSeconds)}–{formatDamageTime(interval.endSeconds)}
      </h3>
      <p className="font-mono text-sm font-semibold text-[#315f4a]">
        {formatDamage(interval.totalDamage)} combat-log damage
      </p>
    </div>
    <ol className="mt-4 space-y-4" aria-label="Damage source details">
      {interval.sources.map((source) => <li key={source.rawName} className="rounded-xl bg-[#eef0e9] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="font-semibold">{source.label}</h4>
          <span className="font-mono text-xs font-semibold text-[#526158]">{formatDamage(source.damage)} combat-log damage</span>
        </div>
        <ol className="mt-3 space-y-3">
          {source.via.map((via) => <li key={`${via.kind}:${via.rawName ?? "direct"}`} className="rounded-lg bg-white p-3">
            <div className="flex items-baseline justify-between gap-3">
              <h5 className="text-sm font-semibold">{via.kind === "direct" ? via.label : `via ${via.label}`}</h5>
              <span className="font-mono text-xs text-[#526158]">{formatDamage(via.damage)} combat-log damage</span>
            </div>
            <ol className="mt-2 space-y-2">
              {via.mechanisms.map((mechanism) => <li key={mechanism.rawName ?? "attack"}>
                <div className="flex items-baseline justify-between gap-3 border-b border-[#e4e7e1] pb-1.5">
                  <h6 className="text-xs font-bold uppercase tracking-[0.06em] text-[#405047]">{mechanism.label}</h6>
                  <span className="font-mono text-xs text-[#526158]">{formatDamage(mechanism.damage)} combat-log damage</span>
                </div>
                <ol className="mt-1 divide-y divide-[#e4e7e1]">
                  {mechanism.events.map((event) => <li key={event.sequence} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <time className="font-mono text-[#405047]">{formatDamageTime(event.gameTimeSeconds, true)}</time>
                    <span className="font-semibold">{formatDamage(event.damage)} combat-log damage</span>
                  </li>)}
                </ol>
              </li>)}
            </ol>
          </li>)}
        </ol>
      </li>)}
    </ol>
  </section>;
}

function TimelineStatus({ kind, children }: {
  kind: "loading" | "unavailable" | "empty";
  children: React.ReactNode;
}) {
  const warning = kind === "unavailable";
  return <div
    className={`mt-5 rounded-xl border p-5 text-sm leading-6 ${warning ? "border-[#e1c784] bg-[#fff8e4] text-[#614d1c]" : "border-[#d8ddd5] bg-[#eef0e9] text-[#405047]"}`}
    role="status"
  >{children}</div>;
}

function playerOptionLabel(player: MatchOverviewPlayer): string {
  const anonymousIndex = (player.teamSlot ?? player.playerSlot) + 1;
  const playerName = player.playerName?.trim() || `Anonymous player ${anonymousIndex}`;
  return `${playerName} · ${heroAsset(player.heroId).name} · ${player.team}`;
}

function formatDamage(damage: number): string {
  return damage.toLocaleString("en", { maximumFractionDigits: 3 });
}
