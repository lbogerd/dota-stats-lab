import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { JobStatus as ServerJobStatus } from "../jobs/job-files.js";
import { isValidMatchId } from "../lib/match-id.js";
import type { CatalogMatchDetail, CatalogMatchSummary, CatalogStats } from "../server/catalog.js";
import type { SqlCatalog } from "../server/sql-catalog.js";
import type { ReadOnlySqlResult } from "../server/warehouse.js";
import type { SavedQuery } from "../server/saved-queries.js";
import {
  deleteSavedQueryFn,
  getCatalogStatsFn,
  getMatchDetailFn,
  getSqlCatalogFn,
  listJobsFn,
  listMatchesFn,
  listSavedQueriesFn,
  readSavedQueryFn,
  renameSavedQueryFn,
  runSqlFn,
  saveSavedQueryFn,
  submitIngestionFn,
} from "./functions.js";

export type JobStatus = "queued" | "fetching" | "parsing" | "loading" | "succeeded" | "failed";

export interface Job {
  id: string;
  matchId: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  extractionId?: string;
  error?: string;
}

export type MatchSummary = CatalogMatchSummary;
export type MatchDetail = CatalogMatchDetail;
export type { CatalogStats };
export type { SavedQuery };
export type SqlResult = ReadOnlySqlResult;
export type { SqlCatalog };

export const matchIdSchema = z.string().refine(isValidMatchId, "Enter a positive match ID in the DuckDB UBIGINT range.");
export const queryNameSchema = z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, hyphens, or underscores.");

export const queryKeys = {
  jobs: ["jobs"] as const,
  matches: ["matches"] as const,
  catalogStats: ["catalog-stats"] as const,
  match: (matchId: string) => ["matches", matchId] as const,
  queries: ["saved-queries"] as const,
  query: (name: string) => ["saved-queries", name] as const,
  sqlCatalog: ["sql-catalog"] as const,
};

function mapJob(status: ServerJobStatus): Job {
  return {
    id: status.jobId,
    matchId: status.matchId,
    status: status.state,
    createdAt: status.createdAt,
    updatedAt: status.updatedAt,
    ...(status.extractionId === undefined ? {} : { extractionId: status.extractionId }),
    ...(status.error === undefined ? {} : { error: status.error.message }),
  };
}

export async function getJobs(): Promise<Job[]> {
  const jobs = await listJobsFn();
  return jobs.map(mapJob).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getMatches(): Promise<MatchSummary[]> {
  return listMatchesFn();
}

export async function getCatalogStatistics(): Promise<CatalogStats> {
  return getCatalogStatsFn();
}

export async function getMatch(matchId: string): Promise<MatchDetail | null> {
  return getMatchDetailFn({ data: { matchId } });
}

export async function ingestMatch(matchId: string): Promise<Job> {
  const parsed = matchIdSchema.parse(matchId);
  return mapJob(await submitIngestionFn({ data: { matchId: parsed } }));
}

export async function getSavedQueries(): Promise<SavedQuery[]> {
  return listSavedQueriesFn();
}

export async function getSavedQuery(name: string): Promise<SavedQuery | null> {
  return readSavedQueryFn({ data: { name } });
}

export async function saveQuery(name: string, sql: string): Promise<SavedQuery> {
  return saveSavedQueryFn({ data: { name, sql } });
}

export async function renameQuery(from: string, to: string): Promise<SavedQuery> {
  return renameSavedQueryFn({ data: { from, to } });
}

export async function deleteQuery(name: string): Promise<void> {
  await deleteSavedQueryFn({ data: { name } });
}

export async function runSql(sql: string): Promise<SqlResult> {
  return runSqlFn({ data: { sql } });
}

export async function getSqlCatalog(): Promise<SqlCatalog> {
  return getSqlCatalogFn();
}

export const jobsQuery = () => queryOptions({
  queryKey: queryKeys.jobs,
  queryFn: getJobs,
  refetchInterval: (query) => (query.state.data?.some((job) => !["succeeded", "failed"].includes(job.status)) ? 2_000 : false),
});
export const matchesQuery = () => queryOptions({ queryKey: queryKeys.matches, queryFn: getMatches });
export const catalogStatsQuery = () => queryOptions({ queryKey: queryKeys.catalogStats, queryFn: getCatalogStatistics });
export const matchQuery = (matchId: string) => queryOptions({ queryKey: queryKeys.match(matchId), queryFn: () => getMatch(matchId) });
export const savedQueriesQuery = () => queryOptions({ queryKey: queryKeys.queries, queryFn: getSavedQueries });
export const savedQueryQuery = (name: string) => queryOptions({ queryKey: queryKeys.query(name), queryFn: () => getSavedQuery(name) });
export const sqlCatalogQuery = () => queryOptions({
  queryKey: queryKeys.sqlCatalog,
  queryFn: getSqlCatalog,
  staleTime: Infinity,
  gcTime: Infinity,
  retry: 1,
  refetchOnMount: false,
});

export function formatRelative(date: string): string {
  const milliseconds = new Date(date).getTime();
  if (!Number.isFinite(milliseconds)) return date;
  const seconds = Math.round((milliseconds - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function formatDuration(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | string | null): string {
  if (bytes === null) return "—";
  const value = Number(bytes);
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

export function formatCount(value: number | string): string {
  const count = Number(value);
  if (!Number.isFinite(count)) return String(value);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}
