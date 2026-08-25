import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Archive, Database, FlaskConical, LayoutDashboard, Plus, Search, Settings2, Shield, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem { label: string; to: "/" | "/ingest" | "/matches" | "/heroes" | "/queries"; icon: LucideIcon }

const navItems: NavItem[] = [
  { label: "Overview", to: "/", icon: LayoutDashboard },
  { label: "Ingest", to: "/ingest", icon: Plus },
  { label: "Matches", to: "/matches", icon: Archive },
  { label: "Heroes", to: "/heroes", icon: Shield },
  { label: "Queries", to: "/queries", icon: TerminalSquare },
];

function Mark() {
  return (
    <div className="relative grid size-9 place-items-center overflow-hidden rounded-[11px] bg-[#d9f77f] text-[#1d2923]">
      <FlaskConical size={20} strokeWidth={2.35} />
      <span className="absolute -bottom-2 -right-2 size-5 rounded-full bg-[#e86b55]" />
    </div>
  );
}

export function AppShell() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div className="min-h-screen bg-[#f3f1e9] text-[#1d2923]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col border-r border-white/8 bg-[#1d2923] px-4 py-5 text-white lg:flex">
        <Link to="/" className="flex items-center gap-3 px-2">
          <Mark />
          <div>
            <div className="text-sm font-semibold tracking-[-0.01em]">Dota Data Lab</div>
            <div className="mt-0.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-white/45">Replay workspace</div>
          </div>
        </Link>

        <nav className="mt-10 space-y-1" aria-label="Main navigation">
          {navItems.map(({ label, to, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white/62 transition hover:bg-white/6 hover:text-white [&.active]:bg-white/10 [&.active]:text-white"
            >
              <Icon size={18} strokeWidth={1.9} className="text-white/46 transition group-[.active]:text-[#d9f77f]" />
              {label}
              {to === "/ingest" && <span className="ml-auto grid size-5 place-items-center rounded-md bg-[#d9f77f] text-[#1d2923]"><Plus size={13} strokeWidth={2.5} /></span>}
            </Link>
          ))}
        </nav>

        <div className="mt-auto">
          <div className="rounded-2xl border border-white/8 bg-white/[0.045] p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[0.61rem] font-bold uppercase tracking-[0.12em] text-white/45">Warehouse</span>
              <span className="size-2 rounded-full bg-[#a6d96c] shadow-[0_0_0_4px_rgba(166,217,108,0.1)]" />
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-sm font-semibold">Ready</div>
                <div className="mt-0.5 text-[0.7rem] text-white/42">DuckDB connected</div>
              </div>
              <Database size={18} className="text-white/25" />
            </div>
          </div>
          <button className="mt-3 flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-white/46 transition hover:bg-white/5 hover:text-white" type="button">
            <Settings2 size={17} /> System
          </button>
        </div>
      </aside>

      <div className="lg:pl-[236px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#e1e2da] bg-[#f3f1e9]/92 px-4 backdrop-blur-md sm:px-7 lg:px-10">
          <Link to="/" className="flex items-center gap-2.5 lg:hidden">
            <Mark />
            <span className="text-sm font-semibold">Dota Data Lab</span>
          </Link>
          <div className="hidden items-center gap-2 text-xs text-[#778079] lg:flex">
            <span>Workspace</span><span className="text-[#b2b8b3]">/</span><span className="font-medium text-[#344139]">{navItems.find((item) => item.to === (pathname === "/" ? "/" : `/${pathname.split("/")[1]}`))?.label ?? "Detail"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Search" className="grid size-9 place-items-center rounded-xl text-[#69746d] transition hover:bg-white"><Search size={18} /></button>
            <div className="grid size-8 place-items-center rounded-full bg-[#dbe6d5] text-xs font-bold text-[#315f4a]" title="Signed in">XU</div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] px-4 pb-28 pt-7 sm:px-7 lg:px-10 lg:pb-12 lg:pt-9">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[#dfe2d9] bg-[#fbfaf5]/96 px-2 pb-[max(env(safe-area-inset-bottom),0.45rem)] pt-1.5 backdrop-blur-lg lg:hidden" aria-label="Mobile navigation">
        {navItems.map(({ label, to, icon: Icon }) => (
          <Link key={to} to={to} activeOptions={{ exact: to === "/" }} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[0.62rem] font-semibold text-[#7a837e] [&.active]:text-[#315f4a]">
            <span className="grid h-7 min-w-10 place-items-center rounded-full transition [.active_&]:bg-[#dfead8]"><Icon size={19} strokeWidth={1.9} /></span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
