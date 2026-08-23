import path from "node:path";

const stagingRoot = process.env.STAGING_ROOT ?? "/work/staging";

export const paths = {
  replayRoot: process.env.REPLAY_ROOT ?? "/data/replays",
  stagingRoot,
  stagingInboxRoot: process.env.STAGING_INBOX_ROOT ?? path.join(stagingRoot, "inbox"),
  stagingClaimedRoot: process.env.STAGING_CLAIMED_ROOT ?? path.join(stagingRoot, "claimed"),
  jobsRoot: process.env.JOBS_ROOT ?? path.join(stagingRoot, "jobs"),
  warehousePath: process.env.WAREHOUSE_PATH ?? "/data/warehouse/dota.duckdb",
  migrationRoot: process.env.MIGRATION_ROOT ?? "/app/migrations",
};

export const limits = {
  replayBytes: envPositiveInt("MAX_REPLAY_BYTES", 2_000_000_000),
  fetchTimeoutMs: envPositiveInt("FETCH_TIMEOUT_MS", 60_000),
  fetchRetryAttempts: envPositiveInt("FETCH_RETRY_ATTEMPTS", 3),
  fetchRetryBaseMs: envPositiveInt("FETCH_RETRY_BASE_MS", 500),
  fetchRetryMaxMs: envPositiveInt("FETCH_RETRY_MAX_MS", 2_000),
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
