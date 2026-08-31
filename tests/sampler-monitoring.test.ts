import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getSamplerStatus, type SamplerStatusOptions } from "../src/server/sampler-monitoring.js";

const now = new Date("2026-08-26T12:00:00.000Z");
const healthyDiskUsage = {
  scratch: { totalBytes: 1_000, availableBytes: 900, usedPercent: 10 },
  warehouseBytes: null,
};

function getTestSamplerStatus(options: SamplerStatusOptions) {
  return getSamplerStatus({ ...options, diskUsage: healthyDiskUsage });
}

async function withHeartbeat(
  value: unknown,
  run: (heartbeatPath: string, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dota-sampler-health-"));
  const heartbeatPath = path.join(root, "sampler", "heartbeat.json");
  await mkdir(path.dirname(heartbeatPath), { recursive: true });
  await writeFile(heartbeatPath, JSON.stringify(value));
  try { await run(heartbeatPath, root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("reports a fresh sampler heartbeat as healthy", async () => {
  await withHeartbeat({
    schemaVersion: 1,
    state: "running",
    startedAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T11:59:30.000Z",
    lastProviderSuccessAt: "2026-08-26T11:58:00.000Z",
    lastWindowFinalizedAt: "2026-08-26T11:05:00.000Z",
    lastWindow: { windowStart: "2026-08-26T10:00:00.000Z", candidateCount: 300, knownRankCount: 250, selectedCount: 30, target: 30, underTarget: false },
    currentWindow: "2026-08-26T12:00:00.000Z",
    dryRun: false,
    counters: { providerRequests: 4, candidatesSeen: 300, rankedCandidates: 250, knownRankCandidates: 225, selected: 30, enqueued: 30, failed: 0, cleanupFailed: 0 },
    queue: { queued: 2, oldestQueuedAt: "2026-08-26T11:57:00.000Z" },
  }, async (heartbeatPath, root) => {
    const status = await getTestSamplerStatus({ heartbeatPath, stagingRoot: root, warehousePath: path.join(root, "warehouse.duckdb"), now });
    assert.equal(status.status, "healthy");
    assert.equal(status.heartbeatAgeSeconds, 30);
    assert.equal(status.providerAgeSeconds, 120);
    assert.equal(status.counters.selected, 30);
    assert.equal(status.counters.knownRankCandidates, 225);
    assert.deepEqual(status.lastWindow, { windowStart: "2026-08-26T10:00:00.000Z", candidates: 300, knownRank: 250, selected: 30, target: 30, underTarget: false });
    assert.equal(status.queue.oldestQueuedAgeSeconds, 180);
    assert.deepEqual(status.reasons, []);
  });
});

test("reports stale heartbeat and a stalled queue as critical", async () => {
  await withHeartbeat({
    state: "running",
    startedAt: "2026-08-26T08:00:00.000Z",
    updatedAt: "2026-08-26T11:57:00.000Z",
    lastProviderSuccessAt: "2026-08-26T11:20:00.000Z",
    counters: {},
    queue: { queued: 61, oldestQueuedAt: "2026-08-26T09:00:00.000Z" },
  }, async (heartbeatPath, root) => {
    const status = await getTestSamplerStatus({ heartbeatPath, stagingRoot: root, now });
    assert.equal(status.status, "critical");
    assert.deepEqual(status.reasons.map((reason) => reason.code), ["heartbeat_stale", "provider_stale", "queue_large", "queue_stalled"]);
  });
});

test("warns when provider success is more than 15 minutes old", async () => {
  await withHeartbeat({
    state: "running",
    startedAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T11:59:30.000Z",
    lastProviderSuccessAt: "2026-08-26T11:44:00.000Z",
  }, async (heartbeatPath, root) => {
    const status = await getTestSamplerStatus({ heartbeatPath, stagingRoot: root, now });
    assert.equal(status.status, "warning");
    assert.equal(status.reasons[0]?.code, "provider_delayed");
  });
});

test("treats a missing heartbeat as a safe starting state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dota-sampler-health-"));
  try {
    const status = await getTestSamplerStatus({ heartbeatPath: path.join(root, "missing.json"), stagingRoot: root, now });
    assert.equal(status.status, "starting");
    assert.equal(status.reasons[0]?.code, "heartbeat_missing");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects malformed heartbeats and omits raw failure data", async () => {
  await withHeartbeat({ updatedAt: "not-a-date", accountId: "private-account" }, async (heartbeatPath, root) => {
    const status = await getTestSamplerStatus({ heartbeatPath, stagingRoot: root, now });
    assert.equal(status.status, "unavailable");
  });

  await withHeartbeat({
    state: "running",
    updatedAt: "2026-08-26T11:59:30.000Z",
    lastProviderSuccessAt: "2026-08-26T11:59:00.000Z",
    recentFailures: [{ at: "2026-08-26T11:50:00.000Z", stage: "provider", code: "rate_limited", accountId: "private-account", message: "secret response" }],
  }, async (heartbeatPath, root) => {
    const status = await getTestSamplerStatus({ heartbeatPath, stagingRoot: root, now });
    const publicJson = JSON.stringify(status);
    assert.equal(status.recentFailures[0]?.code, "rate_limited");
    assert.equal(publicJson.includes("private-account"), false);
    assert.equal(publicJson.includes("secret response"), false);
  });
});

test("reports high scratch disk usage independently of heartbeat health", async () => {
  await withHeartbeat({
    state: "running",
    startedAt: "2026-08-26T11:00:00.000Z",
    updatedAt: "2026-08-26T11:59:30.000Z",
    lastProviderSuccessAt: "2026-08-26T11:59:00.000Z",
  }, async (heartbeatPath, root) => {
    const status = await getSamplerStatus({
      heartbeatPath,
      stagingRoot: root,
      now,
      diskUsage: {
        scratch: { totalBytes: 1_000, availableBytes: 250, usedPercent: 75 },
        warehouseBytes: null,
      },
    });
    assert.equal(status.status, "warning");
    assert.deepEqual(status.reasons.map((reason) => reason.code), ["scratch_disk_high"]);
  });
});
