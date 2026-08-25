import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Download, LoaderCircle, LockKeyhole, Play, Server, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { ingestMatch, jobsQuery, matchIdSchema, queryKeys } from "../web/data";
import { PageHeading, PrimaryButton, StatusBadge } from "../web/ui";

export const Route = createFileRoute("/ingest")({
  loader: ({ context }) => context.queryClient.ensureQueryData(jobsQuery()),
  component: IngestPage,
});

function IngestPage() {
  const queryClient = useQueryClient();
  const { data: jobs } = useSuspenseQuery(jobsQuery());
  const [matchId, setMatchId] = useState("");
  const [error, setError] = useState<string>();
  const active = jobs.find((job) => !["succeeded", "failed"].includes(job.status));
  const currentJob = active ?? jobs[0];
  const mutation = useMutation({
    mutationFn: ingestMatch,
    onSuccess: async () => { setMatchId(""); setError(undefined); await queryClient.invalidateQueries({ queryKey: queryKeys.jobs }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Unable to start ingestion."),
  });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = matchIdSchema.safeParse(matchId.trim());
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Invalid match ID."); return; }
    setError(undefined); mutation.mutate(parsed.data);
  }
  return (
    <>
      <PageHeading eyebrow="New ingestion" title="Bring in a replay." description="Submit one public match ID. The lab will download, parse, and safely load it into your local warehouse." />
      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <section className="card p-5 sm:p-7">
          <p className="eyebrow">Match source</p>
          <form className="mt-5" onSubmit={submit}>
            <label htmlFor="match-id" className="text-sm font-semibold text-[#344139]">Dota 2 match ID</label>
            <div className={`mt-2 flex items-center rounded-2xl border bg-white p-1.5 transition focus-within:ring-4 ${error ? "border-[#db7b68] focus-within:ring-[#db7b68]/10" : "border-[#d8dcd3] focus-within:border-[#789781] focus-within:ring-[#315f4a]/8"}`}>
              <span className="pl-3 font-mono text-sm font-semibold text-[#909893]">#</span>
              <input id="match-id" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="8041927713" value={matchId} onChange={(event) => setMatchId(event.target.value.replace(/\D/g, ""))} className="min-h-11 min-w-0 flex-1 bg-transparent px-2 font-mono text-base font-semibold outline-none placeholder:text-[#b5bbb7]" />
              <PrimaryButton type="submit" disabled={mutation.isPending || Boolean(active)} className="shrink-0 px-4">{mutation.isPending ? <LoaderCircle size={17} className="animate-spin" /> : <Play size={16} fill="currentColor" />}<span className="hidden sm:inline">Start ingestion</span><span className="sm:hidden">Start</span></PrimaryButton>
            </div>
            {error ? <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#a64234]"><TriangleAlert size={13} /> {error}</p> : <p className="mt-2 text-xs text-[#7b847e]">Find the match ID in the post-game screen or match URL.</p>}
          </form>
          <div className="mt-7 grid gap-2 sm:grid-cols-3">
            {[{ icon: Download, title: "Download", body: "Replay source" }, { icon: Server, title: "Parse", body: "Clarity worker" }, { icon: Check, title: "Load", body: "Atomic commit" }].map(({ icon: Icon, title, body }, i) => <div key={title} className="flex items-center gap-3 rounded-xl bg-[#f0f1ea] p-3"><div className="grid size-8 place-items-center rounded-lg bg-white text-[#315f4a]"><Icon size={15} /></div><div><p className="text-xs font-semibold">{i + 1}. {title}</p><p className="mt-0.5 text-[0.65rem] text-[#818984]">{body}</p></div></div>)}
          </div>
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#dde3d8] bg-[#f7f8f2] p-3.5 text-xs leading-5 text-[#69736d]"><LockKeyhole size={15} className="mt-0.5 shrink-0 text-[#557761]" /><p>The parser runs without network or warehouse access. Only validated extraction files reach DuckDB.</p></div>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[#e3e5de] px-5 py-4 sm:px-6"><p className="eyebrow">Current job</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Ingestion status</h2></div>
          {currentJob ? <div className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-lg font-semibold">#{currentJob.matchId}</p><p className="mt-1 text-xs text-[#7d8680]">{active ? "One job runs at a time" : "Most recent job"}</p></div><StatusBadge status={currentJob.status} /></div><div className="relative mt-7 space-y-0">
            {[{ value: "fetching", title: "Replay downloaded", body: "Stored in the durable replay cache" }, { value: "parsing", title: "Parsing replay data", body: "Exporting match, metadata, and combat data" }, { value: "loading", title: "Loading extraction", body: "Validating and committing to DuckDB" }].map((step, i) => { const order = ["queued", "fetching", "parsing", "loading", "succeeded"]; const current = order.indexOf(currentJob.status); const done = currentJob.status === "succeeded" || current > order.indexOf(step.value); const currentStep = current === order.indexOf(step.value); return <div key={step.value} className="relative flex gap-3 pb-6 last:pb-0"><div className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2 ${done ? "border-[#315f4a] bg-[#315f4a] text-white" : currentStep ? "border-[#315f4a] bg-[#e5ecdf] text-[#315f4a]" : "border-[#d8ddd6] bg-[#fbfaf5] text-transparent"}`}>{done ? <Check size={13} strokeWidth={3} /> : currentStep ? <span className="size-2 rounded-full bg-[#315f4a] pulse-soft" /> : null}</div>{i < 2 && <span className={`absolute left-[13px] top-7 h-[calc(100%-28px)] w-px ${done ? "bg-[#315f4a]" : "bg-[#d8ddd6]"}`} />}<div className="pt-0.5"><p className={`text-sm font-semibold ${!done && !currentStep ? "text-[#9aa19c]" : ""}`}>{step.title}</p><p className="mt-0.5 text-xs text-[#8a928d]">{step.body}</p></div></div>; })}
          </div>{currentJob.status === "failed" && <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#fff0ec] p-3.5 text-xs font-medium leading-5 text-[#9b3f33]"><TriangleAlert size={15} className="mt-0.5 shrink-0" />{currentJob.error ?? "Ingestion failed."}</div>}{currentJob.status === "succeeded" && <div className="mt-5 rounded-xl bg-[#e5ecdf] p-3.5 text-xs font-medium leading-5 text-[#315f4a]">The extraction is stored and ready to query.</div>}</div> : <div className="flex min-h-[300px] flex-col items-center justify-center p-8 text-center"><div className="grid size-12 place-items-center rounded-2xl bg-[#e6ecdf] text-[#315f4a]"><Server size={21} /></div><h3 className="mt-4 text-sm font-semibold">The queue is clear</h3><p className="mt-1 max-w-xs text-xs leading-5 text-[#7a837e]">Submit a match and its progress will appear here.</p></div>}
          <div className="border-t border-[#e3e5de] px-5 py-3.5 sm:px-6"><Link to="/" className="flex items-center justify-between text-xs font-semibold text-[#526158]">View recent jobs <ArrowRight size={14} /></Link></div>
        </section>
      </div>
    </>
  );
}
