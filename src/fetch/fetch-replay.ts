import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { limits, replayDir } from "../config.js";
import { writeJson } from "../lib/json.js";

type AcquisitionSource = "cache" | "opendota" | "direct_url" | "direct_file";
export type Acquisition = {
  schemaVersion: 1;
  matchId: string;
  status: "available" | "replay_unavailable" | "error";
  source: AcquisitionSource;
  replaySha256?: string;
  replayBytes?: number;
  replayUrl?: string;
  replayPath?: string;
  acquiredAt: string;
  cacheHit?: boolean;
  lastCacheHitAt?: string;
  error?: string;
};

type OpenDotaMatch = { cluster?: number; replay_salt?: number | string; replay_url?: string };
class ReplayUnavailableError extends Error {}
class TemporaryProviderError extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(message: string, retryAfterMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemporaryProviderError";
    this.retryAfterMs = retryAfterMs;
  }
}

type ReplayKind = "compressed" | "uncompressed";
type DownloadResult = { sha256: string; bytes: number; kind: ReplayKind };
const replayFileNames: Record<ReplayKind, string> = {
  compressed: "replay.dem.bz2",
  uncompressed: "replay.dem",
};
const acquisitionSources = new Set<AcquisitionSource>(["cache", "opendota", "direct_url", "direct_file"]);

export async function fetchReplay(matchId: bigint, directSource?: string): Promise<Acquisition> {
  const dir = replayDir(matchId);
  const acquisitionPath = path.join(dir, "acquisition.json");
  await mkdir(dir, { recursive: true });

  const cached = await validatedCacheEntry(matchId, dir, acquisitionPath);
  if (cached !== undefined) return cached;

  let source: AcquisitionSource = "opendota";
  let location: string | undefined;
  try {
    if (directSource) {
      location = directSource;
      source = /^https?:\/\//i.test(directSource) ? "direct_url" : "direct_file";
    } else {
      location = await openDotaReplayUrl(matchId);
    }
    if (!location) {
      const unavailable: Acquisition = { schemaVersion: 1, matchId: matchId.toString(), status: "replay_unavailable", source, acquiredAt: new Date().toISOString() };
      await replaceJson(acquisitionPath, unavailable);
      return unavailable;
    }

    const temporary = path.join(dir, `.replay.${randomUUID()}.tmp`);
    try {
      const result = /^https?:\/\//i.test(location)
        ? await download(location, temporary)
        : await copyLocal(location, temporary);
      const replayPath = path.join(dir, replayFileNames[result.kind]);
      await rename(temporary, replayPath);
      await removeOtherReplayKind(dir, result.kind);
      const acquisition: Acquisition = {
        schemaVersion: 1, matchId: matchId.toString(), status: "available", source,
        replaySha256: result.sha256, replayBytes: result.bytes, replayPath,
        ...(source !== "direct_file" ? { replayUrl: location } : {}), acquiredAt: new Date().toISOString(),
      };
      await replaceJson(acquisitionPath, acquisition);
      return acquisition;
    } finally {
      await rm(temporary, { force: true });
    }
  } catch (error) {
    if (error instanceof ReplayUnavailableError) {
      const unavailable: Acquisition = {
        schemaVersion: 1, matchId: matchId.toString(), status: "replay_unavailable", source,
        acquiredAt: new Date().toISOString(), error: error.message,
      };
      await replaceJson(acquisitionPath, unavailable);
      return unavailable;
    }
    const failed: Acquisition = {
      schemaVersion: 1, matchId: matchId.toString(), status: "error", source,
      acquiredAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error),
    };
    await replaceJson(acquisitionPath, failed);
    throw error;
  }
}

async function openDotaReplayUrl(matchId: bigint): Promise<string | undefined> {
  const baseUrl = (process.env.OPENDOTA_API_BASE_URL ?? "https://api.opendota.com/api").replace(/\/$/, "");
  const url = `${baseUrl}/matches/${matchId}`;
  return retryTemporary("OpenDota metadata request", async () => {
    let response: Response;
    try {
      response = await fetchWithTimeout(url);
    } catch (error) {
      throw temporaryNetworkError("OpenDota metadata request", error);
    }
    if (response.status === 404) return undefined;
    if (isTemporaryStatus(response.status)) {
      const retryAfterMs = retryAfter(response.headers.get("retry-after"));
      await response.body?.cancel();
      throw new TemporaryProviderError(
        `OpenDota metadata request returned transient HTTP ${response.status}`,
        retryAfterMs,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OpenDota metadata request failed: HTTP ${response.status}`);
    }
    const metadata = await response.json() as OpenDotaMatch;
    if (metadata.replay_url) return metadata.replay_url;
    if (metadata.cluster !== undefined && metadata.replay_salt !== undefined) {
      return `http://replay${metadata.cluster}.valve.net/570/${matchId}_${metadata.replay_salt}.dem.bz2`;
    }
    return undefined;
  });
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.fetchTimeoutMs);
  try { return await fetch(url, { signal: controller.signal, redirect: "follow" }); }
  finally { clearTimeout(timer); }
}

async function download(url: string, destination: string): Promise<DownloadResult> {
  try {
    return await retryTemporary("Replay download", async () => {
      await rm(destination, { force: true });
      try { return await downloadOnce(url, destination); }
      catch (error) {
        await rm(destination, { force: true });
        throw error;
      }
    });
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

async function downloadOnce(url: string, destination: string): Promise<DownloadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.fetchTimeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } catch (error) {
      throw temporaryNetworkError("Replay download", error);
    }
    if (response.status === 404 || response.status === 410) {
      throw new ReplayUnavailableError(`Replay is unavailable: HTTP ${response.status}`);
    }
    if (isTemporaryStatus(response.status)) {
      const retryAfterMs = retryAfter(response.headers.get("retry-after"));
      await response.body?.cancel();
      throw new TemporaryProviderError(`Replay download returned transient HTTP ${response.status}`, retryAfterMs);
    }
    if (!response.ok || response.body === null) throw new Error(`Replay download failed: HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limits.replayBytes) throw new Error("Replay exceeds MAX_REPLAY_BYTES");
    let bytes = 0;
    const hash = createHash("sha256");
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > limits.replayBytes) callback(new Error("Replay exceeds MAX_REPLAY_BYTES"));
        else { hash.update(chunk); callback(null, chunk); }
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
    } catch (error) {
      if (isNetworkError(error)) throw temporaryNetworkError("Replay download", error);
      throw error;
    }
    if (bytes === 0) throw new Error("Replay is empty");
    const kind = await replayKind(destination);
    return { sha256: hash.digest("hex"), bytes, kind };
  } finally { clearTimeout(timer); }
}

function temporaryNetworkError(operation: string, error: unknown): TemporaryProviderError {
  const cause = asError(error);
  return new TemporaryProviderError(`${operation} network error: ${describeError(cause)}`, undefined, { cause });
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error instanceof TypeError) return true;
  const code = errorCode(error) ?? errorCode(error.cause);
  return code !== undefined && /^(?:UND_ERR_|EAI_AGAIN$|E(?:CONN|HOST|NET|PIPE|TIMEDOUT))/.test(code);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function describeError(error: unknown): string {
  const details: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = errorCode(current);
    const detail = code !== undefined && !current.message.includes(code)
      ? `${code}: ${current.message}`
      : current.message;
    if (detail && details.at(-1) !== detail) details.push(detail);
    current = current.cause;
  }
  return details.join(" -> ") || String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function copyLocal(source: string, destination: string): Promise<DownloadResult> {
  const info = await stat(source);
  if (!info.isFile()) throw new Error("Direct replay source is not a file");
  if (info.size > limits.replayBytes) throw new Error("Replay exceeds MAX_REPLAY_BYTES");
  if (info.size === 0) throw new Error("Replay is empty");
  let bytes = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limits.replayBytes) callback(new Error("Replay exceeds MAX_REPLAY_BYTES"));
      else { hash.update(chunk); callback(null, chunk); }
    },
  });
  await pipeline(createReadStream(source), meter, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  return { sha256: hash.digest("hex"), bytes, kind: await replayKind(destination) };
}

async function validatedCacheEntry(
  matchId: bigint,
  directory: string,
  acquisitionPath: string,
): Promise<Acquisition | undefined> {
  const acquisition = await readAcquisition(acquisitionPath, matchId);
  for (const kind of ["compressed", "uncompressed"] as const) {
    const replayPath = path.join(directory, replayFileNames[kind]);
    let valid = false;
    try {
      const info = await stat(replayPath);
      valid = acquisition !== undefined
        && info.isFile()
        && info.size > 0
        && info.size <= limits.replayBytes
        && info.size === acquisition.replayBytes
        && await replayKind(replayPath) === kind
        && await hashFile(replayPath) === acquisition.replaySha256;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") valid = false;
    }
    if (valid && acquisition !== undefined) {
      const cached: Acquisition = {
        ...acquisition,
        cacheHit: true,
        lastCacheHitAt: new Date().toISOString(),
      };
      await replaceJson(acquisitionPath, cached);
      await removeOtherReplayKind(directory, kind);
      return cached;
    }
    await rm(replayPath, { force: true });
  }
  return undefined;
}

async function readAcquisition(file: string, matchId: bigint): Promise<Acquisition | undefined> {
  let value: unknown;
  try { value = JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.matchId !== matchId.toString()
    || value.status !== "available"
    || typeof value.source !== "string"
    || !acquisitionSources.has(value.source as AcquisitionSource)
    || typeof value.replaySha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.replaySha256)
    || typeof value.replayBytes !== "number"
    || !Number.isSafeInteger(value.replayBytes)
    || value.replayBytes <= 0
    || value.replayBytes > limits.replayBytes
    || typeof value.acquiredAt !== "string"
    || !Number.isFinite(Date.parse(value.acquiredAt))) return undefined;
  return value as Acquisition;
}

async function replayKind(file: string): Promise<ReplayKind> {
  const handle = await open(file, "r");
  try {
    const magic = Buffer.alloc(8);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    if (bytesRead >= 3 && magic.subarray(0, 3).equals(Buffer.from("BZh"))) return "compressed";
    if (bytesRead >= 4 && magic.readUInt32LE(0) === 0xfd2fb528) return "compressed";
    if (bytesRead >= 7 && magic.subarray(0, 7).equals(Buffer.from("PBDEMS2"))) return "uncompressed";
    if (bytesRead >= 7 && magic.subarray(0, 7).equals(Buffer.from("HL2DEMO"))) return "uncompressed";
    throw new Error("Replay uses an unsupported file format");
  } finally { await handle.close(); }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function removeOtherReplayKind(directory: string, retained: ReplayKind): Promise<void> {
  const other: ReplayKind = retained === "compressed" ? "uncompressed" : "compressed";
  await rm(path.join(directory, replayFileNames[other]), { force: true });
}

async function retryTemporary<T>(operation: string, run: () => Promise<T>): Promise<T> {
  let lastError: TemporaryProviderError | undefined;
  for (let attempt = 1; attempt <= limits.fetchRetryAttempts; attempt += 1) {
    try { return await run(); }
    catch (error) {
      if (!(error instanceof TemporaryProviderError)) throw error;
      lastError = error;
      if (attempt === limits.fetchRetryAttempts) break;
      const exponential = limits.fetchRetryBaseMs * (2 ** (attempt - 1));
      const requested = error.retryAfterMs ?? exponential;
      await wait(Math.min(limits.fetchRetryMaxMs, Math.max(0, requested)));
    }
  }
  throw new TemporaryProviderError(
    `${operation} temporarily failed after ${limits.fetchRetryAttempts} attempts: ${describeError(lastError)}`,
    undefined,
    { cause: lastError },
  );
}

function isTemporaryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^[0-9]+$/.test(value.trim())) return Number(value.trim()) * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function replaceJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeJson(temporary, value);
  await rename(temporary, file);
  const handle = await open(path.dirname(file), "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
