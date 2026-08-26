import { DuckDBInstance } from "@duckdb/node-api";

const GRID_SIZE = 64;

const POSITION_STATE_SQL = `
SELECT
  match.extraction_id,
  match.duration_seconds,
  (
    json_extract(extraction.manifest, '$.files.heroPositions') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM analysis.hero_position_samples AS available_sample
      WHERE available_sample.extraction_id = match.extraction_id
    )
  ) AS available
FROM analysis.matches AS match
JOIN analysis.latest_successful_extractions AS latest USING (extraction_id)
JOIN catalog.extractions AS extraction USING (extraction_id)
WHERE match.match_id = $matchId`;

const SELECTED_POSITION_COUNT_SQL = `
SELECT count(*) AS selected_position_rows
FROM analysis.hero_position_samples AS sample
JOIN analysis.latest_successful_extractions AS latest USING (extraction_id)
WHERE latest.match_id = $matchId
  AND sample.game_time_milliseconds >= $startMilliseconds
  AND sample.game_time_milliseconds <= $endMilliseconds`;

const HEATMAP_SQL = `
SELECT cell_x, cell_y, sample_count
FROM analysis.match_hero_heatmap(
  $matchId,
  $startMilliseconds,
  $endMilliseconds,
  NULL,
  $gridSize
)`;

const warehousePath = required("WAREHOUSE_PATH");
const matchId = required("BENCHMARK_MATCH_ID");
const rangeSeconds = positiveInteger(
  process.env.BENCHMARK_HEATMAP_RANGE_SECONDS ?? "300",
  "BENCHMARK_HEATMAP_RANGE_SECONDS",
);
const warmSampleCount = positiveInteger(
  process.env.BENCHMARK_HEATMAP_WARM_SAMPLES ?? "5",
  "BENCHMARK_HEATMAP_WARM_SAMPLES",
);
const matchIdParameter = BigInt(matchId);

const stateWarehouse = await openReadOnlyWarehouse();
let state;
try {
  const stateResult = await stateWarehouse.connection.runAndReadAll(POSITION_STATE_SQL, { matchId: matchIdParameter });
  state = stateResult.getRowObjectsJson()[0];
  if (state === undefined) throw new Error(`Match ${matchId} does not have a successful extraction`);
} finally {
  stateWarehouse.connection.closeSync();
  stateWarehouse.instance.closeSync();
}

const durationSeconds = nonnegativeInteger(state.duration_seconds, "match duration");
const available = requiredBoolean(state.available, "position availability");
const range = middleRange(durationSeconds * 1_000, rangeSeconds * 1_000);
let output;

if (!available) {
  output = {
    available: false,
    storedPositionRows: 0,
    gridSize: GRID_SIZE,
    rangeSeconds,
    startMilliseconds: range.startMilliseconds,
    endMilliseconds: range.endMilliseconds,
    coldMs: null,
    warmSamplesMs: [],
    warmMedianMs: null,
    selectedPositionRows: 0,
    occupiedCells: 0,
    responseMs: null,
    responseBytes: null,
    validation: { passed: true, reason: "legacy extraction has no heroPositions file" },
  };
} else {
  const queryParameters = {
    matchId: matchIdParameter,
    startMilliseconds: range.startMilliseconds,
    endMilliseconds: range.endMilliseconds,
    gridSize: GRID_SIZE,
  };
  const queryWarehouse = await openReadOnlyWarehouse();
  try {
    const cold = await timedHeatmapQuery(queryWarehouse.connection, queryParameters);
    const countResult = await queryWarehouse.connection.runAndReadAll(SELECTED_POSITION_COUNT_SQL, {
      matchId: matchIdParameter,
      startMilliseconds: range.startMilliseconds,
      endMilliseconds: range.endMilliseconds,
    });
    const selectedPositionRows = nonnegativeInteger(
      countResult.getRowObjectsJson()[0]?.selected_position_rows,
      "selected position rows",
    );
    const storedCountResult = await queryWarehouse.connection.runAndReadAll(`
      SELECT count(*) AS stored_position_rows
      FROM analysis.hero_position_samples AS sample
      JOIN analysis.latest_successful_extractions AS latest USING (extraction_id)
      WHERE latest.match_id = $matchId`, { matchId: matchIdParameter });
    const storedPositionRows = nonnegativeInteger(
      storedCountResult.getRowObjectsJson()[0]?.stored_position_rows,
      "stored position rows",
    );
    if (storedPositionRows === 0) {
      throw new Error(`Position validation failed for match ${matchId}: extraction declares heroPositions but stores no rows`);
    }
    const warm = [];
    for (let index = 0; index < warmSampleCount; index += 1) {
      warm.push(await timedHeatmapQuery(queryWarehouse.connection, queryParameters));
    }
    validateCells(cold.rows, selectedPositionRows);
    for (const sample of warm) validateCells(sample.rows, selectedPositionRows);
    if (selectedPositionRows === 0) {
      throw new Error(`Position validation failed for match ${matchId}: representative range has no rows`);
    }

    const sortedWarmMs = warm.map((sample) => sample.elapsedMs).sort((left, right) => left - right);
    output = {
      available: true,
      storedPositionRows,
      gridSize: GRID_SIZE,
      rangeSeconds,
      startMilliseconds: range.startMilliseconds,
      endMilliseconds: range.endMilliseconds,
      coldMs: round(cold.elapsedMs),
      warmSamplesMs: warm.map((sample) => round(sample.elapsedMs)),
      warmMedianMs: round(percentile(sortedWarmMs, 0.5)),
      selectedPositionRows,
      occupiedCells: cold.rows.length,
      validation: { passed: true },
    };
  } finally {
    queryWarehouse.connection.closeSync();
    queryWarehouse.instance.closeSync();
  }
}

if (output.available) {
  const serverModule = process.env.BENCHMARK_HERO_POSITIONS_MODULE
    ?? "/app/dist/src/server/hero-positions.js";
  const { getMatchHeroHeatmap } = await import(serverModule);
  const started = performance.now();
  const response = await getMatchHeroHeatmap({
    matchId,
    startMilliseconds: output.startMilliseconds,
    endMilliseconds: output.endMilliseconds,
    playerSlot: null,
  });
  output.responseMs = round(performance.now() - started);
  output.responseBytes = Buffer.byteLength(JSON.stringify(response), "utf8");
  if (!response.available || response.sampleCount !== output.selectedPositionRows) {
    throw new Error(`Position response validation failed for match ${matchId}`);
  }
}

process.stdout.write(`${JSON.stringify(output)}\n`);

async function timedHeatmapQuery(connection, parameters) {
  const started = performance.now();
  const result = await connection.runAndReadAll(HEATMAP_SQL, parameters);
  const rows = result.getRowObjectsJson();
  return { elapsedMs: performance.now() - started, rows };
}

async function openReadOnlyWarehouse() {
  const instance = await DuckDBInstance.create(warehousePath, {
    access_mode: "READ_ONLY",
    threads: "1",
    memory_limit: "512MB",
    enable_external_access: "false",
  });
  return { instance, connection: await instance.connect() };
}

function middleRange(durationMilliseconds, requestedRangeMilliseconds) {
  const length = Math.min(durationMilliseconds, requestedRangeMilliseconds);
  const startMilliseconds = Math.floor((durationMilliseconds - length) / 200) * 100;
  const endMilliseconds = Math.floor((startMilliseconds + length) / 100) * 100;
  return { startMilliseconds, endMilliseconds };
}

function validateCells(rows, expectedSamples) {
  let countedSamples = 0;
  for (const row of rows) {
    const cellX = nonnegativeInteger(row.cell_x, "cell X");
    const cellY = nonnegativeInteger(row.cell_y, "cell Y");
    if (cellX >= GRID_SIZE || cellY >= GRID_SIZE) throw new Error("Heat-map query returned an invalid cell");
    countedSamples += nonnegativeInteger(row.sample_count, "cell sample count");
  }
  if (countedSamples !== expectedSamples) {
    throw new Error(`Heat-map query counted ${countedSamples} samples; expected ${expectedSamples}`);
  }
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

function nonnegativeInteger(value, label) {
  const parsed = typeof value === "number" ? value : typeof value === "bigint" ? Number(value)
    : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Position measurement is missing ${label}`);
  return parsed;
}

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`Position measurement is missing ${label}`);
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
