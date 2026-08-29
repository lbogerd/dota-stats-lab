import { z } from "zod";
import { getHeroCombatLogName, getHeroDisplayData } from "../lib/dota-heroes.js";
import { formatDotaName } from "../lib/dota-names.js";
import { isValidMatchId, parseMatchId } from "../lib/match-id.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

const INTERVAL_SECONDS = 30 as const;

export const damageBySourceInputSchema = z.object({
  matchId: z.string().refine(
    isValidMatchId,
    "Enter a positive match ID in the DuckDB UBIGINT range.",
  ),
  playerSlot: z.number().int().min(0).max(255),
}).strict();

export type DamageBySourceInput = z.infer<typeof damageBySourceInputSchema>;

export interface DamageEvent {
  sequence: string;
  gameTimeSeconds: number;
  rawTimeSeconds: number | null;
  damage: number;
  attackerTeam: number | null;
  damageType: number | null;
  spellGeneratedAttack: boolean;
}

export interface DamageMechanism {
  rawName: string | null;
  label: string;
  damage: number;
  events: DamageEvent[];
}

export interface DamageVia {
  rawName: string | null;
  label: string;
  kind: "direct" | "unit" | "illusion";
  damage: number;
  mechanisms: DamageMechanism[];
}

export interface DamageSource {
  rawName: string;
  label: string;
  damage: number;
  via: DamageVia[];
}

export interface DamageInterval {
  startSeconds: number;
  endSeconds: number;
  totalDamage: number;
  sources: DamageSource[];
}

export interface MatchHeroDamageTimeline {
  matchId: string;
  playerSlot: number;
  intervalSeconds: typeof INTERVAL_SECONDS;
  available: boolean;
  target: {
    heroId: number | null;
    heroName: string;
    playerName: string | null;
    teamId: number;
  } | null;
  totalDamage: number;
  intervals: DamageInterval[];
}

interface SelectedTarget {
  extractionId: string;
  heroId: number | null;
  playerName: string | null;
  teamId: number;
  hasGameStateMarkers: boolean;
}

interface RawDamageEvent extends DamageEvent {
  attackerName: string | null;
  damageSourceName: string | null;
  inflictorName: string | null;
  attackerIllusion: boolean;
}

export async function getMatchHeroDamageTimeline(
  input: DamageBySourceInput,
): Promise<MatchHeroDamageTimeline> {
  const validated = damageBySourceInputSchema.parse(input);
  const matchId = parseMatchId(validated.matchId);

  return withReadOnlyWarehouse(async (connection) => {
    const targetResult = await connection.runAndReadAll(TARGET_SQL, {
      matchId,
      playerSlot: validated.playerSlot,
    });
    const targetRow = targetResult.getRowObjectsJson()[0];
    if (targetRow === undefined) {
      throw new Error(`Player slot ${validated.playerSlot} was not found in match ${matchId}.`);
    }

    const selectedTarget = parseSelectedTarget(targetRow);
    const hero = getHeroDisplayData(selectedTarget.heroId);
    const target = {
      heroId: selectedTarget.heroId,
      heroName: hero?.name ?? (selectedTarget.heroId === null
        ? "Unknown hero"
        : `Hero #${selectedTarget.heroId}`),
      playerName: selectedTarget.playerName,
      teamId: selectedTarget.teamId,
    };
    const base = {
      matchId: matchId.toString(),
      playerSlot: validated.playerSlot,
      intervalSeconds: INTERVAL_SECONDS,
      target,
    };
    const targetCombatLogName = getHeroCombatLogName(selectedTarget.heroId);
    if (!selectedTarget.hasGameStateMarkers || targetCombatLogName === null) {
      return { ...base, available: false, totalDamage: 0, intervals: [] };
    }

    const eventResult = await connection.runAndReadAll(DAMAGE_EVENTS_SQL, {
      extractionId: selectedTarget.extractionId,
      targetName: targetCombatLogName,
      targetTeam: selectedTarget.teamId,
    });
    const events = eventResult.getRowObjectsJson().map(parseDamageEvent);
    const grouped = groupDamageEvents(events);
    return {
      ...base,
      available: true,
      totalDamage: grouped.totalDamage,
      intervals: grouped.intervals,
    };
  });
}

function parseSelectedTarget(row: Record<string, JsonValue>): SelectedTarget {
  return {
    extractionId: requiredString(row.extraction_id, "target extraction ID"),
    heroId: nullableInteger(row.hero_id, "target hero ID"),
    playerName: nullableString(row.player_name, "target player name"),
    teamId: integerValue(row.team_id, "target team ID"),
    hasGameStateMarkers: booleanValue(row.has_game_state_markers, "game-state marker availability"),
  };
}

function parseDamageEvent(row: Record<string, JsonValue>): RawDamageEvent {
  const sequence = requiredString(row.sequence, "damage sequence");
  if (!/^[0-9]+$/.test(sequence)) throw new Error("Unexpected damage sequence");
  return {
    sequence,
    gameTimeSeconds: finiteNumber(row.game_time_seconds, "damage game time"),
    rawTimeSeconds: nullableNumber(row.raw_time_seconds, "damage raw time"),
    damage: integerValue(row.damage, "damage value"),
    attackerTeam: nullableInteger(row.attacker_team, "damage attacker team"),
    damageType: nullableInteger(row.damage_type, "damage type"),
    spellGeneratedAttack: booleanValue(row.spell_generated_attack, "spell-generated attack"),
    attackerName: nullableName(row.attacker_name, "damage attacker name"),
    damageSourceName: nullableName(row.damage_source_name, "damage source name"),
    inflictorName: nullableName(row.inflictor_name, "damage inflictor name"),
    attackerIllusion: booleanValue(row.attacker_illusion, "damage attacker illusion"),
  };
}

function groupDamageEvents(events: RawDamageEvent[]): {
  totalDamage: number;
  intervals: DamageInterval[];
} {
  const intervals = new Map<number, DamageInterval>();
  events.sort(compareEvents);

  for (const row of events) {
    const startSeconds = Math.floor(row.gameTimeSeconds / INTERVAL_SECONDS) * INTERVAL_SECONDS;
    const interval = intervals.get(startSeconds) ?? {
      startSeconds,
      endSeconds: startSeconds + INTERVAL_SECONDS,
      totalDamage: 0,
      sources: [],
    };
    const sourceRawName = row.damageSourceName ?? row.attackerName ?? "Unknown source";
    let source = interval.sources.find((candidate) => candidate.rawName === sourceRawName);
    if (source === undefined) {
      source = { rawName: sourceRawName, label: formatDotaName(sourceRawName), damage: 0, via: [] };
      interval.sources.push(source);
    }

    const viaIdentity = viaForEvent(row, sourceRawName);
    let via = source.via.find((candidate) =>
      candidate.kind === viaIdentity.kind && candidate.rawName === viaIdentity.rawName
    );
    if (via === undefined) {
      via = { ...viaIdentity, damage: 0, mechanisms: [] };
      source.via.push(via);
    }

    const mechanismRawName = row.inflictorName;
    let mechanism = via.mechanisms.find((candidate) => candidate.rawName === mechanismRawName);
    if (mechanism === undefined) {
      mechanism = {
        rawName: mechanismRawName,
        label: mechanismRawName === null ? "Attack" : formatDotaName(mechanismRawName),
        damage: 0,
        events: [],
      };
      via.mechanisms.push(mechanism);
    }

    const event: DamageEvent = {
      sequence: row.sequence,
      gameTimeSeconds: row.gameTimeSeconds,
      rawTimeSeconds: row.rawTimeSeconds,
      damage: row.damage,
      attackerTeam: row.attackerTeam,
      damageType: row.damageType,
      spellGeneratedAttack: row.spellGeneratedAttack,
    };
    mechanism.events.push(event);
    mechanism.damage += row.damage;
    via.damage += row.damage;
    source.damage += row.damage;
    interval.totalDamage += row.damage;
    intervals.set(startSeconds, interval);
  }

  const result = [...intervals.values()].sort((left, right) => left.startSeconds - right.startSeconds);
  for (const interval of result) {
    interval.sources.sort(compareDamageGroups);
    for (const source of interval.sources) {
      source.via.sort(compareDamageGroups);
      for (const via of source.via) {
        via.mechanisms.sort(compareDamageGroups);
        for (const mechanism of via.mechanisms) mechanism.events.sort(compareEvents);
      }
    }
  }
  return {
    totalDamage: result.reduce((sum, interval) => sum + interval.totalDamage, 0),
    intervals: result,
  };
}

function viaForEvent(
  event: RawDamageEvent,
  sourceRawName: string,
): Pick<DamageVia, "rawName" | "label" | "kind"> {
  if (event.attackerIllusion) {
    return {
      rawName: event.attackerName,
      label: `${event.attackerName === null ? "Unknown unit" : formatDotaName(event.attackerName)} illusion`,
      kind: "illusion",
    };
  }
  if (event.attackerName !== null && event.attackerName !== sourceRawName) {
    return {
      rawName: event.attackerName,
      label: formatDotaName(event.attackerName),
      kind: "unit",
    };
  }
  return { rawName: null, label: "Direct", kind: "direct" };
}

function compareEvents(left: Pick<DamageEvent, "gameTimeSeconds" | "sequence">, right: Pick<DamageEvent, "gameTimeSeconds" | "sequence">): number {
  if (left.gameTimeSeconds !== right.gameTimeSeconds) {
    return left.gameTimeSeconds - right.gameTimeSeconds;
  }
  const leftSequence = BigInt(left.sequence);
  const rightSequence = BigInt(right.sequence);
  return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
}

function compareDamageGroups(
  left: { damage: number; label: string; rawName: string | null },
  right: { damage: number; label: string; rawName: string | null },
): number {
  return right.damage - left.damage
    || left.label.localeCompare(right.label)
    || (left.rawName ?? "").localeCompare(right.rawName ?? "");
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Unexpected ${label}`);
  return value;
}

function nullableString(value: JsonValue | undefined, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Unexpected ${label}`);
  return value;
}

function nullableName(value: JsonValue | undefined, label: string): string | null {
  const parsed = nullableString(value, label)?.trim() ?? null;
  return parsed === "" ? null : parsed;
}

function integerValue(value: JsonValue | undefined, label: string): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Unexpected ${label}`);
  return parsed;
}

function nullableInteger(value: JsonValue | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  return integerValue(value, label);
}

function nullableNumber(value: JsonValue | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, label);
}

function finiteNumber(value: JsonValue | undefined, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Unexpected ${label}`);
  return parsed;
}

function booleanValue(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Unexpected ${label}`);
  return value;
}

const TARGET_SQL = `
SELECT
  player.extraction_id,
  player.hero_id,
  player.player_name,
  player.team_id,
  (
    EXISTS (
      SELECT 1
      FROM raw.combat_events AS start_marker
      WHERE start_marker.extraction_id = player.extraction_id
        AND start_marker.event_type = 'DOTA_COMBATLOG_GAME_STATE'
        AND start_marker.value = 4
    )
    AND EXISTS (
      SELECT 1
      FROM raw.combat_events AS stop_marker
      WHERE stop_marker.extraction_id = player.extraction_id
        AND stop_marker.event_type = 'DOTA_COMBATLOG_GAME_STATE'
        AND stop_marker.value = 6
        AND stop_marker.sequence > (
          SELECT min(start_marker.sequence)
          FROM raw.combat_events AS start_marker
          WHERE start_marker.extraction_id = player.extraction_id
            AND start_marker.event_type = 'DOTA_COMBATLOG_GAME_STATE'
            AND start_marker.value = 4
        )
    )
  ) AS has_game_state_markers
FROM analysis.match_players($matchId) AS player
WHERE player.player_slot = $playerSlot`;

const DAMAGE_EVENTS_SQL = `
SELECT
  event.sequence::VARCHAR AS sequence,
  event.game_time AS game_time_seconds,
  event.raw_time AS raw_time_seconds,
  event.value AS damage,
  event.attacker_name,
  event.damage_source_name,
  event.inflictor_name,
  event.attacker_team,
  event.damage_type,
  coalesce(event.spell_generated_attack, false) AS spell_generated_attack,
  coalesce(event.attacker_illusion, false) AS attacker_illusion
FROM raw.combat_events AS event
WHERE event.extraction_id = $extractionId
  AND event.event_type = 'DOTA_COMBATLOG_DAMAGE'
  AND analysis.is_actual_game(event.extraction_id, event.sequence)
  AND event.target_name = $targetName
  AND event.target_team = $targetTeam
  AND NOT coalesce(event.target_illusion, false)
  AND event.game_time IS NOT NULL
  AND event.value IS NOT NULL
ORDER BY event.game_time, event.sequence`;
