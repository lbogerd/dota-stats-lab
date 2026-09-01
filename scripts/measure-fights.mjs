import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const warehousePath = required("WAREHOUSE_PATH");
const matchId = unsignedDecimal(required("BENCHMARK_MATCH_ID"), "BENCHMARK_MATCH_ID", false);
const configuredFightId = process.env.BENCHMARK_FIGHT_ID === undefined
  ? null
  : unsignedDecimal(process.env.BENCHMARK_FIGHT_ID, "BENCHMARK_FIGHT_ID", true);
const warmSampleCount = positiveInteger(
  process.env.BENCHMARK_FIGHTS_WARM_SAMPLES ?? "5",
  "BENCHMARK_FIGHTS_WARM_SAMPLES",
);
const serverModule = resolveServerModule();

// The imported server functions open DuckDB with access_mode=READ_ONLY. Set the
// path before importing because src/config reads it at module initialization.
process.env.WAREHOUSE_PATH = warehousePath;
const { getMatchFights, getMatchFightDetail } = await import(serverModule);
if (typeof getMatchFights !== "function" || typeof getMatchFightDetail !== "function") {
  throw new Error("Fight measurement module must export getMatchFights and getMatchFightDetail");
}

const coldList = await timed(() => getMatchFights({ matchId }));
validateListResponse(coldList.value, matchId);
const warmLists = [];
for (let index = 0; index < warmSampleCount; index += 1) {
  const sample = await timed(() => getMatchFights({ matchId }));
  validateListResponse(sample.value, matchId);
  warmLists.push(sample);
}

const fights = coldList.value.fights;
const fightId = selectFightId(fights, configuredFightId);
let detail = null;
if (fightId !== null) {
  const coldDetail = await timed(() => getMatchFightDetail({ matchId, fightId }));
  validateDetailResponse(coldDetail.value, matchId, fightId);
  const warmDetails = [];
  for (let index = 0; index < warmSampleCount; index += 1) {
    const sample = await timed(() => getMatchFightDetail({ matchId, fightId }));
    validateDetailResponse(sample.value, matchId, fightId);
    warmDetails.push(sample);
  }
  const fight = coldDetail.value.fight;
  detail = {
    fightId,
    coldMs: round(coldDetail.elapsedMs),
    warmSamplesMs: warmDetails.map((sample) => round(sample.elapsedMs)),
    warmMedianMs: round(median(warmDetails.map((sample) => sample.elapsedMs))),
    responseBytes: jsonBytes(coldDetail.value),
    positionState: fight.positionState,
    frameCount: fight.frames.length,
    positionCount: fight.frames.reduce((sum, frame) => sum + frame.positions.length, 0),
    deathMarkerCount: fight.deathMarkers.length,
  };
}

let browser = null;
if (process.env.BENCHMARK_FIGHTS_BASE_URL !== undefined) {
  browser = await measureBrowser(
    process.env.BENCHMARK_FIGHTS_BASE_URL,
    matchId,
    fightId,
    positiveInteger(
      process.env.BENCHMARK_FIGHTS_BROWSER_SAMPLES ?? "3",
      "BENCHMARK_FIGHTS_BROWSER_SAMPLES",
    ),
  );
}

process.stdout.write(`${JSON.stringify({
  matchId,
  available: coldList.value.available,
  fightCount: fights.length,
  list: {
    coldMs: round(coldList.elapsedMs),
    warmSamplesMs: warmLists.map((sample) => round(sample.elapsedMs)),
    warmMedianMs: round(median(warmLists.map((sample) => sample.elapsedMs))),
    responseBytes: jsonBytes(coldList.value),
    containsPositionFrames: containsPositionFrames(coldList.value),
  },
  detail,
  browser,
  validation: {
    passed: true,
    listExcludesPositionFrames: true,
    detailMeasured: detail !== null,
    browserMeasured: browser !== null,
    note: detail === null ? "No engagement was available to measure." : null,
  },
})}\n`);

async function timed(operation) {
  const started = performance.now();
  const value = await operation();
  return { elapsedMs: performance.now() - started, value };
}

function validateListResponse(response, expectedMatchId) {
  if (!isObject(response) || response.matchId !== expectedMatchId
      || typeof response.available !== "boolean" || !Array.isArray(response.fights)) {
    throw new Error("Fight list measurement received an invalid response");
  }
  if (containsPositionFrames(response)) {
    throw new Error("Fight list response contains position frames; list requests must not load them");
  }
  for (const fight of response.fights) {
    if (!isObject(fight) || typeof fight.fightId !== "string") {
      throw new Error("Fight list measurement received an invalid fight record");
    }
  }
}

function validateDetailResponse(response, expectedMatchId, expectedFightId) {
  if (!isObject(response) || response.matchId !== expectedMatchId || !isObject(response.fight)) {
    throw new Error(`Fight detail measurement could not find engagement ${expectedFightId}`);
  }
  if (response.fight.fightId !== expectedFightId
      || !Array.isArray(response.fight.frames)
      || !Array.isArray(response.fight.deathMarkers)
      || !["available", "unavailable", "empty"].includes(response.fight.positionState)) {
    throw new Error("Fight detail measurement received an invalid response");
  }
  let previousTime = null;
  for (const frame of response.fight.frames) {
    if (!isObject(frame) || !Number.isSafeInteger(frame.gameTimeMilliseconds)
        || frame.gameTimeMilliseconds % 100 !== 0 || !Array.isArray(frame.positions)) {
      throw new Error("Fight detail response contains an invalid position frame");
    }
    if (previousTime !== null && frame.gameTimeMilliseconds <= previousTime) {
      throw new Error("Fight detail position frames are not in strict time order");
    }
    previousTime = frame.gameTimeMilliseconds;
  }
}

function selectFightId(fights, configured) {
  if (configured !== null) {
    if (!fights.some((fight) => fight.fightId === configured)) {
      throw new Error(`BENCHMARK_FIGHT_ID ${configured} is not in the measured fight list`);
    }
    return configured;
  }
  if (fights.length === 0) return null;
  return fights[Math.floor(fights.length / 2)].fightId;
}

function containsPositionFrames(value) {
  if (!isObject(value) && !Array.isArray(value)) return false;
  if (Array.isArray(value)) return value.some(containsPositionFrames);
  for (const [key, child] of Object.entries(value)) {
    if ((key === "frames" || key === "positionFrames") && Array.isArray(child)) return true;
    if (containsPositionFrames(child)) return true;
  }
  return false;
}

async function measureBrowser(baseUrl, measuredMatchId, measuredFightId, samples) {
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch (error) {
    throw new Error("Browser measurement requires the Playwright package", { cause: error });
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const listSamplesMs = [];
    const detailSamplesMs = [];
    for (let index = 0; index < samples; index += 1) {
      const page = await browser.newPage();
      try {
        const listStarted = performance.now();
        await page.goto(routeUrl(baseUrl, `/matches/${measuredMatchId}/fights`), { waitUntil: "domcontentloaded" });
        await page.locator(
          '[data-testid="fights-ready"], [data-testid="fights-empty"], [data-testid="fights-unavailable"], [role="alert"]',
        ).first().waitFor();
        listSamplesMs.push(performance.now() - listStarted);

        if (measuredFightId !== null) {
          const detailStarted = performance.now();
          await page.goto(
            routeUrl(baseUrl, `/matches/${measuredMatchId}/fights/${measuredFightId}`),
            { waitUntil: "domcontentloaded" },
          );
          await page.locator('[data-testid="fight-detail"], [data-testid="fight-not-found"], [role="alert"]')
            .first().waitFor();
          detailSamplesMs.push(performance.now() - detailStarted);
        }
      } finally {
        await page.close();
      }
    }
    return {
      samples,
      listRenderSamplesMs: listSamplesMs.map(round),
      listRenderMedianMs: round(median(listSamplesMs)),
      detailRenderSamplesMs: detailSamplesMs.map(round),
      detailRenderMedianMs: detailSamplesMs.length === 0 ? null : round(median(detailSamplesMs)),
    };
  } finally {
    await browser.close();
  }
}

function resolveServerModule() {
  const configured = process.env.BENCHMARK_FIGHTS_MODULE;
  if (configured !== undefined) return moduleSpecifier(configured);
  const containerPath = "/app/dist/src/server/fights.js";
  if (existsSync(containerPath)) return pathToFileURL(containerPath).href;
  return new URL("../dist/src/server/fights.js", import.meta.url).href;
}

function moduleSpecifier(value) {
  if (value.startsWith("file:") || !value.startsWith("/")) return value;
  return pathToFileURL(value).href;
}

function routeUrl(base, path) {
  return new URL(path, base.endsWith("/") ? base : `${base}/`).href;
}

function median(values) {
  if (values.length === 0) throw new Error("Fight measurement needs at least one timing sample");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(`${name} must be an integer from 1 through 100`);
  }
  return parsed;
}

function unsignedDecimal(value, name, allowZero) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be an unsigned decimal string`);
  const parsed = BigInt(value);
  if ((!allowZero && parsed === 0n) || parsed > 18_446_744_073_709_551_615n) {
    throw new Error(`${name} is outside the DuckDB UBIGINT range`);
  }
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
