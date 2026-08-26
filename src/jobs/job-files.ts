import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { parseMatchId } from "../lib/match-id.js";
import { jsonStringify } from "../lib/json.js";

export const jobStates = ["queued", "fetching", "parsing", "loading", "succeeded", "failed"] as const;
export type JobState = typeof jobStates[number];

export const selectionGroups = ["priority", "control", "fill"] as const;
export type SelectionGroup = typeof selectionGroups[number];

export type SamplingMetadata = {
  windowStart: string;
  selectionGroup: SelectionGroup;
  avgRankTier?: number;
  source: string;
  samplingVersion: string;
};

export type IngestionJobOptions = {
  sampling?: SamplingMetadata;
  deleteReplayAfterSuccess?: boolean;
};

export type IngestionRequest = {
  schemaVersion: 1;
  jobId: string;
  matchId: string;
  createdAt: string;
} & IngestionJobOptions;

export type JobError = {
  stage: Exclude<JobState, "queued" | "succeeded" | "failed">;
  message: string;
};

export type JobStatus = {
  schemaVersion: 1;
  jobId: string;
  matchId: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  extractionId?: string;
  result?: "loaded" | "already_loaded";
  error?: JobError;
  replayCleanup?: {
    state: "succeeded" | "failed";
    attemptedAt: string;
    error?: string;
  };
};

export type ParseRequest = {
  schemaVersion: 1;
  jobId: string;
  matchId: string;
  replaySha256: string;
  createdAt: string;
};

export type ParseResult = {
  schemaVersion: 1;
  jobId: string;
  matchId: string;
  status: "succeeded" | "failed";
  completedAt: string;
  extractionId?: string;
  error?: string;
};

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export function jobDirectory(jobId: string, jobsRoot = paths.jobsRoot): string {
  if (!jobIdPattern.test(jobId)) throw new Error("Invalid job ID");
  return path.join(jobsRoot, jobId);
}

export async function createIngestionJob(
  matchId: bigint,
  jobsRoot = paths.jobsRoot,
  options: IngestionJobOptions = {},
): Promise<JobStatus> {
  if (options.sampling !== undefined) validateSamplingMetadata(options.sampling);
  if (options.deleteReplayAfterSuccess !== undefined && typeof options.deleteReplayAfterSuccess !== "boolean") {
    throw new Error("deleteReplayAfterSuccess must be a boolean");
  }
  if (options.deleteReplayAfterSuccess === true && options.sampling === undefined) {
    throw new Error("Replay cleanup policy is only valid for a sampled job");
  }
  const jobId = randomUUID();
  const createdAt = new Date().toISOString();
  const request: IngestionRequest = {
    schemaVersion: 1, jobId, matchId: matchId.toString(), createdAt, ...options,
  };
  const status: JobStatus = {
    schemaVersion: 1, jobId, matchId: matchId.toString(), state: "queued", createdAt, updatedAt: createdAt,
  };
  const directory = jobDirectory(jobId, jobsRoot);
  await mkdir(jobsRoot, { recursive: true });
  await mkdir(directory, { recursive: false });
  try {
    await atomicWriteJson(path.join(directory, "request.json"), request);
    await atomicWriteJson(path.join(directory, "status.json"), status);
    return status;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function readIngestionRequest(jobId: string, jobsRoot = paths.jobsRoot): Promise<IngestionRequest> {
  return validateIngestionRequest(await readJson(path.join(jobDirectory(jobId, jobsRoot), "request.json")), jobId);
}

export async function readJobStatus(jobId: string, jobsRoot = paths.jobsRoot): Promise<JobStatus> {
  return validateJobStatus(await readJson(path.join(jobDirectory(jobId, jobsRoot), "status.json")), jobId);
}

export async function listJobIds(jobsRoot = paths.jobsRoot): Promise<string[]> {
  try {
    const entries = await readdir(jobsRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && jobIdPattern.test(entry.name)).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function listJobStatuses(jobsRoot = paths.jobsRoot): Promise<JobStatus[]> {
  const statuses = await Promise.all((await listJobIds(jobsRoot)).map((id) => readJobStatus(id, jobsRoot)));
  return statuses.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function updateJobStatus(
  previous: JobStatus,
  state: JobState,
  details: Pick<JobStatus, "extractionId" | "result" | "error"> = {},
  jobsRoot = paths.jobsRoot,
): Promise<JobStatus> {
  const now = new Date().toISOString();
  const next: JobStatus = {
    schemaVersion: 1,
    jobId: previous.jobId,
    matchId: previous.matchId,
    state,
    createdAt: previous.createdAt,
    updatedAt: now,
    ...(previous.startedAt === undefined ? (state === "queued" ? {} : { startedAt: now }) : { startedAt: previous.startedAt }),
    ...(state === "succeeded" || state === "failed" ? { completedAt: now } : {}),
    ...details,
  };
  await atomicWriteJson(path.join(jobDirectory(previous.jobId, jobsRoot), "status.json"), next);
  return next;
}

export async function updateReplayCleanup(
  previous: JobStatus,
  replayCleanup: NonNullable<JobStatus["replayCleanup"]>,
  jobsRoot = paths.jobsRoot,
): Promise<JobStatus> {
  if (previous.state !== "succeeded") throw new Error("Replay cleanup can only be recorded for a successful job");
  validDate(replayCleanup.attemptedAt);
  if (replayCleanup.state === "failed" && (replayCleanup.error === undefined || replayCleanup.error.length === 0)) {
    throw new Error("Failed replay cleanup must include an error");
  }
  const next: JobStatus = { ...previous, updatedAt: new Date().toISOString(), replayCleanup };
  await atomicWriteJson(path.join(jobDirectory(previous.jobId, jobsRoot), "status.json"), next);
  return next;
}

export async function writeParseRequest(request: ParseRequest, jobsRoot = paths.jobsRoot): Promise<void> {
  validateParseRequest(request, request.jobId);
  await atomicWriteJson(path.join(jobDirectory(request.jobId, jobsRoot), "parse-request.json"), request);
}

export async function readParseRequest(file: string): Promise<ParseRequest> {
  const jobId = path.basename(path.dirname(file));
  return validateParseRequest(await readJson(file), jobId);
}

export async function readParseResult(jobId: string, jobsRoot = paths.jobsRoot): Promise<ParseResult | undefined> {
  const file = path.join(jobDirectory(jobId, jobsRoot), "parse-result.json");
  try { return validateParseResult(await readJson(file), jobId); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeParseResult(result: ParseResult, jobsRoot = paths.jobsRoot): Promise<void> {
  validateParseResult(result, result.jobId);
  await atomicWriteJson(path.join(jobDirectory(result.jobId, jobsRoot), "parse-result.json"), result);
}

export async function fileExists(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  let published = false;
  try {
    await handle.writeFile(`${jsonStringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, file);
    published = true;
    const directory = await open(path.dirname(file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (!published) await rm(temporary, { force: true });
    throw error;
  }
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

function validateIngestionRequest(value: unknown, expectedId: string): IngestionRequest {
  if (!isObject(value) || value.schemaVersion !== 1 || value.jobId !== expectedId) throw new Error("Invalid ingestion request");
  parseMatchId(stringField(value, "matchId"));
  validDate(stringField(value, "createdAt"));
  if (value.sampling !== undefined) validateSamplingMetadata(value.sampling);
  if (value.deleteReplayAfterSuccess !== undefined && typeof value.deleteReplayAfterSuccess !== "boolean") {
    throw new Error("deleteReplayAfterSuccess must be a boolean");
  }
  return value as IngestionRequest;
}

function validateJobStatus(value: unknown, expectedId: string): JobStatus {
  if (!isObject(value) || value.schemaVersion !== 1 || value.jobId !== expectedId) throw new Error("Invalid job status");
  parseMatchId(stringField(value, "matchId"));
  if (!jobStates.includes(value.state as JobState)) throw new Error("Invalid job state");
  validDate(stringField(value, "createdAt"));
  validDate(stringField(value, "updatedAt"));
  if (value.replayCleanup !== undefined) {
    if (!isObject(value.replayCleanup)
      || (value.replayCleanup.state !== "succeeded" && value.replayCleanup.state !== "failed")) {
      throw new Error("Invalid replay cleanup status");
    }
    validDate(stringField(value.replayCleanup, "attemptedAt"));
    if (value.replayCleanup.state === "failed") stringField(value.replayCleanup, "error");
  }
  return value as JobStatus;
}

export function validateSamplingMetadata(value: unknown): SamplingMetadata {
  if (!isObject(value)) throw new Error("Sampling metadata must be an object");
  validDate(stringField(value, "windowStart"));
  if (!selectionGroups.includes(value.selectionGroup as SelectionGroup)) throw new Error("Invalid sampling selection group");
  if (value.avgRankTier !== undefined
    && (typeof value.avgRankTier !== "number"
      || !Number.isSafeInteger(value.avgRankTier)
      || value.avgRankTier < 0
      || value.avgRankTier > 99)) {
    throw new Error("avgRankTier must be an integer from 0 through 99");
  }
  stringField(value, "source");
  stringField(value, "samplingVersion");
  return value as SamplingMetadata;
}

function validateParseRequest(value: unknown, expectedId: string): ParseRequest {
  if (!isObject(value) || value.schemaVersion !== 1 || value.jobId !== expectedId) throw new Error("Invalid parse request");
  parseMatchId(stringField(value, "matchId"));
  if (!sha256Pattern.test(stringField(value, "replaySha256"))) throw new Error("Invalid replay SHA-256");
  validDate(stringField(value, "createdAt"));
  return value as ParseRequest;
}

function validateParseResult(value: unknown, expectedId: string): ParseResult {
  if (!isObject(value) || value.schemaVersion !== 1 || value.jobId !== expectedId) throw new Error("Invalid parse result");
  parseMatchId(stringField(value, "matchId"));
  if (value.status !== "succeeded" && value.status !== "failed") throw new Error("Invalid parse result status");
  validDate(stringField(value, "completedAt"));
  if (value.status === "succeeded" && !sha256Pattern.test(stringField(value, "extractionId"))) throw new Error("Invalid extraction ID");
  if (value.status === "failed" && typeof value.error !== "string") throw new Error("Invalid parser error");
  return value as ParseResult;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) throw new Error(`${key} must be a non-empty string`);
  return field;
}

function validDate(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp");
}
