import { chromium } from "@playwright/test";

const baseUrl = required("BENCHMARK_BASE_URL").replace(/\/$/, "");
const matchId = required("BENCHMARK_MATCH_ID");
const sampleCount = positiveInteger(process.env.BENCHMARK_OVERVIEW_SAMPLES ?? "30");
const overviewUrl = `${baseUrl}/matches/${matchId}`;

await request(overviewUrl); // Deliberate, unmeasured warm-up.
const samplesMs = [];
for (let index = 0; index < sampleCount; index += 1) {
  const started = performance.now();
  await request(overviewUrl);
  samplesMs.push(performance.now() - started);
}

const sorted = [...samplesMs].sort((left, right) => left - right);
const overview = {
  url: overviewUrl,
  warmups: 1,
  samples: sampleCount,
  samplesMs: samplesMs.map(round),
  medianMs: round(percentile(sorted, 0.5)),
  p95Ms: round(percentile(sorted, 0.95)),
  maximumMs: round(sorted.at(-1)),
};

let acknowledgement;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${baseUrl}/ingest`, { waitUntil: "networkidle" });
  await page.locator("#match-id").fill(matchId);
  const started = performance.now();
  await page.getByRole("button", { name: /Start ingestion|^Start$/ }).click();
  await page.getByText(`#${matchId}`, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  const elapsedMs = performance.now() - started;
  acknowledgement = {
    available: true,
    definition: "button activation through visible queued/active job confirmation",
    elapsedMs: round(elapsedMs),
    passesOneSecondLimit: elapsedMs <= 1_000,
  };
} catch (error) {
  acknowledgement = {
    available: false,
    definition: "button activation through visible queued/active job confirmation",
    error: error instanceof Error ? error.message : String(error),
  };
} finally {
  await browser?.close();
}

process.stdout.write(`${JSON.stringify({ overview, acknowledgement })}\n`);

async function request(url) {
  const response = await fetch(url, { headers: { accept: "text/html" }, cache: "no-store" });
  const body = await response.arrayBuffer();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  if (body.byteLength === 0) throw new Error(`${url} returned an empty response`);
}

function percentile(sortedValues, fraction) {
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("BENCHMARK_OVERVIEW_SAMPLES must be positive");
  return parsed;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
