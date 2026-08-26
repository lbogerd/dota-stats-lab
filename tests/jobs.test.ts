import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "dota-jobs-"));
process.env.STAGING_ROOT = path.join(root, "staging");
process.env.JOBS_ROOT = path.join(root, "staging", "jobs");
process.env.REPLAY_ROOT = path.join(root, "replays");
process.env.WAREHOUSE_PATH = path.join(root, "warehouse", "dota.duckdb");

const {
  createIngestionJob,
  fileExists,
  jobDirectory,
  readIngestionRequest,
  readJobStatus,
  writeParseResult,
} = await import("../src/jobs/job-files.js");
const { IngestionCoordinator } = await import("../src/jobs/coordinator.js");
const { ParserWorker, runJavaParser } = await import("../src/jobs/parser-worker.js");

const sha = "b".repeat(64);
const extractionId = "a".repeat(64);

test("job creation publishes valid request and status files atomically", async () => {
  const jobsRoot = path.join(root, "atomic-jobs");
  const status = await createIngestionJob(8953222159n, jobsRoot);
  assert.equal(status.state, "queued");
  assert.equal((await readIngestionRequest(status.jobId, jobsRoot)).matchId, "8953222159");
  assert.deepEqual(await readJobStatus(status.jobId, jobsRoot), status);
  const names = await import("node:fs/promises").then(({ readdir }) => readdir(jobDirectory(status.jobId, jobsRoot)));
  assert.deepEqual(names.sort(), ["request.json", "status.json"]);
});

test("sampled job creation preserves validated selection and cleanup policy", async () => {
  const jobsRoot = path.join(root, "sampled-request-jobs");
  const sampling = {
    windowStart: "2026-08-26T10:00:00.000Z",
    selectionGroup: "priority" as const,
    avgRankTier: 81,
    source: "opendota-public-matches",
    samplingVersion: "ranked-v1",
  };
  const status = await createIngestionJob(8953222160n, jobsRoot, {
    sampling,
    deleteReplayAfterSuccess: true,
  });
  assert.deepEqual(await readIngestionRequest(status.jobId, jobsRoot), {
    schemaVersion: 1,
    jobId: status.jobId,
    matchId: "8953222160",
    createdAt: status.createdAt,
    sampling,
    deleteReplayAfterSuccess: true,
  });
});

test("coordinator and parser worker complete the fetch, parse, validate, and load states", async () => {
  const jobsRoot = path.join(root, "success-jobs");
  const transitions: string[] = [];
  const coordinator = coordinatorFor(jobsRoot, {
    claim: async (claimId: string, matchId: bigint, expected: string) => {
      assert.match(claimId, /^[0-9a-f-]{36}$/);
      assert.equal(matchId, 8953222159n);
      assert.equal(expected, extractionId);
      transitions.push("claimed");
      return claimed(claimId, matchId, expected);
    },
    inspect: async (value: ReturnType<typeof claimed>) => {
      assert.equal(value.extractionId, extractionId);
      transitions.push("inspected");
      return { extractionId } as never;
    },
    load: async (value: ReturnType<typeof claimed>) => {
      assert.equal(value.extractionId, extractionId);
      transitions.push("loaded");
      return { extractionId, status: "loaded" as const };
    },
  });
  const queued = await coordinator.enqueue(8953222159n);
  await coordinator.tick();
  assert.equal((await coordinator.get(queued.jobId)).state, "fetching");
  await coordinator.tick();
  assert.equal((await coordinator.get(queued.jobId)).state, "parsing");

  const worker = new ParserWorker({ jobsRoot, runner: async (request) => {
    assert.equal(request.replaySha256, sha);
    transitions.push("parsed");
    return { extractionId };
  } });
  await worker.tick();
  await coordinator.tick();
  assert.equal((await coordinator.get(queued.jobId)).state, "loading");
  await coordinator.tick();
  assert.deepEqual(transitions, ["parsed", "claimed", "inspected", "claimed", "loaded"]);
  assert.match(JSON.stringify(await coordinator.get(queued.jobId)), /"state":"succeeded"/);
  assert.equal((await stat(path.join(process.env.REPLAY_ROOT!, "8953222159"))).isDirectory(), true);
});

test("a successful sampled job deletes its replay cache and records cleanup", async () => {
  const jobsRoot = path.join(root, "sampled-success-jobs");
  const coordinator = coordinatorFor(jobsRoot);
  const queued = await coordinator.enqueue(101n, {
    sampling: {
      windowStart: "2026-08-26T11:00:00.000Z",
      selectionGroup: "control",
      source: "opendota-public-matches",
      samplingVersion: "ranked-v1",
    },
    deleteReplayAfterSuccess: true,
  });
  await coordinator.tick();
  await coordinator.tick();
  await writeParseResult({
    schemaVersion: 1, jobId: queued.jobId, matchId: "101", status: "succeeded",
    completedAt: new Date().toISOString(), extractionId,
  }, jobsRoot);
  await coordinator.tick();
  await coordinator.tick();

  const completed = await coordinator.get(queued.jobId);
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.replayCleanup?.state, "succeeded");
  await assert.rejects(stat(path.join(process.env.REPLAY_ROOT!, "101")), /ENOENT/);
});

test("an already-loaded sampled job passes its selection to preflight and still cleans up", async () => {
  const jobsRoot = path.join(root, "sampled-already-loaded-jobs");
  let receivedSampling: unknown;
  const coordinator = coordinatorFor(jobsRoot, {
    alreadyLoaded: async (_matchId: bigint, _checksum: string, sampling: unknown) => {
      receivedSampling = sampling;
      return true;
    },
  });
  const sampling = {
    windowStart: "2026-08-26T11:00:00.000Z",
    selectionGroup: "priority" as const,
    avgRankTier: 83,
    source: "opendota-public-matches",
    samplingVersion: "ranked-v1",
  };
  const queued = await coordinator.enqueue(103n, { sampling, deleteReplayAfterSuccess: true });
  await coordinator.tick();
  await coordinator.tick();

  assert.deepEqual(receivedSampling, sampling);
  const completed = await coordinator.get(queued.jobId);
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.result, "already_loaded");
  assert.equal(completed.replayCleanup?.state, "succeeded");
  await assert.rejects(stat(path.join(process.env.REPLAY_ROOT!, "103")), /ENOENT/);
});

test("a replay cleanup error leaves ingestion successful and is recorded for retry", async () => {
  const jobsRoot = path.join(root, "cleanup-failure-jobs");
  let cleanupAttempts = 0;
  const coordinator = coordinatorFor(jobsRoot, {
    cleanupReplay: async (matchId: bigint) => {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) throw new Error("volume is temporarily read-only");
      await rm(path.join(process.env.REPLAY_ROOT!, matchId.toString()), { recursive: true });
    },
  });
  const queued = await coordinator.enqueue(102n, {
    sampling: {
      windowStart: "2026-08-26T12:00:00.000Z",
      selectionGroup: "fill",
      avgRankTier: 74,
      source: "opendota-public-matches",
      samplingVersion: "ranked-v1",
    },
    deleteReplayAfterSuccess: true,
  });
  await coordinator.tick();
  await coordinator.tick();
  await writeParseResult({
    schemaVersion: 1, jobId: queued.jobId, matchId: "102", status: "succeeded",
    completedAt: new Date().toISOString(), extractionId,
  }, jobsRoot);
  await coordinator.tick();
  await coordinator.tick();

  const completed = await coordinator.get(queued.jobId);
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.result, "loaded");
  assert.deepEqual(completed.replayCleanup?.state, "failed");
  assert.match(completed.replayCleanup?.error ?? "", /read-only/);
  assert.equal((await stat(path.join(process.env.REPLAY_ROOT!, "102"))).isDirectory(), true);
  assert.match(await readFile(path.join(process.env.REPLAY_ROOT!, "102", "acquisition.json"), "utf8"), /replaySha256/);

  const statusFile = path.join(jobDirectory(queued.jobId, jobsRoot), "status.json");
  const retryReady = JSON.parse(await readFile(statusFile, "utf8"));
  retryReady.replayCleanup.attemptedAt = "2020-01-01T00:00:00.000Z";
  await writeFile(statusFile, `${JSON.stringify(retryReady)}\n`);
  await coordinator.tick();
  assert.equal(cleanupAttempts, 2);
  assert.equal((await coordinator.get(queued.jobId)).replayCleanup?.state, "succeeded");
  await assert.rejects(stat(path.join(process.env.REPLAY_ROOT!, "102")), /ENOENT/);
});

test("coordinator records unavailable replay, parser, and loader failures", async () => {
  const unavailableRoot = path.join(root, "unavailable-jobs");
  const unavailable = new IngestionCoordinator({ jobsRoot: unavailableRoot, dependencies: {
    fetch: async (matchId) => ({
      schemaVersion: 1, matchId: matchId.toString(), status: "replay_unavailable", source: "opendota",
      acquiredAt: new Date().toISOString(),
    }),
  } });
  const unavailableJob = await unavailable.enqueue(1n);
  await unavailable.tick();
  await unavailable.tick();
  assert.deepEqual(pickFailure(await unavailable.get(unavailableJob.jobId)), ["failed", "fetching"]);

  const parserRoot = path.join(root, "parser-failure-jobs");
  const parserCoordinator = coordinatorFor(parserRoot);
  const parserJob = await parserCoordinator.enqueue(2n);
  await parserCoordinator.tick();
  await parserCoordinator.tick();
  const worker = new ParserWorker({ jobsRoot: parserRoot, runner: async () => { throw new Error("clarity exploded"); } });
  await worker.tick();
  await parserCoordinator.tick();
  assert.deepEqual(pickFailure(await parserCoordinator.get(parserJob.jobId)), ["failed", "parsing"]);

  const invalidOutputRoot = path.join(root, "invalid-output-jobs");
  const invalidOutputCoordinator = coordinatorFor(invalidOutputRoot, {
    inspect: async () => { throw new Error("invalid manifest"); },
  });
  const invalidOutputJob = await invalidOutputCoordinator.enqueue(22n);
  await invalidOutputCoordinator.tick();
  await invalidOutputCoordinator.tick();
  await writeParseResult({
    schemaVersion: 1, jobId: invalidOutputJob.jobId, matchId: "22", status: "succeeded",
    completedAt: new Date().toISOString(), extractionId,
  }, invalidOutputRoot);
  await invalidOutputCoordinator.tick();
  const invalidOutputStatus = await invalidOutputCoordinator.get(invalidOutputJob.jobId);
  assert.deepEqual(pickFailure(invalidOutputStatus), ["failed", "parsing"]);
  assert.match(invalidOutputStatus.error?.message ?? "", /Cannot claim parser output: invalid manifest/);

  const loaderRoot = path.join(root, "loader-failure-jobs");
  const loaderCoordinator = coordinatorFor(loaderRoot, {
    load: async () => { throw new Error("DuckDB refused import"); },
  });
  const loaderJob = await loaderCoordinator.enqueue(3n);
  await loaderCoordinator.tick();
  await loaderCoordinator.tick();
  await writeParseResult({
    schemaVersion: 1, jobId: loaderJob.jobId, matchId: "3", status: "succeeded",
    completedAt: new Date().toISOString(), extractionId,
  }, loaderRoot);
  await loaderCoordinator.tick();
  await loaderCoordinator.tick();
  assert.deepEqual(pickFailure(await loaderCoordinator.get(loaderJob.jobId)), ["failed", "loading"]);
  assert.equal((await stat(path.join(process.env.REPLAY_ROOT!, "3"))).isDirectory(), true);
});

test("Java parser runner invokes the existing jar contract and validates its JSON response", async () => {
  const fakeJava = path.join(root, "fake-java.sh");
  const argumentsFile = path.join(root, "java-arguments.txt");
  await writeFile(fakeJava, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argumentsFile}"\nprintf '%s\\n' '{"status":"extracted","extractionId":"${extractionId}"}'\n`);
  await chmod(fakeJava, 0o700);
  process.env.JAVA_COMMAND = fakeJava;
  process.env.PARSER_JAR = "/test/parser.jar";
  try {
    assert.deepEqual(await runJavaParser({
      schemaVersion: 1, jobId: "00000000-0000-4000-8000-000000000000", matchId: "99",
      replaySha256: sha, createdAt: new Date().toISOString(),
    }), { extractionId });
    const argumentsText = await import("node:fs/promises").then(({ readFile }) => readFile(argumentsFile, "utf8"));
    assert.deepEqual(argumentsText.trim().split("\n"), [
      "-jar", "/test/parser.jar", "99", "--staging-root", path.join(process.env.STAGING_ROOT!, "inbox"), "--replay-sha256", sha,
    ]);
  } finally {
    delete process.env.JAVA_COMMAND;
    delete process.env.PARSER_JAR;
  }
});

test("a new coordinator and worker recover interrupted fetching, loading, and parse claims", async () => {
  const jobsRoot = path.join(root, "restart-jobs");
  const beforeRestart = coordinatorFor(jobsRoot);
  const fetching = await beforeRestart.enqueue(4n);
  await beforeRestart.tick();
  assert.equal((await beforeRestart.get(fetching.jobId)).state, "fetching");

  const afterRestart = coordinatorFor(jobsRoot);
  await afterRestart.recover();
  await afterRestart.tick();
  assert.equal((await afterRestart.get(fetching.jobId)).state, "parsing");
  const directory = jobDirectory(fetching.jobId, jobsRoot);
  await rename(path.join(directory, "parse-request.json"), path.join(directory, "parse-request.claimed.json"));
  const worker = new ParserWorker({ jobsRoot, runner: async () => ({ extractionId }) });
  await worker.recoverClaims();
  assert.equal(await fileExists(path.join(directory, "parse-request.json")), true);
  await worker.tick();
  await afterRestart.tick();
  assert.equal((await afterRestart.get(fetching.jobId)).state, "loading");

  const loadingRestart = coordinatorFor(jobsRoot, { alreadyLoaded: async () => true });
  await loadingRestart.tick();
  const completed = await loadingRestart.get(fetching.jobId);
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.result, "already_loaded");
});

test("recovery marks a job with a corrupt status as failed", async () => {
  const jobsRoot = path.join(root, "corrupt-jobs");
  const status = await createIngestionJob(5n, jobsRoot);
  await writeFile(path.join(jobDirectory(status.jobId, jobsRoot), "status.json"), "not-json\n");
  const coordinator = coordinatorFor(jobsRoot);
  await coordinator.recover();
  assert.deepEqual(pickFailure(await coordinator.get(status.jobId)), ["failed", "fetching"]);
});

function coordinatorFor(jobsRoot: string, overrides: Record<string, unknown> = {}): InstanceType<typeof IngestionCoordinator> {
  return new IngestionCoordinator({ jobsRoot, dependencies: {
    fetch: async (matchId: bigint) => {
      const replayDirectory = path.join(process.env.REPLAY_ROOT!, matchId.toString());
      await mkdir(replayDirectory, { recursive: true });
      await writeFile(path.join(replayDirectory, "acquisition.json"), JSON.stringify({ replaySha256: sha }));
      return {
        schemaVersion: 1, matchId: matchId.toString(), status: "available" as const, source: "cache" as const,
        replaySha256: sha, replayBytes: 1, acquiredAt: new Date().toISOString(),
      };
    },
    alreadyLoaded: async () => false,
    claim: async (claimId: string, matchId: bigint, expected: string) => claimed(claimId, matchId, expected),
    inspect: async (value: ReturnType<typeof claimed>) => ({ extractionId: value.extractionId } as never),
    load: async (value: ReturnType<typeof claimed>) => ({ extractionId: value.extractionId, status: "loaded" as const }),
    ...overrides,
  } as never });
}

function claimed(claimId: string, matchId: bigint, id: string): {
  claimId: string;
  matchId: bigint;
  extractionId: string;
  directory: string;
} {
  return { claimId, matchId, extractionId: id, directory: path.join(root, "claimed", claimId, id) };
}

function pickFailure(status: { state: string; error?: { stage: string } }): [string, string | undefined] {
  return [status.state, status.error?.stage];
}
