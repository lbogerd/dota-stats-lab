import { useQuery } from "@tanstack/react-query";
import { matchWinProbabilityQuery } from "./overview-data.js";
import { WinProbabilityChart } from "./win-probability-chart.js";

export function WinProbabilitySection({ matchId, radiantName, direName }: {
  matchId: string;
  radiantName: string;
  direName: string;
}) {
  const query = useQuery(matchWinProbabilityQuery(matchId));

  return <section className="card mt-6 min-w-0 overflow-hidden p-5 sm:p-6" aria-labelledby="win-probability-title">
    <div>
      <p className="eyebrow">Replay prediction</p>
      <h2 id="win-probability-title" className="mt-1 text-lg font-semibold">Valve win probability</h2>
      <p className="mt-1 text-sm text-[#526158]">Server prediction from the replay. This application does not calculate the prediction.</p>
    </div>

    {query.isPending && <div className="mt-5 rounded-xl bg-[#eef0e9] p-5 text-sm" role="status">Loading win probability…</div>}
    {query.isError && <div className="mt-5 rounded-xl border border-[#e1b8ad] bg-[#fff0ec] p-5 text-sm text-[#74362d]" role="alert">
      <p className="font-semibold">Win probability could not be loaded.</p>
      <p className="mt-1">{query.error.message}</p>
      <button type="button" onClick={() => void query.refetch()} className="mt-3 min-h-10 rounded-lg bg-[#74362d] px-3 font-semibold text-white">Try again</button>
    </div>}
    {query.isSuccess && query.data.points.length === 0 && <div data-testid="win-probability-unavailable" className="mt-5 rounded-xl border border-[#e1c784] bg-[#fff8e4] p-5 text-sm leading-6 text-[#614d1c]" role="status">
      Valve win probability is not available for this extraction. Extract the replay with the current parser.
    </div>}
    {query.isSuccess && query.data.points.length > 0 && <div data-testid="win-probability-ready" className="mt-5 min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[#526158]">{query.data.points.length.toLocaleString("en")} replay samples</p>
        <p className="rounded-lg bg-[#eef0e9] px-2.5 py-1 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-[#526158]">
          {sourceLabel(query.data.source)}
        </p>
      </div>
      <WinProbabilityChart points={query.data.points} radiantName={radiantName} direName={direName} />
    </div>}
  </section>;
}

function sourceLabel(source: "graph_history" | "spectator_updates" | null): string {
  if (source === "graph_history") return "Replay graph history";
  if (source === "spectator_updates") return "Spectator updates";
  return "Replay data";
}
