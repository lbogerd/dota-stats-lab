import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { MatchCandidate, MatchSelection } from "./types.js";

export type StoredSelection = MatchSelection & { jobId?: string };

export class SamplerStore {
  readonly #databasePath: string;
  #instance: DuckDBInstance | undefined;
  #connection: DuckDBConnection | undefined;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
  }

  async open(): Promise<void> {
    if (this.#connection !== undefined) return;
    await mkdir(path.dirname(this.#databasePath), { recursive: true });
    this.#instance = await DuckDBInstance.create(this.#databasePath, { threads: "1", memory_limit: "512MB" });
    this.#connection = await this.#instance.connect();
    await this.#connection.run(`
      CREATE TABLE IF NOT EXISTS provider_state (
        key VARCHAR PRIMARY KEY,
        value VARCHAR NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
      );
      CREATE TABLE IF NOT EXISTS sampling_windows (
        window_start VARCHAR PRIMARY KEY,
        window_end VARCHAR NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finalized')),
        candidate_count INTEGER NOT NULL DEFAULT 0,
        known_rank_count INTEGER NOT NULL DEFAULT 0,
        selected_count INTEGER NOT NULL DEFAULT 0,
        target INTEGER,
        finalized_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS match_candidates (
        match_id VARCHAR PRIMARY KEY,
        window_start VARCHAR NOT NULL,
        start_time BIGINT NOT NULL,
        duration INTEGER,
        lobby_type INTEGER NOT NULL,
        game_mode INTEGER,
        avg_rank_tier INTEGER,
        num_rank_tier INTEGER,
        cluster INTEGER,
        source VARCHAR NOT NULL,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp
      );
      CREATE INDEX IF NOT EXISTS match_candidates_window_idx ON match_candidates(window_start);
      CREATE TABLE IF NOT EXISTS match_selections (
        match_id VARCHAR PRIMARY KEY,
        window_start VARCHAR NOT NULL,
        selection_group VARCHAR NOT NULL CHECK (selection_group IN ('priority', 'control', 'fill')),
        selection_hash VARCHAR NOT NULL,
        sampling_version VARCHAR NOT NULL,
        selected_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
        job_id VARCHAR,
        enqueued_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS match_selections_window_idx ON match_selections(window_start);
    `);
  }

  close(): void {
    try { this.#connection?.closeSync(); }
    finally {
      this.#instance?.closeSync();
      this.#connection = undefined;
      this.#instance = undefined;
    }
  }

  async upsertCandidates(candidates: readonly MatchCandidate[]): Promise<number> {
    if (candidates.length === 0) return 0;
    const connection = this.#connected();
    await connection.run("BEGIN TRANSACTION");
    try {
      for (const candidate of candidates) {
        await connection.run(`
          INSERT INTO sampling_windows(window_start, window_end)
          VALUES ($windowStart, $windowEnd)
          ON CONFLICT (window_start) DO NOTHING
        `, { windowStart: candidate.windowStart, windowEnd: nextHour(candidate.windowStart) });
        await connection.run(`
          INSERT INTO match_candidates(
            match_id, window_start, start_time, duration, lobby_type, game_mode,
            avg_rank_tier, num_rank_tier, cluster, source
          ) VALUES (
            $matchId, $windowStart, $startTime, $duration, $lobbyType, $gameMode,
            $avgRankTier, $numRankTier, $cluster, $source
          ) ON CONFLICT (match_id) DO UPDATE SET
            avg_rank_tier = coalesce(excluded.avg_rank_tier, match_candidates.avg_rank_tier),
            num_rank_tier = coalesce(excluded.num_rank_tier, match_candidates.num_rank_tier)
        `, {
          matchId: candidate.matchId,
          windowStart: candidate.windowStart,
          startTime: BigInt(candidate.startTime),
          duration: candidate.duration ?? null,
          lobbyType: candidate.lobbyType,
          gameMode: candidate.gameMode ?? null,
          avgRankTier: candidate.avgRankTier ?? null,
          numRankTier: candidate.numRankTier ?? null,
          cluster: candidate.cluster ?? null,
          source: candidate.source,
        });
      }
      for (const windowStart of new Set(candidates.map((candidate) => candidate.windowStart))) {
        await connection.run(`
          UPDATE sampling_windows SET
            candidate_count = (SELECT count(*)::INTEGER FROM match_candidates WHERE window_start = $windowStart),
            known_rank_count = (SELECT count(avg_rank_tier)::INTEGER FROM match_candidates WHERE window_start = $windowStart)
          WHERE window_start = $windowStart
        `, { windowStart });
      }
      await connection.run("COMMIT");
      return candidates.length;
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error;
    }
  }

  async ensureWindows(windowStarts: readonly string[]): Promise<void> {
    const connection = this.#connected();
    for (const windowStart of windowStarts) {
      await connection.run(`
        INSERT INTO sampling_windows(window_start, window_end)
        VALUES ($windowStart, $windowEnd)
        ON CONFLICT (window_start) DO NOTHING
      `, { windowStart, windowEnd: nextHour(windowStart) });
    }
  }

  async setState(key: string, value: string): Promise<void> {
    await this.#connected().run(`
      INSERT INTO provider_state(key, value) VALUES ($key, $value)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
    `, { key, value });
  }

  async getState(key: string): Promise<string | undefined> {
    const result = await this.#connected().runAndReadAll("SELECT value FROM provider_state WHERE key = $key", { key });
    return (result.getRowObjects()[0] as { value?: string } | undefined)?.value;
  }

  async listFinalizableWindows(cutoff: string): Promise<string[]> {
    const result = await this.#connected().runAndReadAll(`
      SELECT window_start FROM sampling_windows
      WHERE status = 'open' AND window_end <= $cutoff
      ORDER BY window_start
    `, { cutoff });
    return result.getRowObjects().map((row) => String((row as { window_start: string }).window_start));
  }

  async getCandidates(windowStart: string): Promise<MatchCandidate[]> {
    const result = await this.#connected().runAndReadAll(`
      SELECT match_id, window_start, start_time, duration, lobby_type, game_mode,
             avg_rank_tier, num_rank_tier, cluster, source
      FROM match_candidates WHERE window_start = $windowStart ORDER BY match_id
    `, { windowStart });
    return result.getRowObjects().map((row) => candidateFromRow(row as Record<string, unknown>));
  }

  async finalizeWindow(windowStart: string, selections: readonly MatchSelection[], target: number): Promise<boolean> {
    const connection = this.#connected();
    await connection.run("BEGIN TRANSACTION");
    try {
      const state = await connection.runAndReadAll(
        "SELECT status FROM sampling_windows WHERE window_start = $windowStart",
        { windowStart },
      );
      const status = (state.getRowObjects()[0] as { status?: string } | undefined)?.status;
      if (status === undefined) throw new Error(`Unknown sampling window ${windowStart}`);
      if (status === "finalized") {
        await connection.run("ROLLBACK");
        return false;
      }
      for (const selection of selections) {
        await connection.run(`
          INSERT INTO match_selections(match_id, window_start, selection_group, selection_hash, sampling_version)
          VALUES ($matchId, $windowStart, $selectionGroup, $selectionHash, $samplingVersion)
          ON CONFLICT (match_id) DO NOTHING
        `, {
          matchId: selection.matchId,
          windowStart,
          selectionGroup: selection.selectionGroup,
          selectionHash: selection.selectionHash,
          samplingVersion: selection.samplingVersion,
        });
      }
      await connection.run(`
        UPDATE sampling_windows SET status = 'finalized', selected_count = $selectedCount,
          target = $target, finalized_at = now()
        WHERE window_start = $windowStart
      `, { selectedCount: selections.length, target, windowStart });
      await connection.run("COMMIT");
      return true;
    } catch (error) {
      await connection.run("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  async listPendingSelections(): Promise<StoredSelection[]> {
    const result = await this.#connected().runAndReadAll(`
      SELECT c.match_id, c.window_start, c.start_time, c.duration, c.lobby_type, c.game_mode,
             c.avg_rank_tier, c.num_rank_tier, c.cluster, c.source,
             s.selection_group, s.selection_hash, s.sampling_version, s.job_id
      FROM match_selections s JOIN match_candidates c USING (match_id)
      WHERE s.job_id IS NULL ORDER BY s.selected_at, c.match_id
    `);
    return result.getRowObjects().map((row) => selectionFromRow(row as Record<string, unknown>));
  }

  async markEnqueued(matchId: string, jobId: string): Promise<void> {
    await this.#connected().run(`
      UPDATE match_selections SET job_id = $jobId, enqueued_at = now()
      WHERE match_id = $matchId AND job_id IS NULL
    `, { matchId, jobId });
  }

  async summary(): Promise<{
    candidates: number;
    rankedCandidates: number;
    selected: number;
    enqueued: number;
    windowsUnderTarget: number;
  }> {
    const result = await this.#connected().runAndReadAll(`
      SELECT
        (SELECT count(*)::INTEGER FROM match_candidates) AS candidates,
        (SELECT count(avg_rank_tier)::INTEGER FROM match_candidates) AS ranked_candidates,
        (SELECT count(*)::INTEGER FROM match_selections) AS selected,
        (SELECT count(job_id)::INTEGER FROM match_selections) AS enqueued,
        (SELECT count(*)::INTEGER FROM sampling_windows
          WHERE status = 'finalized' AND selected_count < target) AS windows_under_target
    `);
    const row = result.getRowObjects()[0] as Record<string, number>;
    return {
      candidates: Number(row.candidates),
      rankedCandidates: Number(row.ranked_candidates),
      selected: Number(row.selected),
      enqueued: Number(row.enqueued),
      windowsUnderTarget: Number(row.windows_under_target),
    };
  }

  async getWindow(windowStart: string): Promise<{
    candidateCount: number;
    knownRankCount: number;
    selectedCount: number;
    target?: number;
    status: string;
  } | undefined> {
    const result = await this.#connected().runAndReadAll(`
      SELECT candidate_count, known_rank_count, selected_count, target, status
      FROM sampling_windows WHERE window_start = $windowStart
    `, { windowStart });
    const row = result.getRowObjects()[0] as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      candidateCount: Number(row.candidate_count),
      knownRankCount: Number(row.known_rank_count),
      selectedCount: Number(row.selected_count),
      ...(typeof row.target === "number" ? { target: row.target } : {}),
      status: String(row.status),
    };
  }

  #connected(): DuckDBConnection {
    if (this.#connection === undefined) throw new Error("Sampler store is not open");
    return this.#connection;
  }
}

function candidateFromRow(row: Record<string, unknown>): MatchCandidate {
  return {
    matchId: String(row.match_id),
    windowStart: String(row.window_start),
    startTime: Number(row.start_time),
    lobbyType: Number(row.lobby_type),
    source: String(row.source),
    ...optionalNumber("duration", row.duration),
    ...optionalNumber("gameMode", row.game_mode),
    ...optionalNumber("avgRankTier", row.avg_rank_tier),
    ...optionalNumber("numRankTier", row.num_rank_tier),
    ...optionalNumber("cluster", row.cluster),
  };
}

function selectionFromRow(row: Record<string, unknown>): StoredSelection {
  return {
    ...candidateFromRow(row),
    selectionGroup: String(row.selection_group) as StoredSelection["selectionGroup"],
    selectionHash: String(row.selection_hash),
    samplingVersion: String(row.sampling_version),
    ...(typeof row.job_id === "string" ? { jobId: row.job_id } : {}),
  };
}

function optionalNumber<Key extends string>(key: Key, value: unknown): { [P in Key]?: number } {
  return value === null || value === undefined ? {} : { [key]: Number(value) } as { [P in Key]?: number };
}

function nextHour(windowStart: string): string {
  const date = new Date(windowStart);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid window start");
  date.setUTCHours(date.getUTCHours() + 1);
  return date.toISOString();
}
