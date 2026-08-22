import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { limits, replayDir } from "../config.js";
import { sha256File } from "../lib/hash.js";
import { writeJson } from "../lib/json.js";

export type Acquisition = {
  schemaVersion: 1;
  matchId: string;
  status: "available" | "replay_unavailable" | "error";
  source: "cache" | "opendota" | "direct_url" | "direct_file";
  replaySha256?: string;
  replayBytes?: number;
  replayUrl?: string;
  acquiredAt: string;
  error?: string;
};

type OpenDotaMatch = { cluster?: number; replay_salt?: number | string; replay_url?: string };
class ReplayUnavailableError extends Error {}

export async function fetchReplay(matchId: bigint, directSource?: string): Promise<Acquisition> {
  const dir = replayDir(matchId);
  const replayPath = path.join(dir, "replay.dem.bz2");
  const acquisitionPath = path.join(dir, "acquisition.json");
  await mkdir(dir, { recursive: true });

  try {
    const info = await stat(replayPath);
    const acquisition: Acquisition = {
      schemaVersion: 1, matchId: matchId.toString(), status: "available", source: "cache",
      replaySha256: await sha256File(replayPath), replayBytes: info.size, acquiredAt: new Date().toISOString(),
    };
    await replaceJson(acquisitionPath, acquisition);
    return acquisition;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let source: Acquisition["source"] = "opendota";
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
      await rename(temporary, replayPath);
      const acquisition: Acquisition = {
        schemaVersion: 1, matchId: matchId.toString(), status: "available", source,
        replaySha256: result.sha256, replayBytes: result.bytes,
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
  const url = `https://api.opendota.com/api/matches/${matchId}`;
  const response = await fetchWithTimeout(url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`OpenDota metadata request failed: HTTP ${response.status}`);
  const metadata = await response.json() as OpenDotaMatch;
  if (metadata.replay_url) return metadata.replay_url;
  if (metadata.cluster !== undefined && metadata.replay_salt !== undefined) {
    return `http://replay${metadata.cluster}.valve.net/570/${matchId}_${metadata.replay_salt}.dem.bz2`;
  }
  return undefined;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.fetchTimeoutMs);
  try { return await fetch(url, { signal: controller.signal, redirect: "follow" }); }
  finally { clearTimeout(timer); }
}

async function download(url: string, destination: string): Promise<{ sha256: string; bytes: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.fetchTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (response.status === 404 || response.status === 410 || response.status === 502) {
      throw new ReplayUnavailableError(`Replay is unavailable: HTTP ${response.status}`);
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
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
    return { sha256: hash.digest("hex"), bytes };
  } finally { clearTimeout(timer); }
}

async function copyLocal(source: string, destination: string): Promise<{ sha256: string; bytes: number }> {
  const info = await stat(source);
  if (!info.isFile()) throw new Error("Direct replay source is not a file");
  if (info.size > limits.replayBytes) throw new Error("Replay exceeds MAX_REPLAY_BYTES");
  await copyFile(source, destination);
  return { sha256: await sha256File(destination), bytes: info.size };
}

async function replaceJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeJson(temporary, value);
  await rename(temporary, file);
  const handle = await open(path.dirname(file), "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
