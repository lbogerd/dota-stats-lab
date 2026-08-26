import type { MatchCandidate } from "./types.js";

export type PublicMatchesPage = {
  candidates: MatchCandidate[];
  rawCount: number;
  invalidCount: number;
  oldestMatchId?: string;
  oldestStartTime?: number;
};

export type PublicMatchesProviderOptions = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  retryAttempts?: number;
  fetch?: typeof globalThis.fetch;
};

export class PublicMatchesProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string | undefined;
  readonly #timeoutMs: number;
  readonly #retryAttempts: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: PublicMatchesProviderOptions) {
    this.#baseUrl = options.baseUrl;
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#retryAttempts = options.retryAttempts ?? 3;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async fetchPage(lessThanMatchId?: string): Promise<PublicMatchesPage> {
    const url = new URL(this.#baseUrl);
    if (lessThanMatchId !== undefined) url.searchParams.set("less_than_match_id", validMatchId(lessThanMatchId));
    if (this.#apiKey !== undefined) url.searchParams.set("api_key", this.#apiKey);

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#retryAttempts; attempt += 1) {
      try {
        const response = await this.#fetch(url, {
          headers: { accept: "application/json", "user-agent": "dota-stats-lab-sampler/1" },
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        if (!response.ok) throw new Error(`OpenDota returned HTTP ${response.status}`);
        return parsePublicMatchesPage(await response.json());
      } catch (error) {
        lastError = error;
        if (attempt < this.#retryAttempts) await wait(Math.min(250 * (2 ** (attempt - 1)), 2_000));
      }
    }
    throw new Error(`OpenDota public matches request failed: ${errorMessage(lastError)}`);
  }
}

export function parsePublicMatchesPage(value: unknown): PublicMatchesPage {
  if (!Array.isArray(value)) throw new Error("OpenDota public matches response must be an array");
  const candidates: MatchCandidate[] = [];
  let invalidCount = 0;
  let oldestMatchId: string | undefined;
  let oldestStartTime: number | undefined;
  for (const item of value) {
    const parsed = parseCandidate(item);
    if (parsed === undefined) {
      invalidCount += 1;
      continue;
    }
    if (oldestMatchId === undefined || BigInt(parsed.matchId) < BigInt(oldestMatchId)) oldestMatchId = parsed.matchId;
    if (oldestStartTime === undefined || parsed.startTime < oldestStartTime) oldestStartTime = parsed.startTime;
    if (parsed.lobbyType === 7) candidates.push(parsed);
  }
  return {
    candidates,
    rawCount: value.length,
    invalidCount,
    ...(oldestMatchId === undefined ? {} : { oldestMatchId }),
    ...(oldestStartTime === undefined ? {} : { oldestStartTime }),
  };
}

function parseCandidate(value: unknown): MatchCandidate | undefined {
  if (!isObject(value)) return undefined;
  const matchId = matchIdField(value.match_id);
  const startTime = integerField(value.start_time, 1);
  const lobbyType = integerField(value.lobby_type, 0);
  if (matchId === undefined || startTime === undefined || lobbyType === undefined) return undefined;
  const duration = optionalInteger(value.duration, 0);
  const gameMode = optionalInteger(value.game_mode, 0);
  const avgRankTier = optionalInteger(value.avg_rank_tier, 1, 99);
  const numRankTier = optionalInteger(value.num_rank_tier, 0);
  const cluster = optionalInteger(value.cluster, 0);
  if ([duration, gameMode, avgRankTier, numRankTier, cluster].includes(INVALID)) return undefined;
  return {
    matchId,
    startTime,
    windowStart: utcHour(startTime),
    lobbyType,
    source: "opendota-public-matches",
    ...(typeof duration === "number" ? { duration } : {}),
    ...(typeof gameMode === "number" ? { gameMode } : {}),
    ...(typeof avgRankTier === "number" ? { avgRankTier } : {}),
    ...(typeof numRankTier === "number" ? { numRankTier } : {}),
    ...(typeof cluster === "number" ? { cluster } : {}),
  };
}

const INVALID = Symbol("invalid");

function optionalInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined;
  const parsed = integerField(value, minimum, maximum);
  return parsed ?? INVALID;
}

function integerField(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) return undefined;
  return value;
}

function matchIdField(value: unknown): string | undefined {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return undefined;
    return String(value);
  }
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
  return undefined;
}

function validMatchId(value: string): string {
  const parsed = matchIdField(value);
  if (parsed === undefined) throw new Error("less_than_match_id must be a positive integer");
  return parsed;
}

function utcHour(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1_000);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
