import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { JobStatus as ServerJobStatus } from "../jobs/job-files.js";
import { isValidMatchId } from "../lib/match-id.js";
import type { CatalogMatchSummary, CatalogStats } from "../server/catalog.js";
import type { SqlCatalog } from "../server/sql-catalog.js";
import type { ReadOnlySqlResult } from "../server/warehouse.js";
import type { SavedQuery } from "../server/saved-queries.js";
import {
  deleteSavedQueryFn,
  getCatalogStatsFn,
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

type MatchSummary = CatalogMatchSummary;
export type SqlResult = ReadOnlySqlResult;

export const matchIdSchema = z.string().refine(isValidMatchId, "Enter a positive match ID in the DuckDB UBIGINT range.");
export const queryNameSchema = z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, hyphens, or underscores.");

export const queryKeys = {
  jobs: ["jobs"] as const,
  matches: ["matches"] as const,
  catalogStats: ["catalog-stats"] as const,
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

async function getJobs(): Promise<Job[]> {
  const jobs = await listJobsFn();
  return jobs.map(mapJob).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function getMatches(): Promise<MatchSummary[]> {
  return listMatchesFn();
}

async function getCatalogStatistics(): Promise<CatalogStats> {
  return getCatalogStatsFn();
}

export async function ingestMatch(matchId: string): Promise<Job> {
  const parsed = matchIdSchema.parse(matchId);
  return mapJob(await submitIngestionFn({ data: { matchId: parsed } }));
}

async function getSavedQueries(): Promise<SavedQuery[]> {
  return listSavedQueriesFn();
}

async function getSavedQuery(name: string): Promise<SavedQuery | null> {
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

async function getSqlCatalog(): Promise<SqlCatalog> {
  return getSqlCatalogFn();
}

export const jobsQuery = () => queryOptions({
  queryKey: queryKeys.jobs,
  queryFn: getJobs,
  refetchInterval: (query) => (query.state.data?.some((job) => !["succeeded", "failed"].includes(job.status)) ? 2_000 : false),
});
export const matchesQuery = () => queryOptions({ queryKey: queryKeys.matches, queryFn: getMatches });
export const catalogStatsQuery = () => queryOptions({ queryKey: queryKeys.catalogStats, queryFn: getCatalogStatistics });
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

export function formatCount(value: number | string): string {
  const count = Number(value);
  if (!Number.isFinite(count)) return String(value);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}
