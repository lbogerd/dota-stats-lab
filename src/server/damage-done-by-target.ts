import { z } from "zod";
import { getHeroCombatLogName, getHeroDisplayData } from "../lib/dota-heroes.js";
import { formatDotaName } from "../lib/dota-names.js";
import { isValidMatchId, parseMatchId } from "../lib/match-id.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

const INTERVAL_SECONDS = 30 as const;

export const damageDoneByTargetInputSchema = z.object({
  matchId: z.string().refine(
    isValidMatchId,
    "Enter a positive match ID in the DuckDB UBIGINT range.",
  ),
  playerSlot: z.number().int().min(0).max(255),
}).strict();

export type DamageDoneByTargetInput = z.infer<typeof damageDoneByTargetInputSchema>;

export interface DamageDoneDealerVia {
  rawName: string | null;
  label: string;
  kind: "direct" | "unit" | "illusion";
}

export interface DamageDoneEvent {
  sequence: string;
  gameTimeSeconds: number;
  rawTimeSeconds: number | null;
  damage: number;
  attackerTeam: number | null;
  targetTeam: number | null;
  damageType: number | null;
  spellGeneratedAttack: boolean;
  dealerVia: DamageDoneDealerVia;
}

export interface DamageDoneMechanism {
  rawName: string | null;
  label: string;
  damage: number;
  events: DamageDoneEvent[];
}

export interface DamageTargetVia {
  rawName: string | null;
  label: string;
  kind: "direct" | "unit" | "illusion";
  damage: number;
  mechanisms: DamageDoneMechanism[];
}

export interface DamageTarget {
  rawName: string;
  label: string;
  teamId: number | null;
  damage: number;
  via: DamageTargetVia[];
}

export interface DamageDoneInterval {
  startSeconds: number;
  endSeconds: number;
  totalDamage: number;
  targets: DamageTarget[];
}

export interface MatchHeroDamageDoneTimeline {
  matchId: string;
  playerSlot: number;
  intervalSeconds: typeof INTERVAL_SECONDS;
  available: boolean;
  dealer: {
    heroId: number | null;
    heroName: string;
    playerName: string | null;
    teamId: number;
  } | null;
  totalDamage: number;
  intervals: DamageDoneInterval[];
}

interface SelectedDealer {
  extractionId: string;
  heroId: number | null;
  playerName: string | null;
  teamId: number;
  hasGameStateMarkers: boolean;
}

interface RawDamageDoneEvent {
  sequence: string;
  gameTimeSeconds: number;
  rawTimeSeconds: number | null;
  damage: number;
  attackerName: string | null;
  damageSourceName: string | null;
  inflictorName: string | null;
  targetName: string | null;
  targetSourceName: string | null;
  attackerTeam: number | null;
  targetTeam: number | null;
  damageType: number | null;
  attackerIllusion: boolean;
  targetIllusion: boolean;
  spellGeneratedAttack: boolean;
}

export async function getMatchHeroDamageDoneTimeline(
  input: DamageDoneByTargetInput,
): Promise<MatchHeroDamageDoneTimeline> {
  const validated = damageDoneByTargetInputSchema.parse(input);
  const matchId = parseMatchId(validated.matchId);

  return withReadOnlyWarehouse(async (connection) => {
    const dealerResult = await connection.runAndReadAll(DEALER_SQL, {
      matchId,
      playerSlot: validated.playerSlot,
    });
    const dealerRow = dealerResult.getRowObjectsJson()[0];
    if (dealerRow === undefined) {
      throw new Error(`Player slot ${validated.playerSlot} was not found in match ${matchId}.`);
    }

    const selectedDealer = parseSelectedDealer(dealerRow);
    const hero = getHeroDisplayData(selectedDealer.heroId);
    const dealer = {
      heroId: selectedDealer.heroId,
      heroName: hero?.name ?? (selectedDealer.heroId === null
        ? "Unknown hero"
        : `Hero #${selectedDealer.heroId}`),
      playerName: selectedDealer.playerName,
      teamId: selectedDealer.teamId,
    };
    const base = {
      matchId: matchId.toString(),
      playerSlot: validated.playerSlot,
      intervalSeconds: INTERVAL_SECONDS,
      dealer,
    };
    const dealerCombatLogName = getHeroCombatLogName(selectedDealer.heroId);
    if (!selectedDealer.hasGameStateMarkers || dealerCombatLogName === null) {
      return { ...base, available: false, totalDamage: 0, intervals: [] };
    }

    const eventResult = await connection.runAndReadAll(DAMAGE_EVENTS_SQL, {
      extractionId: selectedDealer.extractionId,
      dealerName: dealerCombatLogName,
      dealerTeam: selectedDealer.teamId,
    });
    const events = eventResult.getRowObjectsJson().map(parseDamageDoneEvent);
    const grouped = groupDamageDoneEvents(events);
    return {
      ...base,
      available: true,
      totalDamage: grouped.totalDamage,
      intervals: grouped.intervals,
    };
  });
}

function parseSelectedDealer(row: Record<string, JsonValue>): SelectedDealer {
  return {
    extractionId: requiredString(row.extraction_id, "dealer extraction ID"),
    heroId: nullableInteger(row.hero_id, "dealer hero ID"),
    playerName: nullableString(row.player_name, "dealer player name"),
    teamId: integerValue(row.team_id, "dealer team ID"),
    hasGameStateMarkers: booleanValue(row.has_game_state_markers, "game-state marker availability"),
  };
}

function parseDamageDoneEvent(row: Record<string, JsonValue>): RawDamageDoneEvent {
  const sequence = requiredString(row.sequence, "damage sequence");
  if (!/^[0-9]+$/.test(sequence)) throw new Error("Unexpected damage sequence");
  return {
    sequence,
    gameTimeSeconds: finiteNumber(row.game_time_seconds, "damage game time"),
    rawTimeSeconds: nullableNumber(row.raw_time_seconds, "damage raw time"),
    damage: integerValue(row.damage, "damage value"),
    attackerName: nullableName(row.attacker_name, "damage attacker name"),
    damageSourceName: nullableName(row.damage_source_name, "damage source name"),
    inflictorName: nullableName(row.inflictor_name, "damage inflictor name"),
    targetName: nullableName(row.target_name, "damage target name"),
    targetSourceName: nullableName(row.target_source_name, "damage target source name"),
    attackerTeam: nullableInteger(row.attacker_team, "damage attacker team"),
    targetTeam: nullableInteger(row.target_team, "damage target team"),
    damageType: nullableInteger(row.damage_type, "damage type"),
    attackerIllusion: booleanValue(row.attacker_illusion, "damage attacker illusion"),
    targetIllusion: booleanValue(row.target_illusion, "damage target illusion"),
    spellGeneratedAttack: booleanValue(row.spell_generated_attack, "spell-generated attack"),
  };
}

function groupDamageDoneEvents(events: RawDamageDoneEvent[]): {
  totalDamage: number;
  intervals: DamageDoneInterval[];
} {
  const intervals = new Map<number, DamageDoneInterval>();
  events.sort(compareEvents);

  for (const row of events) {
    const startSeconds = Math.floor(row.gameTimeSeconds / INTERVAL_SECONDS) * INTERVAL_SECONDS;
    const interval = intervals.get(startSeconds) ?? {
      startSeconds,
      endSeconds: startSeconds + INTERVAL_SECONDS,
      totalDamage: 0,
      targets: [],
    };
    const targetRawName = row.targetSourceName ?? row.targetName ?? "Unknown target";
    let target = interval.targets.find((candidate) =>
      candidate.rawName === targetRawName && candidate.teamId === row.targetTeam
    );
    if (target === undefined) {
      target = {
        rawName: targetRawName,
        label: formatDotaName(targetRawName),
        teamId: row.targetTeam,
        damage: 0,
        via: [],
      };
      interval.targets.push(target);
    }

    const viaIdentity = targetViaForEvent(row, targetRawName);
    let via = target.via.find((candidate) =>
      candidate.kind === viaIdentity.kind && candidate.rawName === viaIdentity.rawName
    );
    if (via === undefined) {
      via = { ...viaIdentity, damage: 0, mechanisms: [] };
      target.via.push(via);
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

    const event: DamageDoneEvent = {
      sequence: row.sequence,
      gameTimeSeconds: row.gameTimeSeconds,
      rawTimeSeconds: row.rawTimeSeconds,
      damage: row.damage,
      attackerTeam: row.attackerTeam,
      targetTeam: row.targetTeam,
      damageType: row.damageType,
      spellGeneratedAttack: row.spellGeneratedAttack,
      dealerVia: dealerViaForEvent(row),
    };
    mechanism.events.push(event);
    mechanism.damage += row.damage;
    via.damage += row.damage;
    target.damage += row.damage;
    interval.totalDamage += row.damage;
    intervals.set(startSeconds, interval);
  }

  const result = [...intervals.values()].sort((left, right) => left.startSeconds - right.startSeconds);
  for (const interval of result) {
    interval.targets.sort(compareTargets);
    for (const target of interval.targets) {
      target.via.sort(compareDamageGroups);
      for (const via of target.via) {
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

function targetViaForEvent(
  event: RawDamageDoneEvent,
  targetRawName: string,
): Pick<DamageTargetVia, "rawName" | "label" | "kind"> {
  if (event.targetIllusion) {
    return {
      rawName: event.targetName,
      label: `${event.targetName === null ? "Unknown unit" : formatDotaName(event.targetName)} illusion`,
      kind: "illusion",
    };
  }
  if (event.targetName !== null && event.targetName !== targetRawName) {
    return {
      rawName: event.targetName,
      label: formatDotaName(event.targetName),
      kind: "unit",
    };
  }
  return { rawName: null, label: "Direct", kind: "direct" };
}

function dealerViaForEvent(
  event: RawDamageDoneEvent,
): DamageDoneDealerVia {
  const dealerRawName = event.damageSourceName ?? event.attackerName;
  if (event.attackerIllusion) {
    return {
      rawName: event.attackerName,
      label: `${event.attackerName === null ? "Unknown unit" : formatDotaName(event.attackerName)} illusion`,
      kind: "illusion",
    };
  }
  if (event.attackerName !== null && event.attackerName !== dealerRawName) {
    return {
      rawName: event.attackerName,
      label: formatDotaName(event.attackerName),
      kind: "unit",
    };
  }
  return { rawName: null, label: "Direct", kind: "direct" };
}

function compareEvents(
  left: Pick<DamageDoneEvent, "gameTimeSeconds" | "sequence">,
  right: Pick<DamageDoneEvent, "gameTimeSeconds" | "sequence">,
): number {
  if (left.gameTimeSeconds !== right.gameTimeSeconds) {
    return left.gameTimeSeconds - right.gameTimeSeconds;
  }
  const leftSequence = BigInt(left.sequence);
  const rightSequence = BigInt(right.sequence);
  return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
}

function compareTargets(left: DamageTarget, right: DamageTarget): number {
  return right.damage - left.damage
    || left.label.localeCompare(right.label)
    || left.rawName.localeCompare(right.rawName)
    || compareNullableNumbers(left.teamId, right.teamId);
}

function compareDamageGroups(
  left: { damage: number; label: string; rawName: string | null },
  right: { damage: number; label: string; rawName: string | null },
): number {
  return right.damage - left.damage
    || left.label.localeCompare(right.label)
    || (left.rawName ?? "").localeCompare(right.rawName ?? "");
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  return left === right ? 0 : left === null ? -1 : right === null ? 1 : left - right;
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

const DEALER_SQL = `
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
  event.target_name,
  event.target_source_name,
  event.attacker_team,
  event.target_team,
  event.damage_type,
  coalesce(event.attacker_illusion, false) AS attacker_illusion,
  coalesce(event.target_illusion, false) AS target_illusion,
  coalesce(event.spell_generated_attack, false) AS spell_generated_attack
FROM raw.combat_events AS event
WHERE event.extraction_id = $extractionId
  AND event.event_type = 'DOTA_COMBATLOG_DAMAGE'
  AND analysis.is_actual_game(event.extraction_id, event.sequence)
  AND coalesce(nullif(event.damage_source_name, ''), nullif(event.attacker_name, '')) = $dealerName
  AND event.attacker_team = $dealerTeam
  AND event.game_time IS NOT NULL
  AND event.value IS NOT NULL
ORDER BY event.game_time, event.sequence`;
