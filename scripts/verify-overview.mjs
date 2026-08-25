import { chromium } from "@playwright/test";

const baseUrl = required("BENCHMARK_BASE_URL").replace(/\/$/, "");
const matchId = required("BENCHMARK_MATCH_ID");
const sampleCount = positiveInteger(process.env.BENCHMARK_OVERVIEW_SAMPLES ?? "30", "BENCHMARK_OVERVIEW_SAMPLES");
const browserRenderSampleCount = positiveInteger(
  process.env.BENCHMARK_BROWSER_RENDER_SAMPLES ?? "3",
  "BENCHMARK_BROWSER_RENDER_SAMPLES",
);
const measureAcknowledgement = booleanFlag(process.env.BENCHMARK_ACKNOWLEDGEMENT ?? "1", "BENCHMARK_ACKNOWLEDGEMENT");
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

let browserRender;
let acknowledgement = {
  available: false,
  skipped: true,
  definition: "button activation through visible queued/active job confirmation",
};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const samplesMs = [];
  for (let index = 0; index < browserRenderSampleCount; index += 1) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const started = performance.now();
    await page.goto(overviewUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Granular GPM" }).waitFor({ state: "visible", timeout: 30_000 });
    await page.getByText(/^Rolling GPM - last \d+ seconds$/)
      .or(page.getByText(/Granular gold data is unavailable for this extraction/))
      .first().waitFor({ state: "visible", timeout: 30_000 });
    samplesMs.push(performance.now() - started);
    await page.close();
  }
  const sortedBrowserSamples = [...samplesMs].sort((left, right) => left - right);
  browserRender = {
    available: true,
    definition: "fresh mobile navigation through visible granular GPM graph or unavailable state",
    samples: browserRenderSampleCount,
    samplesMs: samplesMs.map(round),
    medianMs: round(percentile(sortedBrowserSamples, 0.5)),
    p95Ms: round(percentile(sortedBrowserSamples, 0.95)),
  };

  if (measureAcknowledgement) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
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
      await page.close();
    }
  }
} finally {
  await browser?.close();
}

process.stdout.write(`${JSON.stringify({ overview, browserRender, acknowledgement })}\n`);

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

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive`);
  return parsed;
}

function booleanFlag(value, name) {
  if (value === "0") return false;
  if (value === "1") return true;
  throw new Error(`${name} must be 0 or 1`);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
