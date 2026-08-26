import { z } from "zod";
import { isValidMatchId, parseMatchId } from "../lib/match-id.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

const GRID_SIZE = 64;
const MAX_UINTEGER_SAMPLE_TIME = 4_294_967_200;

const sampleTimeSchema = z.number().int().min(0).max(MAX_UINTEGER_SAMPLE_TIME)
  .refine((value) => value % 100 === 0, "Time must use 100 ms increments.");

export const heroHeatmapInputSchema = z.object({
  matchId: z.string().refine(isValidMatchId, "Enter a positive match ID in the DuckDB UBIGINT range."),
  startMilliseconds: sampleTimeSchema,
  endMilliseconds: sampleTimeSchema,
  playerSlot: z.number().int().min(0).max(255).nullable(),
}).strict();

export type HeroHeatmapInput = z.infer<typeof heroHeatmapInputSchema>;

export interface HeroHeatmapCell {
  cellX: number;
  cellY: number;
  sampleCount: number;
}

export interface MatchHeroHeatmap {
  matchId: string;
  available: boolean;
  startMilliseconds: number;
  endMilliseconds: number;
  playerSlot: number | null;
  sampleCount: number;
  maximumCellCount: number;
  cells: HeroHeatmapCell[];
}

export async function getMatchHeroHeatmap(input: HeroHeatmapInput): Promise<MatchHeroHeatmap> {
  const validated = heroHeatmapInputSchema.parse(input);
  if (validated.startMilliseconds > validated.endMilliseconds) {
    throw new RangeError("Start time must not be after end time.");
  }
  const matchId = parseMatchId(validated.matchId);

  return withReadOnlyWarehouse(async (connection) => {
    const matchResult = await connection.runAndReadAll(MATCH_POSITION_STATE_SQL, { matchId });
    const match = matchResult.getRowObjectsJson()[0];
    if (match === undefined) throw new Error(`Match ${matchId} does not have a successful extraction.`);

    const durationSeconds = nonnegativeInteger(match.duration_seconds, "match duration");
    const durationMilliseconds = durationSeconds * 1_000;
    if (!Number.isSafeInteger(durationMilliseconds)) {
      throw new Error("Unexpected hero heat map match duration");
    }
    if (validated.endMilliseconds > durationMilliseconds) {
      throw new RangeError("Selected time must not be after the match duration.");
    }

    const available = booleanValue(match.available, "position availability");
    const base = {
      matchId: matchId.toString(),
      available,
      startMilliseconds: validated.startMilliseconds,
      endMilliseconds: validated.endMilliseconds,
      playerSlot: validated.playerSlot,
    };
    if (!available) {
      return { ...base, sampleCount: 0, maximumCellCount: 0, cells: [] };
    }

    const heatmapResult = await connection.runAndReadAll(HEATMAP_SQL, {
      matchId,
      startMilliseconds: validated.startMilliseconds,
      endMilliseconds: validated.endMilliseconds,
      playerSlot: validated.playerSlot,
      gridSize: GRID_SIZE,
    });
    const rows = heatmapResult.getRowObjectsJson();
    const cells = rows.map((row) => ({
      cellX: boundedInteger(row.cell_x, "cell X", 0, GRID_SIZE - 1),
      cellY: boundedInteger(row.cell_y, "cell Y", 0, GRID_SIZE - 1),
      sampleCount: nonnegativeInteger(row.sample_count, "cell sample count"),
    }));
    const sampleCount = rows.length === 0
      ? 0
      : nonnegativeInteger(rows[0]?.selected_sample_count, "selected sample count");
    const maximumCellCount = rows.length === 0
      ? 0
      : nonnegativeInteger(rows[0]?.maximum_cell_count, "maximum cell count");
    if (cells.reduce((sum, cell) => sum + cell.sampleCount, 0) !== sampleCount) {
      throw new Error("Unexpected hero heat map sample count");
    }

    return { ...base, sampleCount, maximumCellCount, cells };
  });
}

function boundedInteger(value: JsonValue | undefined, label: string, minimum: number, maximum: number): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Unexpected hero heat map ${label}`);
  }
  return parsed;
}

function nonnegativeInteger(value: JsonValue | undefined, label: string): number {
  return boundedInteger(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function finiteNumber(value: JsonValue | undefined, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Unexpected hero heat map ${label}`);
  return parsed;
}

function booleanValue(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Unexpected hero heat map ${label}`);
  return value;
}

const MATCH_POSITION_STATE_SQL = `
SELECT
  match.duration_seconds,
  (
    json_extract(extraction.manifest, '$.files.heroPositions') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM analysis.hero_position_samples AS sample
      WHERE sample.extraction_id = latest.extraction_id
    )
  ) AS available
FROM analysis.latest_successful_extractions AS latest
JOIN catalog.extractions AS extraction USING (extraction_id)
JOIN analysis.matches AS match
  ON match.extraction_id = latest.extraction_id
 AND match.match_id = latest.match_id
WHERE latest.match_id = $matchId`;

const HEATMAP_SQL = `
SELECT
  cell_x,
  cell_y,
  sample_count,
  sum(sample_count) OVER () AS selected_sample_count,
  max(sample_count) OVER () AS maximum_cell_count
FROM analysis.match_hero_heatmap(
  $matchId,
  $startMilliseconds,
  $endMilliseconds,
  $playerSlot,
  $gridSize
)
ORDER BY cell_y, cell_x`;
