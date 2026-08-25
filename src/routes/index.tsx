import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, ChevronRight, Clock3, Database, FileCode2, Layers3, Plus, TerminalSquare, TriangleAlert } from "lucide-react";
import { catalogStatsQuery, formatCount, formatRelative, jobsQuery, matchesQuery, savedQueriesQuery } from "../web/data";
import { PageHeading, StatusBadge } from "../web/ui";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => Promise.all([context.queryClient.ensureQueryData(jobsQuery()), context.queryClient.ensureQueryData(matchesQuery()), context.queryClient.ensureQueryData(catalogStatsQuery()), context.queryClient.ensureQueryData(savedQueriesQuery())]),
  component: Dashboard,
});

function Dashboard() {
  const { data: jobs } = useSuspenseQuery(jobsQuery());
  const { data: matches } = useSuspenseQuery(matchesQuery());
  const { data: catalogStats } = useSuspenseQuery(catalogStatsQuery());
  const { data: savedQueries } = useSuspenseQuery(savedQueriesQuery());
  const active = jobs.find((job) => !["succeeded", "failed"].includes(job.status));
  const recent = jobs.slice(0, 3);
  return (
    <>
      <PageHeading eyebrow="Replay workspace" title="Good afternoon." description="Your local Dota replay warehouse is healthy and ready to explore." action={<Link to="/ingest" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#315f4a] px-4 text-sm font-semibold text-white transition hover:bg-[#234636]"><Plus size={17} /> Ingest match</Link>} />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Stored matches", value: catalogStats.storedMatches.padStart(2, "0"), note: "Catalog total", icon: Database },
          { label: "Total records", value: formatCount(catalogStats.totalRecords), note: "Parser-native", icon: Layers3 },
          { label: "Saved queries", value: savedQueries.length.toString().padStart(2, "0"), note: "Durable files", icon: FileCode2 },
          { label: "Warehouse", value: "Ready", note: "DuckDB online", icon: TerminalSquare },
        ].map(({ label, value, note, icon: Icon }) => (
          <div key={label} className="card min-h-[132px] p-4 sm:p-5">
            <div className="flex items-start justify-between"><p className="text-xs font-medium text-[#778079]">{label}</p><Icon size={17} className="text-[#98a19b]" /></div>
            <p className="mt-4 text-[1.65rem] font-semibold leading-none tracking-[-0.045em] sm:text-[1.9rem]">{value}</p>
            <p className="mt-2 text-[0.68rem] font-medium text-[#879089]">{note}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e4e5de] px-5 py-4 sm:px-6"><div><p className="eyebrow">Queue</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em]">{active ? "Active ingestion" : "Recent ingestion"}</h2></div><Link to="/ingest" className="text-xs font-semibold text-[#315f4a]">View all</Link></div>
          {active ? <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-lg font-semibold tracking-[-0.02em]">#{active.matchId}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-[#778079]"><Clock3 size={13} /> Started {formatRelative(active.createdAt)}</p></div><StatusBadge status={active.status} /></div>
            <div className="mt-7 grid grid-cols-4 gap-1.5" aria-label="Ingestion progress">
              {["Download", "Parse", "Load", "Done"].map((label, index) => { const stage = active.status === "queued" ? 0 : active.status === "fetching" ? 0 : active.status === "parsing" ? 1 : active.status === "loading" ? 2 : 3; return <div key={label}><div className={`h-1.5 rounded-full ${index <= stage ? "bg-[#315f4a]" : "bg-[#e3e5de]"}`} /><p className={`mt-2 text-[0.62rem] font-semibold ${index <= stage ? "text-[#315f4a]" : "text-[#9ca39f]"}`}>{label}</p></div>; })}
            </div>
            <div className="mt-6 rounded-xl bg-[#eff1e8] px-4 py-3 text-xs leading-5 text-[#68736d]"><span className="font-semibold text-[#35433b]">Parsing entity updates.</span> The Clarity worker is exporting replay events into immutable staging files.</div>
          </div> : recent.length > 0 ? <div className="divide-y divide-[#e7e8e2]">
            {recent.map((job) => <div key={job.id} className="flex min-h-[76px] items-center gap-3 px-5 py-3.5 sm:px-6">
              <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${job.status === "succeeded" ? "bg-[#e5ecdf] text-[#315f4a]" : "bg-[#fae3de] text-[#a64638]"}`}>{job.status === "succeeded" ? <CheckCircle2 size={17} /> : <TriangleAlert size={17} />}</div>
              <div className="min-w-0 flex-1"><p className="font-mono text-sm font-semibold">#{job.matchId}</p><p className="mt-1 truncate text-xs text-[#7a837e]">{job.error ?? (job.status === "succeeded" ? "Extraction ready to query" : "Ingestion finished")}</p></div>
              <div className="text-right"><StatusBadge status={job.status} /><p className="mt-1 text-[0.62rem] text-[#929a95]">{formatRelative(job.updatedAt)}</p></div>
            </div>)}
          </div> : <div className="p-8 text-center text-sm text-[#778079]">No ingestion jobs yet.</div>}
        </div>

        <div className="relative overflow-hidden rounded-[18px] bg-[#315f4a] p-5 text-white shadow-sm sm:p-6">
          <div className="absolute -right-16 -top-20 size-52 rounded-full border-[38px] border-white/5" />
          <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.13em] text-[#d9f77f]">Quick query</p>
          <h2 className="mt-3 max-w-xs text-[1.45rem] font-semibold leading-7 tracking-[-0.035em]">Ask a precise question of your replay data.</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-white/62">Open the SQL workbench with a safe, read-only warehouse connection.</p>
          <Link to="/queries" className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#d9f77f] px-4 text-sm font-semibold text-[#1d2923]">Open workbench <ArrowRight size={16} /></Link>
        </div>
      </section>

      <section className="mt-6 card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e4e5de] px-5 py-4 sm:px-6"><div><p className="eyebrow">Catalog</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em]">Recent extractions</h2></div><Link to="/matches" className="flex items-center gap-1 text-xs font-semibold text-[#315f4a]">All matches <ChevronRight size={14} /></Link></div>
        <div className="divide-y divide-[#e7e8e2]">
          {matches.slice(0, 3).map((match) => <Link key={match.matchId} to="/matches/$matchId" params={{ matchId: match.matchId }} className="flex min-h-[72px] items-center gap-3 px-5 py-3.5 transition hover:bg-white sm:px-6"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e5ecdf] text-[#315f4a]"><Database size={16} /></div><div className="min-w-0 flex-1"><p className="font-mono text-sm font-semibold">{match.matchId}</p><p className="mt-1 truncate text-xs text-[#7a837e]">{match.extractionId ?? "No extraction"} · {formatCount(match.counts.total)} records</p></div><span className="hidden text-xs text-[#8a928d] sm:block">{formatRelative(match.acquiredAt)}</span><ChevronRight size={16} className="text-[#a9afab]" /></Link>)}
        </div>
      </section>
    </>
  );
}
