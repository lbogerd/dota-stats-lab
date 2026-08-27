import { z } from "zod";
import { isValidMatchId, parseMatchId } from "../lib/match-id.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

export const winProbabilityInputSchema = z.object({
  matchId: z.string().refine(
    isValidMatchId,
    "Enter a positive match ID in the DuckDB UBIGINT range.",
  ),
}).strict();

export type WinProbabilitySource = "graph_history" | "spectator_updates";

export interface MatchWinProbabilityPoint {
  gameTimeSeconds: number;
  radiantProbability: number;
  direProbability: number;
}

export interface MatchWinProbability {
  matchId: string;
  source: WinProbabilitySource | null;
  points: MatchWinProbabilityPoint[];
}

export async function getMatchWinProbability(
  input: z.infer<typeof winProbabilityInputSchema>,
): Promise<MatchWinProbability> {
  const validated = winProbabilityInputSchema.parse(input);
  const matchId = parseMatchId(validated.matchId);

  return withReadOnlyWarehouse(async (connection) => {
    const result = await connection.runAndReadAll(WIN_PROBABILITY_SQL, { matchId });
    const rows = result.getRowObjectsJson();
    if (rows.length === 0) return { matchId: matchId.toString(), source: null, points: [] };

    let source: WinProbabilitySource | null = null;
    const points = rows.map((row) => {
      const rowSource = probabilitySource(row.source);
      if (source !== null && source !== rowSource) {
        throw new Error("Unexpected mixed win probability sources");
      }
      source = rowSource;
      const gameTimeSeconds = nonnegativeNumber(row.game_time_seconds, "game time");
      const radiantProbability = probability(row.radiant_probability, "Radiant probability");
      return {
        gameTimeSeconds,
        radiantProbability,
        direProbability: 1 - radiantProbability,
      };
    });

    return { matchId: matchId.toString(), source, points };
  });
}

function probabilitySource(value: JsonValue | undefined): WinProbabilitySource {
  if (value === "graph_history" || value === "spectator_updates") return value;
  throw new Error("Unexpected win probability source");
}

function probability(value: JsonValue | undefined, label: string): number {
  const number = finiteNumber(value, label);
  if (number < 0 || number > 1) throw new Error(`Unexpected ${label}`);
  return number;
}

function nonnegativeNumber(value: JsonValue | undefined, label: string): number {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`Unexpected win probability ${label}`);
  return number;
}

function finiteNumber(value: JsonValue | undefined, label: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) throw new Error(`Unexpected win probability ${label}`);
  return number;
}

const WIN_PROBABILITY_SQL = `
SELECT game_time_seconds, radiant_probability, source
FROM analysis.match_win_probability($matchId)
ORDER BY game_time_seconds, sample_index`;
