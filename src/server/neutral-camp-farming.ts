import { z } from "zod";
import { isValidMatchId, parseMatchId } from "../lib/match-id.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

const SUPPORTED_PROFILE = "match-analysis-v4";
const DEFINITION_NAME = "neutral-camp-farming-v1";
const UINTEGER_MAX = 4_294_967_295;
const INTEGER_MIN = -2_147_483_648;
const INTEGER_MAX = 2_147_483_647;
const UBIGINT_MAX = 18_446_744_073_709_551_615n;

export const neutralCampFarmingInputSchema = z.object({
  matchId: z.string().refine(
    isValidMatchId,
    "Enter a positive match ID in the DuckDB UBIGINT range.",
  ),
}).strict();

export type NeutralCampFarmingResult = "cleared" | "not_cleared";

export interface NeutralCampFarmingAction {
  extractionId: string;
  actionIndex: number;
  definitionName: "neutral-camp-farming-v1";
  playerSlot: number;
  campId: number;
  spawnerHandle: string;
  campType: number;
  campWorldX: number;
  campWorldY: number;
  startGameTimeMilliseconds: number;
  endGameTimeMilliseconds: number;
  result: NeutralCampFarmingResult;
  damageEventCount: number;
  totalDamage: number;
  initialCreepCount: number;
  deadInitialCreepCount: number;
}

export interface MatchNeutralCampFarming {
  matchId: string;
  available: boolean;
  actions: NeutralCampFarmingAction[];
}

export async function getMatchNeutralCampFarming(
  input: z.infer<typeof neutralCampFarmingInputSchema>,
): Promise<MatchNeutralCampFarming> {
  const validated = neutralCampFarmingInputSchema.parse(input);
  const matchId = parseMatchId(validated.matchId);

  return withReadOnlyWarehouse(async (connection) => {
    const stateResult = await connection.runAndReadAll(MATCH_ACTION_STATE_SQL, { matchId });
    const state = stateResult.getRowObjectsJson()[0];
    if (state === undefined) throw new Error("Neutral camp farming state query returned no rows");
    const available = booleanValue(state.available, "availability");
    const base = { matchId: matchId.toString(), available };
    if (!available) return { ...base, actions: [] };

    const result = await connection.runAndReadAll(NEUTRAL_CAMP_FARMING_SQL, { matchId });
    const actions = result.getRowObjectsJson().map(mapAction);
    return { ...base, actions };
  });
}

function mapAction(row: Record<string, JsonValue>): NeutralCampFarmingAction {
  const extractionId = nonemptyString(row.extraction_id, "extraction ID");
  const definitionName = nonemptyString(row.definition_name, "definition name");
  if (definitionName !== DEFINITION_NAME) {
    throw new Error("Unexpected neutral camp farming definition name");
  }

  const startGameTimeMilliseconds = integerValue(row.start_game_time_ms, "start game time");
  const endGameTimeMilliseconds = integerValue(row.end_game_time_ms, "end game time");
  if (endGameTimeMilliseconds < startGameTimeMilliseconds) {
    throw new Error("Unexpected neutral camp farming action time range");
  }
  const result = actionResult(row.result);
  const damageEventCount = positiveInteger(row.damage_event_count, "damage event count");
  const totalDamage = positiveInteger(row.total_damage, "total damage");
  const initialCreepCount = positiveInteger(row.initial_creep_count, "initial creep count");
  const deadInitialCreepCount = nonnegativeInteger(
    row.dead_initial_creep_count,
    "dead initial creep count",
  );
  if (deadInitialCreepCount > initialCreepCount) {
    throw new Error("Unexpected neutral camp farming dead creep count");
  }
  if (result === "cleared" && deadInitialCreepCount !== initialCreepCount) {
    throw new Error("Unexpected neutral camp farming cleared creep count");
  }

  return {
    extractionId,
    actionIndex: boundedInteger(row.action_index, "action index", 0, UINTEGER_MAX),
    definitionName,
    playerSlot: boundedInteger(row.player_slot, "player slot", 0, 255),
    campId: boundedInteger(row.camp_id, "camp ID", 0, UINTEGER_MAX),
    spawnerHandle: unsignedIntegerString(row.spawner_handle, "spawner handle"),
    campType: boundedInteger(row.camp_type, "camp type", INTEGER_MIN, INTEGER_MAX),
    campWorldX: finiteNumber(row.camp_world_x, "camp world X"),
    campWorldY: finiteNumber(row.camp_world_y, "camp world Y"),
    startGameTimeMilliseconds,
    endGameTimeMilliseconds,
    result,
    damageEventCount: boundedInteger(damageEventCount, "damage event count", 1, UINTEGER_MAX),
    totalDamage,
    initialCreepCount: boundedInteger(initialCreepCount, "initial creep count", 1, UINTEGER_MAX),
    deadInitialCreepCount: boundedInteger(
      deadInitialCreepCount,
      "dead initial creep count",
      0,
      UINTEGER_MAX,
    ),
  };
}

function actionResult(value: JsonValue | undefined): NeutralCampFarmingResult {
  if (value === "cleared" || value === "not_cleared") return value;
  throw new Error("Unexpected neutral camp farming result");
}

function booleanValue(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Unexpected neutral camp farming ${label}`);
  return value;
}

function nonemptyString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Unexpected neutral camp farming ${label}`);
  }
  return value;
}

function unsignedIntegerString(value: JsonValue | undefined, label: string): string {
  const text = typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new Error(`Unexpected neutral camp farming ${label}`);
  }
  if (BigInt(text) > UBIGINT_MAX) {
    throw new Error(`Unexpected neutral camp farming ${label}`);
  }
  return text;
}

function boundedInteger(
  value: JsonValue | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Unexpected neutral camp farming ${label}`);
  }
  return parsed;
}

function integerValue(value: JsonValue | undefined, label: string): number {
  return boundedInteger(value, label, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
}

function nonnegativeInteger(value: JsonValue | undefined, label: string): number {
  return boundedInteger(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function positiveInteger(value: JsonValue | undefined, label: string): number {
  return boundedInteger(value, label, 1, Number.MAX_SAFE_INTEGER);
}

function finiteNumber(value: JsonValue | undefined, label: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Unexpected neutral camp farming ${label}`);
  return parsed;
}

const MATCH_ACTION_STATE_SQL = `
SELECT coalesce((
  SELECT json_extract_string(extraction.manifest, '$.profile') = '${SUPPORTED_PROFILE}'
  FROM analysis.latest_successful_extractions AS latest
  JOIN catalog.extractions AS extraction USING (extraction_id)
  WHERE latest.match_id = $matchId
), false) AS available`;

const NEUTRAL_CAMP_FARMING_SQL = `
SELECT
  extraction_id,
  action_index,
  definition_name,
  player_slot,
  camp_id,
  spawner_handle,
  camp_type,
  camp_world_x,
  camp_world_y,
  start_game_time_ms,
  end_game_time_ms,
  result,
  damage_event_count,
  total_damage,
  initial_creep_count,
  dead_initial_creep_count
FROM analysis.match_neutral_camp_farming_actions($matchId)
ORDER BY start_game_time_ms, action_index`;
