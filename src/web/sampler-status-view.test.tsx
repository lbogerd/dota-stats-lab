import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SamplerStatus } from "../server/sampler-monitoring.js";
import { formatBytes, formatDuration, SamplerStatusView } from "./sampler-status-view.js";

const healthyStatus: SamplerStatus = {
  schemaVersion: 1,
  status: "healthy",
  checkedAt: "2026-08-26T12:00:00.000Z",
  state: "running",
  startedAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T11:59:30.000Z",
  heartbeatAgeSeconds: 30,
  lastProviderSuccessAt: "2026-08-26T11:59:00.000Z",
  providerAgeSeconds: 60,
  lastWindowFinalizedAt: "2026-08-26T11:05:00.000Z",
  lastWindow: { windowStart: "2026-08-26T10:00:00.000Z", candidates: 200, knownRank: 180, selected: 30, target: 30, underTarget: false },
  currentWindow: "2026-08-26T11:00:00.000Z",
  dryRun: false,
  counters: { providerRequests: 8, candidatesSeen: 200, rankedCandidates: 180, knownRankCandidates: 170, selected: 30, enqueued: 29, failed: 1, cleanupFailed: 0, windowsUnderTarget: 0 },
  queue: { queued: 2, oldestQueuedAt: "2026-08-26T11:55:00.000Z", oldestQueuedAgeSeconds: 300 },
  recentFailures: [],
  disk: { scratch: { totalBytes: 1000, availableBytes: 750, usedPercent: 25 }, warehouseBytes: 1024 * 1024 },
  reasons: [],
};

describe("SamplerStatusView", () => {
  it("shows the public sampler metrics", () => {
    render(<SamplerStatusView status={healthyStatus} />);
    expect(screen.getByRole("heading", { name: "Ranked match sampler" })).toBeTruthy();
    expect(screen.getAllByText("180")).toHaveLength(2);
    expect(screen.getByText("29")).toBeTruthy();
    expect(screen.getByText("25.0%")).toBeTruthy();
    expect(screen.getByText("No recent sampler failures.")).toBeTruthy();
  });

  it("shows clear warnings and dry-run state", () => {
    render(<SamplerStatusView status={{ ...healthyStatus, status: "warning", dryRun: true, reasons: [{ severity: "warning", code: "queue_large", message: "More than 60 ingestion jobs are waiting." }] }} />);
    expect(screen.getByText("Dry run is on.")).toBeTruthy();
    expect(screen.getByText("More than 60 ingestion jobs are waiting.")).toBeTruthy();
  });
});

describe("sampler formatting", () => {
  it("formats byte sizes and elapsed time", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MiB");
    expect(formatDuration(7_201)).toBe("2h ago");
  });
});
