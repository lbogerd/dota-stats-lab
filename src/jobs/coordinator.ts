import { readFile } from "node:fs/promises";
import path from "node:path";
import { paths, replayDir } from "../config.js";
import { fetchReplay, type Acquisition } from "../fetch/fetch-replay.js";
import { loadClaimedExtraction, type LoadResult } from "../load/load-extraction.js";
import type { Manifest } from "../load/manifest.js";
import { extractionAlreadyLoaded } from "../load/preflight.js";
import { parseMatchId } from "../lib/match-id.js";
import {
  atomicWriteJson,
  createIngestionJob,
  fileExists,
  jobDirectory,
  listJobIds,
  listJobStatuses,
  readIngestionRequest,
  readJobStatus,
  readParseResult,
  updateJobStatus,
  writeParseRequest,
  type JobStatus,
} from "./job-files.js";
import { claimExtraction, type ClaimedExtraction } from "./extraction-claim.js";
import { inspectClaimedExtraction } from "./parser-output.js";

export type CoordinatorDependencies = {
  fetch: (matchId: bigint) => Promise<Acquisition>;
  alreadyLoaded: (matchId: bigint, replaySha256: string | undefined) => Promise<boolean>;
  claim: (claimId: string, matchId: bigint, extractionId: string) => Promise<ClaimedExtraction>;
  inspect: (claimed: ClaimedExtraction) => Promise<Manifest>;
  load: (claimed: ClaimedExtraction) => Promise<LoadResult>;
};

const defaultDependencies: CoordinatorDependencies = {
  fetch: fetchReplay,
  alreadyLoaded: extractionAlreadyLoaded,
  claim: (claimId, matchId, extractionId) => claimExtraction({
    claimId,
    matchId,
    extractionId,
    inboxRoot: paths.stagingInboxRoot,
    claimedRoot: paths.stagingClaimedRoot,
  }),
  inspect: inspectClaimedExtraction,
  load: loadClaimedExtraction,
};

export class IngestionCoordinator {
  readonly #jobsRoot: string;
  readonly #pollIntervalMs: number;
  readonly #dependencies: CoordinatorDependencies;
  #abortController: AbortController | undefined;
  #loop: Promise<void> | undefined;
  #busy = false;

  constructor(options: {
    jobsRoot?: string;
    pollIntervalMs?: number;
    dependencies?: Partial<CoordinatorDependencies>;
  } = {}) {
    this.#jobsRoot = options.jobsRoot ?? paths.jobsRoot;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#dependencies = { ...defaultDependencies, ...options.dependencies };
  }

  async enqueue(matchId: bigint): Promise<JobStatus> {
    return createIngestionJob(matchId, this.#jobsRoot);
  }

  async get(jobId: string): Promise<JobStatus> {
    return readJobStatus(jobId, this.#jobsRoot);
  }

  async list(): Promise<JobStatus[]> {
    return listJobStatuses(this.#jobsRoot);
  }

  start(): void {
    if (this.#loop !== undefined) return;
    this.#abortController = new AbortController();
    this.#loop = this.#run(this.#abortController.signal).finally(() => { this.#loop = undefined; });
  }

  async stop(): Promise<void> {
    this.#abortController?.abort();
    await this.#loop;
  }

  async recover(): Promise<void> {
    for (const jobId of await listJobIds(this.#jobsRoot)) {
      let request;
      try { request = await readIngestionRequest(jobId, this.#jobsRoot); }
      catch { continue; }
      try {
        const status = await readJobStatus(jobId, this.#jobsRoot);
        if (status.matchId !== request.matchId) throw new Error("Job request and status match IDs differ");
      } catch (error) {
        const now = new Date().toISOString();
        await atomicWriteJson(path.join(jobDirectory(jobId, this.#jobsRoot), "status.json"), {
          schemaVersion: 1,
          jobId,
          matchId: request.matchId,
          state: "failed",
          createdAt: request.createdAt,
          updatedAt: now,
          completedAt: now,
          error: { stage: "fetching", message: `Cannot recover job: ${errorMessage(error)}` },
        } satisfies JobStatus);
      }
    }
  }

  async tick(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      let statuses: JobStatus[];
      try { statuses = await listJobStatuses(this.#jobsRoot); }
      catch {
        await this.recover();
        statuses = await listJobStatuses(this.#jobsRoot);
      }
      const active = statuses.find((status) => status.state !== "succeeded" && status.state !== "failed");
      if (active !== undefined) await this.#advance(active);
    } finally { this.#busy = false; }
  }

  async #run(signal: AbortSignal): Promise<void> {
    try { await this.recover(); }
    catch (error) { process.stderr.write(`ingestion recovery: ${errorMessage(error)}\n`); }
    while (!signal.aborted) {
      try { await this.tick(); }
      catch (error) { process.stderr.write(`ingestion coordinator: ${errorMessage(error)}\n`); }
      await wait(this.#pollIntervalMs, signal);
    }
  }

  async #advance(status: JobStatus): Promise<void> {
    const matchId = parseMatchId(status.matchId);
    if (status.state === "queued") {
      await updateJobStatus(status, "fetching", {}, this.#jobsRoot);
      return;
    }
    if (status.state === "fetching") {
      try {
        const acquisition = await this.#dependencies.fetch(matchId);
        if (acquisition.status !== "available" || acquisition.replaySha256 === undefined) {
          await this.#fail(status, "fetching", acquisition.error ?? "Replay is unavailable");
          return;
        }
        if (await this.#dependencies.alreadyLoaded(matchId, acquisition.replaySha256)) {
          await updateJobStatus(status, "succeeded", { result: "already_loaded" }, this.#jobsRoot);
          return;
        }
        const parsing = await updateJobStatus(status, "parsing", {}, this.#jobsRoot);
        await this.#ensureParseRequest(parsing, acquisition.replaySha256);
      } catch (error) { await this.#fail(status, "fetching", errorMessage(error)); }
      return;
    }
    if (status.state === "parsing") {
      let result;
      try { result = await readParseResult(status.jobId, this.#jobsRoot); }
      catch (error) {
        await this.#fail(status, "parsing", `Invalid parser result: ${errorMessage(error)}`);
        return;
      }
      if (result === undefined) {
        try {
          const acquisition = await readAcquisition(matchId);
          await this.#ensureParseRequest(status, acquisition.replaySha256);
        } catch (error) { await this.#fail(status, "parsing", errorMessage(error)); }
        return;
      }
      if (result.matchId !== status.matchId) {
        await this.#fail(status, "parsing", "Parser result match ID differs from job");
        return;
      }
      if (result.status === "failed") {
        await this.#fail(status, "parsing", result.error ?? "Parser failed");
        return;
      }
      try {
        if (result.extractionId === undefined) throw new Error("Successful parser result does not have an extraction ID");
        const claimed = await this.#dependencies.claim(status.jobId, matchId, result.extractionId);
        const manifest = await this.#dependencies.inspect(claimed);
        await updateJobStatus(status, "loading", { extractionId: manifest.extractionId }, this.#jobsRoot);
      } catch (error) { await this.#fail(status, "parsing", `Cannot claim parser output: ${errorMessage(error)}`); }
      return;
    }
    if (status.state === "loading") {
      try {
        if (status.extractionId === undefined) throw new Error("Loading job does not have an extraction ID");
        const acquisition = await readAcquisition(matchId);
        if (await this.#dependencies.alreadyLoaded(matchId, acquisition.replaySha256)) {
          await updateJobStatus(status, "succeeded", {
            extractionId: status.extractionId,
            result: "already_loaded",
          }, this.#jobsRoot);
          return;
        }
        const claimed = await this.#dependencies.claim(status.jobId, matchId, status.extractionId);
        const loaded = await this.#dependencies.load(claimed);
        await updateJobStatus(status, "succeeded", { extractionId: loaded.extractionId, result: loaded.status }, this.#jobsRoot);
      } catch (error) { await this.#fail(status, "loading", errorMessage(error)); }
    }
  }

  async #ensureParseRequest(status: JobStatus, replaySha256: string): Promise<void> {
    const directory = jobDirectory(status.jobId, this.#jobsRoot);
    if (await fileExists(path.join(directory, "parse-result.json"))
      || await fileExists(path.join(directory, "parse-request.json"))
      || await fileExists(path.join(directory, "parse-request.claimed.json"))) return;
    await writeParseRequest({
      schemaVersion: 1,
      jobId: status.jobId,
      matchId: status.matchId,
      replaySha256,
      createdAt: new Date().toISOString(),
    }, this.#jobsRoot);
  }

  async #fail(status: JobStatus, stage: "fetching" | "parsing" | "loading", message: string): Promise<void> {
    await updateJobStatus(status, "failed", { error: { stage, message } }, this.#jobsRoot);
  }
}

async function readAcquisition(matchId: bigint): Promise<{ replaySha256: string }> {
  const value: unknown = JSON.parse(await readFile(path.join(replayDir(matchId), "acquisition.json"), "utf8"));
  if (typeof value !== "object" || value === null || !("replaySha256" in value)
    || typeof value.replaySha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.replaySha256)) {
    throw new Error("Cached acquisition does not contain a valid replay checksum");
  }
  return { replaySha256: value.replaySha256 };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
