import type { DuckDBConnection } from "@duckdb/node-api";
import { z } from "zod";
import { getHeroCombatLogName } from "../lib/dota-heroes.js";
import { isValidMatchId, parseMatchId } from "../lib/match-id.js";
import {
  FIGHT_DETECTION_THRESHOLDS,
  detectFights,
  selectFightAnchorDeaths,
  type DetectedFight,
  type FightAnchorDeath,
  type FightCombatEvent,
  type FightDeathPosition,
  type FightParticipant,
  type FightPoint,
  type FightRosterHero,
  type FightTeamId,
  type FightType,
} from "./fight-detector.js";
import {
  deriveFightMapView,
  pointInBounds,
  type FightMapBounds,
  type FightMapView,
} from "./fight-map.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

const MAX_UBIGINT = 18_446_744_073_709_551_615n;

const fightIdSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, "Enter an unsigned decimal fight ID.")
  .refine((value) => BigInt(value) <= MAX_UBIGINT, "Fight ID is outside the DuckDB UBIGINT range.");

export const fightsListInputSchema = z.object({
  matchId: z.string().refine(isValidMatchId, "Enter a positive match ID in the DuckDB UBIGINT range."),
}).strict();

export const fightDetailInputSchema = z.object({
  matchId: z.string().refine(isValidMatchId, "Enter a positive match ID in the DuckDB UBIGINT range."),
  fightId: fightIdSchema,
}).strict();

export interface FightParticipantSummary {
  playerSlot: number;
  teamId: FightTeamId;
  heroId: number | null;
  kills: number;
  deaths: number;
  assists: number;
}

export interface FightTeamResult {
  teamId: FightTeamId;
  participantSlots: number[];
  kills: number;
  deaths: number;
  heroDamage: number | null;
  heroHealing: number | null;
  earnedGoldChange: string | null;
  experienceChange: string | null;
  netWorthChange: string | null;
}

export type FightObjectiveKind = "tower" | "barracks" | "roshan" | "tormentor";

export interface FightObjective {
  sequence: string;
  gameTimeSeconds: number;
  kind: FightObjectiveKind;
  label: string;
  teamId: FightTeamId | null;
}

export interface FightAvailability {
  combat: boolean;
  healing: boolean;
  earnedGold: boolean;
  experience: boolean;
  netWorth: boolean;
  winProbability: boolean;
  positions: boolean;
}

export interface FightListRecord {
  fightId: string;
  detectionVersion: string;
  type: FightType;
  firstAnchorTimeSeconds: number;
  anchorTimesSeconds: number[];
  combatStartSeconds: number;
  combatEndSeconds: number;
  durationSeconds: number;
  outcomeEndSeconds: number;
  location: FightPoint | null;
  locationAvailable: boolean;
  participants: FightParticipantSummary[];
  teams: [FightTeamResult, FightTeamResult];
  radiantWinProbabilityChange: number | null;
  winProbabilitySource: WinProbabilitySource | null;
  objectives: FightObjective[];
  availability: FightAvailability;
}

export interface MatchFights {
  matchId: string;
  available: boolean;
  fights: FightListRecord[];
}

export interface FightAnchorDeathDetail {
  sequence: string;
  gameTimeSeconds: number;
  victimSlot: number;
  killerSlot: number | null;
  assistSlots: number[];
  location: FightPoint | null;
}

export interface FightPlayerResult {
  playerSlot: number;
  teamId: FightTeamId;
  heroId: number | null;
  damageDealt: number | null;
  damageTaken: number | null;
  healing: number | null;
  earnedGoldChange: string | null;
  experienceChange: string | null;
}

export interface FightPosition {
  playerSlot: number;
  teamId: FightTeamId;
  heroId: number;
  worldX: number;
  worldY: number;
}

export interface FightPositionFrame {
  gameTimeMilliseconds: number;
  positions: FightPosition[];
}

export interface FightDeathMarker {
  playerSlot: number;
  gameTimeMilliseconds: number;
  worldX: number;
  worldY: number;
}

export type FightPositionState = "available" | "unavailable" | "empty";

export interface FightDetail extends FightListRecord {
  anchorDeaths: FightAnchorDeathDetail[];
  playerResults: FightPlayerResult[];
  combatCenter: FightPoint | null;
  mapBounds: FightMapBounds | null;
  frames: FightPositionFrame[];
  deathMarkers: FightDeathMarker[];
  positionState: FightPositionState;
}

export interface MatchFightDetail {
  matchId: string;
  fight: FightDetail | null;
}

type WinProbabilitySource = "graph_history" | "spectator_updates";

interface MatchFightState {
  extractionId: string;
  hasCombat: boolean;
  hasPositions: boolean;
}

interface StoredRosterPlayer {
  playerSlot: number;
  teamId: FightTeamId;
  heroId: number | null;
  gamePlayerId: number | null;
  combatLogName: string | null;
}

interface StoredCombatEvent extends FightCombatEvent {
  value: number | null;
  targetBuilding: boolean;
}

interface GoldEvent {
  playerSlot: number;
  gameTimeSeconds: number;
  totalGoldEarned: bigint;
}

interface TeamSeriesPoint {
  teamId: FightTeamId;
  sampleIndex: number;
  netWorth: number | null;
}

interface WinProbabilityPoint {
  gameTimeSeconds: number;
  radiantProbability: number;
  source: WinProbabilitySource;
}

interface FightMetricData {
  goldByPlayer: Map<number, GoldEvent[]>;
  teamSeries: TeamSeriesPoint[];
  winProbability: WinProbabilityPoint[];
}

interface NormalizedFight {
  detected: DetectedFight;
  outcomeEndTimeSeconds: number;
  mapView: FightMapView | null;
}

interface LoadedFightData {
  state: MatchFightState;
  events: StoredCombatEvent[];
  fights: NormalizedFight[];
  records: FightListRecord[];
  metricData: FightMetricData | null;
}

export async function getMatchFights(
  input: z.infer<typeof fightsListInputSchema>,
): Promise<MatchFights> {
  const { matchId: matchIdText } = fightsListInputSchema.parse(input);
  const matchId = parseMatchId(matchIdText);
  return withReadOnlyWarehouse(async (connection) => {
    const loaded = await loadFightData(connection, matchId);
    return {
      matchId: matchId.toString(),
      available: loaded.state.hasCombat,
      fights: loaded.records,
    };
  });
}

export async function getMatchFightDetail(
  input: z.infer<typeof fightDetailInputSchema>,
): Promise<MatchFightDetail> {
  const validated = fightDetailInputSchema.parse(input);
  const matchId = parseMatchId(validated.matchId);
  return withReadOnlyWarehouse(async (connection) => {
    const loaded = await loadFightData(connection, matchId);
    const index = loaded.fights.findIndex((fight) => fight.detected.fightId === validated.fightId);
    if (index < 0) return { matchId: matchId.toString(), fight: null };
    const selected = requiredAt(loaded.fights, index);
    const record = requiredAt(loaded.records, index);
    const position = await queryFightPositions(connection, loaded.state, selected);
    return {
      matchId: matchId.toString(),
      fight: {
        ...record,
        anchorDeaths: selected.detected.anchorDeaths.map(anchorDetail),
        playerResults: playerResults(record, selected, loaded.events, loaded.metricData),
        combatCenter: selected.mapView?.center ?? null,
        mapBounds: selected.mapView?.bounds ?? null,
        frames: position.frames,
        deathMarkers: position.deathMarkers,
        positionState: position.state,
      },
    };
  });
}

async function loadFightData(connection: DuckDBConnection, matchId: bigint): Promise<LoadedFightData> {
  const state = await queryMatchState(connection, matchId);
  if (!state.hasCombat) {
    return { state, events: [], fights: [], records: [], metricData: null };
  }

  const roster = await queryRoster(connection, state.extractionId);
  const detectorRoster = roster.flatMap((player): FightRosterHero[] => {
    if (player.heroId === null || player.combatLogName === null) return [];
    return [{
      playerSlot: player.playerSlot,
      teamId: player.teamId,
      heroId: player.heroId,
      gamePlayerId: player.gamePlayerId ?? -1_000 - player.playerSlot,
      combatLogName: player.combatLogName,
    }];
  });
  const events = await queryCombatEvents(connection, state.extractionId);
  const anchorsWithoutPositions = selectFightAnchorDeaths(events, detectorRoster);
  const deathPositions = state.hasPositions
    ? await queryVictimPositions(connection, state.extractionId, anchorsWithoutPositions)
    : [];
  const detected = detectFights({ roster: detectorRoster, combatEvents: events, deathPositions });
  const fights = clipOutcomesAndMap(detected);
  if (fights.length === 0) {
    return { state, events, fights, records: [], metricData: null };
  }

  const metricData = await queryMetricData(connection, state.extractionId);
  const records = fights.map((fight) => buildListRecord(fight, state, events, metricData));
  return { state, events, fights, records, metricData };
}

async function queryMatchState(connection: DuckDBConnection, matchId: bigint): Promise<MatchFightState> {
  const result = await connection.runAndReadAll(MATCH_STATE_SQL, { matchId });
  const row = result.getRowObjectsJson()[0];
  if (row === undefined) throw new Error(`Match ${matchId} does not have a successful extraction.`);
  return {
    extractionId: requiredString(row.extraction_id, "fight extraction ID"),
    hasCombat: requiredBoolean(row.has_combat, "combat availability"),
    hasPositions: requiredBoolean(row.has_positions, "position availability"),
  };
}

async function queryRoster(
  connection: DuckDBConnection,
  extractionId: string,
): Promise<StoredRosterPlayer[]> {
  const result = await connection.runAndReadAll(ROSTER_SQL, { extractionId });
  return result.getRowObjectsJson().map((row) => {
    const heroId = nullableInteger(row.hero_id, "fight hero ID");
    return {
      playerSlot: requiredInteger(row.player_slot, "fight player slot"),
      teamId: teamId(row.team_id, "fight player team"),
      heroId,
      gamePlayerId: nullableInteger(row.game_player_id, "fight game-player ID"),
      combatLogName: getHeroCombatLogName(heroId),
    };
  });
}

async function queryCombatEvents(
  connection: DuckDBConnection,
  extractionId: string,
): Promise<StoredCombatEvent[]> {
  const result = await connection.runAndReadAll(COMBAT_EVENTS_SQL, { extractionId });
  return result.getRowObjectsJson().map((row) => ({
    sequence: BigInt(requiredString(row.event_sequence, "fight event sequence")),
    eventType: requiredString(row.event_type, "fight event type"),
    gameTimeSeconds: nullableFiniteNumber(row.game_time_seconds, "fight game time"),
    targetName: nullableString(row.target_name, "fight target name"),
    attackerName: nullableString(row.attacker_name, "fight attacker name"),
    damageSourceName: nullableString(row.damage_source_name, "fight damage source"),
    targetTeam: nullableInteger(row.target_team, "fight target team"),
    attackerTeam: nullableInteger(row.attacker_team, "fight attacker team"),
    assistPlayers: integerArray(row.assist_players, "fight assist players"),
    targetIllusion: nullableBoolean(row.target_illusion, "fight target illusion"),
    attackerIllusion: nullableBoolean(row.attacker_illusion, "fight attacker illusion"),
    locationX: nullableFiniteNumber(row.location_x, "fight location X"),
    locationY: nullableFiniteNumber(row.location_y, "fight location Y"),
    value: nullableInteger(row.value, "fight event value"),
    targetBuilding: row.target_building === true,
  }));
}

async function queryVictimPositions(
  connection: DuckDBConnection,
  extractionId: string,
  anchors: readonly FightAnchorDeath[],
): Promise<FightDeathPosition[]> {
  const requests = anchors.filter((anchor) => anchor.location === null && anchor.gameTimeSeconds >= 0);
  if (requests.length === 0) return [];
  const values = requests.map((anchor) => {
    const time = Math.floor(anchor.gameTimeSeconds * 10) * 100;
    return `(${anchor.sequence}::UBIGINT, ${anchor.victim.playerSlot}::UINTEGER, ${time}::BIGINT)`;
  }).join(",\n");
  const result = await connection.runAndReadAll(`
    WITH requested(death_sequence, player_slot, death_time_ms) AS (VALUES ${values})
    SELECT
      requested.death_sequence::VARCHAR AS death_sequence,
      position.world_x,
      position.world_y
    FROM requested
    JOIN LATERAL (
      SELECT sample.game_time_milliseconds, sample.world_x, sample.world_y
      FROM analysis.hero_position_samples AS sample
      WHERE sample.extraction_id = $extractionId
        AND sample.player_slot = requested.player_slot
        AND sample.game_time_milliseconds <= requested.death_time_ms
      ORDER BY sample.game_time_milliseconds DESC
      LIMIT 1
    ) AS position ON true
    ORDER BY requested.death_sequence`, { extractionId });
  return result.getRowObjectsJson().map((row) => ({
    deathSequence: BigInt(requiredString(row.death_sequence, "victim death sequence")),
    worldX: requiredFiniteNumber(row.world_x, "victim position X"),
    worldY: requiredFiniteNumber(row.world_y, "victim position Y"),
  }));
}

function clipOutcomesAndMap(detected: readonly DetectedFight[]): NormalizedFight[] {
  const views = detected.map((fight) => deriveFightMapView(fight.combatPoints));
  return detected.map((fight, index) => {
    let outcomeEndTimeSeconds = fight.outcomeEndTimeSeconds;
    const view = views[index] ?? null;
    for (let nextIndex = index + 1; nextIndex < detected.length; nextIndex++) {
      const next = detected[nextIndex];
      const nextView = views[nextIndex] ?? null;
      if (next === undefined || view === null || nextView === null) continue;
      if (distance(view.center, nextView.center)
        <= FIGHT_DETECTION_THRESHOLDS.localMapRadiusWorldUnits) {
        outcomeEndTimeSeconds = Math.max(
          fight.combatEndTimeSeconds,
          Math.min(outcomeEndTimeSeconds, next.combatStartTimeSeconds),
        );
        break;
      }
    }
    return { detected: fight, outcomeEndTimeSeconds, mapView: view };
  });
}

async function queryMetricData(
  connection: DuckDBConnection,
  extractionId: string,
): Promise<FightMetricData> {
  const goldResult = await connection.runAndReadAll(GOLD_EVENTS_SQL, { extractionId });
  const teamResult = await connection.runAndReadAll(TEAM_SERIES_SQL, { extractionId });
  const probabilityResult = await connection.runAndReadAll(WIN_PROBABILITY_SQL, { extractionId });
  const goldByPlayer = new Map<number, GoldEvent[]>();
  for (const row of goldResult.getRowObjectsJson()) {
    const event = {
      playerSlot: requiredInteger(row.player_slot, "fight gold player slot"),
      gameTimeSeconds: requiredFiniteNumber(row.game_time_seconds, "fight gold time"),
      totalGoldEarned: BigInt(requiredString(row.total_gold_earned, "fight earned gold")),
    };
    const values = goldByPlayer.get(event.playerSlot) ?? [];
    values.push(event);
    goldByPlayer.set(event.playerSlot, values);
  }
  return {
    goldByPlayer,
    teamSeries: teamResult.getRowObjectsJson().map((row) => ({
      teamId: teamId(row.team_id, "fight graph team"),
      sampleIndex: requiredInteger(row.sample_index, "fight graph sample"),
      netWorth: nullableFiniteNumber(row.net_worth, "fight net worth"),
    })),
    winProbability: probabilityResult.getRowObjectsJson().map((row) => ({
      gameTimeSeconds: requiredFiniteNumber(row.game_time_seconds, "fight probability time"),
      radiantProbability: requiredFiniteNumber(row.radiant_probability, "fight probability"),
      source: probabilitySource(row.source),
    })),
  };
}

function buildListRecord(
  fight: NormalizedFight,
  state: MatchFightState,
  events: readonly StoredCombatEvent[],
  metricData: FightMetricData,
): FightListRecord {
  const detected = fight.detected;
  const participants = [...detected.radiantParticipants, ...detected.direParticipants]
    .sort((left, right) => left.playerSlot - right.playerSlot);
  const indexedRoster = rosterIndexes(participants);
  const intervalEvents = events.filter((event) => event.gameTimeSeconds !== null
    && event.gameTimeSeconds >= detected.combatStartTimeSeconds
    && event.gameTimeSeconds <= detected.combatEndTimeSeconds);
  const resultsByPlayer = aggregatePlayerMetrics(participants, intervalEvents, indexedRoster);
  const goldChanges = new Map(participants.map((player) => [
    player.playerSlot,
    boundaryGoldChange(metricData.goldByPlayer.get(player.playerSlot) ?? [],
      detected.combatStartTimeSeconds, detected.combatEndTimeSeconds),
  ]));
  const teamResults = ([2, 3] as const).map((selectedTeam) => {
    const teamPlayers = participants.filter((player) => player.teamId === selectedTeam);
    const teamGold = sumAvailableBigints(teamPlayers.map((player) => goldChanges.get(player.playerSlot) ?? null));
    const teamExperience = sumAvailableBigints(teamPlayers.map((player) => (
      resultsByPlayer.get(player.playerSlot)?.experience ?? null
    )));
    return {
      teamId: selectedTeam,
      participantSlots: teamPlayers.map((player) => player.playerSlot),
      kills: detected.anchorDeaths.filter((death) => death.victim.teamId !== selectedTeam).length,
      deaths: detected.anchorDeaths.filter((death) => death.victim.teamId === selectedTeam).length,
      heroDamage: sumPlayerNumbers(teamPlayers, resultsByPlayer, "damageDealt"),
      heroHealing: sumPlayerNumbers(teamPlayers, resultsByPlayer, "healing"),
      earnedGoldChange: teamGold?.toString() ?? null,
      experienceChange: teamExperience?.toString() ?? null,
      netWorthChange: netWorthChange(metricData.teamSeries, selectedTeam,
        detected.combatStartTimeSeconds, detected.combatEndTimeSeconds),
    } satisfies FightTeamResult;
  }) as [FightTeamResult, FightTeamResult];
  const probability = probabilityChange(metricData.winProbability,
    detected.combatStartTimeSeconds, detected.combatEndTimeSeconds);
  const experienceAvailable = events.some((event) => event.eventType === "DOTA_COMBATLOG_XP");
  const availability: FightAvailability = {
    combat: true,
    healing: true,
    earnedGold: metricData.goldByPlayer.size > 0,
    experience: experienceAvailable,
    netWorth: metricData.teamSeries.some((point) => point.netWorth !== null),
    winProbability: probability !== null,
    positions: state.hasPositions,
  };
  if (!availability.earnedGold) {
    for (const team of teamResults) team.earnedGoldChange = null;
  }
  if (!availability.experience) {
    for (const team of teamResults) team.experienceChange = null;
  }

  return {
    fightId: detected.fightId,
    detectionVersion: detected.detectionVersion,
    type: detected.type,
    firstAnchorTimeSeconds: detected.firstAnchorDeathTimeSeconds,
    anchorTimesSeconds: detected.anchorDeaths.map((anchor) => anchor.gameTimeSeconds),
    combatStartSeconds: detected.combatStartTimeSeconds,
    combatEndSeconds: detected.combatEndTimeSeconds,
    durationSeconds: detected.durationSeconds,
    outcomeEndSeconds: fight.outcomeEndTimeSeconds,
    location: fight.mapView?.center ?? null,
    locationAvailable: fight.mapView !== null,
    participants: participants.map((player) => participantSummary(player, detected.anchorDeaths)),
    teams: teamResults,
    radiantWinProbabilityChange: probability?.change ?? null,
    winProbabilitySource: probability?.source ?? null,
    objectives: findObjectives(events, detected.combatStartTimeSeconds, fight.outcomeEndTimeSeconds),
    availability,
  };
}

function participantSummary(
  player: FightParticipant,
  deaths: readonly FightAnchorDeath[],
): FightParticipantSummary {
  return {
    playerSlot: player.playerSlot,
    teamId: player.teamId,
    heroId: player.heroId,
    kills: deaths.filter((death) => death.killer?.playerSlot === player.playerSlot).length,
    deaths: deaths.filter((death) => death.victim.playerSlot === player.playerSlot).length,
    assists: deaths.filter((death) => death.assists.some(
      (assist) => assist.playerSlot === player.playerSlot,
    )).length,
  };
}

interface PlayerAggregate {
  damageDealt: number;
  damageTaken: number;
  healing: number;
  experience: bigint;
}

function aggregatePlayerMetrics(
  participants: readonly FightParticipant[],
  events: readonly StoredCombatEvent[],
  indexes: ReturnType<typeof rosterIndexes>,
): Map<number, PlayerAggregate> {
  const active = new Set(participants.map((player) => player.playerSlot));
  const result = new Map(participants.map((player) => [player.playerSlot, {
    damageDealt: 0, damageTaken: 0, healing: 0, experience: 0n,
  }]));
  for (const event of events) {
    const value = event.value;
    if (value === null || value <= 0) continue;
    const target = uniqueHero(indexes.byName, event.targetName);
    if (event.eventType === "DOTA_COMBATLOG_XP") {
      if (target !== null && active.has(target.playerSlot)) {
        const targetResult = result.get(target.playerSlot);
        if (targetResult !== undefined) targetResult.experience += BigInt(value);
      }
      continue;
    }
    const source = uniqueHero(indexes.byName, event.damageSourceName)
      ?? uniqueHero(indexes.byName, event.attackerName);
    if (source === null || !active.has(source.playerSlot)) continue;
    const sourceResult = result.get(source.playerSlot);
    if (sourceResult === undefined) continue;
    if (event.eventType === "DOTA_COMBATLOG_DAMAGE") {
      if (event.targetIllusion === true || target === null || !active.has(target.playerSlot)
        || target.teamId === source.teamId || target.playerSlot === source.playerSlot) continue;
      sourceResult.damageDealt += value;
      const targetResult = result.get(target.playerSlot);
      if (targetResult !== undefined) targetResult.damageTaken += value;
    } else if (event.eventType === "DOTA_COMBATLOG_HEAL") {
      sourceResult.healing += value;
    }
  }
  return result;
}

function playerResults(
  record: FightListRecord,
  fight: NormalizedFight,
  events: readonly StoredCombatEvent[],
  metricData: FightMetricData | null,
): FightPlayerResult[] {
  const participants = [...fight.detected.radiantParticipants, ...fight.detected.direParticipants]
    .sort((left, right) => left.playerSlot - right.playerSlot);
  const intervalEvents = events.filter((event) => event.gameTimeSeconds !== null
    && event.gameTimeSeconds >= fight.detected.combatStartTimeSeconds
    && event.gameTimeSeconds <= fight.detected.combatEndTimeSeconds);
  const aggregates = aggregatePlayerMetrics(participants, intervalEvents, rosterIndexes(participants));
  return participants.map((player) => {
    const aggregate = aggregates.get(player.playerSlot);
    const earnedGold = metricData === null ? null : boundaryGoldChange(
      metricData.goldByPlayer.get(player.playerSlot) ?? [],
      fight.detected.combatStartTimeSeconds,
      fight.detected.combatEndTimeSeconds,
    );
    return {
      playerSlot: player.playerSlot,
      teamId: player.teamId,
      heroId: player.heroId,
      damageDealt: aggregate?.damageDealt ?? null,
      damageTaken: aggregate?.damageTaken ?? null,
      healing: aggregate?.healing ?? null,
      earnedGoldChange: record.availability.earnedGold ? earnedGold?.toString() ?? null : null,
      experienceChange: record.availability.experience
        ? (aggregate?.experience ?? 0n).toString()
        : null,
    };
  });
}

function findObjectives(
  events: readonly StoredCombatEvent[],
  startSeconds: number,
  endSeconds: number,
): FightObjective[] {
  return events.flatMap((event): FightObjective[] => {
    if (event.eventType !== "DOTA_COMBATLOG_DEATH" || event.gameTimeSeconds === null
      || event.gameTimeSeconds < startSeconds || event.gameTimeSeconds > endSeconds
      || event.targetIllusion === true) return [];
    const target = event.targetName?.toLowerCase() ?? "";
    let kind: FightObjectiveKind | null = null;
    if (target.includes("roshan")) kind = "roshan";
    else if (target.includes("miniboss") || target.includes("tormentor")) kind = "tormentor";
    else if (event.targetBuilding && (target.includes("rax") || target.includes("barracks"))) kind = "barracks";
    else if (event.targetBuilding && target.includes("tower")) kind = "tower";
    if (kind === null) return [];
    return [{
      sequence: event.sequence.toString(),
      gameTimeSeconds: event.gameTimeSeconds,
      kind,
      label: objectiveLabel(kind),
      teamId: event.targetTeam === 2 || event.targetTeam === 3 ? event.targetTeam : null,
    }];
  }).sort((left, right) => left.gameTimeSeconds - right.gameTimeSeconds
    || compareDecimalIds(left.sequence, right.sequence));
}

async function queryFightPositions(
  connection: DuckDBConnection,
  state: MatchFightState,
  fight: NormalizedFight,
): Promise<{ state: FightPositionState; frames: FightPositionFrame[]; deathMarkers: FightDeathMarker[] }> {
  if (!state.hasPositions) return { state: "unavailable", frames: [], deathMarkers: [] };
  const startMilliseconds = Math.max(0, Math.ceil(fight.detected.combatStartTimeSeconds * 10) * 100);
  const endMilliseconds = Math.max(0, Math.floor(fight.detected.combatEndTimeSeconds * 10) * 100);
  const participantSlots = [
    ...fight.detected.radiantParticipants,
    ...fight.detected.direParticipants,
  ].map((player) => player.playerSlot);
  if (startMilliseconds > endMilliseconds || participantSlots.length === 0) {
    return { state: "empty", frames: [], deathMarkers: [] };
  }
  const slotSql = participantSlots.map((slot) => `${slot}::UINTEGER`).join(", ");
  const result = await connection.runAndReadAll(`
    SELECT game_time_milliseconds, player_slot, team_id, hero_id, world_x, world_y
    FROM analysis.hero_position_samples
    WHERE extraction_id = $extractionId
      AND game_time_milliseconds BETWEEN $startMilliseconds AND $endMilliseconds
      AND player_slot IN (${slotSql})
    ORDER BY game_time_milliseconds, player_slot`, {
    extractionId: state.extractionId,
    startMilliseconds,
    endMilliseconds,
  });
  const framesByTime = new Map<number, FightPosition[]>();
  for (const row of result.getRowObjectsJson()) {
    const gameTimeMilliseconds = requiredInteger(row.game_time_milliseconds, "fight frame time");
    const positions = framesByTime.get(gameTimeMilliseconds) ?? [];
    positions.push({
      playerSlot: requiredInteger(row.player_slot, "fight frame player"),
      teamId: teamId(row.team_id, "fight frame team"),
      heroId: requiredInteger(row.hero_id, "fight frame hero"),
      worldX: requiredFiniteNumber(row.world_x, "fight frame X"),
      worldY: requiredFiniteNumber(row.world_y, "fight frame Y"),
    });
    framesByTime.set(gameTimeMilliseconds, positions);
  }
  const frames = [...framesByTime].map(([gameTimeMilliseconds, positions]) => ({
    gameTimeMilliseconds,
    positions,
  }));
  const bounds = fight.mapView?.bounds ?? null;
  const deathMarkers = fight.detected.anchorDeaths.flatMap((anchor): FightDeathMarker[] => {
    if (anchor.location === null || (bounds !== null && !pointInBounds(anchor.location, bounds))) return [];
    return [{
      playerSlot: anchor.victim.playerSlot,
      gameTimeMilliseconds: Math.floor(anchor.gameTimeSeconds * 10) * 100,
      worldX: anchor.location.x,
      worldY: anchor.location.y,
    }];
  });
  return { state: frames.length === 0 ? "empty" : "available", frames, deathMarkers };
}

function anchorDetail(anchor: FightAnchorDeath): FightAnchorDeathDetail {
  return {
    sequence: anchor.sequence.toString(),
    gameTimeSeconds: anchor.gameTimeSeconds,
    victimSlot: anchor.victim.playerSlot,
    killerSlot: anchor.killer?.playerSlot ?? null,
    assistSlots: anchor.assists.map((assist) => assist.playerSlot),
    location: anchor.location,
  };
}

function rosterIndexes(players: readonly FightParticipant[]) {
  const byName = new Map<string, FightParticipant[]>();
  for (const player of players) {
    const values = byName.get(player.combatLogName) ?? [];
    values.push(player);
    byName.set(player.combatLogName, values);
  }
  return { byName };
}

function uniqueHero(
  index: Map<string, FightParticipant[]>,
  name: string | null | undefined,
): FightParticipant | null {
  if (name === null || name === undefined) return null;
  const matches = index.get(name);
  return matches?.length === 1 ? matches[0] ?? null : null;
}

function boundaryGoldChange(events: readonly GoldEvent[], start: number, end: number): bigint | null {
  const startEvent = valueAtOrBefore(events, start);
  const endEvent = valueAtOrBefore(events, end);
  return startEvent === null || endEvent === null ? null : endEvent.totalGoldEarned - startEvent.totalGoldEarned;
}

function valueAtOrBefore(events: readonly GoldEvent[], time: number): GoldEvent | null {
  let selected: GoldEvent | null = null;
  for (const event of events) {
    if (event.gameTimeSeconds > time) break;
    selected = event;
  }
  return selected;
}

function netWorthChange(
  points: readonly TeamSeriesPoint[],
  selectedTeam: FightTeamId,
  start: number,
  end: number,
): string | null {
  const teamPoints = points.filter((point) => point.teamId === selectedTeam && point.netWorth !== null);
  const startPoint = graphValueAtOrBefore(teamPoints, start);
  const endPoint = graphValueAtOrBefore(teamPoints, end);
  if (startPoint?.netWorth === null || startPoint === null || endPoint?.netWorth === null || endPoint === null) return null;
  return Math.round(endPoint.netWorth - startPoint.netWorth).toString();
}

function graphValueAtOrBefore(points: readonly TeamSeriesPoint[], time: number): TeamSeriesPoint | null {
  const sample = Math.max(0, Math.floor(time / 60));
  let selected: TeamSeriesPoint | null = null;
  for (const point of points) {
    if (point.sampleIndex > sample) break;
    selected = point;
  }
  return selected;
}

function probabilityChange(
  points: readonly WinProbabilityPoint[],
  start: number,
  end: number,
): { change: number; source: WinProbabilitySource } | null {
  const startPoint = probabilityAtOrBefore(points, start);
  const endPoint = probabilityAtOrBefore(points, end);
  if (startPoint === null || endPoint === null || startPoint.source !== endPoint.source) return null;
  return { change: endPoint.radiantProbability - startPoint.radiantProbability, source: endPoint.source };
}

function probabilityAtOrBefore(
  points: readonly WinProbabilityPoint[],
  time: number,
): WinProbabilityPoint | null {
  let selected: WinProbabilityPoint | null = null;
  for (const point of points) {
    if (point.gameTimeSeconds > time) break;
    selected = point;
  }
  return selected;
}

function sumAvailableBigints(values: readonly (bigint | null)[]): bigint | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
}

function sumPlayerNumbers(
  players: readonly FightParticipant[],
  results: Map<number, PlayerAggregate>,
  key: "damageDealt" | "healing",
): number {
  return players.reduce((sum, player) => sum + (results.get(player.playerSlot)?.[key] ?? 0), 0);
}

function objectiveLabel(kind: FightObjectiveKind): string {
  if (kind === "roshan") return "Roshan";
  if (kind === "tormentor") return "Tormentor";
  if (kind === "barracks") return "Barracks";
  return "Tower";
}

function probabilitySource(value: JsonValue | undefined): WinProbabilitySource {
  if (value === "graph_history" || value === "spectator_updates") return value;
  throw new Error("Unexpected fight win-probability source");
}

function distance(left: FightPoint, right: FightPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function compareDecimalIds(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError("Fight result index is out of range.");
  return value;
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

function requiredFiniteNumber(value: JsonValue | undefined, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Unexpected ${label}`);
  return parsed;
}

function nullableFiniteNumber(value: JsonValue | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  return requiredFiniteNumber(value, label);
}

function requiredInteger(value: JsonValue | undefined, label: string): number {
  const parsed = requiredFiniteNumber(value, label);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Unexpected ${label}`);
  return parsed;
}

function nullableInteger(value: JsonValue | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  return requiredInteger(value, label);
}

function teamId(value: JsonValue | undefined, label: string): FightTeamId {
  const parsed = requiredInteger(value, label);
  if (parsed !== 2 && parsed !== 3) throw new Error(`Unexpected ${label}`);
  return parsed;
}

function requiredBoolean(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Unexpected ${label}`);
  return value;
}

function nullableBoolean(value: JsonValue | undefined, label: string): boolean | null {
  if (value === null || value === undefined) return null;
  return requiredBoolean(value, label);
}

function integerArray(value: JsonValue | undefined, label: string): number[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Unexpected ${label}`);
  return value.map((entry) => requiredInteger(entry, label));
}

const MATCH_STATE_SQL = `
SELECT
  latest.extraction_id,
  (
    EXISTS (
      SELECT 1 FROM raw.combat_events AS start_marker
      WHERE start_marker.extraction_id = latest.extraction_id
        AND start_marker.event_type = 'DOTA_COMBATLOG_GAME_STATE'
        AND start_marker.value = 4
    )
    AND EXISTS (
      SELECT 1 FROM raw.combat_events AS stop_marker
      WHERE stop_marker.extraction_id = latest.extraction_id
        AND stop_marker.event_type = 'DOTA_COMBATLOG_GAME_STATE'
        AND stop_marker.value = 6
    )
  ) AS has_combat,
  EXISTS (
    SELECT 1 FROM analysis.hero_position_samples AS sample
    WHERE sample.extraction_id = latest.extraction_id
  ) AS has_positions
FROM analysis.latest_successful_extractions AS latest
WHERE latest.match_id = $matchId`;

const ROSTER_SQL = `
WITH metadata_candidates AS MATERIALIZED (
  SELECT
    try_cast(json_extract_string(player.value, '$.game_player_id') AS INTEGER) AS game_player_id,
    try_cast(json_extract_string(player.value, '$.player_slot') AS UINTEGER) AS player_slot,
    try_cast(json_extract_string(team.value, '$.dota_team') AS INTEGER) AS team_id
  FROM raw.records AS metadata,
       json_each(metadata.payload, '$.metadata.teams') AS team,
       json_each(team.value, '$.players') AS player
  WHERE metadata.extraction_id = $extractionId
    AND metadata.record_type = 'CDOTAMatchMetadataFile'
),
unique_game_players AS (
  SELECT game_player_id, min(player_slot) AS player_slot, min(team_id) AS team_id
  FROM metadata_candidates
  WHERE game_player_id BETWEEN 0 AND 9 AND player_slot IS NOT NULL AND team_id IN (2, 3)
  GROUP BY game_player_id
  HAVING count(*) = 1
),
unique_slots AS (
  SELECT player_slot, min(game_player_id) AS game_player_id, min(team_id) AS team_id
  FROM metadata_candidates
  WHERE game_player_id BETWEEN 0 AND 9 AND player_slot IS NOT NULL AND team_id IN (2, 3)
  GROUP BY player_slot
  HAVING count(*) = 1
),
metadata_players AS (
  SELECT game.game_player_id, game.player_slot, game.team_id
  FROM unique_game_players AS game
  JOIN unique_slots AS slot USING (game_player_id, player_slot, team_id)
)
SELECT player.player_slot, player.team_id, player.hero_id, metadata.game_player_id
FROM analysis.players AS player
LEFT JOIN metadata_players AS metadata
  ON metadata.player_slot = player.player_slot AND metadata.team_id = player.team_id
WHERE player.extraction_id = $extractionId
  AND player.team_id IN (2, 3)
ORDER BY player.team_id, player.team_slot, player.player_slot`;

const COMBAT_EVENTS_SQL = `
WITH start_marker AS MATERIALIZED (
  SELECT min(sequence) AS start_sequence
  FROM raw.combat_events
  WHERE extraction_id = $extractionId
    AND event_type = 'DOTA_COMBATLOG_GAME_STATE' AND value = 4
),
actual_game AS MATERIALIZED (
  SELECT
    start_marker.start_sequence,
    min(marker.sequence) AS stop_sequence
  FROM start_marker
  JOIN raw.combat_events AS marker
    ON marker.extraction_id = $extractionId
   AND marker.event_type = 'DOTA_COMBATLOG_GAME_STATE'
   AND marker.value = 6
   AND marker.sequence > start_marker.start_sequence
  GROUP BY start_marker.start_sequence
),
clock AS MATERIALIZED (
  SELECT coalesce(
    min(marker.game_time) FILTER (WHERE marker.value = 5),
    min(marker.game_time) FILTER (WHERE marker.value = 4),
    0
  ) AS zero_time
  FROM raw.combat_events AS marker
  CROSS JOIN actual_game
  WHERE marker.extraction_id = $extractionId
    AND marker.event_type = 'DOTA_COMBATLOG_GAME_STATE'
    AND marker.sequence >= actual_game.start_sequence
    AND marker.sequence < actual_game.stop_sequence
)
SELECT
  event.sequence::VARCHAR AS event_sequence,
  event.event_type,
  event.game_time - clock.zero_time AS game_time_seconds,
  event.target_name,
  event.attacker_name,
  event.damage_source_name,
  event.target_team,
  event.attacker_team,
  event.assist_players,
  event.target_illusion,
  event.attacker_illusion,
  event.location_x,
  event.location_y,
  event.value,
  coalesce(event.target_building, false) AS target_building
FROM raw.combat_events AS event
CROSS JOIN clock
CROSS JOIN actual_game
WHERE event.extraction_id = $extractionId
  AND event.event_type IN (
    'DOTA_COMBATLOG_DEATH',
    'DOTA_COMBATLOG_DAMAGE',
    'DOTA_COMBATLOG_HEAL',
    'DOTA_COMBATLOG_XP'
  )
  -- These are the exact sequence bounds used by analysis.is_actual_game. Resolve
  -- them once rather than invoking the macro for every combat-log row.
  AND event.sequence >= actual_game.start_sequence
  AND event.sequence < actual_game.stop_sequence
ORDER BY event.game_time, event.sequence`;

const GOLD_EVENTS_SQL = `
SELECT player_slot, game_time_seconds, total_gold_earned::VARCHAR AS total_gold_earned
FROM analysis.player_gold_events
WHERE extraction_id = $extractionId
ORDER BY player_slot, game_time_seconds, sequence`;

const TEAM_SERIES_SQL = `
SELECT team_id, sample_index, net_worth
FROM analysis.team_time_series
WHERE extraction_id = $extractionId
  AND team_id IN (2, 3)
ORDER BY team_id, sample_index`;

const WIN_PROBABILITY_SQL = `
SELECT game_time_seconds, radiant_probability, source
FROM analysis.win_probability_samples
WHERE extraction_id = $extractionId
ORDER BY game_time_seconds, sample_index`;
