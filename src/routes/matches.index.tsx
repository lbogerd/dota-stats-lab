import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Database, Plus, Search } from "lucide-react";
import { useState } from "react";
import { formatBytes, formatCount, formatRelative, matchesQuery } from "../web/data";
import { PageHeading, StatusBadge } from "../web/ui";

export const Route = createFileRoute("/matches/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(matchesQuery()),
  component: MatchesPage,
});

function MatchesPage() {
  const { data: matches } = useSuspenseQuery(matchesQuery());
  const [filter, setFilter] = useState("");
  const visible = matches.filter((match) => match.matchId.includes(filter.trim()));
  return <>
    <PageHeading eyebrow="Replay catalog" title="Stored matches" description="Browse replay acquisitions and their immutable parser extractions." action={<Link to="/ingest" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#315f4a] px-4 text-sm font-semibold text-white"><Plus size={17} /> Add match</Link>} />
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#e2e4dc] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8d9590]" /><input value={filter} onChange={(event) => setFilter(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Filter by match ID" className="h-10 w-full rounded-xl border border-[#dcded7] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#789781] sm:w-64" /></div>
        <p className="text-xs text-[#7a837e]">{visible.length} {visible.length === 1 ? "match" : "matches"} · newest first</p>
      </div>
      <div className="hidden grid-cols-[1.25fr_1.2fr_0.8fr_0.7fr_28px] gap-4 border-b border-[#e2e4dc] bg-[#f4f4ee] px-5 py-2.5 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#818a84] md:grid"><span>Match / extraction</span><span>Acquired</span><span>Records</span><span>Size</span><span /></div>
      <div className="divide-y divide-[#e5e7df]">
        {visible.map((match) => <Link key={match.matchId} to="/matches/$matchId" params={{ matchId: match.matchId }} className="grid gap-3 px-4 py-4 transition hover:bg-white sm:px-5 md:grid-cols-[1.25fr_1.2fr_0.8fr_0.7fr_28px] md:items-center md:gap-4">
          <div className="flex min-w-0 items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e5ecdf] text-[#315f4a]"><Database size={17} /></div><div className="min-w-0"><p className="font-mono text-sm font-semibold">{match.matchId}</p><p className="mt-1 truncate font-mono text-[0.65rem] text-[#89918c]">{match.extractionId}</p></div></div>
          <div className="flex items-center justify-between md:block"><span className="text-[0.65rem] font-bold uppercase tracking-wider text-[#969d98] md:hidden">Acquired</span><div><p className="text-xs font-medium">{formatRelative(match.acquiredAt)}</p><div className="mt-1"><StatusBadge status={match.status === "succeeded" ? "ready" : "failed"} /></div></div></div>
          <div className="flex justify-between text-xs md:block"><span className="font-bold uppercase tracking-wider text-[#969d98] md:hidden">Records</span><span>{formatCount(match.counts.total)}</span></div>
          <div className="flex justify-between text-xs md:block"><span className="font-bold uppercase tracking-wider text-[#969d98] md:hidden">Replay</span><span>{formatBytes(match.replayBytes)}</span></div>
          <ChevronRight size={16} className="hidden text-[#a5aca7] md:block" />
        </Link>)}
        {visible.length === 0 && <div className="p-10 text-center"><p className="text-sm font-semibold">No match found</p><p className="mt-1 text-xs text-[#7a837e]">Try a different match ID.</p></div>}
      </div>
    </div>
  </>;
}
