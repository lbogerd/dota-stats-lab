import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createIngestionJob, listJobIds } from "../src/jobs/job-files.js";
import type { SamplerConfig } from "../src/sampler/config.js";
import { selectMatches } from "../src/sampler/selector.js";
import { RankedMatchSampler } from "../src/sampler/service.js";
import { SamplerStore } from "../src/sampler/store.js";
import type { MatchCandidate } from "../src/sampler/types.js";

test("sampler recovers a job created before markEnqueued and stays idempotent after restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dota-sampler-service-"));
  const databasePath = path.join(root, "sampler.duckdb");
  const jobsRoot = path.join(root, "jobs");
  const heartbeatPath = path.join(root, "heartbeat.json");
  const windowStart = "2026-08-26T10:00:00.000Z";
  const candidate: MatchCandidate = {
    matchId: "9001",
    startTime: 1_777_264_400,
    windowStart,
    lobbyType: 7,
    avgRankTier: 81,
    source: "opendota-public-matches",
  };
  const store = new SamplerStore(databasePath);
  await store.open();
  await store.upsertCandidates([candidate]);
  const [selection] = selectMatches([candidate], {
    target: 1, priority: 1, control: 0, samplingVersion: "test-v1", windowStart,
  });
  assert.ok(selection);
  await store.finalizeWindow(windowStart, [selection], 1);
  store.close();

  const existing = await createIngestionJob(9001n, jobsRoot, {
    sampling: {
      windowStart,
      selectionGroup: selection.selectionGroup,
      avgRankTier: 81,
      source: candidate.source,
      samplingVersion: "test-v1",
    },
    deleteReplayAfterSuccess: true,
  });
  const config = samplerConfig({ root, databasePath, jobsRoot, heartbeatPath });
  const provider = { fetchPage: async () => ({ candidates: [], rawCount: 0, invalidCount: 0 }) };

  const first = new RankedMatchSampler({ config, provider, now: () => new Date("2026-08-26T12:30:00.000Z") });
  await first.open();
  await first.tick();
  first.close();
  assert.deepEqual(await listJobIds(jobsRoot), [existing.jobId]);

  const restarted = new RankedMatchSampler({ config, provider, now: () => new Date("2026-08-26T12:31:00.000Z") });
  await restarted.open();
  await restarted.tick();
  assert.equal(restarted.heartbeat().counters.enqueued, 1);
  restarted.close();
  assert.deepEqual(await listJobIds(jobsRoot), [existing.jobId]);
});

test("sampler does not repeat the full backfill after a restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dota-sampler-backfill-"));
  const config = {
    ...samplerConfig({
      root,
      databasePath: path.join(root, "sampler.duckdb"),
      jobsRoot: path.join(root, "jobs"),
      heartbeatPath: path.join(root, "heartbeat.json"),
    }),
    backfillMaxPages: 4,
    pollPages: 1,
    dryRun: true,
  };
  let requests = 0;
  const provider = {
    fetchPage: async () => {
      requests += 1;
      return {
        candidates: [], rawCount: 100, invalidCount: 0,
        oldestMatchId: String(10_000 - requests),
        oldestStartTime: Math.floor(new Date("2026-08-26T12:00:00.000Z").getTime() / 1_000),
      };
    },
  };

  const first = new RankedMatchSampler({ config, provider, now: () => new Date("2026-08-26T12:30:00.000Z") });
  await first.open();
  await first.tick();
  first.close();
  assert.equal(requests, 4);

  const restarted = new RankedMatchSampler({ config, provider, now: () => new Date("2026-08-26T12:31:00.000Z") });
  await restarted.open();
  await restarted.tick();
  restarted.close();
  assert.equal(requests, 5);
});

function samplerConfig(paths: {
  root: string;
  databasePath: string;
  jobsRoot: string;
  heartbeatPath: string;
}): SamplerConfig {
  return {
    databasePath: paths.databasePath,
    heartbeatPath: paths.heartbeatPath,
    jobsRoot: paths.jobsRoot,
    providerUrl: "https://example.test/publicMatches",
    providerApiKey: undefined,
    pollIntervalMs: 60_000,
    heartbeatIntervalMs: 30_000,
    httpTimeoutMs: 5_000,
    httpRetryAttempts: 1,
    backfillHours: 1,
    backfillMaxPages: 1,
    pollPages: 1,
    maxActiveJobs: 60,
    windowDelayMinutes: 60,
    targetPerHour: 1,
    priorityPerHour: 1,
    controlPerHour: 0,
    samplingVersion: "test-v1",
    dryRun: false,
  };
}
