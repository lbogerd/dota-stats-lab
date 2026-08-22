import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

export type JobStatus = "queued" | "fetching" | "parsing" | "loading" | "succeeded" | "failed";

export interface Job {
  id: string;
  matchId: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface MatchSummary {
  matchId: string;
  acquiredAt: string;
  extractionId: string;
  exporterVersion: string;
  durationSeconds: number;
  entities: number;
  records: number;
  replayBytes: number;
  status: "ready" | "failed";
}

export interface SavedQuery {
  name: string;
  sql: string;
  updatedAt: string;
}

export interface SqlResult {
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  totalRows: number;
  durationMs: number;
  truncated: boolean;
}

const now = Date.now();
const demoStartedAt = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

const initialJobs: Job[] = [
  { id: "job-8041927713", matchId: "8041927713", status: "parsing", createdAt: minutesAgo(4), updatedAt: minutesAgo(1) },
  { id: "job-8041784432", matchId: "8041784432", status: "succeeded", createdAt: minutesAgo(52), updatedAt: minutesAgo(41) },
  { id: "job-8041138097", matchId: "8041138097", status: "succeeded", createdAt: daysAgo(1), updatedAt: daysAgo(1) },
  { id: "job-8040921164", matchId: "8040921164", status: "failed", createdAt: daysAgo(2), updatedAt: daysAgo(2), error: "Replay is no longer available from the source." },
];

const matches: MatchSummary[] = [
  { matchId: "8041784432", acquiredAt: minutesAgo(41), extractionId: "ext_b901d9aa83f4", exporterVersion: "1.0.0", durationSeconds: 2874, entities: 1846, records: 2_481_093, replayBytes: 189_400_000, status: "ready" },
  { matchId: "8041138097", acquiredAt: daysAgo(1), extractionId: "ext_71d860ed42c1", exporterVersion: "1.0.0", durationSeconds: 2241, entities: 1639, records: 1_894_762, replayBytes: 161_800_000, status: "ready" },
  { matchId: "8039826401", acquiredAt: daysAgo(3), extractionId: "ext_4f9c1b725ee8", exporterVersion: "1.0.0", durationSeconds: 3512, entities: 2104, records: 3_105_871, replayBytes: 237_200_000, status: "ready" },
  { matchId: "8037649128", acquiredAt: daysAgo(6), extractionId: "ext_e3328b67dc09", exporterVersion: "0.9.0", durationSeconds: 1983, entities: 1518, records: 1_642_981, replayBytes: 144_100_000, status: "ready" },
  { matchId: "8035417604", acquiredAt: daysAgo(9), extractionId: "ext_a8c09f1856cd", exporterVersion: "0.9.0", durationSeconds: 2598, entities: 1793, records: 2_177_402, replayBytes: 176_900_000, status: "ready" },
];

let jobs = [...initialJobs];
let savedQueries: SavedQuery[] = [
  { name: "hero-property-history", sql: "SELECT game_time, property_path, value_text\nFROM analysis.entity_property_history(\n  'ext_b901d9aa83f4',\n  137,\n  'm_iHealth'\n)\nORDER BY game_time DESC\nLIMIT 100;", updatedAt: minutesAgo(18) },
  { name: "recent-extractions", sql: "SELECT match_id, extraction_id, exporter_version, created_at\nFROM catalog.extractions\nORDER BY created_at DESC\nLIMIT 25;", updatedAt: daysAgo(2) },
  { name: "entity-counts", sql: "SELECT extraction_id, count(DISTINCT entity_instance_id) AS entity_count\nFROM raw.entity_lifecycle\nGROUP BY extraction_id\nORDER BY entity_count DESC;", updatedAt: daysAgo(5) },
];

const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

export const matchIdSchema = z.string().regex(/^\d{6,20}$/, "Enter a valid numeric match ID.");
export const queryNameSchema = z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, hyphens, or underscores.");

export const queryKeys = {
  jobs: ["jobs"] as const,
  matches: ["matches"] as const,
  match: (matchId: string) => ["matches", matchId] as const,
  queries: ["saved-queries"] as const,
  query: (name: string) => ["saved-queries", name] as const,
};

function materializeJobs(): Job[] {
  return jobs.map<Job>((job) => {
    if (job.id === "job-8041927713" && Date.now() - demoStartedAt > 14_000) return { ...job, status: "succeeded", updatedAt: new Date().toISOString() };
    if (job.id === "job-8041927713" && Date.now() - demoStartedAt > 9_000) return { ...job, status: "loading", updatedAt: new Date().toISOString() };
    if (job.status === "queued" && Date.now() - new Date(job.createdAt).getTime() > 2_000) return { ...job, status: "fetching", updatedAt: new Date().toISOString() };
    if (job.status === "fetching" && Date.now() - new Date(job.createdAt).getTime() > 6_000) return { ...job, status: "parsing", updatedAt: new Date().toISOString() };
    if (job.status === "parsing" && job.id.startsWith("job-new-") && Date.now() - new Date(job.createdAt).getTime() > 12_000) return { ...job, status: "loading", updatedAt: new Date().toISOString() };
    if (job.status === "loading" && Date.now() - new Date(job.createdAt).getTime() > 17_000) return { ...job, status: "succeeded", updatedAt: new Date().toISOString() };
    return job;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJobs(): Promise<Job[]> {
  await wait();
  jobs = materializeJobs();
  return structuredClone(jobs);
}

export async function getMatches(): Promise<MatchSummary[]> {
  await wait();
  return structuredClone(matches);
}

export async function getMatch(matchId: string): Promise<MatchSummary | null> {
  await wait();
  return structuredClone(matches.find((match) => match.matchId === matchId) ?? null);
}

export async function ingestMatch(matchId: string): Promise<Job> {
  matchIdSchema.parse(matchId);
  await wait(350);
  const createdAt = new Date().toISOString();
  const job: Job = { id: `job-new-${matchId}`, matchId, status: "queued", createdAt, updatedAt: createdAt };
  jobs = [job, ...jobs.filter((item) => item.matchId !== matchId || item.status === "succeeded")];
  return structuredClone(job);
}

export async function getSavedQueries(): Promise<SavedQuery[]> {
  await wait();
  return structuredClone(savedQueries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export async function getSavedQuery(name: string): Promise<SavedQuery | null> {
  await wait();
  return structuredClone(savedQueries.find((query) => query.name === name) ?? null);
}

export async function saveQuery(name: string, sql: string): Promise<SavedQuery> {
  queryNameSchema.parse(name);
  if (!sql.trim()) throw new Error("SQL cannot be empty.");
  await wait(220);
  const query = { name, sql, updatedAt: new Date().toISOString() };
  savedQueries = [query, ...savedQueries.filter((item) => item.name !== name)];
  return structuredClone(query);
}

export async function renameQuery(from: string, to: string): Promise<SavedQuery> {
  queryNameSchema.parse(to);
  await wait(220);
  if (savedQueries.some((query) => query.name === to)) throw new Error("A query with that name already exists.");
  const existing = savedQueries.find((query) => query.name === from);
  if (!existing) throw new Error("Query not found.");
  return saveQuery(to, existing.sql).then(async (query) => {
    savedQueries = savedQueries.filter((item) => item.name !== from);
    return query;
  });
}

export async function deleteQuery(name: string): Promise<void> {
  await wait(180);
  savedQueries = savedQueries.filter((query) => query.name !== name);
}

export async function runSql(sql: string): Promise<SqlResult> {
  if (!sql.trim()) throw new Error("Write a query before running it.");
  if (/\b(insert|update|delete|drop|alter|create|copy|attach|install|load|call|pragma)\b/i.test(sql)) {
    throw new Error("Only read-only SQL is allowed in the browser.");
  }
  await wait(620);
  const rows = [
    { game_time: 2814.3, property_path: "m_iHealth", value_text: "1842", entity_instance_id: 137 },
    { game_time: 2808.7, property_path: "m_iHealth", value_text: "1718", entity_instance_id: 137 },
    { game_time: 2795.1, property_path: "m_iHealth", value_text: "1524", entity_instance_id: 137 },
    { game_time: 2782.9, property_path: "m_iHealth", value_text: "1401", entity_instance_id: 137 },
    { game_time: 2771.4, property_path: "m_iHealth", value_text: "1268", entity_instance_id: 137 },
    { game_time: 2759.8, property_path: "m_iHealth", value_text: "1975", entity_instance_id: 137 },
  ];
  return { columns: Object.keys(rows[0] ?? {}), rows, totalRows: rows.length, durationMs: 41, truncated: false };
}

export const jobsQuery = () => queryOptions({
  queryKey: queryKeys.jobs,
  queryFn: getJobs,
  refetchInterval: (query) => (query.state.data?.some((job) => !["succeeded", "failed"].includes(job.status)) ? 2_000 : false),
});
export const matchesQuery = () => queryOptions({ queryKey: queryKeys.matches, queryFn: getMatches });
export const matchQuery = (matchId: string) => queryOptions({ queryKey: queryKeys.match(matchId), queryFn: () => getMatch(matchId) });
export const savedQueriesQuery = () => queryOptions({ queryKey: queryKeys.queries, queryFn: getSavedQueries });
export const savedQueryQuery = (name: string) => queryOptions({ queryKey: queryKeys.query(name), queryFn: () => getSavedQuery(name) });

export function formatRelative(date: string): string {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
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

export function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
