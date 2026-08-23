import { spawn } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { envPositiveInt, paths } from "../config.js";
import {
  fileExists,
  jobDirectory,
  listJobIds,
  readIngestionRequest,
  readParseRequest,
  writeParseResult,
  type ParseRequest,
} from "./job-files.js";

export type ParserRunResult = { extractionId: string };
export type ParserRunner = (request: ParseRequest) => Promise<ParserRunResult>;

export class ParserWorker {
  readonly #jobsRoot: string;
  readonly #pollIntervalMs: number;
  readonly #runner: ParserRunner;
  #abortController: AbortController | undefined;
  #loop: Promise<void> | undefined;
  #busy = false;

  constructor(options: { jobsRoot?: string; pollIntervalMs?: number; runner?: ParserRunner } = {}) {
    this.#jobsRoot = options.jobsRoot ?? paths.jobsRoot;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#runner = options.runner ?? runJavaParser;
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

  async recoverClaims(): Promise<void> {
    for (const jobId of await listJobIds(this.#jobsRoot)) {
      const directory = jobDirectory(jobId, this.#jobsRoot);
      const claim = path.join(directory, "parse-request.claimed.json");
      if (!await fileExists(claim)) continue;
      if (await fileExists(path.join(directory, "parse-result.json"))) {
        await rm(claim, { force: true });
        continue;
      }
      const request = path.join(directory, "parse-request.json");
      try { await rename(claim, request); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") await rm(claim, { force: true });
        else throw error;
      }
    }
  }

  async tick(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      for (const jobId of await listJobIds(this.#jobsRoot)) {
        const directory = jobDirectory(jobId, this.#jobsRoot);
        const pending = path.join(directory, "parse-request.json");
        const claimed = path.join(directory, "parse-request.claimed.json");
        try { await rename(pending, claimed); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        await this.#process(claimed);
        return;
      }
    } finally { this.#busy = false; }
  }

  async #run(signal: AbortSignal): Promise<void> {
    try { await this.recoverClaims(); }
    catch (error) { process.stderr.write(`parser worker recovery: ${errorMessage(error)}\n`); }
    while (!signal.aborted) {
      try { await this.tick(); }
      catch (error) { process.stderr.write(`parser worker: ${errorMessage(error)}\n`); }
      await wait(this.#pollIntervalMs, signal);
    }
  }

  async #process(claimedFile: string): Promise<void> {
    let request: ParseRequest;
    try { request = await readParseRequest(claimedFile); }
    catch (error) {
      process.stderr.write(`parser worker: invalid claimed request ${claimedFile}: ${errorMessage(error)}\n`);
      const jobId = path.basename(path.dirname(claimedFile));
      try {
        const ingestion = await readIngestionRequest(jobId, this.#jobsRoot);
        await writeParseResult({
          schemaVersion: 1,
          jobId,
          matchId: ingestion.matchId,
          status: "failed",
          completedAt: new Date().toISOString(),
          error: `Invalid parse request: ${errorMessage(error)}`,
        }, this.#jobsRoot);
      } finally { await rm(claimedFile, { force: true }); }
      return;
    }
    try {
      const parsed = await this.#runner(request);
      await writeParseResult({
        schemaVersion: 1,
        jobId: request.jobId,
        matchId: request.matchId,
        status: "succeeded",
        completedAt: new Date().toISOString(),
        extractionId: parsed.extractionId,
      }, this.#jobsRoot);
    } catch (error) {
      await writeParseResult({
        schemaVersion: 1,
        jobId: request.jobId,
        matchId: request.matchId,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: errorMessage(error),
      }, this.#jobsRoot);
    } finally { await rm(claimedFile, { force: true }); }
  }
}

export async function runJavaParser(request: ParseRequest): Promise<ParserRunResult> {
  const java = process.env.JAVA_COMMAND ?? "java";
  const jar = process.env.PARSER_JAR ?? "/app/parser.jar";
  const timeoutMs = envPositiveInt("PARSER_WORKER_TIMEOUT_MS", 1_860_000);
  const outputLimit = 64 * 1024;
  const child = spawn(java, [
    "-jar", jar, request.matchId,
    "--staging-root", paths.stagingInboxRoot,
    "--replay-sha256", request.replaySha256,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout = appendLimited(stdout, chunk, outputLimit);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = appendLimited(stderr, chunk, outputLimit);
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Parser process exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => { clearTimeout(timeout); resolve(code ?? 1); });
  });
  if (exitCode !== 0) throw new Error(`Parser exited with code ${exitCode}: ${stderr.trim() || "no error output"}`);
  let value: unknown;
  try { value = JSON.parse(stdout.trim()); }
  catch { throw new Error("Parser did not return valid JSON"); }
  if (typeof value !== "object" || value === null || !("extractionId" in value)
    || typeof value.extractionId !== "string" || !/^[a-f0-9]{64}$/.test(value.extractionId)) {
    throw new Error("Parser returned an invalid extraction ID");
  }
  return { extractionId: value.extractionId };
}

async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function appendLimited(previous: string, chunk: string, limit: number): string {
  const combined = previous + chunk;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
