import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson } from "../jobs/job-files.js";
import type { WindowSummary } from "./types.js";

export type SamplerHeartbeat = {
  schemaVersion: 1;
  state: "starting" | "running" | "paused" | "error";
  startedAt: string;
  updatedAt: string;
  lastProviderSuccessAt?: string;
  lastWindowFinalizedAt?: string;
  lastError?: string;
  counters: {
    providerRequests: number;
    candidatesSeen: number;
    rankedCandidates: number;
    knownRankCandidates: number;
    selected: number;
    enqueued: number;
    failed: number;
    cleanupFailed: number;
    windowsUnderTarget: number;
  };
  queue: { queued: number; oldestQueuedAt?: string };
  currentWindow?: string;
  lastWindow?: WindowSummary;
  recentFailures?: Array<{
    at: string;
    stage: "fetching" | "parsing" | "loading" | "cleanup" | "enqueue";
    code: "job_failed" | "replay_cleanup_failed" | "enqueue_failed";
  }>;
  dryRun: boolean;
};

export async function writeSamplerHeartbeat(file: string, heartbeat: SamplerHeartbeat): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWriteJson(file, { ...heartbeat, updatedAt: new Date().toISOString() });
}
