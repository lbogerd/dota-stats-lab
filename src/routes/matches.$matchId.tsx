import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Box, Clock3, Copy, Database, FileDigit, HardDrive, Layers3, TerminalSquare } from "lucide-react";
import { formatBytes, formatCount, formatRelative, matchQuery } from "../web/data";
import { StatusBadge } from "../web/ui";

export const Route = createFileRoute("/matches/$matchId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(matchQuery(params.matchId)),
  component: MatchDetail,
});

function MatchDetail() {
  const { matchId } = Route.useParams();
  const { data: match } = useSuspenseQuery(matchQuery(matchId));
  if (!match) return <div className="card p-8"><h1 className="text-xl font-semibold">Match not found</h1><Link to="/matches" className="mt-4 inline-block text-sm font-semibold text-[#315f4a]">Return to matches</Link></div>;
  const latestExtraction = match.extractions[0];
  const latestAcquisition = match.acquisitions[0];
  const latestDate = latestExtraction?.completedAt ?? latestExtraction?.startedAt ?? latestAcquisition?.completedAt ?? latestAcquisition?.requestedAt;
  const ready = latestExtraction?.status === "succeeded";

  return <>
    <Link to="/matches" className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#647068]"><ArrowLeft size={15} /> All matches</Link>
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow mb-2">Match detail</p><div className="flex flex-wrap items-center gap-3"><h1 className="font-mono text-[1.85rem] font-semibold tracking-[-0.04em] sm:text-[2.35rem]">#{match.matchId}</h1><StatusBadge status={ready ? "ready" : "failed"} /></div><p className="mt-2 text-sm text-[#6e7872]">{latestDate ? `${formatRelative(latestDate)} · ` : ""}{match.extractions.length} extraction{match.extractions.length === 1 ? "" : "s"}</p></div><Link to="/queries" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#315f4a] px-4 text-sm font-semibold text-white"><TerminalSquare size={16} /> Query warehouse</Link></div>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        { label: "Raw records", value: formatCount(latestExtraction?.counts.total ?? "0"), icon: Layers3 },
        { label: "Entities", value: formatCount(latestExtraction?.counts.entityInstances ?? "0"), icon: Box },
        { label: "Extractions", value: match.extractions.length.toLocaleString(), icon: FileDigit },
        { label: "Replay size", value: formatBytes(latestAcquisition?.replayBytes ?? null), icon: HardDrive },
      ].map(({ label, value, icon: Icon }) => <div className="card p-4 sm:p-5" key={label}><div className="flex items-center gap-2 text-xs text-[#778079]"><Icon size={15} /> {label}</div><p className="mt-3 text-xl font-semibold tracking-[-0.035em] sm:text-2xl">{value}</p></div>)}
    </section>

    <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="card overflow-hidden"><div className="border-b border-[#e3e5de] px-5 py-4 sm:px-6"><p className="eyebrow">Extraction history</p><h2 className="mt-1 text-lg font-semibold">Immutable outputs</h2></div>
        {match.extractions.length === 0 ? <div className="p-8 text-center text-sm text-[#778079]">No parser extraction has been stored for this match.</div> : <div className="divide-y divide-[#e5e7df]">{match.extractions.map((extraction) => <div key={extraction.extractionId} className="px-5 py-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-mono text-xs font-semibold sm:text-sm">{extraction.extractionId}</p><p className="mt-1 text-xs text-[#7c8580]">Clarity {extraction.parserVersion} · exporter {extraction.exporterVersion}</p></div><StatusBadge status={extraction.status === "succeeded" ? "ready" : "failed"} /></div><div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-[#f0f2ea] p-3 text-center"><div><p className="text-[0.62rem] text-[#7d8680]">Records</p><p className="mt-1 text-xs font-semibold">{formatCount(extraction.counts.total)}</p></div><div><p className="text-[0.62rem] text-[#7d8680]">Output</p><p className="mt-1 text-xs font-semibold">{formatBytes(extraction.outputSizeBytes)}</p></div><div><p className="text-[0.62rem] text-[#7d8680]">Completed</p><p className="mt-1 text-xs font-semibold">{formatRelative(extraction.completedAt ?? extraction.startedAt)}</p></div></div>{extraction.errorMessage && <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[#a44537]"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{extraction.errorMessage}</p>}</div>)}</div>}
      </div>

      <div className="space-y-6">
        <div className="card overflow-hidden"><div className="border-b border-[#e3e5de] px-5 py-4"><p className="eyebrow">Latest acquisition</p><h2 className="mt-1 text-lg font-semibold">Replay source</h2></div>{latestAcquisition ? <dl className="divide-y divide-[#e5e7df] px-5">
          {[{ term: "Source", value: latestAcquisition.source, icon: Database }, { term: "Requested", value: formatRelative(latestAcquisition.requestedAt), icon: Clock3 }, { term: "Checksum", value: latestAcquisition.replaySha256 ?? "—", icon: FileDigit }].map(({ term, value, icon: Icon }) => <div key={term} className="py-4"><dt className="flex items-center gap-2 text-xs font-medium text-[#7c8580]"><Icon size={14} />{term}</dt><dd className={`mt-1.5 flex min-w-0 items-center justify-between gap-2 text-sm font-medium ${term === "Checksum" ? "font-mono text-xs" : ""}`}><span className="truncate">{value}</span>{term === "Checksum" && latestAcquisition.replaySha256 && <button type="button" aria-label="Copy replay checksum" onClick={() => navigator.clipboard.writeText(latestAcquisition.replaySha256!)} className="grid size-8 shrink-0 place-items-center rounded-lg text-[#859089] hover:bg-[#edf0e9]"><Copy size={14} /></button>}</dd></div>)}
        </dl> : <div className="p-6 text-sm text-[#778079]">No acquisition record.</div>}</div>

        <div className="card p-5 sm:p-6"><p className="eyebrow">Data contract</p><h2 className="mt-2 text-lg font-semibold tracking-[-0.02em]">Parser-native by design</h2><p className="mt-2 text-sm leading-6 text-[#6f7973]">Extractions keep protobuf records, blobs, entity lifecycle events, property updates, and checkpoints without friendly-name translation.</p><div className="mt-5 space-y-2">{["Atomic, validated load", "Append-only property updates", "Targeted state reconstruction"].map((label) => <div key={label} className="flex items-center gap-2 rounded-xl bg-[#f0f2ea] px-3 py-2.5 text-xs font-semibold"><span className="size-1.5 rounded-full bg-[#5c8069]" />{label}</div>)}</div></div>
      </div>
    </section>
  </>;
}
