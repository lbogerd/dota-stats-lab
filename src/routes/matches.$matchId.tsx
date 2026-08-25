import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Clock3, ImageOff, Shield, Swords, Trophy } from "lucide-react";
import { useState } from "react";
import type { MatchOverviewPlayer, MatchOverviewTeamTotals } from "../server/overview";
import { heroAsset, itemAsset, type DotaAsset } from "../web/dota-assets";
import { GpmSection } from "../web/gpm-section";
import {
  displayValue,
  formatInteger,
  gameModeLabel,
  formatMatchDate,
  formatMatchDuration,
  lobbyTypeLabel,
  localTimeZoneLabel,
  matchOverviewQuery,
  teamName,
} from "../web/overview-data";
import { StatusBadge } from "../web/ui";

export const Route = createFileRoute("/matches/$matchId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(matchOverviewQuery(params.matchId)),
  pendingComponent: MatchPending,
  errorComponent: ({ error, reset }) => <MatchError error={error} retry={reset} />,
  component: MatchDetail,
});

function MatchDetail() {
  const { matchId } = Route.useParams();
  const { data: match } = useSuspenseQuery(matchOverviewQuery(matchId));
  if (!match) return <div className="card p-8">
    <h1 className="text-xl font-semibold">Match not found</h1>
    <p className="mt-2 text-sm text-[#526158]">No replay acquisition or extraction exists for match {matchId}.</p>
    <Link to="/matches" className="overview-primary-link mt-5">Return to matches</Link>
  </div>;

  const { summary } = match;
  const timezone = localTimeZoneLabel();
  const radiant = match.players.filter((player) => player.teamId === 2);
  const dire = match.players.filter((player) => player.teamId === 3);
  const radiantTotals = match.teamTotals.find((total) => total.teamId === 2) ?? null;
  const direTotals = match.teamTotals.find((total) => total.teamId === 3) ?? null;

  return <>
    <Link to="/matches" className="mb-5 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-[#405047]">
      <ArrowLeft size={16} aria-hidden="true" /> All matches
    </Link>

    <header className="card overflow-hidden">
      <div className="border-b border-[#d8ddd5] px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow">Match overview</p>
            <h1 className="mt-2 font-mono text-[1.75rem] font-semibold tracking-[-0.04em] sm:text-[2.25rem]">#{match.matchId}</h1>
            <div className="mt-2"><MatchStatus status={match.status} /></div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm font-semibold text-[#263a30]">
              {summary.startTime === null ? "Unknown start time" : <time dateTime={summary.startTime}>{formatMatchDate(summary.startTime)}</time>}
            </p>
            <p className="mt-1 text-xs leading-5 text-[#526158]">
              {summary.startTime === null
                ? `Time zone: ${timezone}`
                : timezone === "UTC"
                  ? "UTC"
                  : `${timezone} · UTC: ${formatMatchDate(summary.startTime, "UTC")}`}
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-[1.15fr_0.85fr]">
        <div className="border-b border-[#d8ddd5] p-5 sm:p-7 md:border-b-0 md:border-r">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
            <TeamScore
              name={teamName(2, summary.radiantTeamName)}
              score={summary.radiantScore}
              winner={summary.winnerTeamId === 2}
              side="Radiant"
            />
            <div className="px-1">
              <Swords size={22} aria-hidden="true" className="mx-auto text-[#68766e]" />
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.09em] text-[#526158]">Final</p>
            </div>
            <TeamScore
              name={teamName(3, summary.direTeamName)}
              score={summary.direScore}
              winner={summary.winnerTeamId === 3}
              side="Dire"
            />
          </div>
          <p className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-[#eef0e9] px-3 py-2.5 text-sm font-semibold">
            <Trophy size={16} aria-hidden="true" className="text-[#315f4a]" />
            Winning team: {displayValue(summary.winnerTeam)}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-px bg-[#d8ddd5]">
          <HeaderFact term="Duration" value={formatMatchDuration(summary.durationSeconds)} icon={<Clock3 size={15} />} />
          <HeaderFact term="Game mode" value={gameModeLabel(summary.gameMode)} icon={<Swords size={15} />} />
          <HeaderFact term="Lobby" value={lobbyTypeLabel(summary.lobbyType, summary.lobbyTypeName)} icon={<Shield size={15} />} />
          <HeaderFact term="First blood" value={summary.firstBloodSeconds === null ? "Unknown" : formatMatchDuration(summary.firstBloodSeconds)} icon={<BarChart3 size={15} />} />
        </dl>
      </div>
    </header>

    {summary.extractionId === null && <div className="mt-5 rounded-2xl border border-[#e1c784] bg-[#fff8e4] p-4 text-sm leading-6 text-[#614d1c]" role="status">
      The replay is stored, but match facts are not available from a successful overview extraction yet. Missing values are shown as Unknown.
    </div>}

    <NetWorthAnalysis
      radiantName={teamName(2, summary.radiantTeamName)}
      direName={teamName(3, summary.direTeamName)}
      radiant={match.netWorthAnalysis.radiantNetWorth}
      dire={match.netWorthAnalysis.direNetWorth}
      advantage={match.netWorthAnalysis.advantage}
      leader={match.netWorthAnalysis.leader}
    />

    <GpmSection
      matchId={matchId}
      players={match.players}
      radiantName={teamName(2, summary.radiantTeamName)}
      direName={teamName(3, summary.direTeamName)}
    />

    <div className="mt-6 space-y-6">
      <TeamRoster
        teamId={2}
        name={teamName(2, summary.radiantTeamName)}
        players={radiant}
        totals={radiantTotals}
        winner={summary.winnerTeamId === 2}
      />
      <TeamRoster
        teamId={3}
        name={teamName(3, summary.direTeamName)}
        players={dire}
        totals={direTotals}
        winner={summary.winnerTeamId === 3}
      />
    </div>
  </>;
}

function TeamScore({ name, side, score, winner }: { name: string; side: string; score: number | null; winner: boolean }) {
  return <div className="min-w-0">
    <p className="text-xs font-bold uppercase tracking-[0.09em] text-[#526158]">{side}</p>
    <p className="mt-1 truncate text-sm font-semibold sm:text-base">{name}</p>
    <p className="mt-2 font-mono text-4xl font-semibold tracking-[-0.04em]">{displayValue(score)}</p>
    <p className={`mt-1 min-h-5 text-xs font-bold ${winner ? "text-[#315f4a]" : "text-[#526158]"}`}>{winner ? "Winner" : ""}</p>
  </div>;
}

function HeaderFact({ term, value, icon }: { term: string; value: string; icon: React.ReactNode }) {
  return <div className="bg-[#fbfaf5] p-4 sm:p-5">
    <dt className="flex items-center gap-2 text-xs font-semibold text-[#526158]">{icon}{term}</dt>
    <dd className="mt-2 text-sm font-semibold text-[#263a30]">{value}</dd>
  </div>;
}

function NetWorthAnalysis({ radiantName, direName, radiant, dire, advantage, leader }: {
  radiantName: string;
  direName: string;
  radiant: string | null;
  dire: string | null;
  advantage: string | null;
  leader: string | null;
}) {
  return <section className="card mt-6 p-5 sm:p-6" aria-labelledby="net-worth-title">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">DuckDB analysis</p>
        <h2 id="net-worth-title" className="mt-1 text-lg font-semibold">Final team net worth</h2>
        <p className="mt-1 text-sm text-[#526158]">Aggregated from the final player scoreboard.</p>
      </div>
      <p className="rounded-xl bg-[#e4eadf] px-4 py-2 text-sm font-semibold text-[#244536]">
        {leader === null || advantage === null ? "Advantage: Unknown" : leader === "Even" ? "Even net worth" : `${leader} +${formatInteger(advantage)}`}
      </p>
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-3">
      <div className="rounded-xl bg-[#eef0e9] p-4"><dt className="truncate text-xs font-semibold text-[#526158]">{radiantName}</dt><dd className="mt-1 text-xl font-semibold">{formatInteger(radiant)}</dd></div>
      <div className="rounded-xl bg-[#eef0e9] p-4"><dt className="truncate text-xs font-semibold text-[#526158]">{direName}</dt><dd className="mt-1 text-xl font-semibold">{formatInteger(dire)}</dd></div>
    </dl>
  </section>;
}

function TeamRoster({ teamId, name, players, totals, winner }: {
  teamId: number;
  name: string;
  players: MatchOverviewPlayer[];
  totals: MatchOverviewTeamTotals | null;
  winner: boolean;
}) {
  const titleId = `team-${teamId}-roster`;
  return <section className="card overflow-hidden" aria-labelledby={titleId}>
    <div className="flex items-center justify-between gap-3 border-b border-[#d8ddd5] px-5 py-4 sm:px-6">
      <div><p className="eyebrow">{teamId === 2 ? "Radiant" : "Dire"} roster</p><h2 id={titleId} className="mt-1 text-lg font-semibold">{name}</h2></div>
      <span className="text-sm font-semibold text-[#315f4a]">{winner ? "Winner" : `${players.length} players`}</span>
    </div>

    {players.length === 0 ? <div className="p-8 text-center">
      <p className="text-sm font-semibold">Roster data is unavailable</p>
      <p className="mt-1 text-sm text-[#526158]">The replay did not supply player rows for this team.</p>
    </div> : <>
      <div className="hidden overflow-x-auto lg:block" tabIndex={0} aria-label={`${name} scoreboard, scroll horizontally for all statistics`}>
        <table className="roster-table w-full min-w-[1460px] border-collapse text-left">
          <caption className="sr-only">Final scoreboard and items for {name}</caption>
          <thead className="bg-[#eef0e9] text-xs font-bold uppercase tracking-[0.07em] text-[#405047]">
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-64 bg-[#eef0e9] px-5 py-3">Player / hero</th>
              <th scope="col">Lvl</th><th scope="col">K / D / A</th><th scope="col">LH / DN</th>
              <th scope="col">GPM / XPM</th><th scope="col">Net worth</th><th scope="col">Hero dmg</th>
              <th scope="col">Tower dmg</th><th scope="col">Healing</th><th scope="col" className="min-w-72">Final items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#dde1d9]">
            {players.map((player) => <PlayerTableRow key={player.playerSlot} player={player} />)}
          </tbody>
          <TeamTotalsRow totals={totals} />
        </table>
      </div>
      <div className="divide-y divide-[#dde1d9] lg:hidden">
        {players.map((player) => <PlayerCard key={player.playerSlot} player={player} />)}
        <MobileTotals totals={totals} />
      </div>
    </>}
  </section>;
}

function PlayerTableRow({ player }: { player: MatchOverviewPlayer }) {
  const hero = heroAsset(player.heroId);
  return <tr className="hover:bg-white">
    <th scope="row" className="sticky left-0 z-[5] bg-[#fbfaf5] px-5 py-3 font-normal">
      <PlayerIdentity player={player} hero={hero} />
    </th>
    <StatCell value={player.level} />
    <td>{slashValues(player.kills, player.deaths, player.assists)}</td>
    <td>{slashValues(player.lastHits, player.denies)}</td>
    <td>{slashValues(player.goldPerMin, player.xpPerMin)}</td>
    <StatCell value={player.netWorth} />
    <StatCell value={player.heroDamage} />
    <StatCell value={player.towerDamage} />
    <StatCell value={player.heroHealing} />
    <td><ItemStrip player={player} /></td>
  </tr>;
}

function StatCell({ value }: { value: number | null }) {
  return <td>{formatInteger(value)}</td>;
}

function TeamTotalsRow({ totals }: { totals: MatchOverviewTeamTotals | null }) {
  return <tfoot className="border-t-2 border-[#cbd2c8] bg-[#eef0e9] font-semibold">
    <tr>
      <th scope="row" className="sticky left-0 z-10 bg-[#eef0e9] px-5 py-3 text-sm">Team total</th>
      <td>—</td>
      <td>{totals ? slashValues(totals.kills, totals.deaths, totals.assists) : "Unknown"}</td>
      <td>{totals ? slashValues(totals.lastHits, totals.denies) : "Unknown"}</td>
      <td>—</td>
      <td>{formatInteger(totals?.netWorth ?? null)}</td>
      <td>{formatInteger(totals?.heroDamage ?? null)}</td>
      <td>{formatInteger(totals?.towerDamage ?? null)}</td>
      <td>{formatInteger(totals?.heroHealing ?? null)}</td>
      <td>—</td>
    </tr>
  </tfoot>;
}

function PlayerCard({ player }: { player: MatchOverviewPlayer }) {
  const hero = heroAsset(player.heroId);
  const statistics = [
    ["Level", formatInteger(player.level)], ["K / D / A", slashValues(player.kills, player.deaths, player.assists)],
    ["LH / DN", slashValues(player.lastHits, player.denies)], ["GPM / XPM", slashValues(player.goldPerMin, player.xpPerMin)],
    ["Net worth", formatInteger(player.netWorth)], ["Hero damage", formatInteger(player.heroDamage)],
    ["Tower damage", formatInteger(player.towerDamage)], ["Hero healing", formatInteger(player.heroHealing)],
  ];
  return <article className="p-4 sm:p-5">
    <PlayerIdentity player={player} hero={hero} />
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {statistics.map(([term, value]) => <div key={term} className="rounded-xl bg-[#eef0e9] p-3"><dt className="text-xs font-semibold text-[#526158]">{term}</dt><dd className="mt-1 font-mono text-sm font-semibold">{value}</dd></div>)}
    </dl>
    <div className="mt-4"><p className="text-xs font-semibold text-[#526158]">Final items</p><div className="mt-2"><ItemStrip player={player} /></div></div>
  </article>;
}

function MobileTotals({ totals }: { totals: MatchOverviewTeamTotals | null }) {
  return <div className="bg-[#eef0e9] p-4 sm:p-5">
    <p className="text-sm font-semibold">Team totals</p>
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div><dt className="text-[#526158]">K / D / A</dt><dd className="font-mono font-semibold">{totals ? slashValues(totals.kills, totals.deaths, totals.assists) : "Unknown"}</dd></div>
      <div><dt className="text-[#526158]">LH / DN</dt><dd className="font-mono font-semibold">{totals ? slashValues(totals.lastHits, totals.denies) : "Unknown"}</dd></div>
      <div><dt className="text-[#526158]">Net worth</dt><dd className="font-mono font-semibold">{formatInteger(totals?.netWorth ?? null)}</dd></div>
      <div><dt className="text-[#526158]">Hero damage</dt><dd className="font-mono font-semibold">{formatInteger(totals?.heroDamage ?? null)}</dd></div>
      <div><dt className="text-[#526158]">Tower damage</dt><dd className="font-mono font-semibold">{formatInteger(totals?.towerDamage ?? null)}</dd></div>
      <div><dt className="text-[#526158]">Healing</dt><dd className="font-mono font-semibold">{formatInteger(totals?.heroHealing ?? null)}</dd></div>
    </dl>
  </div>;
}

function PlayerIdentity({ player, hero }: { player: MatchOverviewPlayer; hero: DotaAsset }) {
  const anonymousIndex = (player.teamSlot ?? player.playerSlot) + 1;
  return <div className="flex min-w-0 items-center gap-3">
    <AssetImage asset={hero} kind="hero" />
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold">{player.playerName?.trim() || `Anonymous player ${anonymousIndex}`}</p>
      <p className="mt-0.5 truncate text-xs text-[#526158]">{hero.name}</p>
    </div>
  </div>;
}

function ItemStrip({ player }: { player: MatchOverviewPlayer }) {
  const items = player.items.filter((item) => item.itemId !== null && item.itemId !== 0).sort((left, right) => left.itemSlot - right.itemSlot);
  if (items.length === 0) return <span className="text-sm text-[#526158]">Unknown</span>;
  return <ul className="flex flex-wrap gap-1.5" aria-label={`Final items for ${player.playerName?.trim() || "anonymous player"}`}>
    {items.map((item) => {
      const asset = itemAsset(item.itemId);
      return <li key={item.itemSlot}><AssetImage asset={asset} kind="item" /></li>;
    })}
  </ul>;
}

function AssetImage({ asset, kind }: { asset: DotaAsset; kind: "hero" | "item" }) {
  const [failed, setFailed] = useState(false);
  const dimensions = kind === "hero" ? "h-11 w-[78px]" : "h-9 w-12";
  if (asset.imageUrl === null || failed) return <span title={asset.name} role="img" aria-label={`${asset.name} image unavailable`} className={`grid shrink-0 place-items-center rounded-lg bg-[#dce2d9] text-[#405047] ${dimensions}`}><ImageOff size={kind === "hero" ? 18 : 14} aria-hidden="true" /></span>;
  return <img src={asset.imageUrl} alt={kind === "hero" ? `${asset.name} hero` : asset.name} title={asset.name} loading="lazy" onError={() => setFailed(true)} className={`shrink-0 rounded-lg bg-[#dce2d9] object-cover ${dimensions}`} />;
}

function slashValues(...values: Array<number | string | null>): string {
  return values.map((value) => value === null ? "?" : formatInteger(value)).join(" / ");
}

function MatchStatus({ status }: { status: string }) {
  const badgeStatus = status === "succeeded" ? "ready" : status === "failed" ? "failed" : "queued";
  return <StatusBadge status={badgeStatus} />;
}

function MatchPending() {
  return <div className="card p-8" role="status"><p className="text-sm font-semibold">Loading match overview…</p></div>;
}

function MatchError({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="card p-8" role="alert">
    <h1 className="text-xl font-semibold">Match overview could not be loaded</h1>
    <p className="mt-2 text-sm text-[#526158]">{error.message}</p>
    <button type="button" onClick={retry} className="overview-primary-link mt-5">Try again</button>
  </div>;
}
