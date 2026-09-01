import { getHeroCombatLogName } from "../lib/dota-heroes.js";

export const FIGHT_DETECTION_VERSION = "death-anchored-fights-v1" as const;

export const FIGHT_DETECTION_THRESHOLDS = {
  maximumLinkedDeathGapSeconds: 20,
  maximumLinkedDeathDistanceWorldUnits: 2_500,
  maximumCombatDamageIdleGapSeconds: 10,
  maximumPreludeSeconds: 60,
  maximumCombatEndSeconds: 20,
  outcomePeriodSeconds: 30,
  localMapRadiusWorldUnits: 3_500,
  minimumMapWidthWorldUnits: 2_400,
  minimumMapHeightWorldUnits: 2_400,
  maximumMapWidthWorldUnits: 6_500,
  maximumMapHeightWorldUnits: 6_500,
  mapPaddingWorldUnits: 800,
} as const;

export type FightTeamId = 2 | 3;
export type FightType = "pickoff" | "skirmish" | "team_fight";

export interface FightPoint {
  x: number;
  y: number;
}

export interface FightRosterHero {
  playerSlot: number;
  gamePlayerId: number;
  heroId: number;
  teamId: FightTeamId;
  /** Defaults to the standard combat-log name for heroId. */
  combatLogName?: string;
}

export interface FightCombatEvent {
  sequence: bigint;
  eventType: string;
  gameTimeSeconds: number | null;
  targetName?: string | null;
  attackerName?: string | null;
  damageSourceName?: string | null;
  targetTeam?: number | null;
  attackerTeam?: number | null;
  assistPlayers?: readonly number[] | null;
  targetIllusion?: boolean | null;
  attackerIllusion?: boolean | null;
  locationX?: number | null;
  locationY?: number | null;
}

export interface FightDeathPosition {
  deathSequence: bigint;
  worldX: number;
  worldY: number;
}

export interface FightDetectionInput {
  roster: readonly FightRosterHero[];
  combatEvents: readonly FightCombatEvent[];
  /** Nearest 100 ms victim samples before deaths, keyed by combat-event sequence. */
  deathPositions?: readonly FightDeathPosition[];
}

export interface FightParticipant extends FightRosterHero {
  combatLogName: string;
}

export interface FightAnchorDeath {
  sequence: bigint;
  gameTimeSeconds: number;
  location: FightPoint | null;
  victim: FightParticipant;
  killer: FightParticipant | null;
  assists: FightParticipant[];
  activeParticipants: FightParticipant[];
}

export interface DetectedFight {
  fightId: string;
  detectionVersion: typeof FIGHT_DETECTION_VERSION;
  type: FightType;
  firstAnchorDeathTimeSeconds: number;
  combatStartTimeSeconds: number;
  combatEndTimeSeconds: number;
  outcomeEndTimeSeconds: number;
  durationSeconds: number;
  anchorDeaths: FightAnchorDeath[];
  radiantParticipants: FightParticipant[];
  direParticipants: FightParticipant[];
  /** Death and local relevant hero-damage locations within the combat interval. */
  combatPoints: FightPoint[];
}

interface RosterIndex {
  byCombatLogName: Map<string, FightParticipant[]>;
  byGamePlayerId: Map<number, FightParticipant[]>;
}

interface RelevantDamage {
  gameTimeSeconds: number;
  sequence: bigint;
  location: FightPoint | null;
}

const DEATH_EVENT = "DOTA_COMBATLOG_DEATH";
const DAMAGE_EVENT = "DOTA_COMBATLOG_DAMAGE";

export function detectFights(input: FightDetectionInput): DetectedFight[] {
  const roster = normalizedRoster(input.roster);
  const index = makeRosterIndex(roster);
  const anchors = selectFightAnchorDeathsWithIndex(
    input.combatEvents,
    index,
    input.deathPositions ?? [],
  );
  if (anchors.length === 0) return [];

  const groups = groupAnchorDeaths(anchors);
  const fights = groups.flatMap((anchorDeaths): DetectedFight[] => {
    const participants = uniqueParticipants(anchorDeaths.flatMap(
      (anchor) => anchor.activeParticipants,
    ));
    const radiantParticipants = participants.filter((hero) => hero.teamId === 2);
    const direParticipants = participants.filter((hero) => hero.teamId === 3);
    const type = classifyFight(radiantParticipants.length, direParticipants.length);
    if (type === null) return [];

    const participantSlots = new Set(participants.map((hero) => hero.playerSlot));
    const damage = relevantDamageEvents(input.combatEvents, index, participantSlots);
    const firstDeath = anchorDeaths[0];
    const lastDeath = anchorDeaths.at(-1);
    if (firstDeath === undefined || lastDeath === undefined) return [];
    const combatStartTimeSeconds = findCombatStart(firstDeath.gameTimeSeconds, damage);
    const combatEndTimeSeconds = findCombatEnd(lastDeath.gameTimeSeconds, damage);
    const anchorPoints = anchorDeaths.flatMap(
      (anchor) => anchor.location === null ? [] : [anchor.location],
    );
    const damagePoints: FightPoint[] = [];
    for (const event of damage) {
      const location = event.location;
      if (location === null
        || event.gameTimeSeconds < combatStartTimeSeconds
        || event.gameTimeSeconds > combatEndTimeSeconds) continue;
      const isLocal = anchorPoints.length === 0 || anchorPoints.some((anchorPoint) => (
        squaredDistance(anchorPoint, location)
          <= FIGHT_DETECTION_THRESHOLDS.localMapRadiusWorldUnits ** 2
      ));
      if (isLocal) damagePoints.push(location);
    }
    const combatPoints = [
      ...anchorPoints,
      ...damagePoints,
    ];

    return [{
      fightId: unsignedSequenceString(firstDeath.sequence),
      detectionVersion: FIGHT_DETECTION_VERSION,
      type,
      firstAnchorDeathTimeSeconds: firstDeath.gameTimeSeconds,
      combatStartTimeSeconds,
      combatEndTimeSeconds,
      outcomeEndTimeSeconds: combatEndTimeSeconds
        + FIGHT_DETECTION_THRESHOLDS.outcomePeriodSeconds,
      durationSeconds: combatEndTimeSeconds - combatStartTimeSeconds,
      anchorDeaths,
      radiantParticipants,
      direParticipants,
      combatPoints,
    }];
  });

  return fights.sort(compareFights);
}

export function selectFightAnchorDeaths(
  events: readonly FightCombatEvent[],
  roster: readonly FightRosterHero[],
  deathPositions: readonly FightDeathPosition[] = [],
): FightAnchorDeath[] {
  return selectFightAnchorDeathsWithIndex(
    events,
    makeRosterIndex(normalizedRoster(roster)),
    deathPositions,
  );
}

function selectFightAnchorDeathsWithIndex(
  events: readonly FightCombatEvent[],
  index: RosterIndex,
  deathPositions: readonly FightDeathPosition[],
): FightAnchorDeath[] {
  const positionsByDeath = indexDeathPositions(deathPositions);

  return events.flatMap((event): FightAnchorDeath[] => {
    if (event.eventType !== DEATH_EVENT || !Number.isFinite(event.gameTimeSeconds)) return [];
    if (event.sequence < 0n || (event.targetTeam !== 2 && event.targetTeam !== 3)) return [];
    if (event.targetIllusion === true) return [];

    const victim = uniqueMappedHero(index.byCombatLogName, event.targetName);
    if (victim === null || victim.teamId !== event.targetTeam) return [];

    const creditedSource = uniqueMappedHero(index.byCombatLogName, event.damageSourceName);
    const attacker = creditedSource
      ?? uniqueMappedHero(index.byCombatLogName, event.attackerName);
    const killer = attacker?.teamId === enemyTeam(victim.teamId) ? attacker : null;
    const assists = uniqueParticipants((event.assistPlayers ?? []).flatMap((gamePlayerId) => {
      const hero = uniqueMappedHero(index.byGamePlayerId, gamePlayerId);
      return hero !== null && hero.teamId === enemyTeam(victim.teamId) ? [hero] : [];
    })).filter((hero) => hero.playerSlot !== killer?.playerSlot);
    if (killer === null && assists.length === 0) return [];

    const gameTimeSeconds = event.gameTimeSeconds as number;
    return [{
      sequence: event.sequence,
      gameTimeSeconds,
      location: eventPoint(event) ?? positionsByDeath.get(event.sequence) ?? null,
      victim,
      killer,
      assists,
      activeParticipants: uniqueParticipants([
        victim,
        ...(killer === null ? [] : [killer]),
        ...assists,
      ]),
    }];
  }).sort(compareAnchors);
}

export function groupAnchorDeaths(
  sortedOrUnsortedAnchors: readonly FightAnchorDeath[],
): FightAnchorDeath[][] {
  const anchors = [...sortedOrUnsortedAnchors].sort(compareAnchors);
  const parents = anchors.map((_, index) => index);
  for (let right = 0; right < anchors.length; right++) {
    const rightAnchor = anchors[right];
    if (rightAnchor === undefined) continue;
    for (let left = right - 1; left >= 0; left--) {
      const leftAnchor = anchors[left];
      if (leftAnchor === undefined) continue;
      const gap = rightAnchor.gameTimeSeconds - leftAnchor.gameTimeSeconds;
      if (gap > FIGHT_DETECTION_THRESHOLDS.maximumLinkedDeathGapSeconds) break;
      if (anchorsLink(leftAnchor, rightAnchor)) union(parents, left, right);
    }
  }

  const groups = new Map<number, FightAnchorDeath[]>();
  for (let index = 0; index < anchors.length; index++) {
    const root = find(parents, index);
    const group = groups.get(root) ?? [];
    const anchor = anchors[index];
    if (anchor !== undefined) group.push(anchor);
    groups.set(root, group);
  }
  return [...groups.values()].sort((left, right) => compareAnchors(left[0], right[0]));
}

export function classifyFight(
  radiantParticipantCount: number,
  direParticipantCount: number,
): FightType | null {
  if (radiantParticipantCount === 0 || direParticipantCount === 0) return null;
  if (radiantParticipantCount >= 3 && direParticipantCount >= 3) return "team_fight";
  if (radiantParticipantCount === 1 || direParticipantCount === 1) return "pickoff";
  return "skirmish";
}

function normalizedRoster(roster: readonly FightRosterHero[]): FightParticipant[] {
  return roster.flatMap((hero): FightParticipant[] => {
    const combatLogName = hero.combatLogName ?? getHeroCombatLogName(hero.heroId);
    if (combatLogName === null || combatLogName.length === 0) return [];
    return [{ ...hero, combatLogName }];
  });
}

function makeRosterIndex(roster: readonly FightParticipant[]): RosterIndex {
  const byCombatLogName = new Map<string, FightParticipant[]>();
  const byGamePlayerId = new Map<number, FightParticipant[]>();
  for (const hero of roster) {
    addIndexValue(byCombatLogName, hero.combatLogName, hero);
    addIndexValue(byGamePlayerId, hero.gamePlayerId, hero);
  }
  return { byCombatLogName, byGamePlayerId };
}

function addIndexValue<Key>(
  index: Map<Key, FightParticipant[]>,
  key: Key,
  hero: FightParticipant,
): void {
  const values = index.get(key) ?? [];
  values.push(hero);
  index.set(key, values);
}

function uniqueMappedHero<Key>(
  index: Map<Key, FightParticipant[]>,
  key: Key | null | undefined,
): FightParticipant | null {
  if (key === null || key === undefined) return null;
  const matches = index.get(key);
  return matches?.length === 1 ? matches[0] ?? null : null;
}

function indexDeathPositions(
  positions: readonly FightDeathPosition[],
): Map<bigint, FightPoint> {
  const byDeath = new Map<bigint, FightPoint>();
  const ambiguous = new Set<bigint>();
  for (const position of positions) {
    if (!Number.isFinite(position.worldX) || !Number.isFinite(position.worldY)) continue;
    if (byDeath.has(position.deathSequence)) ambiguous.add(position.deathSequence);
    byDeath.set(position.deathSequence, { x: position.worldX, y: position.worldY });
  }
  for (const sequence of ambiguous) byDeath.delete(sequence);
  return byDeath;
}

function relevantDamageEvents(
  events: readonly FightCombatEvent[],
  index: RosterIndex,
  participantSlots: ReadonlySet<number>,
): RelevantDamage[] {
  return events.flatMap((event): RelevantDamage[] => {
    if (event.eventType !== DAMAGE_EVENT || !Number.isFinite(event.gameTimeSeconds)) return [];
    if (event.targetIllusion === true) return [];
    const target = uniqueMappedHero(index.byCombatLogName, event.targetName);
    const source = uniqueMappedHero(index.byCombatLogName, event.damageSourceName)
      ?? uniqueMappedHero(index.byCombatLogName, event.attackerName);
    if (target === null || source === null) return [];
    if (!participantSlots.has(target.playerSlot) || !participantSlots.has(source.playerSlot)) return [];
    if (target.playerSlot === source.playerSlot || target.teamId === source.teamId) return [];
    return [{
      gameTimeSeconds: event.gameTimeSeconds as number,
      sequence: event.sequence,
      location: eventPoint(event),
    }];
  }).sort((left, right) => (
    left.gameTimeSeconds - right.gameTimeSeconds
      || compareBigints(left.sequence, right.sequence)
  ));
}

function findCombatStart(firstDeathTime: number, damage: readonly RelevantDamage[]): number {
  const lowerBound = firstDeathTime - FIGHT_DETECTION_THRESHOLDS.maximumPreludeSeconds;
  const earlier = damage.filter((event) => (
    event.gameTimeSeconds >= lowerBound && event.gameTimeSeconds <= firstDeathTime
  ));
  let cursor = firstDeathTime;
  let start = firstDeathTime;
  for (let index = earlier.length - 1; index >= 0; index--) {
    const event = earlier[index];
    if (event === undefined) continue;
    if (cursor - event.gameTimeSeconds
      > FIGHT_DETECTION_THRESHOLDS.maximumCombatDamageIdleGapSeconds) break;
    start = event.gameTimeSeconds;
    cursor = event.gameTimeSeconds;
  }
  return start;
}

function findCombatEnd(lastDeathTime: number, damage: readonly RelevantDamage[]): number {
  const upperBound = lastDeathTime + FIGHT_DETECTION_THRESHOLDS.maximumCombatEndSeconds;
  const later = damage.filter((event) => (
    event.gameTimeSeconds >= lastDeathTime && event.gameTimeSeconds <= upperBound
  ));
  let cursor = lastDeathTime;
  let end = lastDeathTime;
  for (const event of later) {
    if (event.gameTimeSeconds - cursor
      > FIGHT_DETECTION_THRESHOLDS.maximumCombatDamageIdleGapSeconds) break;
    end = event.gameTimeSeconds;
    cursor = event.gameTimeSeconds;
  }
  return end;
}

function anchorsLink(left: FightAnchorDeath, right: FightAnchorDeath): boolean {
  if (right.gameTimeSeconds - left.gameTimeSeconds
    > FIGHT_DETECTION_THRESHOLDS.maximumLinkedDeathGapSeconds) return false;
  if (left.location !== null && right.location !== null) {
    return squaredDistance(left.location, right.location)
      <= FIGHT_DETECTION_THRESHOLDS.maximumLinkedDeathDistanceWorldUnits ** 2;
  }
  const leftSlots = new Set(left.activeParticipants.map((hero) => hero.playerSlot));
  return right.activeParticipants.some((hero) => leftSlots.has(hero.playerSlot));
}

function eventPoint(event: FightCombatEvent): FightPoint | null {
  return Number.isFinite(event.locationX) && Number.isFinite(event.locationY)
    ? { x: event.locationX as number, y: event.locationY as number }
    : null;
}

function uniqueParticipants(participants: readonly FightParticipant[]): FightParticipant[] {
  const byPlayerSlot = new Map<number, FightParticipant>();
  for (const participant of participants) {
    if (!byPlayerSlot.has(participant.playerSlot)) {
      byPlayerSlot.set(participant.playerSlot, participant);
    }
  }
  return [...byPlayerSlot.values()].sort((left, right) => left.playerSlot - right.playerSlot);
}

function enemyTeam(teamId: FightTeamId): FightTeamId {
  return teamId === 2 ? 3 : 2;
}

function squaredDistance(left: FightPoint, right: FightPoint): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function union(parents: number[], left: number, right: number): void {
  const leftRoot = find(parents, left);
  const rightRoot = find(parents, right);
  if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
}

function find(parents: number[], index: number): number {
  const parent = parents[index];
  if (parent === undefined || parent === index) return index;
  const root = find(parents, parent);
  parents[index] = root;
  return root;
}

function compareAnchors(
  left: FightAnchorDeath | undefined,
  right: FightAnchorDeath | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  return left.gameTimeSeconds - right.gameTimeSeconds
    || compareBigints(left.sequence, right.sequence);
}

function compareFights(left: DetectedFight, right: DetectedFight): number {
  return left.firstAnchorDeathTimeSeconds - right.firstAnchorDeathTimeSeconds
    || compareUnsignedDecimalStrings(left.fightId, right.fightId);
}

function compareBigints(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareUnsignedDecimalStrings(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

function unsignedSequenceString(sequence: bigint): string {
  if (sequence < 0n) throw new RangeError("Fight anchor sequence must be unsigned.");
  return sequence.toString();
}
