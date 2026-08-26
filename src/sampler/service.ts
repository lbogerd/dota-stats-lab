import {
  createIngestionJob,
  listJobIds,
  listJobStatuses,
  readIngestionRequest,
} from "../jobs/job-files.js";
import { jsonStringify } from "../lib/json.js";
import type { SamplerConfig } from "./config.js";
import { writeSamplerHeartbeat, type SamplerHeartbeat } from "./heartbeat.js";
import { PublicMatchesProvider } from "./provider.js";
import { selectMatches } from "./selector.js";
import { SamplerStore } from "./store.js";
import type { MatchCandidate, WindowSummary } from "./types.js";

export type RankedMatchSamplerOptions = {
  config: SamplerConfig;
  store?: SamplerStore;
  provider?: Pick<PublicMatchesProvider, "fetchPage">;
  now?: () => Date;
};

export class RankedMatchSampler {
  readonly #config: SamplerConfig;
  readonly #store: SamplerStore;
  readonly #provider: Pick<PublicMatchesProvider, "fetchPage">;
  readonly #now: () => Date;
  readonly #startedAt: string;
  #heartbeat: SamplerHeartbeat;
  #heartbeatTimer: NodeJS.Timeout | undefined;
  #firstCycle = true;

  constructor(options: RankedMatchSamplerOptions) {
    this.#config = options.config;
    this.#store = options.store ?? new SamplerStore(options.config.databasePath);
    this.#provider = options.provider ?? new PublicMatchesProvider({
      baseUrl: options.config.providerUrl,
      ...(options.config.providerApiKey === undefined ? {} : { apiKey: options.config.providerApiKey }),
      timeoutMs: options.config.httpTimeoutMs,
      retryAttempts: options.config.httpRetryAttempts,
    });
    this.#now = options.now ?? (() => new Date());
    this.#startedAt = this.#now().toISOString();
    this.#heartbeat = {
      schemaVersion: 1,
      state: "starting",
      startedAt: this.#startedAt,
      updatedAt: this.#startedAt,
      counters: {
        providerRequests: 0,
        candidatesSeen: 0,
        rankedCandidates: 0,
        knownRankCandidates: 0,
        selected: 0,
        enqueued: 0,
        failed: 0,
        cleanupFailed: 0,
        windowsUnderTarget: 0,
      },
      queue: { queued: 0 },
      dryRun: options.config.dryRun,
    };
  }

  async open(): Promise<void> {
    await this.#store.open();
    this.#firstCycle = await this.#store.getState("initial_backfill_completed_at") === undefined;
    await this.#writeHeartbeat();
  }

  close(): void {
    if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = undefined;
    this.#store.close();
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.open();
    this.#heartbeatTimer = setInterval(() => {
      void this.#writeHeartbeat().catch((error) => log("heartbeat_write_failed", { error: errorMessage(error) }));
    }, this.#config.heartbeatIntervalMs);
    try {
      let failures = 0;
      while (!signal.aborted) {
        try {
          await this.tick();
          failures = 0;
        } catch (error) {
          failures += 1;
          this.#heartbeat.state = "error";
          this.#heartbeat.lastError = errorMessage(error);
          log("sampler_tick_failed", { error: errorMessage(error), consecutiveFailures: failures });
          await this.#writeHeartbeat();
        }
        const backoff = Math.min(this.#config.pollIntervalMs * (2 ** Math.min(failures, 4)), 15 * 60_000);
        await wait(backoff, signal);
      }
    } finally {
      this.close();
    }
  }

  async tick(): Promise<void> {
    await this.#store.ensureWindows(hourRange(
      new Date(this.#now().getTime() - this.#config.backfillHours * 60 * 60 * 1_000),
      this.#now(),
    ));
    const initialBackfill = this.#firstCycle;
    const pageLimit = initialBackfill ? this.#config.backfillMaxPages : this.#config.pollPages;
    const stopBefore = this.#now().getTime() - this.#config.backfillHours * 60 * 60 * 1_000;
    const candidates = await this.#collectPages(pageLimit, stopBefore);
    await this.#store.upsertCandidates(candidates);
    if (candidates.length > 0) {
      const latestMatchId = candidates.reduce((latest, candidate) =>
        BigInt(candidate.matchId) > BigInt(latest) ? candidate.matchId : latest, candidates[0]!.matchId);
      await this.#store.setState("latest_seen_match_id", latestMatchId);
    }
    if (initialBackfill) await this.#store.setState("initial_backfill_completed_at", this.#now().toISOString());
    this.#firstCycle = false;
    this.#heartbeat.lastProviderSuccessAt = this.#now().toISOString();

    const cutoff = new Date(this.#now().getTime() - this.#config.windowDelayMinutes * 60_000).toISOString();
    for (const windowStart of await this.#store.listFinalizableWindows(cutoff)) {
      const windowCandidates = await this.#store.getCandidates(windowStart);
      const selections = selectMatches(windowCandidates, {
        target: this.#config.targetPerHour,
        priority: this.#config.priorityPerHour,
        control: this.#config.controlPerHour,
        samplingVersion: this.#config.samplingVersion,
        windowStart,
      });
      if (await this.#store.finalizeWindow(windowStart, selections, this.#config.targetPerHour)) {
        const lastWindow: WindowSummary = {
          windowStart,
          candidateCount: windowCandidates.length,
          knownRankCount: windowCandidates.filter((candidate) => candidate.avgRankTier !== undefined).length,
          selectedCount: selections.length,
          target: this.#config.targetPerHour,
          underTarget: selections.length < this.#config.targetPerHour,
        };
        this.#heartbeat.lastWindow = lastWindow;
        this.#heartbeat.lastWindowFinalizedAt = this.#now().toISOString();
        log("sampling_window_finalized", lastWindow);
      }
    }
    if (!this.#config.dryRun) await this.#enqueuePending();
    await this.#refreshHeartbeat();
    this.#heartbeat.state = "running";
    delete this.#heartbeat.lastError;
    await this.#writeHeartbeat();
    log("sampler_tick_completed", {
      pages: pageLimit,
      rankedCandidatesInResponse: candidates.length,
      selected: this.#heartbeat.counters.selected,
      enqueued: this.#heartbeat.counters.enqueued,
    });
  }

  heartbeat(): Readonly<SamplerHeartbeat> {
    return this.#heartbeat;
  }

  async #collectPages(pageLimit: number, stopBeforeMs: number): Promise<MatchCandidate[]> {
    const candidates = new Map<string, MatchCandidate>();
    let lessThanMatchId: string | undefined;
    for (let pageNumber = 0; pageNumber < pageLimit; pageNumber += 1) {
      const page = await this.#provider.fetchPage(lessThanMatchId);
      this.#heartbeat.counters.providerRequests += 1;
      this.#heartbeat.counters.candidatesSeen += page.rawCount;
      for (const candidate of page.candidates) candidates.set(candidate.matchId, candidate);
      log("provider_page_received", {
        page: pageNumber + 1,
        rawMatches: page.rawCount,
        rankedMatches: page.candidates.length,
        invalidMatches: page.invalidCount,
      });
      if (page.oldestMatchId === undefined || page.oldestMatchId === lessThanMatchId || page.rawCount === 0) break;
      lessThanMatchId = page.oldestMatchId;
      if (page.oldestStartTime !== undefined && page.oldestStartTime * 1_000 < stopBeforeMs) break;
    }
    return [...candidates.values()];
  }

  async #enqueuePending(): Promise<void> {
    const statuses = await listJobStatuses(this.#config.jobsRoot);
    const activeJobs = statuses.filter((status) => status.state !== "succeeded" && status.state !== "failed").length;
    let availableSlots = Math.max(0, this.#config.maxActiveJobs - activeJobs);
    if (availableSlots === 0) {
      log("sample_enqueue_paused", { reason: "queue_limit", activeJobs, limit: this.#config.maxActiveJobs });
      return;
    }
    for (const selection of await this.#store.listPendingSelections()) {
      if (availableSlots === 0) break;
      try {
        const existingJobId = await findJobForMatch(
          selection.matchId,
          selection.samplingVersion,
          selection.windowStart,
          this.#config.jobsRoot,
        );
        const job = existingJobId === undefined
          ? await createIngestionJob(BigInt(selection.matchId), this.#config.jobsRoot, {
            sampling: {
              windowStart: selection.windowStart,
              selectionGroup: selection.selectionGroup,
              ...(selection.avgRankTier === undefined ? {} : { avgRankTier: selection.avgRankTier }),
              source: selection.source,
              samplingVersion: selection.samplingVersion,
            },
            deleteReplayAfterSuccess: true,
          })
          : { jobId: existingJobId };
        await this.#store.markEnqueued(selection.matchId, job.jobId);
        if (existingJobId === undefined) availableSlots -= 1;
        log("sample_enqueued", {
          matchId: selection.matchId,
          jobId: job.jobId,
          selectionGroup: selection.selectionGroup,
          recoveredExistingJob: existingJobId !== undefined,
        });
      } catch (error) {
        this.#heartbeat.counters.failed += 1;
        log("sample_enqueue_failed", { matchId: selection.matchId, error: errorMessage(error) });
      }
    }
  }

  async #refreshHeartbeat(): Promise<void> {
    const summary = await this.#store.summary();
    this.#heartbeat.counters.rankedCandidates = summary.candidates;
    this.#heartbeat.counters.knownRankCandidates = summary.rankedCandidates;
    this.#heartbeat.counters.selected = summary.selected;
    this.#heartbeat.counters.enqueued = summary.enqueued;
    this.#heartbeat.counters.windowsUnderTarget = summary.windowsUnderTarget;
    this.#heartbeat.currentWindow = utcHour(this.#now());
    try {
      const statuses = await listJobStatuses(this.#config.jobsRoot);
      const queued = statuses.filter((status) => !["succeeded", "failed"].includes(status.state));
      const sampled = [];
      for (const status of statuses) {
        try {
          const request = await readIngestionRequest(status.jobId, this.#config.jobsRoot);
          if (request.sampling !== undefined) sampled.push(status);
        } catch {
          // Invalid jobs are handled by the ingestion coordinator and are not attributed to this sampler.
        }
      }
      const failed = sampled.filter((status) => status.state === "failed");
      const cleanupFailed = sampled.filter((status) => status.replayCleanup?.state === "failed");
      this.#heartbeat.counters.failed = Math.max(this.#heartbeat.counters.failed, failed.length);
      this.#heartbeat.counters.cleanupFailed = cleanupFailed.length;
      this.#heartbeat.recentFailures = [
        ...failed.map((status) => ({
          at: status.completedAt ?? status.updatedAt,
          stage: status.error?.stage ?? "fetching" as const,
          code: "job_failed" as const,
        })),
        ...cleanupFailed.map((status) => ({
          at: status.replayCleanup!.attemptedAt,
          stage: "cleanup" as const,
          code: "replay_cleanup_failed" as const,
        })),
      ].sort((left, right) => right.at.localeCompare(left.at)).slice(0, 10);
      this.#heartbeat.queue = {
        queued: queued.length,
        ...(queued[0] === undefined ? {} : { oldestQueuedAt: queued[0].createdAt }),
      };
    } catch (error) {
      log("job_queue_measurement_failed", { error: errorMessage(error) });
    }
  }

  async #writeHeartbeat(): Promise<void> {
    await writeSamplerHeartbeat(this.#config.heartbeatPath, this.#heartbeat);
  }
}

async function findJobForMatch(
  matchId: string,
  samplingVersion: string,
  windowStart: string,
  jobsRoot: string,
): Promise<string | undefined> {
  for (const jobId of await listJobIds(jobsRoot)) {
    try {
      const request = await readIngestionRequest(jobId, jobsRoot);
      if (request.matchId === matchId
        && request.sampling?.samplingVersion === samplingVersion
        && request.sampling.windowStart === windowStart) return jobId;
    } catch {
      // A broken unrelated job must not cause a second job for this match to be created.
      // It also cannot be safely identified, so the coordinator will report it separately.
    }
  }
  return undefined;
}

function hourRange(from: Date, through: Date): string[] {
  const cursor = new Date(from);
  cursor.setUTCMinutes(0, 0, 0);
  const end = new Date(through);
  end.setUTCMinutes(0, 0, 0);
  const result: string[] = [];
  while (cursor <= end) {
    result.push(cursor.toISOString());
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return result;
}

function utcHour(date: Date): string {
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);
  return result.toISOString();
}

function log(event: string, details: Record<string, unknown>): void {
  process.stdout.write(`${jsonStringify({ timestamp: new Date().toISOString(), service: "ranked-match-sampler", event, ...details })}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}
