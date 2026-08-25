import { DuckDBInstance } from "@duckdb/node-api";

const ROLLING_GPM_SQL = `
SELECT series_kind, player_slot, team_id, game_time_seconds, window_seconds, gpm
FROM analysis.match_rolling_gpm($matchId, $windowSeconds, $outputStepSeconds)`;

const GOLD_COMPARISON_SQL = `
WITH selected AS (
  SELECT match.extraction_id, match.duration_seconds
  FROM analysis.matches AS match
  JOIN analysis.latest_successful_extractions AS latest USING (extraction_id)
  WHERE match.match_id = $matchId
)
SELECT
  player.player_slot,
  player.team_id,
  selected.duration_seconds,
  player.gold_per_min AS final_gold_per_minute,
  baseline.total_gold_earned AS baseline_gold,
  final_value.total_gold_earned AS final_gold
FROM selected
JOIN analysis.players AS player USING (extraction_id)
LEFT JOIN LATERAL (
  SELECT event.total_gold_earned
  FROM analysis.player_gold_events AS event
  WHERE event.extraction_id = player.extraction_id
    AND event.player_slot = player.player_slot
    AND event.game_time_seconds <= 0
  ORDER BY event.game_time_seconds DESC, event.sequence DESC
  LIMIT 1
) AS baseline ON true
LEFT JOIN LATERAL (
  SELECT event.total_gold_earned
  FROM analysis.player_gold_events AS event
  WHERE event.extraction_id = player.extraction_id
    AND event.player_slot = player.player_slot
  ORDER BY event.game_time_seconds DESC, event.sequence DESC
  LIMIT 1
) AS final_value ON true
ORDER BY player.player_slot`;

const warehousePath = required("WAREHOUSE_PATH");
const matchId = required("BENCHMARK_MATCH_ID");
const windowSeconds = positiveInteger(process.env.BENCHMARK_GPM_WINDOW_SECONDS ?? "60", "BENCHMARK_GPM_WINDOW_SECONDS");
const outputStepSeconds = positiveInteger(
  process.env.BENCHMARK_GPM_OUTPUT_STEP_SECONDS ?? "1",
  "BENCHMARK_GPM_OUTPUT_STEP_SECONDS",
);
const warmSampleCount = positiveInteger(
  process.env.BENCHMARK_GPM_WARM_SAMPLES ?? "5",
  "BENCHMARK_GPM_WARM_SAMPLES",
);
const allowedGpmDifference = nonnegativeNumber(
  process.env.BENCHMARK_GPM_MAX_ROUNDING_DIFFERENCE ?? "1",
  "BENCHMARK_GPM_MAX_ROUNDING_DIFFERENCE",
);
const queryParameters = {
  matchId: BigInt(matchId),
  windowSeconds,
  outputStepSeconds,
};

const instance = await DuckDBInstance.create(warehousePath, {
  access_mode: "READ_ONLY",
  threads: "1",
  memory_limit: "512MB",
  enable_external_access: "false",
});
const connection = await instance.connect();
let coldMs;
const warmSamplesMs = [];
let comparisons;
try {
  coldMs = await timedMacroQuery(connection);
  for (let index = 0; index < warmSampleCount; index += 1) {
    warmSamplesMs.push(await timedMacroQuery(connection));
  }
  const comparisonResult = await connection.runAndReadAll(GOLD_COMPARISON_SQL, { matchId: queryParameters.matchId });
  comparisons = comparisonResult.getRowObjectsJson().map((row) => {
    const baselineGold = requiredNumber(row.baseline_gold, "baseline gold");
    const finalGold = requiredNumber(row.final_gold, "final gold");
    const finalGoldPerMinute = requiredNumber(row.final_gold_per_minute, "final gold per minute");
    const durationSeconds = requiredNumber(row.duration_seconds, "match duration");
    const calculatedGoldPerMinute = 60 * (finalGold - baselineGold) / durationSeconds;
    const roundedGoldPerMinute = Math.round(calculatedGoldPerMinute);
    return {
      playerSlot: requiredNumber(row.player_slot, "player slot"),
      teamId: requiredNumber(row.team_id, "team ID"),
      durationSeconds,
      baselineGold,
      finalGold,
      finalGoldPerMinute,
      calculatedGoldPerMinute: round(calculatedGoldPerMinute),
      roundedGoldPerMinute,
      difference: Math.abs(roundedGoldPerMinute - finalGoldPerMinute),
    };
  });
} finally {
  connection.closeSync();
  instance.closeSync();
}

const { getMatchRollingGpm } = await import("/app/dist/src/server/gpm.js");
const response = await getMatchRollingGpm({ matchId, windowSeconds, outputStepSeconds });
const durationSeconds = comparisons[0]?.durationSeconds ?? null;
const matchSupportsWindow = durationSeconds !== null && durationSeconds >= windowSeconds;
const maxGpmDifference = comparisons.length === 0
  ? null
  : Math.max(...comparisons.map((comparison) => comparison.difference));
const playersByTeam = Object.fromEntries(
  [...new Set(response.players.map((series) => series.teamId))]
    .sort((left, right) => left - right)
    .map((teamId) => [String(teamId), response.players.filter((series) => series.teamId === teamId).length]),
);
const seriesComplete = !matchSupportsWindow || (
  response.players.length === 10
  && response.teams.length === 2
  && Object.values(playersByTeam).length === 2
  && Object.values(playersByTeam).every((count) => count === 5)
  && response.players.every((series) => series.points.length > 0)
  && response.teams.every((series) => series.points.length > 0)
);
const goldComparisonComplete = comparisons.length === 10
  && maxGpmDifference !== null
  && maxGpmDifference <= allowedGpmDifference;
const validation = {
  passed: seriesComplete && goldComparisonComplete,
  durationSeconds,
  matchSupportsWindow,
  playerSeries: response.players.length,
  teamSeries: response.teams.length,
  playersByTeam,
  seriesComplete,
  goldComparison: {
    comparedPlayers: comparisons.length,
    allowedGpmDifference,
    maxGpmDifference,
    complete: goldComparisonComplete,
    players: comparisons,
  },
};

if (!validation.passed) {
  throw new Error(
    `Granular GPM validation failed for match ${matchId}: `
    + `${response.players.length} player series, ${response.teams.length} team series, `
    + `${comparisons.length} final-gold comparisons, max GPM difference ${maxGpmDifference ?? "unavailable"} `
    + `(allowed ${allowedGpmDifference})`,
  );
}

const sortedWarmSamples = [...warmSamplesMs].sort((left, right) => left - right);
process.stdout.write(`${JSON.stringify({
  windowSeconds,
  outputStepSeconds,
  coldMs: round(coldMs),
  warmSamplesMs: warmSamplesMs.map(round),
  warmMedianMs: round(percentile(sortedWarmSamples, 0.5)),
  responseBytes: Buffer.byteLength(JSON.stringify(response), "utf8"),
  playerSeries: response.players.length,
  teamSeries: response.teams.length,
  validation,
})}\n`);

async function timedMacroQuery(connection) {
  const started = performance.now();
  const result = await connection.runAndReadAll(ROLLING_GPM_SQL, queryParameters);
  result.getRowObjectsJson();
  return performance.now() - started;
}

function percentile(sortedValues, fraction) {
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive`);
  return parsed;
}

function nonnegativeNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a nonnegative number`);
  return parsed;
}

function requiredNumber(value, label) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Granular GPM validation is missing ${label}`);
  return parsed;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
