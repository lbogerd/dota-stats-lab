import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ImageOff, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import type { HeroStatistic, HeroStatsOverview } from "../server/hero-stats";
import { heroAsset } from "../web/dota-assets";
import { heroStatsQuery } from "../web/hero-stats-data";
import { PageHeading } from "../web/ui";

export const Route = createFileRoute("/heroes")({
  loader: ({ context }) => context.queryClient.ensureQueryData(heroStatsQuery()),
  pendingComponent: HeroesPending,
  errorComponent: ({ error, reset }) => <HeroesError error={error} retry={reset} />,
  component: HeroesPage,
});

function HeroesPage() {
  const { data } = useSuspenseQuery(heroStatsQuery());
  return <HeroesOverview overview={data} />;
}

export function HeroesOverview({ overview }: { overview: HeroStatsOverview }) {
  const matchLabel = `${formatCount(overview.matchCount)} ${overview.matchCount === 1 ? "match" : "matches"}`;
  return <>
    <PageHeading
      eyebrow="Hero performance"
      title="Hero overview"
      description={`Picks, bans, results, and economy across ${matchLabel} in the latest successful extractions.`}
    />

    <section className="card overflow-hidden" aria-labelledby="hero-statistics-title">
      <div className="border-b border-[#d8ddd5] px-4 py-4 sm:px-5">
        <h2 id="hero-statistics-title" className="text-base font-semibold tracking-[-0.02em]">Hero statistics</h2>
        <p className="mt-1 text-sm text-[#526158]">Metric scope: {matchLabel}</p>
      </div>

      {overview.heroes.length > 0 ? <>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1080px] border-collapse text-left">
            <caption className="sr-only">Hero economy, match results, pick rate, and ban rate</caption>
            <thead className="bg-[#eef0e9] text-[0.68rem] font-bold uppercase tracking-[0.07em] text-[#526158]">
              <tr>
                <th scope="col" className="px-5 py-3">Hero</th>
                <th scope="col" className="px-4 py-3 text-right">Average GPM</th>
                <th scope="col" className="px-4 py-3 text-right">Average XPM</th>
                <th scope="col" className="px-4 py-3 text-right">Wins-Losses</th>
                <th scope="col" className="px-4 py-3 text-right">Win-Loss rate</th>
                <th scope="col" className="px-4 py-3 text-right">Picks and pick rate</th>
                <th scope="col" className="px-5 py-3 text-right">Bans and ban rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#dde1d9]">
              {overview.heroes.map((hero) => <DesktopHeroRow key={hero.heroId} hero={hero} />)}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-[#dde1d9] md:hidden">
          {overview.heroes.map((hero) => <MobileHeroCard key={hero.heroId} hero={hero} />)}
        </div>
      </> : <HeroesEmpty />}
    </section>
  </>;
}

function DesktopHeroRow({ hero }: { hero: HeroStatistic }) {
  return <tr className="transition hover:bg-white">
    <th scope="row" className="px-5 py-3.5 font-normal"><HeroIdentity heroId={hero.heroId} /></th>
    <MetricCell value={formatAverage(hero.averageGpm)} />
    <MetricCell value={formatAverage(hero.averageXpm)} />
    <MetricCell value={`${formatCount(hero.wins)}–${formatCount(hero.losses)}`} />
    <MetricCell value={formatWinLossRate(hero)} />
    <MetricCell value={`${formatCount(hero.picks)} · ${formatRate(hero.pickRate)}`} />
    <MetricCell value={`${formatCount(hero.bans)} · ${formatRate(hero.banRate)}`} padded />
  </tr>;
}

function MetricCell({ value, padded = false }: { value: string; padded?: boolean }) {
  return <td className={`${padded ? "px-5" : "px-4"} py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-[#2e4b3d]`}>{value}</td>;
}

function MobileHeroCard({ hero }: { hero: HeroStatistic }) {
  const metrics = [
    ["Average GPM", formatAverage(hero.averageGpm)],
    ["Average XPM", formatAverage(hero.averageXpm)],
    ["Wins-Losses", `${formatCount(hero.wins)}–${formatCount(hero.losses)}`],
    ["Win-Loss rate", formatWinLossRate(hero)],
    ["Picks and pick rate", `${formatCount(hero.picks)} · ${formatRate(hero.pickRate)}`],
    ["Bans and ban rate", `${formatCount(hero.bans)} · ${formatRate(hero.banRate)}`],
  ] as const;
  return <article className="p-4 sm:p-5">
    <HeroIdentity heroId={hero.heroId} />
    <dl className="mt-4 grid grid-cols-2 gap-2">
      {metrics.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl bg-[#eef0e9] p-3">
        <dt className="text-[0.7rem] font-semibold leading-4 text-[#526158]">{label}</dt>
        <dd className="mt-1 break-words font-mono text-sm font-semibold tabular-nums text-[#2e4b3d]">{value}</dd>
      </div>)}
    </dl>
  </article>;
}

function HeroIdentity({ heroId }: { heroId: number }) {
  const hero = heroAsset(heroId);
  return <div className="flex min-w-0 items-center gap-3">
    <HeroImage name={hero.name} imageUrl={hero.imageUrl} />
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-[#233b30]">{hero.name}</p>
      <p className="mt-0.5 font-mono text-xs text-[#526158]">Hero ID {heroId}</p>
    </div>
  </div>;
}

function HeroImage({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (imageUrl === null || failed) {
    return <span title={name} role="img" aria-label={`${name} image unavailable`} className="grid h-11 w-[78px] shrink-0 place-items-center rounded-lg bg-[#dce2d9] text-[#405047]">
      <ImageOff size={18} aria-hidden="true" />
    </span>;
  }
  return <img src={imageUrl} alt={`${name} hero`} title={name} loading="lazy" onError={() => setFailed(true)} className="h-11 w-[78px] shrink-0 rounded-lg bg-[#dce2d9] object-cover" />;
}

function HeroesEmpty() {
  return <div className="px-6 py-14 text-center">
    <ShieldQuestion size={26} aria-hidden="true" className="mx-auto text-[#607168]" />
    <p className="mt-3 text-sm font-semibold">No hero statistics yet</p>
    <p className="mt-1 text-sm text-[#526158]">Ingest a replay to add hero picks, bans, results, and economy metrics.</p>
  </div>;
}

export function HeroesPending() {
  return <div className="card p-8" role="status"><p className="text-sm font-semibold">Loading hero statistics…</p></div>;
}

export function HeroesError({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="card p-8" role="alert">
    <h1 className="text-xl font-semibold">Hero statistics could not be loaded</h1>
    <p className="mt-2 text-sm text-[#526158]">{error.message}</p>
    <button type="button" onClick={retry} className="overview-primary-link mt-5">Try again</button>
  </div>;
}

export function formatAverage(value: number | null): string {
  return value === null ? "Unknown" : value.toFixed(1);
}

export function formatRate(value: number | null): string {
  return value === null ? "Unknown" : `${(value * 100).toFixed(1)}%`;
}

function formatWinLossRate(hero: Pick<HeroStatistic, "winRate" | "lossRate">): string {
  if (hero.winRate === null || hero.lossRate === null) return "Unknown";
  return `${formatRate(hero.winRate)} win · ${formatRate(hero.lossRate)} loss`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en");
}
