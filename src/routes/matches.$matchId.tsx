import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Box, Clock3, Copy, Database, FileDigit, HardDrive, Layers3, Timer } from "lucide-react";
import { formatBytes, formatDuration, formatRelative, matchQuery } from "../web/data";
import { StatusBadge } from "../web/ui";

export const Route = createFileRoute("/matches/$matchId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(matchQuery(params.matchId)),
  component: MatchDetail,
});

function MatchDetail() {
  const { matchId } = Route.useParams();
  const { data: match } = useSuspenseQuery(matchQuery(matchId));
  if (!match) return <div className="card p-8"><h1 className="text-xl font-semibold">Match not found</h1><Link to="/matches" className="mt-4 inline-block text-sm font-semibold text-[#315f4a]">Return to matches</Link></div>;
  return <>
    <Link to="/matches" className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#647068]"><ArrowLeft size={15} /> All matches</Link>
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow mb-2">Match detail</p><div className="flex flex-wrap items-center gap-3"><h1 className="font-mono text-[1.85rem] font-semibold tracking-[-0.04em] sm:text-[2.35rem]">#{match.matchId}</h1><StatusBadge status="ready" /></div><p className="mt-2 text-sm text-[#6e7872]">Acquired {formatRelative(match.acquiredAt)} · exporter v{match.exporterVersion}</p></div><Link to="/queries/$queryName" params={{ queryName: "hero-property-history" }} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#315f4a] px-4 text-sm font-semibold text-white">Query this match</Link></div>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[{ label: "Game duration", value: formatDuration(match.durationSeconds), icon: Timer }, { label: "Entities", value: match.entities.toLocaleString(), icon: Box }, { label: "Raw records", value: match.records.toLocaleString(), icon: Layers3 }, { label: "Replay size", value: formatBytes(match.replayBytes), icon: HardDrive }].map(({ label, value, icon: Icon }) => <div className="card p-4 sm:p-5" key={label}><div className="flex items-center gap-2 text-xs text-[#778079]"><Icon size={15} /> {label}</div><p className="mt-3 text-xl font-semibold tracking-[-0.035em] sm:text-2xl">{value}</p></div>)}
    </section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="card overflow-hidden"><div className="border-b border-[#e3e5de] px-5 py-4 sm:px-6"><p className="eyebrow">Extraction</p><h2 className="mt-1 text-lg font-semibold">Immutable output</h2></div><dl className="divide-y divide-[#e5e7df] px-5 sm:px-6">
        {[{ term: "Extraction ID", value: match.extractionId, icon: FileDigit, mono: true }, { term: "Exporter version", value: match.exporterVersion, icon: Box }, { term: "Created", value: new Date(match.acquiredAt).toLocaleString(), icon: Clock3 }, { term: "Storage", value: "DuckDB · catalog + raw schemas", icon: Database }].map(({ term, value, icon: Icon, mono }) => <div key={term} className="grid gap-2 py-4 sm:grid-cols-[150px_1fr] sm:items-center"><dt className="flex items-center gap-2 text-xs font-medium text-[#7c8580]"><Icon size={14} />{term}</dt><dd className={`flex min-w-0 items-center justify-between gap-2 text-sm font-medium ${mono ? "font-mono" : ""}`}><span className="truncate">{value}</span>{term === "Extraction ID" && <button type="button" aria-label="Copy extraction ID" onClick={() => navigator.clipboard.writeText(value)} className="grid size-8 shrink-0 place-items-center rounded-lg text-[#859089] hover:bg-[#edf0e9]"><Copy size={14} /></button>}</dd></div>)}
      </dl></div>
      <div className="card p-5 sm:p-6"><p className="eyebrow">Data contract</p><h2 className="mt-2 text-lg font-semibold tracking-[-0.02em]">Parser-native by design</h2><p className="mt-2 text-sm leading-6 text-[#6f7973]">This extraction keeps protobuf records, blobs, entity lifecycle events, property updates, and checkpoints without friendly-name translation.</p><div className="mt-5 space-y-2">{["Atomic, validated load", "Append-only property updates", "Targeted state reconstruction"].map((label) => <div key={label} className="flex items-center gap-2 rounded-xl bg-[#f0f2ea] px-3 py-2.5 text-xs font-semibold"><span className="size-1.5 rounded-full bg-[#5c8069]" />{label}</div>)}</div></div>
    </section>
  </>;
}
