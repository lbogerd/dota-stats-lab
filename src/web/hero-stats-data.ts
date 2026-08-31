import { queryOptions } from "@tanstack/react-query";
import type { HeroStat, HeroStatistic, HeroStatsOverview } from "../server/hero-stats.js";
import { listHeroStatsFn } from "./functions.js";

export type { HeroStat, HeroStatistic, HeroStatsOverview };

const heroStatsQueryKey = ["hero-stats"] as const;

export const heroStatsQuery = () => queryOptions({
  queryKey: heroStatsQueryKey,
  queryFn: (): Promise<HeroStatsOverview> => listHeroStatsFn(),
});
