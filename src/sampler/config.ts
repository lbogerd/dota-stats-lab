import path from "node:path";
import { envPositiveInt } from "../config.js";

export type SamplerConfig = ReturnType<typeof loadSamplerConfig>;

export function loadSamplerConfig() {
  const stagingRoot = process.env.STAGING_ROOT ?? "/work/staging";
  const targetPerHour = envPositiveInt("SAMPLER_TARGET_PER_HOUR", 30);
  const priorityPerHour = envNonNegativeInt("SAMPLER_PRIORITY_PER_HOUR", 24);
  const controlPerHour = envNonNegativeInt("SAMPLER_CONTROL_PER_HOUR", 6);
  if (priorityPerHour + controlPerHour > targetPerHour) {
    throw new Error("SAMPLER_PRIORITY_PER_HOUR plus SAMPLER_CONTROL_PER_HOUR cannot exceed SAMPLER_TARGET_PER_HOUR");
  }
  return {
    databasePath: process.env.SAMPLER_DB_PATH ?? path.join(stagingRoot, "sampler", "sampler.duckdb"),
    heartbeatPath: process.env.SAMPLER_HEARTBEAT_PATH ?? path.join(stagingRoot, "sampler", "heartbeat.json"),
    jobsRoot: process.env.JOBS_ROOT ?? path.join(stagingRoot, "jobs"),
    providerUrl: process.env.SAMPLER_PROVIDER_URL ?? "https://api.opendota.com/api/publicMatches",
    providerApiKey: process.env.OPENDOTA_API_KEY,
    pollIntervalMs: envPositiveInt("SAMPLER_POLL_INTERVAL_MS", 60_000),
    heartbeatIntervalMs: envPositiveInt("SAMPLER_HEARTBEAT_INTERVAL_MS", 30_000),
    httpTimeoutMs: envPositiveInt("SAMPLER_HTTP_TIMEOUT_MS", 15_000),
    httpRetryAttempts: envPositiveInt("SAMPLER_HTTP_RETRY_ATTEMPTS", 3),
    backfillHours: envPositiveInt("SAMPLER_BACKFILL_HOURS", 6),
    backfillMaxPages: envPositiveInt("SAMPLER_BACKFILL_MAX_PAGES", 24),
    pollPages: envPositiveInt("SAMPLER_POLL_PAGES", 2),
    maxActiveJobs: envPositiveInt("SAMPLER_MAX_ACTIVE_JOBS", 60),
    windowDelayMinutes: envNonNegativeInt("SAMPLER_WINDOW_DELAY_MINUTES", 90),
    targetPerHour,
    priorityPerHour,
    controlPerHour,
    samplingVersion: nonEmptyEnv("SAMPLER_SAMPLING_VERSION", "ranked-hourly-v1"),
    dryRun: envBoolean("SAMPLER_DRY_RUN", false),
  };
}

function envNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}

function nonEmptyEnv(name: string, fallback: string): string {
  const raw = process.env[name] ?? fallback;
  if (raw.trim().length === 0) throw new Error(`${name} cannot be empty`);
  return raw;
}
