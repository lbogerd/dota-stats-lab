import type { DuckDBConnection } from "@duckdb/node-api";
import { parseMatchId } from "../lib/match-id.js";
import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

export interface MatchListItem {
  matchId: string;
  status: string;
  startTime: string | null;
  durationSeconds: number | null;
  winnerTeam: string | null;
  radiantScore: number | null;
  direScore: number | null;
  radiantTeamName: string | null;
  direTeamName: string | null;
}

export interface MatchOverviewSummary {
  matchId: string;
  extractionId: string | null;
  startTime: string | null;
  durationSeconds: number | null;
  gameMode: string | null;
  lobbyType: number | null;
  lobbyTypeName: string | null;
  winnerTeamId: number | null;
  winnerTeam: string | null;
  radiantScore: number | null;
  direScore: number | null;
  radiantTeamName: string | null;
  direTeamName: string | null;
  cluster: number | null;
  firstBloodSeconds: number | null;
}

export interface MatchOverviewItem {
  itemSlot: number;
  itemId: number | null;
}

export interface MatchOverviewPlayer {
  playerSlot: number;
  teamId: number;
  team: string;
  teamSlot: number | null;
  accountId: string | null;
  playerName: string | null;
  heroId: number | null;
  level: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  lastHits: number | null;
  denies: number | null;
  goldPerMin: number | null;
  xpPerMin: number | null;
  netWorth: number | null;
  heroDamage: number | null;
  towerDamage: number | null;
  heroHealing: number | null;
  items: MatchOverviewItem[];
}

export interface MatchOverviewTeamTotals {
  teamId: number;
  team: string;
  players: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  lastHits: number | null;
  denies: number | null;
  netWorth: string | null;
  heroDamage: string | null;
  towerDamage: string | null;
  heroHealing: string | null;
}

export interface MatchNetWorthAnalysis {
  radiantNetWorth: string | null;
  direNetWorth: string | null;
  advantage: string | null;
  leader: string | null;
}

export interface MatchOverview {
  matchId: string;
  status: string;
  summary: MatchOverviewSummary;
  players: MatchOverviewPlayer[];
  teamTotals: MatchOverviewTeamTotals[];
  netWorthAnalysis: MatchNetWorthAnalysis;
}

export async function listMatchOverviews(): Promise<MatchListItem[]> {
  return withReadOnlyWarehouse(async (connection) => {
    const result = await connection.runAndReadAll(LIST_MATCHES_SQL);
    return result.getRowObjectsJson().map((row) => ({
      matchId: stringValue(row.match_id),
      status: stringValue(row.status),
      startTime: nullableString(row.start_time),
      durationSeconds: nullableNumber(row.duration_seconds),
      winnerTeam: nullableString(row.winner_team),
      radiantScore: nullableNumber(row.radiant_score),
      direScore: nullableNumber(row.dire_score),
      radiantTeamName: nullableString(row.radiant_team_name),
      direTeamName: nullableString(row.dire_team_name),
    }));
  });
}

export async function getMatchOverview(matchId: string): Promise<MatchOverview | null> {
  const parsedMatchId = parseMatchId(matchId);
  return withReadOnlyWarehouse(async (connection) => {
    const presenceResult = await connection.runAndReadAll(PRESENCE_SQL, { matchId: parsedMatchId });
    const presence = presenceResult.getRowObjectsJson()[0];
    if (presence === undefined || presence.present !== true) return null;

    const summary = await querySummary(connection, parsedMatchId);
    const players = await queryPlayers(connection, parsedMatchId);
    const items = await queryItems(connection, parsedMatchId);
    const teamTotals = await queryTeamTotals(connection, parsedMatchId);
    const netWorthAnalysis = await queryNetWorthAnalysis(connection, parsedMatchId);

    const status = summary?.extractionId === null || summary === null ? stringValue(presence.status) : "succeeded";
    const playerItems = new Map<number, MatchOverviewItem[]>();
    for (const item of items) {
      const collection = playerItems.get(item.playerSlot) ?? [];
      collection.push({ itemSlot: item.itemSlot, itemId: item.itemId });
      playerItems.set(item.playerSlot, collection);
    }

    return {
      matchId: parsedMatchId.toString(),
      status,
      summary: summary ?? emptySummary(parsedMatchId.toString()),
      players: players.map((player) => ({ ...player, items: playerItems.get(player.playerSlot) ?? [] })),
      teamTotals,
      netWorthAnalysis,
    };
  });
}

async function querySummary(connection: DuckDBConnection, matchId: bigint): Promise<MatchOverviewSummary | null> {
  const result = await connection.runAndReadAll(SUMMARY_SQL, { matchId });
  const row = result.getRowObjectsJson()[0];
  if (row === undefined) return null;
  return {
    matchId: stringValue(row.match_id),
    extractionId: nullableString(row.extraction_id),
    startTime: nullableString(row.start_time),
    durationSeconds: nullableNumber(row.duration_seconds),
    gameMode: nullableString(row.game_mode),
    lobbyType: nullableNumber(row.lobby_type),
    lobbyTypeName: nullableString(row.lobby_type_name),
    winnerTeamId: nullableNumber(row.winner_team_id),
    winnerTeam: nullableString(row.winner_team),
    radiantScore: nullableNumber(row.radiant_score),
    direScore: nullableNumber(row.dire_score),
    radiantTeamName: nullableString(row.radiant_team_name),
    direTeamName: nullableString(row.dire_team_name),
    cluster: nullableNumber(row.cluster),
    firstBloodSeconds: nullableNumber(row.first_blood_seconds),
  };
}

async function queryPlayers(connection: DuckDBConnection, matchId: bigint): Promise<Omit<MatchOverviewPlayer, "items">[]> {
  const result = await connection.runAndReadAll(PLAYERS_SQL, { matchId });
  return result.getRowObjectsJson().map((row) => ({
    playerSlot: numberValue(row.player_slot),
    teamId: numberValue(row.team_id),
    team: stringValue(row.team),
    teamSlot: nullableNumber(row.team_slot),
    accountId: nullableString(row.account_id),
    playerName: nullableString(row.player_name),
    heroId: nullableNumber(row.hero_id),
    level: nullableNumber(row.level),
    kills: nullableNumber(row.kills),
    deaths: nullableNumber(row.deaths),
    assists: nullableNumber(row.assists),
    lastHits: nullableNumber(row.last_hits),
    denies: nullableNumber(row.denies),
    goldPerMin: nullableNumber(row.gold_per_min),
    xpPerMin: nullableNumber(row.xp_per_min),
    netWorth: nullableNumber(row.net_worth),
    heroDamage: nullableNumber(row.hero_damage),
    towerDamage: nullableNumber(row.tower_damage),
    heroHealing: nullableNumber(row.hero_healing),
  }));
}

async function queryItems(connection: DuckDBConnection, matchId: bigint): Promise<Array<MatchOverviewItem & { playerSlot: number }>> {
  const result = await connection.runAndReadAll(ITEMS_SQL, { matchId });
  return result.getRowObjectsJson().map((row) => ({
    playerSlot: numberValue(row.player_slot),
    itemSlot: numberValue(row.item_slot),
    itemId: nullableNumber(row.item_id),
  }));
}

async function queryTeamTotals(connection: DuckDBConnection, matchId: bigint): Promise<MatchOverviewTeamTotals[]> {
  const result = await connection.runAndReadAll(TEAM_TOTALS_SQL, { matchId });
  return result.getRowObjectsJson().map((row) => ({
    teamId: numberValue(row.team_id),
    team: stringValue(row.team),
    players: numberValue(row.players),
    kills: nullableNumber(row.kills),
    deaths: nullableNumber(row.deaths),
    assists: nullableNumber(row.assists),
    lastHits: nullableNumber(row.last_hits),
    denies: nullableNumber(row.denies),
    netWorth: nullableString(row.net_worth),
    heroDamage: nullableString(row.hero_damage),
    towerDamage: nullableString(row.tower_damage),
    heroHealing: nullableString(row.hero_healing),
  }));
}

async function queryNetWorthAnalysis(connection: DuckDBConnection, matchId: bigint): Promise<MatchNetWorthAnalysis> {
  const result = await connection.runAndReadAll(NET_WORTH_ANALYSIS_SQL, { matchId });
  const row = result.getRowObjectsJson()[0];
  if (row === undefined) return { radiantNetWorth: null, direNetWorth: null, advantage: null, leader: null };
  return {
    radiantNetWorth: nullableString(row.radiant_net_worth),
    direNetWorth: nullableString(row.dire_net_worth),
    advantage: nullableString(row.advantage),
    leader: nullableString(row.leader),
  };
}

function emptySummary(matchId: string): MatchOverviewSummary {
  return {
    matchId,
    extractionId: null,
    startTime: null,
    durationSeconds: null,
    gameMode: null,
    lobbyType: null,
    lobbyTypeName: null,
    winnerTeamId: null,
    winnerTeam: null,
    radiantScore: null,
    direScore: null,
    radiantTeamName: null,
    direTeamName: null,
    cluster: null,
    firstBloodSeconds: null,
  };
}

function stringValue(value: JsonValue | undefined): string {
  if (typeof value !== "string") throw new Error("Unexpected match overview value");
  return value;
}

function nullableString(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  return stringValue(value);
}

function numberValue(value: JsonValue | undefined): number {
  const number = nullableNumber(value);
  if (number === null) throw new Error("Unexpected match overview number");
  return number;
}

function nullableNumber(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number)) throw new Error("Unexpected match overview number");
  return number;
}

const LIST_MATCHES_SQL = `
WITH match_ids AS (
  SELECT match_id FROM catalog.replay_acquisitions
  UNION
  SELECT match_id FROM catalog.extractions
), latest_catalog AS (
  SELECT match_id, status, row_number() OVER (
    PARTITION BY match_id ORDER BY started_at DESC, extraction_id DESC
  ) AS row_number
  FROM catalog.extractions
), latest_acquisition AS (
  SELECT match_id, status, row_number() OVER (
    PARTITION BY match_id ORDER BY requested_at DESC, acquisition_id DESC
  ) AS row_number
  FROM catalog.replay_acquisitions
), selected_analysis AS (
  SELECT match.*
  FROM analysis.matches AS match
  JOIN analysis.latest_successful_extractions AS latest USING (extraction_id)
)
SELECT
  ids.match_id::VARCHAR AS match_id,
  CASE
    WHEN analysis.extraction_id IS NOT NULL THEN 'succeeded'
    ELSE coalesce(catalog.status, acquisition.status, 'unknown')
  END AS status,
  analysis.start_time::VARCHAR AS start_time,
  analysis.duration_seconds,
  analysis.winner_team,
  analysis.radiant_score,
  analysis.dire_score,
  analysis.radiant_team_name,
  analysis.dire_team_name
FROM match_ids AS ids
LEFT JOIN latest_catalog AS catalog
  ON catalog.match_id = ids.match_id AND catalog.row_number = 1
LEFT JOIN latest_acquisition AS acquisition
  ON acquisition.match_id = ids.match_id AND acquisition.row_number = 1
LEFT JOIN selected_analysis AS analysis ON analysis.match_id = ids.match_id
ORDER BY analysis.start_time DESC NULLS LAST, ids.match_id DESC
LIMIT 500`;

const PRESENCE_SQL = `
SELECT
  EXISTS (
    SELECT 1 FROM catalog.replay_acquisitions WHERE match_id = $matchId
    UNION ALL
    SELECT 1 FROM catalog.extractions WHERE match_id = $matchId
  ) AS present,
  coalesce(
    (SELECT status FROM catalog.extractions WHERE match_id = $matchId ORDER BY started_at DESC LIMIT 1),
    (SELECT status FROM catalog.replay_acquisitions WHERE match_id = $matchId ORDER BY requested_at DESC LIMIT 1),
    'unknown'
  ) AS status`;

const SUMMARY_SQL = `
SELECT
  match_id::VARCHAR AS match_id,
  extraction_id,
  start_time::VARCHAR AS start_time,
  duration_seconds,
  game_mode,
  lobby_type,
  coalesce(
    lobby_type::VARCHAR,
    (SELECT json_extract_string(record.payload, '$.lobby_type')
       FROM raw.records AS record
      WHERE record.extraction_id = summary.extraction_id
        AND record.record_type = 'CMsgDOTAMatch'
      LIMIT 1)
  ) AS lobby_type_name,
  winner_team_id,
  winner_team,
  radiant_score,
  dire_score,
  radiant_team_name,
  dire_team_name,
  cluster,
  first_blood_seconds
FROM analysis.match_summary($matchId) AS summary`;

const PLAYERS_SQL = `
SELECT
  player_slot,
  team_id,
  team,
  team_slot,
  account_id::VARCHAR AS account_id,
  player_name,
  hero_id,
  level,
  kills,
  deaths,
  assists,
  last_hits,
  denies,
  gold_per_min,
  xp_per_min,
  net_worth,
  hero_damage,
  tower_damage,
  hero_healing
FROM analysis.match_players($matchId)`;

const ITEMS_SQL = `
SELECT item.player_slot, item.item_slot, item.item_id
FROM analysis.player_items AS item
JOIN analysis.latest_successful_extractions AS latest USING (extraction_id)
WHERE latest.match_id = $matchId
ORDER BY item.player_slot, item.item_slot`;

const TEAM_TOTALS_SQL = `
SELECT
  team_id,
  team,
  players,
  kills,
  deaths,
  assists,
  last_hits,
  denies,
  net_worth::VARCHAR AS net_worth,
  hero_damage::VARCHAR AS hero_damage,
  tower_damage::VARCHAR AS tower_damage,
  hero_healing::VARCHAR AS hero_healing
FROM analysis.match_team_totals($matchId)`;

const NET_WORTH_ANALYSIS_SQL = `
WITH totals AS (
  SELECT * FROM analysis.match_team_totals($matchId)
), values AS (
  SELECT
    max(net_worth) FILTER (WHERE team_id = 2) AS radiant_net_worth,
    max(net_worth) FILTER (WHERE team_id = 3) AS dire_net_worth
  FROM totals
)
SELECT
  radiant_net_worth::VARCHAR AS radiant_net_worth,
  dire_net_worth::VARCHAR AS dire_net_worth,
  CASE
    WHEN radiant_net_worth IS NULL OR dire_net_worth IS NULL THEN NULL
    ELSE abs(radiant_net_worth - dire_net_worth)::VARCHAR
  END AS advantage,
  CASE
    WHEN radiant_net_worth IS NULL OR dire_net_worth IS NULL THEN NULL
    WHEN radiant_net_worth > dire_net_worth THEN 'Radiant'
    WHEN dire_net_worth > radiant_net_worth THEN 'Dire'
    ELSE 'Even'
  END AS leader
FROM values`;
