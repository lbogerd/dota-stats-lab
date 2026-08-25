import { parseMatchId } from "../lib/match-id.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

export const GPM_WINDOWS = [1, 5, 10, 30, 60, 300] as const;

export interface GpmPoint { gameTimeSeconds: number; gpm: number; }
export interface GpmSeries {
  kind: "player" | "team";
  playerSlot: number | null;
  teamId: number;
  points: GpmPoint[];
}
export interface MatchGpm { matchId: string; windowSeconds: number; outputStepSeconds: number; series: GpmSeries[]; }

export async function getMatchGpm(matchId: string, windowSeconds: number, outputStepSeconds: number): Promise<MatchGpm> {
  const parsedMatchId = parseMatchId(matchId);
  validateGpmInputs(windowSeconds, outputStepSeconds);
  return withReadOnlyWarehouse(async (connection) => {
    const result = await connection.runAndReadAll(GPM_SQL, {
      matchId: parsedMatchId,
      windowSeconds,
      outputStepSeconds,
    });
    const grouped = new Map<string, GpmSeries>();
    for (const row of result.getRowObjectsJson()) {
      const kind = row.series_kind === "team" ? "team" : "player";
      const playerSlot = row.player_slot === null ? null : Number(row.player_slot);
      const key = `${kind}:${row.team_id}:${playerSlot ?? "team"}`;
      const series = grouped.get(key) ?? { kind, playerSlot, teamId: Number(row.team_id), points: [] };
      series.points.push({ gameTimeSeconds: Number(row.game_time_seconds), gpm: Number(row.gpm) });
      grouped.set(key, series);
    }
    return { matchId: parsedMatchId.toString(), windowSeconds, outputStepSeconds, series: [...grouped.values()] };
  });
}

export function validateGpmInputs(windowSeconds: number, outputStepSeconds: number): void {
  if (!GPM_WINDOWS.includes(windowSeconds as typeof GPM_WINDOWS[number])) {
    throw new Error("windowSeconds must be one of 1, 5, 10, 30, 60, or 300");
  }
  if (!Number.isSafeInteger(outputStepSeconds) || outputStepSeconds < 1 || outputStepSeconds > 60) {
    throw new Error("outputStepSeconds must be an integer from 1 through 60");
  }
}

const GPM_SQL = `
SELECT * FROM analysis.match_rolling_gpm($matchId, $windowSeconds, $outputStepSeconds)
`;
