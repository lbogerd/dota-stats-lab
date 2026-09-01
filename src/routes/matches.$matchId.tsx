import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Clock3, Shield, Swords, Trophy } from "lucide-react";
import {
  displayValue,
  formatInteger,
  formatMatchDate,
  formatMatchDuration,
  gameModeLabel,
  lobbyTypeLabel,
  localTimeZoneLabel,
  matchOverviewQuery,
  teamName,
} from "../web/overview-data";
import {
  MatchLensControls,
  MatchLensProvider,
  matchLensSearch,
  parseMatchLensSearch,
  resolveMatchLens,
} from "../web/match-lens";
import { StatusBadge } from "../web/ui";

export const Route = createFileRoute("/matches/$matchId")({
  validateSearch: parseMatchLensSearch,
  loader: ({ context, params }) => context.queryClient.ensureQueryData(matchOverviewQuery(params.matchId)),
  pendingComponent: MatchPending,
  errorComponent: ({ error, reset }) => <MatchError error={error} retry={reset} />,
  component: MatchDetailLayout,
});

function MatchDetailLayout() {
  const { matchId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: match } = useSuspenseQuery(matchOverviewQuery(matchId));
  if (!match) return <div className="card p-8">
    <h1 className="text-xl font-semibold">Match not found</h1>
    <p className="mt-2 text-sm text-[#526158]">No replay acquisition or extraction exists for match {matchId}.</p>
    <Link to="/matches" className="overview-primary-link mt-5">Return to matches</Link>
  </div>;

  const { summary, netWorthAnalysis } = match;
  const timezone = localTimeZoneLabel();
  const radiantName = teamName(2, summary.radiantTeamName);
  const direName = teamName(3, summary.direTeamName);
  const lens = resolveMatchLens(search, match);
  const updateLens = (nextLens: typeof lens) => {
    void navigate({
      to: ".",
      unsafeRelative: "path",
      search: matchLensSearch(nextLens),
      replace: true,
      resetScroll: false,
    });
  };

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
            <TeamScore name={radiantName} score={summary.radiantScore} winner={summary.winnerTeamId === 2} side="Radiant" />
            <div className="px-1">
              <Swords size={22} aria-hidden="true" className="mx-auto text-[#68766e]" />
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.09em] text-[#526158]">Final</p>
            </div>
            <TeamScore name={direName} score={summary.direScore} winner={summary.winnerTeamId === 3} side="Dire" />
          </div>
          <p className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-[#eef0e9] px-3 py-2.5 text-sm font-semibold">
            <Trophy size={16} aria-hidden="true" className="text-[#315f4a]" />
            Winning team: {displayValue(summary.winnerTeam)}
          </p>
          <div className="mt-3 rounded-xl border border-[#d8ddd5] bg-white px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
              <span className="font-semibold text-[#526158]">Final net worth</span>
              <span className="font-semibold text-[#315f4a]">{advantageLabel(netWorthAnalysis.leader, netWorthAnalysis.advantage)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-3">
              <div><dt className="truncate text-xs text-[#526158]">{radiantName}</dt><dd className="mt-0.5 font-mono text-sm font-semibold">{formatInteger(netWorthAnalysis.radiantNetWorth)}</dd></div>
              <div className="text-right"><dt className="truncate text-xs text-[#526158]">{direName}</dt><dd className="mt-0.5 font-mono text-sm font-semibold">{formatInteger(netWorthAnalysis.direNetWorth)}</dd></div>
            </dl>
          </div>
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

    <MatchLensControls lens={lens} match={match} onChange={updateLens} />
    <MatchSectionNav matchId={matchId} />
    <MatchLensProvider lens={lens} match={match}>
      <div className="mt-6"><Outlet /></div>
    </MatchLensProvider>
  </>;
}

function MatchSectionNav({ matchId }: { matchId: string }) {
  const linkClass = "flex min-h-10 shrink-0 items-center rounded-xl px-3.5 py-2 text-sm font-semibold text-[#526158] transition hover:bg-[#eef0e9] hover:text-[#263a30] [&.active]:bg-[#315f4a] [&.active]:text-white";
  return <nav className="mt-5 overflow-x-auto rounded-2xl border border-[#d8ddd5] bg-[#fbfaf5] p-1.5" aria-label="Match details sections">
    <div className="flex min-w-max gap-1">
      <Link to="/matches/$matchId" params={{ matchId }} search={(previous) => previous} resetScroll={false} activeOptions={{ exact: true }} className={linkClass}>Overview</Link>
      <Link to="/matches/$matchId/timelines" params={{ matchId }} search={(previous) => previous} resetScroll={false} className={linkClass}>Timelines</Link>
      <Link to="/matches/$matchId/combat" params={{ matchId }} search={(previous) => previous} resetScroll={false} className={linkClass}>Combat</Link>
      <Link to="/matches/$matchId/fights" params={{ matchId }} search={(previous) => previous} resetScroll={false} className={linkClass}>Fights</Link>
      <Link to="/matches/$matchId/map-farming" params={{ matchId }} search={(previous) => previous} resetScroll={false} className={linkClass}>Map &amp; farming</Link>
    </div>
  </nav>;
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

function advantageLabel(leader: string | null, advantage: string | null): string {
  if (leader === null || advantage === null) return "Advantage unknown";
  if (leader === "Even") return "Even";
  return `${leader} +${formatInteger(advantage)}`;
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
