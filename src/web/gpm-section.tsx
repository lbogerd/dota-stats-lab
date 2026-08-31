import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ROLLING_GPM_WINDOWS, type RollingGpmWindowSeconds } from "../lib/gpm.js";
import type { MatchOverviewPlayer } from "../server/overview.js";
import { heroAsset } from "./dota-assets.js";
import { GpmChart, type GpmChartSeries } from "./gpm-chart.js";
import { matchRollingGpmQuery } from "./overview-data.js";
import type { MatchLens } from "./match-lens.js";
import { lensTeamId } from "./match-lens.js";

export function GpmSection({ matchId, players, radiantName, direName, lens }: {
  matchId: string;
  players: MatchOverviewPlayer[];
  radiantName: string;
  direName: string;
  lens?: MatchLens;
}) {
  const [windowSeconds, setWindowSeconds] = useState<RollingGpmWindowSeconds>(60);
  const [selectedTeamId, setSelectedTeamId] = useState(2);
  const query = useQuery(matchRollingGpmQuery(matchId, windowSeconds));
  const teamNames = new Map([[2, radiantName], [3, direName]]);
  const scopedTeamId = lens === undefined ? null : lensTeamId(lens);
  const filterPoints = <T extends { gameTimeSeconds: number }>(points: T[]): T[] => points.filter((point) => lens === undefined
    || (point.gameTimeSeconds >= lens.startSeconds && point.gameTimeSeconds <= lens.endSeconds));
  const teamSeries: GpmChartSeries[] = (query.data?.teams ?? [])
    .filter((series) => lens === undefined || (lens.scope.kind !== "player" && (scopedTeamId === null || series.teamId === scopedTeamId)))
    .map((series) => ({
    id: `team-${series.teamId}`,
    label: teamNames.get(series.teamId) ?? `Team ${series.teamId}`,
    points: filterPoints(series.points),
  }));
  const playerSeries: GpmChartSeries[] = (query.data?.players ?? [])
    .filter((series) => lens === undefined
      ? series.teamId === selectedTeamId
      : lens.scope.kind === "team"
        ? series.teamId === lens.scope.teamId
        : lens.scope.kind === "player" && series.playerSlot === lens.scope.playerSlot)
    .map((series) => ({
      id: `player-${series.playerSlot}`,
      label: playerLabel(players.find((player) => player.playerSlot === series.playerSlot), series.playerSlot),
      points: filterPoints(series.points),
    }));
  const hasData = [...teamSeries, ...playerSeries].some((series) => series.points.length > 0);
  const selectedTeamName = teamNames.get(selectedTeamId) ?? `Team ${selectedTeamId}`;

  return <section className="card min-w-0 overflow-hidden p-5 sm:p-6" aria-labelledby="gpm-title">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">Economy timeline</p>
        <h2 id="gpm-title" className="mt-1 text-lg font-semibold">Granular GPM</h2>
        <p className="mt-1 text-sm text-[#526158]">Rolling earned gold per minute, measured on pause-safe game time.</p>
      </div>
      <label className="flex shrink-0 items-center gap-2 text-sm font-semibold text-[#405047]">
        Window
        <select
          aria-label="Rolling GPM window"
          value={windowSeconds}
          onChange={(event) => setWindowSeconds(Number(event.target.value) as RollingGpmWindowSeconds)}
          className="h-11 rounded-xl border border-[#cdd3ca] bg-white px-3 text-[#263a30]"
        >
          {ROLLING_GPM_WINDOWS.map((value) => <option key={value} value={value}>{value === 300 ? "5m" : `${value}s`}</option>)}
        </select>
      </label>
    </div>

    {query.isPending && <div className="mt-5 rounded-xl bg-[#eef0e9] p-5 text-sm" role="status">Loading rolling GPM…</div>}
    {query.isError && <div className="mt-5 rounded-xl border border-[#e1b8ad] bg-[#fff0ec] p-5 text-sm text-[#74362d]" role="alert">
      <p className="font-semibold">Rolling GPM could not be loaded.</p>
      <p className="mt-1">{query.error.message}</p>
      <button type="button" onClick={() => void query.refetch()} className="mt-3 min-h-10 rounded-lg bg-[#74362d] px-3 font-semibold text-white">Try again</button>
    </div>}
    {query.isSuccess && !hasData && <div className="mt-5 rounded-xl border border-[#e1c784] bg-[#fff8e4] p-5 text-sm leading-6 text-[#614d1c]" role="status">
      Granular gold data is unavailable for this extraction. Re-extract the replay with the current parser to enable this graph.
    </div>}
    {query.isSuccess && hasData && <div className="mt-5 min-w-0 space-y-5">
      <p className="sr-only">
        Rolling GPM data is available for {query.data.teams.length} teams and {query.data.players.length} players at one-second intervals.
      </p>
      {teamSeries.length > 0 && <GpmChart
        title={`Rolling GPM - last ${windowSeconds} seconds`}
        series={teamSeries}
      />}
      {lens === undefined && <div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Player graph team">
          <span className="mr-1 text-xs font-semibold text-[#526158]">Player team</span>
          {[{ id: 2, name: radiantName }, { id: 3, name: direName }].map((team) => <button
            key={team.id}
            type="button"
            onClick={() => setSelectedTeamId(team.id)}
            aria-pressed={selectedTeamId === team.id}
            className={`min-h-10 rounded-lg px-3 py-2 text-xs font-semibold ${selectedTeamId === team.id ? "bg-[#315f4a] text-white" : "bg-[#eef0e9] text-[#405047]"}`}
          >{team.name}</button>)}
        </div>
        <div className="mt-3">
          <GpmChart title={`${selectedTeamName} player rolling GPM`} series={playerSeries} />
        </div>
      </div>}
      {lens !== undefined && playerSeries.length > 0 && <GpmChart
        title={lens.scope.kind === "player" ? "Selected player rolling GPM" : "Players in selected team"}
        series={playerSeries}
      />}
    </div>}
  </section>;
}

function playerLabel(player: MatchOverviewPlayer | undefined, playerSlot: number): string {
  if (player === undefined) return `Player ${playerSlot}`;
  const anonymousIndex = (player.teamSlot ?? player.playerSlot) + 1;
  const playerName = player.playerName?.trim() || `Anonymous player ${anonymousIndex}`;
  return `${playerName} · ${heroAsset(player.heroId).name}`;
}
