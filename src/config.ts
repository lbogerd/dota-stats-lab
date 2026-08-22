import path from "node:path";

export const paths = {
  replayRoot: process.env.REPLAY_ROOT ?? "/data/replays",
  stagingRoot: process.env.STAGING_ROOT ?? "/work/staging",
  jobsRoot: process.env.JOBS_ROOT ?? path.join(process.env.STAGING_ROOT ?? "/work/staging", "jobs"),
  warehousePath: process.env.WAREHOUSE_PATH ?? "/data/warehouse/dota.duckdb",
  migrationRoot: process.env.MIGRATION_ROOT ?? "/app/migrations",
};

export const limits = {
  replayBytes: envPositiveInt("MAX_REPLAY_BYTES", 2_000_000_000),
  fetchTimeoutMs: envPositiveInt("FETCH_TIMEOUT_MS", 60_000),
};

export function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function replayDir(matchId: bigint): string {
  return path.join(paths.replayRoot, matchId.toString());
}
