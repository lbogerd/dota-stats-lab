import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import type { JobStatus } from "./data";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="eyebrow mb-2">{eyebrow}</p>
        <h1 className="text-[2rem] font-semibold leading-[1.05] tracking-[-0.045em] text-[#1d2923] sm:text-[2.45rem]">{title}</h1>
        <p className="mt-2.5 max-w-xl text-[0.92rem] leading-6 text-[#68736d]">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: JobStatus | "ready" }) {
  const complete = status === "succeeded" || status === "ready";
  const failed = status === "failed";
  const label = status === "succeeded" ? "Complete" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-[0.09em] ${complete ? "bg-[#dcebdd] text-[#315f4a]" : failed ? "bg-[#fae2dc] text-[#a33c2f]" : "bg-[#f0e9c9] text-[#775f17]"}`}>
      {complete ? <CheckCircle2 size={12} strokeWidth={2.6} /> : failed ? <AlertCircle size={12} strokeWidth={2.6} /> : <LoaderCircle size={12} className="animate-spin" strokeWidth={2.6} />}
      {label}
    </span>
  );
}

export function PrimaryButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#315f4a] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#234636] disabled:cursor-not-allowed disabled:opacity-55 ${className}`} {...props}>{children}</button>;
}

export function SecondaryButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#d9ddd5] bg-[#fbfaf5] px-3.5 text-sm font-semibold text-[#334039] transition hover:border-[#b7c2b9] hover:bg-white disabled:cursor-not-allowed disabled:opacity-55 ${className}`} {...props}>{children}</button>;
}
