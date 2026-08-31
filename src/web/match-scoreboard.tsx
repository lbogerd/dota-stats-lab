import { ImageOff } from "lucide-react";
import { useState } from "react";
import type {
  MatchOverview,
  MatchOverviewPlayer,
  MatchOverviewTeamTotals,
} from "../server/overview.js";
import { heroAsset, itemAsset, type DotaAsset } from "./dota-assets.js";
import type { MatchLens } from "./match-lens.js";
import { playersInLens } from "./match-lens.js";
import { formatInteger, teamName } from "./overview-data.js";

export function MatchScoreboard({ match, lens }: { match: MatchOverview; lens: MatchLens }) {
  const { summary } = match;
  const scopedPlayers = playersInLens(match.players, lens);
  const radiant = scopedPlayers.filter((player) => player.teamId === 2);
  const dire = scopedPlayers.filter((player) => player.teamId === 3);
  const radiantTotals = match.teamTotals.find((total) => total.teamId === 2) ?? null;
  const direTotals = match.teamTotals.find((total) => total.teamId === 3) ?? null;
  const showTeamTotals = lens.scope.kind !== "player";
  const visibleTeams = lens.scope.kind === "all" ? [2, 3] : [lens.scope.teamId];

  return <div className="space-y-6">
    {visibleTeams.includes(2) && <TeamRoster
      teamId={2}
      name={teamName(2, summary.radiantTeamName)}
      players={radiant}
      totals={radiantTotals}
      winner={summary.winnerTeamId === 2}
      showTeamTotals={showTeamTotals}
    />}
    {visibleTeams.includes(3) && <TeamRoster
      teamId={3}
      name={teamName(3, summary.direTeamName)}
      players={dire}
      totals={direTotals}
      winner={summary.winnerTeamId === 3}
      showTeamTotals={showTeamTotals}
    />}
  </div>;
}

function TeamRoster({ teamId, name, players, totals, winner, showTeamTotals }: {
  teamId: number;
  name: string;
  players: MatchOverviewPlayer[];
  totals: MatchOverviewTeamTotals | null;
  winner: boolean;
  showTeamTotals: boolean;
}) {
  const titleId = `team-${teamId}-roster`;
  return <section className="card overflow-hidden" aria-labelledby={titleId}>
    <div className="flex items-center justify-between gap-3 border-b border-[#d8ddd5] px-5 py-4 sm:px-6">
      <div>
        <p className="eyebrow">{teamId === 2 ? "Radiant" : "Dire"} roster</p>
        <h2 id={titleId} className="mt-1 text-lg font-semibold">{name}</h2>
      </div>
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
          {showTeamTotals && <TeamTotalsRow totals={totals} />}
        </table>
      </div>
      <div className="divide-y divide-[#dde1d9] lg:hidden">
        {players.map((player) => <PlayerCard key={player.playerSlot} player={player} />)}
        {showTeamTotals && <MobileTotals totals={totals} />}
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
