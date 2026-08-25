import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

export interface HeroStat {
  heroId: number;
  matchCount: number;
  picks: number;
  bans: number;
  wins: number;
  losses: number;
  pickRate: number;
  banRate: number;
  winRate: number | null;
  lossRate: number | null;
  averageGpm: number | null;
  averageXpm: number | null;
}

export interface HeroStatsOverview {
  matchCount: number;
  heroes: HeroStat[];
}

export type HeroStatistic = HeroStat;

export async function listHeroStats(): Promise<HeroStatsOverview> {
  return withReadOnlyWarehouse(async (connection) => {
    const scopeResult = await connection.runAndReadAll(SCOPE_MATCH_COUNT_SQL);
    const scopeRow = scopeResult.getRowObjectsJson()[0];
    const matchCount = nonnegativeInteger(scopeRow?.match_count, "scope match count");

    const statsResult = await connection.runAndReadAll(HERO_STATS_SQL);
    const heroes = statsResult.getRowObjectsJson().map((row) => {
      const rowMatchCount = nonnegativeInteger(row.match_count, "match count");
      if (rowMatchCount !== matchCount) {
        throw new Error("Unexpected hero statistics match count");
      }

      return {
        heroId: positiveInteger(row.hero_id, "hero ID"),
        matchCount: rowMatchCount,
        picks: nonnegativeInteger(row.picks, "pick count"),
        bans: nonnegativeInteger(row.bans, "ban count"),
        wins: nonnegativeInteger(row.wins, "win count"),
        losses: nonnegativeInteger(row.losses, "loss count"),
        pickRate: rate(row.pick_rate, "pick rate"),
        banRate: rate(row.ban_rate, "ban rate"),
        winRate: nullableRate(row.win_rate, "win rate"),
        lossRate: nullableRate(row.loss_rate, "loss rate"),
        averageGpm: nullableFiniteNumber(row.average_gpm, "average GPM"),
        averageXpm: nullableFiniteNumber(row.average_xpm, "average XPM"),
      };
    });

    return { matchCount, heroes };
  });
}

function positiveInteger(value: JsonValue | undefined, label: string): number {
  const parsed = nonnegativeInteger(value, label);
  if (parsed === 0) throw new Error(`Unexpected hero statistics ${label}`);
  return parsed;
}

function nonnegativeInteger(value: JsonValue | undefined, label: string): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Unexpected hero statistics ${label}`);
  }
  return parsed;
}

function nullableRate(value: JsonValue | undefined, label: string): number | null {
  return value === null || value === undefined ? null : rate(value, label);
}

function rate(value: JsonValue | undefined, label: string): number {
  const parsed = finiteNumber(value, label);
  if (parsed < 0 || parsed > 1) throw new Error(`Unexpected hero statistics ${label}`);
  return parsed;
}

function nullableFiniteNumber(value: JsonValue | undefined, label: string): number | null {
  return value === null || value === undefined ? null : finiteNumber(value, label);
}

function finiteNumber(value: JsonValue | undefined, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Unexpected hero statistics ${label}`);
  return parsed;
}

const SCOPE_MATCH_COUNT_SQL = `
SELECT count(*) AS match_count
FROM analysis.latest_successful_extractions AS latest
JOIN analysis.matches AS match USING (extraction_id, match_id)`;

const HERO_STATS_SQL = `
SELECT
  hero_id, match_count, picks, bans, wins, losses,
  pick_rate, ban_rate, win_rate, loss_rate, average_gpm, average_xpm
FROM analysis.hero_stats()
ORDER BY pick_rate DESC, ban_rate DESC, hero_id`;
