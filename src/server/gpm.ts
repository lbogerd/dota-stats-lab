import { z } from "zod";
import { ROLLING_GPM_WINDOWS, type RollingGpmWindowSeconds } from "../lib/gpm.js";
import { isValidMatchId, parseMatchId } from "../lib/match-id.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

export { ROLLING_GPM_WINDOWS } from "../lib/gpm.js";
export type { RollingGpmWindowSeconds } from "../lib/gpm.js";

const rollingGpmWindowSchema = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(10),
  z.literal(30),
  z.literal(60),
  z.literal(300),
]);

export const rollingGpmInputSchema = z.object({
  matchId: z.string().refine(isValidMatchId, "Enter a positive match ID in the DuckDB UBIGINT range."),
  windowSeconds: rollingGpmWindowSchema,
  outputStepSeconds: z.number().int().min(1).max(60),
}).strict();

export type RollingGpmInput = z.infer<typeof rollingGpmInputSchema>;

export interface GpmPoint {
  gameTimeSeconds: number;
  gpm: number;
}

export interface GpmPlayerSeries {
  playerSlot: number;
  teamId: number;
  points: GpmPoint[];
}

export interface GpmTeamSeries {
  teamId: number;
  points: GpmPoint[];
}

export interface MatchRollingGpm {
  matchId: string;
  windowSeconds: RollingGpmWindowSeconds;
  outputStepSeconds: number;
  players: GpmPlayerSeries[];
  teams: GpmTeamSeries[];
}

export async function getMatchRollingGpm(input: RollingGpmInput): Promise<MatchRollingGpm> {
  const validated = rollingGpmInputSchema.parse(input);
  const matchId = parseMatchId(validated.matchId);

  return withReadOnlyWarehouse(async (connection) => {
    const result = await connection.runAndReadAll(ROLLING_GPM_SQL, {
      matchId,
      windowSeconds: validated.windowSeconds,
      outputStepSeconds: validated.outputStepSeconds,
    });
    return groupRollingGpmRows(validated, result.getRowObjectsJson());
  });
}

function groupRollingGpmRows(
  input: RollingGpmInput,
  rows: ReadonlyArray<Record<string, JsonValue>>,
): MatchRollingGpm {
  const playersByKey = new Map<string, GpmPlayerSeries>();
  const teamsById = new Map<number, GpmTeamSeries>();

  for (const row of rows) {
    const kind = seriesKind(row.series_kind);
    const teamId = integerValue(row.team_id, "team ID");
    const rowWindowSeconds = integerValue(row.window_seconds, "window size");
    if (rowWindowSeconds !== input.windowSeconds) {
      throw new Error("Unexpected rolling GPM window size");
    }
    const point = {
      gameTimeSeconds: nonnegativeNumber(row.game_time_seconds, "game time"),
      gpm: finiteNumber(row.gpm, "GPM"),
    };

    if (kind === "player") {
      const playerSlot = integerValue(row.player_slot, "player slot");
      const key = `${teamId}:${playerSlot}`;
      const series = playersByKey.get(key) ?? { playerSlot, teamId, points: [] };
      series.points.push(point);
      playersByKey.set(key, series);
    } else {
      if (row.player_slot !== null && row.player_slot !== undefined) {
        throw new Error("Unexpected player slot for team rolling GPM");
      }
      const series = teamsById.get(teamId) ?? { teamId, points: [] };
      series.points.push(point);
      teamsById.set(teamId, series);
    }
  }

  const players = [...playersByKey.values()]
    .sort((left, right) => left.teamId - right.teamId || left.playerSlot - right.playerSlot);
  const teams = [...teamsById.values()].sort((left, right) => left.teamId - right.teamId);
  for (const series of [...players, ...teams]) {
    series.points.sort((left, right) => left.gameTimeSeconds - right.gameTimeSeconds);
  }

  return {
    matchId: parseMatchId(input.matchId).toString(),
    windowSeconds: input.windowSeconds,
    outputStepSeconds: input.outputStepSeconds,
    players,
    teams,
  };
}

function seriesKind(value: JsonValue | undefined): "player" | "team" {
  if (value === "player" || value === "team") return value;
  throw new Error("Unexpected rolling GPM series kind");
}

function integerValue(value: JsonValue | undefined, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isSafeInteger(number)) throw new Error(`Unexpected rolling GPM ${label}`);
  return number;
}

function nonnegativeNumber(value: JsonValue | undefined, label: string): number {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`Unexpected rolling GPM ${label}`);
  return number;
}

function finiteNumber(value: JsonValue | undefined, label: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) throw new Error(`Unexpected rolling GPM ${label}`);
  return number;
}

const ROLLING_GPM_SQL = `
SELECT series_kind, player_slot, team_id, game_time_seconds, window_seconds, gpm
FROM analysis.match_rolling_gpm($matchId, $windowSeconds, $outputStepSeconds)
ORDER BY series_kind, team_id, player_slot NULLS FIRST, game_time_seconds`;
