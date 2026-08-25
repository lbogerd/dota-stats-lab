import { queryOptions } from "@tanstack/react-query";
import type { MatchRollingGpm, RollingGpmWindowSeconds } from "../server/gpm.js";
import type { MatchListItem, MatchOverview } from "../server/overview.js";
import { getMatchOverviewFn, getMatchRollingGpmFn, listMatchOverviewsFn } from "./functions.js";

export type { MatchListItem, MatchOverview, MatchRollingGpm };

export const overviewQueryKeys = {
  matches: ["match-overviews"] as const,
  match: (matchId: string) => ["match-overviews", matchId] as const,
  gpm: (matchId: string, windowSeconds: number, outputStepSeconds: number) =>
    ["match-rolling-gpm", matchId, windowSeconds, outputStepSeconds] as const,
};

export const matchOverviewsQuery = () => queryOptions({
  queryKey: overviewQueryKeys.matches,
  queryFn: (): Promise<MatchListItem[]> => listMatchOverviewsFn(),
});

export const matchOverviewQuery = (matchId: string) => queryOptions({
  queryKey: overviewQueryKeys.match(matchId),
  queryFn: (): Promise<MatchOverview | null> => getMatchOverviewFn({ data: { matchId } }),
});

export const matchRollingGpmQuery = (
  matchId: string,
  windowSeconds: RollingGpmWindowSeconds,
  outputStepSeconds = 1,
) => queryOptions({
  queryKey: overviewQueryKeys.gpm(matchId, windowSeconds, outputStepSeconds),
  queryFn: (): Promise<MatchRollingGpm> => getMatchRollingGpmFn({
    data: { matchId, windowSeconds, outputStepSeconds },
  }),
});

export function displayValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "Unknown" : String(value);
}

export function formatMatchDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "Unknown";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainder = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatMatchDate(value: string | null, timeZone?: string): string {
  if (value === null) return "Unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: timeZone === undefined ? undefined : "short",
  }).format(date);
}

export function localTimeZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
}

export function lobbyTypeLabel(value: number | null, encodedName: string | null = null): string {
  if (value === null) return enumLabel(encodedName, "DOTA_LOBBY_TYPE_");
  return ({
    0: "Normal",
    1: "Practice",
    2: "Tournament",
    3: "Tutorial",
    4: "Co-op bots",
    5: "Ranked team",
    6: "Ranked solo",
    7: "Ranked",
    8: "1v1 mid",
    9: "Battle Cup",
    10: "Local bots",
    11: "Spectator",
    12: "Event",
    13: "Gauntlet",
    14: "New player",
    15: "Featured",
  } as Record<number, string>)[value] ?? `Unknown (${value})`;
}

export function gameModeLabel(value: string | null): string {
  return enumLabel(value, "DOTA_GAMEMODE_");
}

export function formatInteger(value: number | string | null): string {
  if (value === null) return "Unknown";
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed).toLocaleString("en") : "Unknown";
}

export function teamName(teamId: number, configuredName: string | null): string {
  return configuredName?.trim() || (teamId === 2 ? "Radiant" : teamId === 3 ? "Dire" : `Team ${teamId}`);
}

function enumLabel(value: string | null, prefix: string): string {
  if (value === null || value.trim() === "") return "Unknown";
  if (!value.startsWith(prefix)) return value;
  return value.slice(prefix.length).toLowerCase().split("_")
    .map((word) => word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
