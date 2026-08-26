import path from "node:path";
import { readFile, stat, statfs } from "node:fs/promises";

const HEARTBEAT_FRESH_MS = 2 * 60 * 1_000;
const PROVIDER_WARNING_MS = 15 * 60 * 1_000;
const PROVIDER_CRITICAL_MS = 30 * 60 * 1_000;
const OLDEST_QUEUE_CRITICAL_MS = 2 * 60 * 60 * 1_000;

export type SamplerHealth = "healthy" | "warning" | "critical" | "starting" | "unavailable";
export type SamplerSeverity = "warning" | "critical";

export interface SamplerReason {
  severity: SamplerSeverity;
  code: string;
  message: string;
}

export interface SamplerCounters {
  providerRequests: number;
  candidatesSeen: number;
  rankedCandidates: number;
  knownRankCandidates: number;
  selected: number;
  enqueued: number;
  failed: number;
  cleanupFailed: number;
  windowsUnderTarget: number;
}

export interface SamplerWindowSummary {
  windowStart: string;
  candidates: number;
  knownRank: number;
  selected: number;
  target: number;
  underTarget: boolean;
}

export interface SamplerQueue {
  queued: number;
  oldestQueuedAt: string | null;
  oldestQueuedAgeSeconds: number | null;
}

export interface DiskUsage {
  totalBytes: number;
  availableBytes: number;
  usedPercent: number;
}

export interface SamplerStatus {
  schemaVersion: 1;
  status: SamplerHealth;
  checkedAt: string;
  state: string;
  startedAt: string | null;
  updatedAt: string | null;
  heartbeatAgeSeconds: number | null;
  lastProviderSuccessAt: string | null;
  providerAgeSeconds: number | null;
  lastWindowFinalizedAt: string | null;
  lastWindow: SamplerWindowSummary | null;
  currentWindow: string | null;
  dryRun: boolean;
  counters: SamplerCounters;
  queue: SamplerQueue;
  recentFailures: Array<{ at: string | null; stage: string; code: string }>;
  disk: {
    scratch: DiskUsage | null;
    warehouseBytes: number | null;
  };
  reasons: SamplerReason[];
}

export interface SamplerStatusOptions {
  heartbeatPath?: string;
  stagingRoot?: string;
  warehousePath?: string;
  now?: Date;
}

interface ParsedHeartbeat {
  state: string;
  startedAt: string | null;
  updatedAt: string;
  lastProviderSuccessAt: string | null;
  lastWindowFinalizedAt: string | null;
  lastWindow: SamplerWindowSummary | null;
  currentWindow: string | null;
  dryRun: boolean;
  counters: SamplerCounters;
  queue: { queued: number; oldestQueuedAt: string | null };
  recentFailures: Array<{ at: string | null; stage: string; code: string }>;
}

const emptyCounters = (): SamplerCounters => ({
  providerRequests: 0,
  candidatesSeen: 0,
  rankedCandidates: 0,
  knownRankCandidates: 0,
  selected: 0,
  enqueued: 0,
  failed: 0,
  cleanupFailed: 0,
  windowsUnderTarget: 0,
});

export function samplerHeartbeatPath(stagingRoot = process.env.STAGING_ROOT ?? "/work/staging"): string {
  return process.env.SAMPLER_HEARTBEAT_PATH ?? path.join(stagingRoot, "sampler", "heartbeat.json");
}

export async function getSamplerStatus(options: SamplerStatusOptions = {}): Promise<SamplerStatus> {
  const now = options.now ?? new Date();
  const stagingRoot = options.stagingRoot ?? process.env.STAGING_ROOT ?? "/work/staging";
  const warehousePath = options.warehousePath ?? process.env.WAREHOUSE_PATH ?? "/data/warehouse/dota.duckdb";
  const heartbeatPath = options.heartbeatPath ?? samplerHeartbeatPath(stagingRoot);
  const diskPromise = readDiskUsage(stagingRoot, warehousePath);

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(heartbeatPath, "utf8"));
  } catch (error) {
    const disk = await diskPromise;
    if (isMissingFile(error)) return unavailableStatus("starting", "heartbeat_missing", "The sampler has not written its first heartbeat yet.", now, disk);
    return unavailableStatus("unavailable", "heartbeat_unavailable", "The sampler heartbeat cannot be read.", now, disk);
  }

  const heartbeat = parseHeartbeat(raw);
  const disk = await diskPromise;
  if (heartbeat === null) {
    return unavailableStatus("unavailable", "heartbeat_invalid", "The sampler heartbeat is not valid.", now, disk);
  }

  return evaluateHeartbeat(heartbeat, now, disk);
}

function evaluateHeartbeat(
  heartbeat: ParsedHeartbeat,
  now: Date,
  disk: SamplerStatus["disk"],
): SamplerStatus {
  const reasons: SamplerReason[] = [];
  const heartbeatAgeMs = ageMs(heartbeat.updatedAt, now);
  const providerReference = heartbeat.lastProviderSuccessAt ?? heartbeat.startedAt;
  const providerAgeMs = providerReference === null ? null : ageMs(providerReference, now);
  const oldestQueueAgeMs = heartbeat.queue.oldestQueuedAt === null ? null : ageMs(heartbeat.queue.oldestQueuedAt, now);

  if (heartbeatAgeMs > HEARTBEAT_FRESH_MS) {
    reasons.push({ severity: "critical", code: "heartbeat_stale", message: "The sampler heartbeat is more than 2 minutes old." });
  }

  if (providerAgeMs !== null && providerAgeMs >= PROVIDER_CRITICAL_MS) {
    reasons.push({ severity: "critical", code: "provider_stale", message: "No provider request has succeeded for 30 minutes." });
  } else if (providerAgeMs !== null && providerAgeMs >= PROVIDER_WARNING_MS) {
    reasons.push({ severity: "warning", code: "provider_delayed", message: "No provider request has succeeded for 15 minutes." });
  }

  if (heartbeat.queue.queued > 60) {
    reasons.push({ severity: "warning", code: "queue_large", message: "More than 60 ingestion jobs are waiting." });
  }
  if (oldestQueueAgeMs !== null && oldestQueueAgeMs > OLDEST_QUEUE_CRITICAL_MS) {
    reasons.push({ severity: "critical", code: "queue_stalled", message: "The oldest queued job has waited for more than 2 hours." });
  }

  if (disk.scratch !== null && disk.scratch.usedPercent >= 85) {
    reasons.push({ severity: "critical", code: "scratch_disk_full", message: "Scratch disk use is at least 85%." });
  } else if (disk.scratch !== null && disk.scratch.usedPercent >= 70) {
    reasons.push({ severity: "warning", code: "scratch_disk_high", message: "Scratch disk use is at least 70%." });
  }

  const state = heartbeat.state.toLowerCase();
  if (["error", "failed", "stopped"].includes(state)) {
    reasons.push({ severity: "critical", code: "sampler_not_running", message: `The sampler reports the ${state} state.` });
  } else if (["degraded", "paused"].includes(state)) {
    reasons.push({ severity: "warning", code: "sampler_degraded", message: `The sampler reports the ${state} state.` });
  }

  const status: SamplerHealth = reasons.some((reason) => reason.severity === "critical")
    ? "critical"
    : reasons.some((reason) => reason.severity === "warning")
      ? "warning"
      : state === "starting"
        ? "starting"
        : "healthy";

  return {
    schemaVersion: 1,
    status,
    checkedAt: now.toISOString(),
    state: heartbeat.state,
    startedAt: heartbeat.startedAt,
    updatedAt: heartbeat.updatedAt,
    heartbeatAgeSeconds: seconds(heartbeatAgeMs),
    lastProviderSuccessAt: heartbeat.lastProviderSuccessAt,
    providerAgeSeconds: providerAgeMs === null ? null : seconds(providerAgeMs),
    lastWindowFinalizedAt: heartbeat.lastWindowFinalizedAt,
    lastWindow: heartbeat.lastWindow,
    currentWindow: heartbeat.currentWindow,
    dryRun: heartbeat.dryRun,
    counters: heartbeat.counters,
    queue: {
      queued: heartbeat.queue.queued,
      oldestQueuedAt: heartbeat.queue.oldestQueuedAt,
      oldestQueuedAgeSeconds: oldestQueueAgeMs === null ? null : seconds(oldestQueueAgeMs),
    },
    recentFailures: heartbeat.recentFailures,
    disk,
    reasons,
  };
}

function parseHeartbeat(value: unknown): ParsedHeartbeat | null {
  if (!isRecord(value)) return null;
  const updatedAt = isoDate(value.updatedAt);
  if (updatedAt === null) return null;
  const countersValue = isRecord(value.counters) ? value.counters : {};
  const queueValue = isRecord(value.queue) ? value.queue : {};
  return {
    state: safeLabel(value.state, "starting"),
    startedAt: isoDate(value.startedAt),
    updatedAt,
    lastProviderSuccessAt: isoDate(value.lastProviderSuccessAt),
    lastWindowFinalizedAt: isoDate(value.lastWindowFinalizedAt),
    lastWindow: parseWindowSummary(value.lastWindow),
    currentWindow: readCurrentWindow(value.currentWindow),
    dryRun: value.dryRun === true,
    counters: {
      providerRequests: count(countersValue.providerRequests),
      candidatesSeen: count(countersValue.candidatesSeen),
      rankedCandidates: count(countersValue.rankedCandidates),
      knownRankCandidates: count(countersValue.knownRankCandidates),
      selected: count(countersValue.selected),
      enqueued: count(countersValue.enqueued),
      failed: count(countersValue.failed),
      cleanupFailed: count(countersValue.cleanupFailed),
      windowsUnderTarget: count(countersValue.windowsUnderTarget),
    },
    queue: {
      queued: count(queueValue.queued ?? queueValue.size),
      oldestQueuedAt: isoDate(queueValue.oldestQueuedAt),
    },
    recentFailures: parseRecentFailures(value.recentFailures),
  };
}

function unavailableStatus(
  status: "starting" | "unavailable",
  code: string,
  message: string,
  now: Date,
  disk: SamplerStatus["disk"],
): SamplerStatus {
  return {
    schemaVersion: 1,
    status,
    checkedAt: now.toISOString(),
    state: status,
    startedAt: null,
    updatedAt: null,
    heartbeatAgeSeconds: null,
    lastProviderSuccessAt: null,
    providerAgeSeconds: null,
    lastWindowFinalizedAt: null,
    lastWindow: null,
    currentWindow: null,
    dryRun: false,
    counters: emptyCounters(),
    queue: { queued: 0, oldestQueuedAt: null, oldestQueuedAgeSeconds: null },
    recentFailures: [],
    disk,
    reasons: [{ severity: status === "starting" ? "warning" : "critical", code, message }],
  };
}

async function readDiskUsage(stagingRoot: string, warehousePath: string): Promise<SamplerStatus["disk"]> {
  const [scratch, warehouse] = await Promise.all([
    statfs(stagingRoot, { bigint: true }).then((value) => {
      const totalBytes = Number(value.blocks * value.bsize);
      const availableBytes = Number(value.bavail * value.bsize);
      return {
        totalBytes,
        availableBytes,
        usedPercent: totalBytes === 0 ? 0 : Math.round(((totalBytes - availableBytes) / totalBytes) * 1_000) / 10,
      };
    }).catch(() => null),
    stat(warehousePath).then((value) => value.size).catch(() => null),
  ]);
  return { scratch, warehouseBytes: warehouse };
}

function parseRecentFailures(value: unknown): ParsedHeartbeat["recentFailures"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).filter(isRecord).map((failure) => ({
    at: isoDate(failure.at),
    stage: safeLabel(failure.stage, "unknown"),
    code: safeCode(failure.code),
  }));
}

function parseWindowSummary(value: unknown): SamplerWindowSummary | null {
  if (!isRecord(value)) return null;
  const windowStart = isoDate(value.windowStart);
  if (windowStart === null) return null;
  return {
    windowStart,
    candidates: count(value.candidates ?? value.candidateCount),
    knownRank: count(value.knownRank ?? value.knownRankCount),
    selected: count(value.selected ?? value.selectedCount),
    target: count(value.target),
    underTarget: value.underTarget === true,
  };
}

function readCurrentWindow(value: unknown): string | null {
  const direct = isoDate(value);
  if (direct !== null) return direct;
  if (!isRecord(value)) return null;
  return isoDate(value.windowStart ?? value.start ?? value.startedAt);
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().slice(0, 40);
  return /^[a-zA-Z0-9 _-]+$/.test(clean) && clean.length > 0 ? clean : fallback;
}

function safeCode(value: unknown): string {
  return safeLabel(value, "unknown").replaceAll(" ", "_").toLowerCase();
}

function ageMs(value: string, now: Date): number {
  return Math.max(0, now.getTime() - Date.parse(value));
}

function seconds(milliseconds: number): number {
  return Math.floor(milliseconds / 1_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
