import { getHeroCombatLogName } from "../lib/dota-heroes.js";

export const NEUTRAL_CAMP_FARMING_V1_CONFIG = Object.freeze({
  definitionName: "neutral-camp-farming-v1" as const,
  positionTimeToleranceMs: 250,
  campRadiusWorldUnits: 1_200,
  damageGapMs: 8_000,
  neutralTeamNumber: 4,
  invalidEntityHandle: 16_777_215n,
  neutralCreepClassName: "CDOTA_BaseNPC_Creep_Neutral",
  damageEventType: "DOTA_COMBATLOG_DAMAGE",
  neutralTargetNamePrefix: "npc_dota_neutral_",
});

export interface NeutralCampFarmingRosterPlayer {
  playerSlot: number;
  heroId: number;
}

export interface NeutralCampFarmingDamageEvent {
  sourceSequence: bigint;
  /** Pause-safe game time normalized to the same clock used by entity and position facts. */
  gameTimeSeconds: number;
  eventType: string;
  targetName: string | null;
  attackerName: string | null;
  targetTeam: number | null;
  damageValue: number;
  attackerIllusion: boolean;
}

export interface NeutralCampFarmingHeroPosition {
  playerSlot: number;
  gameTimeMs: number;
  worldX: number;
  worldY: number;
}

export interface NeutralCampFarmingSpawnerFact {
  entityInstanceId: bigint;
  handle: bigint;
  campType: number;
  worldX: number;
  worldY: number;
  creationGameTimeMs: number;
  deletionGameTimeMs: number | null;
}

export interface NeutralCampFarmingCreepFact {
  entityInstanceId: bigint;
  handle: bigint;
  className: string;
  neutralSpawnerHandle: bigint;
  teamNumber: number | null;
  creationGameTimeMs: number;
  deathGameTimeMs: number | null;
  deletionGameTimeMs: number | null;
}

export interface NeutralCampFarmingFacts {
  extractionId: string;
  rosterPlayers: readonly NeutralCampFarmingRosterPlayer[];
  damageEvents: readonly NeutralCampFarmingDamageEvent[];
  heroPositions: readonly NeutralCampFarmingHeroPosition[];
  campSpawners: readonly NeutralCampFarmingSpawnerFact[];
  campCreeps: readonly NeutralCampFarmingCreepFact[];
}

export type NeutralCampFarmingResult = "cleared" | "not_cleared";

export interface NeutralCampFarmingAction {
  extractionId: string;
  actionIndex: number;
  definitionName: typeof NEUTRAL_CAMP_FARMING_V1_CONFIG.definitionName;
  playerSlot: number;
  campId: number;
  spawnerHandle: bigint;
  campType: number;
  campWorldX: number;
  campWorldY: number;
  startGameTimeMs: number;
  endGameTimeMs: number;
  result: NeutralCampFarmingResult;
  damageEventCount: number;
  totalDamage: number;
  initialCreepCount: number;
  deadInitialCreepCount: number;
}

interface Camp extends NeutralCampFarmingSpawnerFact {
  campId: number;
  creeps: NeutralCampFarmingCreepFact[];
}

interface AssignedDamage {
  playerSlot: number;
  camp: Camp;
  gameTimeMs: number;
  sourceSequence: bigint;
  damageValue: number;
}

interface DamageSession {
  playerSlot: number;
  camp: Camp;
  damageEvents: AssignedDamage[];
}

/** Derive version 1 neutral-camp farming actions from extraction-local, sorted facts. */
export function deriveNeutralCampFarmingActions(
  facts: NeutralCampFarmingFacts,
): NeutralCampFarmingAction[] {
  const camps = buildCamps(facts.campSpawners, facts.campCreeps);
  const playerByAttackerName = buildUniqueRosterMapping(facts.rosterPlayers);
  const positionsByPlayer = groupPositionsByPlayer(facts.heroPositions);
  const assignedDamage: AssignedDamage[] = [];

  for (const event of facts.damageEvents) {
    if (!isDirectHeroDamage(event)) continue;
    const player = event.attackerName === null ? undefined : playerByAttackerName.get(event.attackerName);
    if (player === undefined) continue;

    const gameTimeMs = Math.round(event.gameTimeSeconds * 1_000);
    const position = nearestPosition(positionsByPlayer.get(player.playerSlot) ?? [], gameTimeMs);
    if (position === null) continue;
    const camp = nearestApplicableCamp(camps, position, gameTimeMs);
    if (camp === null) continue;

    assignedDamage.push({
      playerSlot: player.playerSlot,
      camp,
      gameTimeMs,
      sourceSequence: event.sourceSequence,
      damageValue: event.damageValue,
    });
  }

  assignedDamage.sort(compareAssignedDamage);
  const sessions = groupDamageSessions(assignedDamage);
  const derived = sessions.map((session) => ({
    action: buildAction(facts.extractionId, session),
    firstDamageSequence: requiredEvent(session.damageEvents[0]).sourceSequence,
  }));
  derived.sort((left, right) =>
    left.action.startGameTimeMs - right.action.startGameTimeMs
    || left.action.playerSlot - right.action.playerSlot
    || left.action.campId - right.action.campId
    || compareBigInt(left.firstDamageSequence, right.firstDamageSequence)
  );
  return derived.map(({ action }, actionIndex) => ({ ...action, actionIndex }));
}

function buildCamps(
  spawnerFacts: readonly NeutralCampFarmingSpawnerFact[],
  creepFacts: readonly NeutralCampFarmingCreepFact[],
): Camp[] {
  const sortedSpawners = [...spawnerFacts].sort((left, right) =>
    left.worldY - right.worldY
    || left.worldX - right.worldX
    || compareBigInt(left.handle, right.handle)
    || compareBigInt(left.entityInstanceId, right.entityInstanceId)
  );
  const spawnerCountByHandle = new Map<bigint, number>();
  for (const spawner of sortedSpawners) {
    spawnerCountByHandle.set(spawner.handle, (spawnerCountByHandle.get(spawner.handle) ?? 0) + 1);
  }

  return sortedSpawners.map((spawner, campId) => ({
    ...spawner,
    campId,
    creeps: creepFacts.filter((creep) =>
      creep.className === NEUTRAL_CAMP_FARMING_V1_CONFIG.neutralCreepClassName
      && creep.neutralSpawnerHandle !== NEUTRAL_CAMP_FARMING_V1_CONFIG.invalidEntityHandle
      && creep.neutralSpawnerHandle === spawner.handle
      && spawnerCountByHandle.get(creep.neutralSpawnerHandle) === 1
    ),
  }));
}

function buildUniqueRosterMapping(
  players: readonly NeutralCampFarmingRosterPlayer[],
): Map<string, NeutralCampFarmingRosterPlayer> {
  const candidates = new Map<string, NeutralCampFarmingRosterPlayer[]>();
  for (const player of players) {
    const attackerName = getHeroCombatLogName(player.heroId);
    if (attackerName === null) continue;
    const matching = candidates.get(attackerName) ?? [];
    matching.push(player);
    candidates.set(attackerName, matching);
  }
  const unique = new Map<string, NeutralCampFarmingRosterPlayer>();
  for (const [attackerName, matching] of candidates) {
    if (matching.length === 1 && matching[0] !== undefined) unique.set(attackerName, matching[0]);
  }
  return unique;
}

function groupPositionsByPlayer(
  positions: readonly NeutralCampFarmingHeroPosition[],
): Map<number, NeutralCampFarmingHeroPosition[]> {
  const grouped = new Map<number, NeutralCampFarmingHeroPosition[]>();
  for (const position of positions) {
    const matching = grouped.get(position.playerSlot) ?? [];
    matching.push(position);
    grouped.set(position.playerSlot, matching);
  }
  return grouped;
}

function isDirectHeroDamage(event: NeutralCampFarmingDamageEvent): boolean {
  return event.eventType === NEUTRAL_CAMP_FARMING_V1_CONFIG.damageEventType
    && Number.isFinite(event.damageValue)
    && event.damageValue > 0
    && event.targetTeam === NEUTRAL_CAMP_FARMING_V1_CONFIG.neutralTeamNumber
    && event.targetName !== null
    && event.targetName.startsWith(NEUTRAL_CAMP_FARMING_V1_CONFIG.neutralTargetNamePrefix)
    && !event.attackerIllusion;
}

function nearestPosition(
  positions: readonly NeutralCampFarmingHeroPosition[],
  gameTimeMs: number,
): NeutralCampFarmingHeroPosition | null {
  let nearest: NeutralCampFarmingHeroPosition | null = null;
  let nearestDifference = Number.POSITIVE_INFINITY;
  for (const position of positions) {
    const difference = Math.abs(position.gameTimeMs - gameTimeMs);
    if (difference > NEUTRAL_CAMP_FARMING_V1_CONFIG.positionTimeToleranceMs) continue;
    if (
      difference < nearestDifference
      || (difference === nearestDifference && nearest !== null && position.gameTimeMs < nearest.gameTimeMs)
    ) {
      nearest = position;
      nearestDifference = difference;
    }
  }
  return nearest;
}

function nearestApplicableCamp(
  camps: readonly Camp[],
  position: NeutralCampFarmingHeroPosition,
  gameTimeMs: number,
): Camp | null {
  let nearest: Camp | null = null;
  let nearestSquaredDistance = Number.POSITIVE_INFINITY;
  const maximumSquaredDistance = NEUTRAL_CAMP_FARMING_V1_CONFIG.campRadiusWorldUnits ** 2;
  for (const camp of camps) {
    if (!existsAt(camp.creationGameTimeMs, camp.deletionGameTimeMs, gameTimeMs)) continue;
    if (!camp.creeps.some((creep) => isApplicableLiveCreep(creep, gameTimeMs))) continue;
    const squaredDistance = (camp.worldX - position.worldX) ** 2 + (camp.worldY - position.worldY) ** 2;
    if (squaredDistance <= maximumSquaredDistance && squaredDistance < nearestSquaredDistance) {
      nearest = camp;
      nearestSquaredDistance = squaredDistance;
    }
  }
  return nearest;
}

function isApplicableLiveCreep(creep: NeutralCampFarmingCreepFact, gameTimeMs: number): boolean {
  return creep.teamNumber === NEUTRAL_CAMP_FARMING_V1_CONFIG.neutralTeamNumber
    && existsAt(creep.creationGameTimeMs, creep.deletionGameTimeMs, gameTimeMs)
    && (creep.deathGameTimeMs === null || creep.deathGameTimeMs >= gameTimeMs);
}

function existsAt(creationGameTimeMs: number, deletionGameTimeMs: number | null, gameTimeMs: number): boolean {
  return creationGameTimeMs <= gameTimeMs
    && (deletionGameTimeMs === null || deletionGameTimeMs > gameTimeMs);
}

function compareAssignedDamage(left: AssignedDamage, right: AssignedDamage): number {
  return left.gameTimeMs - right.gameTimeMs || compareBigInt(left.sourceSequence, right.sourceSequence);
}

function groupDamageSessions(events: readonly AssignedDamage[]): DamageSession[] {
  const sessions: DamageSession[] = [];
  const openSessionByPlayerAndCamp = new Map<string, DamageSession>();
  for (const event of events) {
    const key = `${event.playerSlot}:${event.camp.campId}`;
    const open = openSessionByPlayerAndCamp.get(key);
    const previousEvent = open?.damageEvents.at(-1);
    if (
      open === undefined
      || previousEvent === undefined
      || event.gameTimeMs - previousEvent.gameTimeMs > NEUTRAL_CAMP_FARMING_V1_CONFIG.damageGapMs
    ) {
      const session = { playerSlot: event.playerSlot, camp: event.camp, damageEvents: [event] };
      sessions.push(session);
      openSessionByPlayerAndCamp.set(key, session);
    } else {
      open.damageEvents.push(event);
    }
  }
  return sessions;
}

function buildAction(extractionId: string, session: DamageSession): NeutralCampFarmingAction {
  const firstDamage = requiredEvent(session.damageEvents[0]);
  const lastDamage = requiredEvent(session.damageEvents.at(-1));
  const initialCreeps = session.camp.creeps.filter((creep) => isApplicableLiveCreep(creep, firstDamage.gameTimeMs));
  const deathTimes = initialCreeps.flatMap((creep) =>
    creep.deathGameTimeMs === null ? [] : [creep.deathGameTimeMs]
  );
  const deadInitialCreepCount = deathTimes.length;
  const lastDeath = deathTimes.length === 0 ? null : Math.max(...deathTimes);
  const cleared = initialCreeps.length > 0
    && deadInitialCreepCount === initialCreeps.length
    && lastDeath !== null
    && lastDeath <= lastDamage.gameTimeMs + NEUTRAL_CAMP_FARMING_V1_CONFIG.damageGapMs;

  return {
    extractionId,
    actionIndex: -1,
    definitionName: NEUTRAL_CAMP_FARMING_V1_CONFIG.definitionName,
    playerSlot: session.playerSlot,
    campId: session.camp.campId,
    spawnerHandle: session.camp.handle,
    campType: session.camp.campType,
    campWorldX: session.camp.worldX,
    campWorldY: session.camp.worldY,
    startGameTimeMs: firstDamage.gameTimeMs,
    endGameTimeMs: cleared ? lastDeath : lastDamage.gameTimeMs,
    result: cleared ? "cleared" : "not_cleared",
    damageEventCount: session.damageEvents.length,
    totalDamage: session.damageEvents.reduce((sum, event) => sum + event.damageValue, 0),
    initialCreepCount: initialCreeps.length,
    deadInitialCreepCount,
  };
}

function requiredEvent(event: AssignedDamage | undefined): AssignedDamage {
  if (event === undefined) throw new Error("Neutral camp farming session has no damage events");
  return event;
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
