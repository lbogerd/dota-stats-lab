import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, Gauge, HardDrive, ListChecks, Radio, ShieldAlert } from "lucide-react";
import type { SamplerHealth, SamplerStatus } from "../server/sampler-monitoring.js";
import { formatCount } from "./data.js";
import { PageHeading } from "./ui.js";

const statusStyle: Record<SamplerHealth, string> = {
  healthy: "bg-[#dcebdd] text-[#315f4a]",
  warning: "bg-[#f4e8bd] text-[#775f17]",
  critical: "bg-[#fae2dc] text-[#a33c2f]",
  starting: "bg-[#e6e9e3] text-[#59655e]",
  unavailable: "bg-[#fae2dc] text-[#a33c2f]",
};

export function SamplerStatusView({ status }: { status: SamplerStatus }) {
  const unhealthy = status.status === "critical" || status.status === "unavailable";
  const statusLabel = status.status.charAt(0).toUpperCase() + status.status.slice(1);
  const lastWindow = status.lastWindow;
  return (
    <>
      <PageHeading
        eyebrow="Operations"
        title="Ranked match sampler"
        description="Live collection health, selection volume, queue pressure, and storage use. This page refreshes every 30 seconds."
        action={<span className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-xs font-bold uppercase tracking-[0.09em] ${statusStyle[status.status]}`}>{unhealthy ? <ShieldAlert size={15} /> : status.status === "healthy" ? <CheckCircle2 size={15} /> : <Activity size={15} />}{statusLabel}</span>}
      />

      {status.dryRun && <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-[#e4d49c] bg-[#fff8dd] p-3.5 text-xs leading-5 text-[#735d1e]"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><p><strong>Dry run is on.</strong> Match IDs are selected but are not added to the ingestion queue.</p></div>}

      {status.reasons.length > 0 && <section className="mb-6 card overflow-hidden" aria-label="Sampler alerts">
        <div className="border-b border-[#e4e5de] px-5 py-4"><p className="eyebrow">Attention</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em]">{status.reasons.length} active {status.reasons.length === 1 ? "reason" : "reasons"}</h2></div>
        <div className="divide-y divide-[#e7e8e2]">{status.reasons.map((reason) => <div key={reason.code} className="flex items-start gap-3 px-5 py-3.5"><div className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${reason.severity === "critical" ? "bg-[#fae2dc] text-[#a33c2f]" : "bg-[#f4e8bd] text-[#775f17]"}`}><AlertTriangle size={14} /></div><div><p className="text-sm font-semibold">{reason.severity === "critical" ? "Critical" : "Warning"}</p><p className="mt-0.5 text-xs leading-5 text-[#68736d]">{reason.message}</p></div></div>)}</div>
      </section>}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Ranked candidates" value={formatCount(status.counters.rankedCandidates)} note={`${formatCount(status.counters.candidatesSeen)} public seen · ${formatCount(status.counters.knownRankCandidates)} rank known`} icon={Radio} />
        <MetricCard label="Selected" value={formatCount(status.counters.selected)} note={status.lastWindowFinalizedAt ? `Last window ${formatTime(status.lastWindowFinalizedAt)}` : "No window finalized yet"} icon={ListChecks} />
        <MetricCard label="Enqueued" value={formatCount(status.counters.enqueued)} note={`${formatCount(status.counters.failed)} sampler failures`} icon={Database} />
        <MetricCard label="Waiting jobs" value={formatCount(status.queue.queued)} note={status.queue.oldestQueuedAgeSeconds === null ? "Queue is clear" : `Oldest ${formatDuration(status.queue.oldestQueuedAgeSeconds)}`} icon={Clock3} />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="card overflow-hidden">
          <div className="border-b border-[#e4e5de] px-5 py-4 sm:px-6"><p className="eyebrow">Service</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em]">Collection activity</h2></div>
          <dl className="divide-y divide-[#e7e8e2]">
            <StatusRow label="Sampler state" value={status.state} detail={status.updatedAt ? `Heartbeat ${formatDuration(status.heartbeatAgeSeconds ?? 0)}` : "Waiting for first heartbeat"} />
            <StatusRow label="Provider" value={status.lastProviderSuccessAt ? "Connected" : "Waiting"} detail={status.providerAgeSeconds === null ? "No successful request yet" : `Last success ${formatDuration(status.providerAgeSeconds)}`} />
            <StatusRow label="Current UTC window" value={status.currentWindow ? formatWindow(status.currentWindow) : "Not open"} detail={`${formatCount(status.counters.providerRequests)} provider requests`} />
            <StatusRow label="Replay cleanup" value={status.counters.cleanupFailed === 0 ? "Clear" : `${formatCount(status.counters.cleanupFailed)} failed`} detail="Sampled replays are removed after successful loading" />
          </dl>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-[#e4e5de] px-5 py-4 sm:px-6"><p className="eyebrow">Storage</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em]">Disk use</h2></div>
          <div className="p-5 sm:p-6">
            {status.disk.scratch ? <>
              <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><HardDrive size={17} className="text-[#557761]" /><span className="text-sm font-semibold">Scratch and jobs</span></div><span className="font-mono text-sm font-semibold">{status.disk.scratch.usedPercent.toFixed(1)}%</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e3e5de]"><div className={`h-full rounded-full ${status.disk.scratch.usedPercent >= 85 ? "bg-[#d05847]" : status.disk.scratch.usedPercent >= 70 ? "bg-[#c49a2d]" : "bg-[#557761]"}`} style={{ width: `${Math.min(100, status.disk.scratch.usedPercent)}%` }} /></div>
              <p className="mt-2 text-xs text-[#778079]">{formatBytes(status.disk.scratch.availableBytes)} free of {formatBytes(status.disk.scratch.totalBytes)}</p>
            </> : <p className="text-sm text-[#778079]">Disk information is not available.</p>}
            <div className="mt-6 flex items-center justify-between rounded-xl bg-[#eff1e8] p-3.5"><div className="flex items-center gap-2 text-sm font-semibold"><Database size={16} className="text-[#557761]" />Warehouse file</div><span className="font-mono text-sm">{status.disk.warehouseBytes === null ? "Not created" : formatBytes(status.disk.warehouseBytes)}</span></div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-[#e4e5de] px-5 py-4 sm:px-6"><p className="eyebrow">Last window</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em]">Selection result</h2></div>
          {lastWindow ? <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4 sm:p-6">
            <SmallMetric label="Candidates" value={lastWindow.candidates} />
            <SmallMetric label="Known rank" value={lastWindow.knownRank} />
            <SmallMetric label="Selected" value={lastWindow.selected} />
            <SmallMetric label="Target" value={lastWindow.target} warning={lastWindow.underTarget} />
          </div> : <EmptyState text="No hourly window has been finalized yet." />}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-[#e4e5de] px-5 py-4 sm:px-6"><p className="eyebrow">Failures</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.025em]">Recent sampler events</h2></div>
          {status.recentFailures.length > 0 ? <div className="divide-y divide-[#e7e8e2]">{status.recentFailures.map((failure, index) => <div key={`${failure.at ?? "unknown"}-${failure.code}-${index}`} className="flex items-center gap-3 px-5 py-3.5"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#fae2dc] text-[#a33c2f]"><AlertTriangle size={15} /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{humanize(failure.code)}</p><p className="mt-0.5 text-xs text-[#778079]">{humanize(failure.stage)}{failure.at ? ` · ${formatTime(failure.at)}` : ""}</p></div></div>)}</div> : <EmptyState text="No recent sampler failures." />}
        </div>
      </section>
    </>
  );
}

function MetricCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Gauge }) {
  return <div className="card min-h-[132px] p-4 sm:p-5"><div className="flex items-start justify-between"><p className="text-xs font-medium text-[#778079]">{label}</p><Icon size={17} className="text-[#98a19b]" /></div><p className="mt-4 text-[1.65rem] font-semibold leading-none tracking-[-0.045em] sm:text-[1.9rem]">{value}</p><p className="mt-2 text-[0.68rem] font-medium text-[#879089]">{note}</p></div>;
}

function StatusRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6"><div><dt className="text-sm font-semibold">{label}</dt><dd className="mt-1 text-xs text-[#778079]">{detail}</dd></div><dd className="shrink-0 font-mono text-xs font-semibold text-[#526158]">{value}</dd></div>;
}

function SmallMetric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className={`rounded-xl p-3.5 ${warning ? "bg-[#fff0e7] text-[#9b4a35]" : "bg-[#eff1e8]"}`}><p className="text-[0.65rem] font-bold uppercase tracking-[0.09em] opacity-65">{label}</p><p className="mt-2 font-mono text-xl font-semibold">{formatCount(value)}</p></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex min-h-36 items-center justify-center p-6 text-center text-sm text-[#778079]">{text}</div>;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds <= 5 ? "just now" : `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) { value /= 1_024; unit += 1; }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function formatWindow(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value));
}

function humanize(value: string): string {
  return value.replaceAll(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}
