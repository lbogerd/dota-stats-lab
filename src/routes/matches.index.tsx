import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, ChevronRight, Plus, Search, Swords } from "lucide-react";
import { useState } from "react";
import {
  displayValue,
  formatMatchDate,
  formatMatchDuration,
  localTimeZoneLabel,
  matchOverviewsQuery,
  type MatchListItem,
} from "../web/overview-data";
import { PageHeading, StatusBadge } from "../web/ui";

export const Route = createFileRoute("/matches/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(matchOverviewsQuery()),
  pendingComponent: MatchesPending,
  errorComponent: ({ error, reset }) => <MatchesError error={error} retry={reset} />,
  component: MatchesPage,
});

function MatchesPage() {
  const { data: matches } = useSuspenseQuery(matchOverviewsQuery());
  const [filter, setFilter] = useState("");
  const visible = matches.filter((match) => match.matchId.includes(filter.trim()));
  const timezone = localTimeZoneLabel();

  return <>
    <PageHeading
      eyebrow="Match archive"
      title="Stored matches"
      description={`Results from the latest successful extraction. Dates are shown in ${timezone}.`}
      action={<Link to="/ingest" className="overview-primary-link"><Plus size={17} /> Add match</Link>}
    />

    <section className="card overflow-hidden" aria-labelledby="match-list-title">
      <h2 id="match-list-title" className="sr-only">Stored match results</h2>
      <div className="flex flex-col gap-3 border-b border-[#d8ddd5] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <label className="relative block" htmlFor="match-filter">
          <span className="sr-only">Filter matches by match ID</span>
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#526158]" />
          <input
            id="match-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Filter by match ID"
            className="h-11 w-full rounded-xl border border-[#c8cec5] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#315f4a] sm:w-72"
          />
        </label>
        <p className="text-sm text-[#526158]" aria-live="polite">{visible.length} {visible.length === 1 ? "match" : "matches"} · newest first</p>
      </div>

      {visible.length > 0 ? <>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <caption className="sr-only">Match date, duration, result, and team scores</caption>
            <thead className="bg-[#eef0e9] text-xs font-bold uppercase tracking-[0.08em] text-[#526158]">
              <tr>
                <th scope="col" className="px-5 py-3">Match</th>
                <th scope="col" className="px-4 py-3">Date</th>
                <th scope="col" className="px-4 py-3">Duration</th>
                <th scope="col" className="px-4 py-3">Result</th>
                <th scope="col" className="px-4 py-3 text-center">Radiant</th>
                <th scope="col" className="px-4 py-3 text-center">Dire</th>
                <th scope="col" className="w-14 px-4 py-3"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#dde1d9]">
              {visible.map((match) => <DesktopMatchRow key={match.matchId} match={match} />)}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-[#dde1d9] md:hidden">
          {visible.map((match) => <MobileMatchCard key={match.matchId} match={match} />)}
        </div>
      </> : <div className="px-6 py-14 text-center">
        <Swords size={24} aria-hidden="true" className="mx-auto text-[#607168]" />
        <p className="mt-3 text-sm font-semibold">{matches.length === 0 ? "No matches stored yet" : "No matching match ID"}</p>
        <p className="mt-1 text-sm text-[#526158]">{matches.length === 0 ? "Ingest a replay to build the first overview." : "Try a shorter numeric filter."}</p>
      </div>}
    </section>
  </>;
}

function DesktopMatchRow({ match }: { match: MatchListItem }) {
  return <tr className="transition hover:bg-white">
    <th scope="row" className="px-5 py-4 font-normal">
      <Link to="/matches/$matchId" params={{ matchId: match.matchId }} className="font-mono text-sm font-semibold text-[#233b30] underline-offset-4 hover:underline">
        {match.matchId}
      </Link>
      <div className="mt-1"><MatchStatus status={match.status} /></div>
    </th>
    <td className="px-4 py-4 text-sm text-[#425148]">
      {match.startTime === null ? "Unknown" : <time dateTime={match.startTime}>{formatMatchDate(match.startTime)}</time>}
    </td>
    <td className="px-4 py-4 font-mono text-sm text-[#425148]">{formatMatchDuration(match.durationSeconds)}</td>
    <td className="px-4 py-4 text-sm font-semibold text-[#263a30]">{resultLabel(match)}</td>
    <td className="px-4 py-4 text-center font-mono text-base font-semibold">{displayValue(match.radiantScore)}</td>
    <td className="px-4 py-4 text-center font-mono text-base font-semibold">{displayValue(match.direScore)}</td>
    <td className="px-4 py-4">
      <Link to="/matches/$matchId" params={{ matchId: match.matchId }} aria-label={`Open match ${match.matchId}`} className="grid size-10 place-items-center rounded-xl text-[#315f4a] hover:bg-[#e4eadf]">
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </td>
  </tr>;
}

function MobileMatchCard({ match }: { match: MatchListItem }) {
  return <Link to="/matches/$matchId" params={{ matchId: match.matchId }} className="block px-4 py-4 transition hover:bg-white">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-mono text-sm font-semibold">{match.matchId}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-[#526158]">
          <CalendarDays size={13} aria-hidden="true" />
          {match.startTime === null ? "Unknown date" : <time dateTime={match.startTime}>{formatMatchDate(match.startTime)}</time>}
        </p>
      </div>
      <MatchStatus status={match.status} />
    </div>
    <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center rounded-xl bg-[#eef0e9] px-3 py-3 text-center">
      <div><p className="truncate text-xs font-semibold">{match.radiantTeamName || "Radiant"}</p><p className="mt-1 font-mono text-xl font-semibold">{displayValue(match.radiantScore)}</p></div>
      <div className="px-3"><p className="text-xs font-semibold text-[#405047]">{resultLabel(match)}</p><p className="mt-1 font-mono text-xs text-[#59675f]">{formatMatchDuration(match.durationSeconds)}</p></div>
      <div><p className="truncate text-xs font-semibold">{match.direTeamName || "Dire"}</p><p className="mt-1 font-mono text-xl font-semibold">{displayValue(match.direScore)}</p></div>
    </div>
  </Link>;
}

function MatchStatus({ status }: { status: string }) {
  const badgeStatus = status === "succeeded" ? "ready" : status === "failed" ? "failed" : "queued";
  return <StatusBadge status={badgeStatus} />;
}

function resultLabel(match: MatchListItem): string {
  return match.winnerTeam === null ? "Unknown" : `${match.winnerTeam} victory`;
}

function MatchesPending() {
  return <div className="card p-8" role="status"><p className="text-sm font-semibold">Loading stored matches…</p></div>;
}

function MatchesError({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="card p-8" role="alert">
    <h1 className="text-xl font-semibold">Matches could not be loaded</h1>
    <p className="mt-2 text-sm text-[#526158]">{error.message}</p>
    <button type="button" onClick={retry} className="overview-primary-link mt-5">Try again</button>
  </div>;
}
