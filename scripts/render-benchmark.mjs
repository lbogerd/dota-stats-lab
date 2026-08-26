import { readFile, writeFile } from "node:fs/promises";

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || !outputFile) throw new Error("Usage: render-benchmark.mjs RESULTS.json REPORT.md");

const report = JSON.parse(await readFile(inputFile, "utf8"));
const groups = Map.groupBy(report.runs.filter((run) => run.kind === "measured"), (run) => run.label);
const gpmWindowSeconds = report.configuration?.gpmWindowSeconds ?? 60;
const heatmapRangeSeconds = report.configuration?.heatmapRangeSeconds ?? 300;
const lines = [
  "# Dota replay ingestion benchmark",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  "## Environment",
  "",
  `- CPU: ${report.environment.cpuModel} (${report.environment.logicalCpus} logical CPUs)`,
  `- Memory: ${formatGiB(report.environment.memoryBytes)}`,
  `- Operating system: ${report.environment.os}; kernel ${report.environment.kernel}`,
  `- Docker: ${report.environment.dockerVersion}; Compose: ${report.environment.composeVersion}`,
  `- Git revision: ${report.environment.gitRevision}${report.environment.gitDirty ? " (dirty)" : ""}`,
  `- Clarity fork: ${report.environment.parserIdentity.clarityForkRevision}`,
  `- Export format: ${report.environment.parserIdentity.exportFormatVersion}`,
  `- DuckDB Node API: ${report.environment.software.duckdbNodeApi}`,
  "",
  "## Median measured results",
  "",
  "| Replay | Match | Runs | Duration | Replay | Preparation | Clarity | DuckDB writes | Summary | Complete | Peak RSS | Rows | Overview p95 | Ack |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
];

for (const [label, runs] of groups) {
  const first = runs[0];
  const http = runs.map((run) => run.http).find(Boolean);
  lines.push(`| ${label} | ${first.matchId} | ${runs.length} | ${formatDuration(first.matchDurationSeconds)} | ${formatMiB(first.replayBytes)} | ${formatSeconds(median(runs, "preparationMs"))} | ${formatSeconds(median(runs, "parsingMs"))} | ${formatSeconds(median(runs, "duckdbWriteMs"))} | ${formatSeconds(median(runs, "summaryMs"))} | ${formatSeconds(median(runs, "completeMs"))} | ${formatMiB(median(runs, "peakRssBytes"))} | ${formatInteger(median(runs, "retainedRows"))} | ${http ? `${http.overview.p95Ms.toFixed(2)} ms` : "not measured"} | ${http?.acknowledgement?.available ? `${http.acknowledgement.elapsedMs.toFixed(2)} ms` : "not measured"} |`);
}

lines.push(
  "",
  "## Hero position and heat-map measurements",
  "",
  "| Replay | Match | Positions | Stored | Position output | Total output | Warehouse | Cold heat map | Warm heat map | API response | Response |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
);

for (const [label, runs] of groups) {
  const first = runs[0];
  const positionOutputBytes = medianOptional(runs, "positionOutputBytes");
  const totalOutputBytes = medianOptional(runs, "outputBytes");
  const outputWithShare = positionOutputBytes == null
    ? "not measured"
    : `${formatMiB(positionOutputBytes)}${totalOutputBytes > 0 ? ` (${formatPercent(positionOutputBytes / totalOutputBytes)})` : ""}`;
  const availability = runs.map((run) => run.positions?.available).find((value) => value != null);
  lines.push(`| ${label} | ${first.matchId} | ${formatOptionalInteger(medianOptional(runs, "positionExportedRows"))} | ${formatOptionalInteger(medianOptional(runs, "positionStoredRows"))} | ${outputWithShare} | ${formatOptionalBytes(totalOutputBytes)} | ${formatOptionalBytes(medianOptional(runs, "warehouseBytes"))} | ${availability === false ? "unavailable" : formatOptionalMilliseconds(medianNested(runs, "positions", "coldMs"))} | ${availability === false ? "unavailable" : formatOptionalMilliseconds(medianNested(runs, "positions", "warmMedianMs"))} | ${availability === false ? "unavailable" : formatOptionalMilliseconds(medianNested(runs, "positions", "responseMs"))} | ${availability === false ? "unavailable" : formatOptionalResponseBytes(medianNested(runs, "positions", "responseBytes"))} |`);
}

lines.push(
  "",
  "## Granular GPM measurements",
  "",
  "| Replay | Match | Gold events | Warehouse | Cold GPM | Warm GPM | 1s response | Max final GPM diff | Browser render p95 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
);

for (const [label, runs] of groups) {
  const first = runs[0];
  const browserRender = runs.map((run) => run.http?.browserRender).find((measurement) => measurement?.available);
  lines.push(`| ${label} | ${first.matchId} | ${formatOptionalInteger(medianOptional(runs, "goldEventRows"))} | ${formatOptionalBytes(medianOptional(runs, "warehouseBytes"))} | ${formatOptionalMilliseconds(medianNested(runs, "gpm", "coldMs"))} | ${formatOptionalMilliseconds(medianNested(runs, "gpm", "warmMedianMs"))} | ${formatOptionalResponseBytes(medianNested(runs, "gpm", "responseBytes"))} | ${formatOptionalGpmDifference(medianDeep(runs, ["gpm", "validation", "goldComparison", "maxGpmDifference"]))} | ${browserRender ? `${browserRender.p95Ms.toFixed(2)} ms` : "not measured"} |`);
}

lines.push(
  "",
  "## Measurement boundaries and limitations",
  "",
  "- Replay download time is excluded; every run mounts an existing cached replay read-only.",
  "- Each warm-up and measured run uses a newly created staging directory and DuckDB warehouse.",
  "- Preparation is the parser's decompression/input-preparation timer. Replay hashing and container startup are represented only in complete wall time.",
  "- DuckDB write time is the loader transaction time less its nested summary-materialization timer.",
  "- Complete time is parser-container wall time plus loader-container wall time. Report generation and HTTP probes are excluded.",
  "- Peak RSS is the largest sum of process RSS observed with `docker top` in either ingestion container at 200 ms intervals; a narrow spike between samples may be missed.",
  "- The overview result uses one unmeasured warm request followed by 30 sequential loopback HTTP requests.",
  "- Warehouse size is the exact DuckDB file size after loading one match into a fresh database and before running query probes.",
  "- Position output is the exact byte size of `hero_positions.ndjson`; its percentage is its share of all exported NDJSON bytes.",
  "- Exported position rows come from the parser manifest. Stored position rows come from `analysis.hero_position_samples` after loading.",
  `- Heat-map latency uses all heroes in a ${heatmapRangeSeconds}-second range centered in the match, or the full match when it is shorter, on a 64 by 64 grid. Times accept 100 ms increments.`,
  "- Cold heat-map latency is the first macro query on a new read-only DuckDB connection. Warm heat-map latency is the median of repeated materialized queries on that connection.",
  "- The heat-map API measurement includes its read-only connection, availability query, macro query, and response assembly. Response size is UTF-8 JSON bytes.",
  "- A schema-version-1 extraction has no position file. The benchmark reports its position metrics as unavailable and continues to run the existing GPM validations.",
  "- Cold GPM is the first rolling-macro query on a new read-only DuckDB connection. Warm GPM is the median of repeated materialized queries on that same connection.",
  `- The GPM response size is the UTF-8 JSON byte length of the grouped ${gpmWindowSeconds}-second-window response at a one-second output step.`,
  "- The real-replay validation requires ten non-empty player series, two non-empty complete-team series, and five players per team when the match is at least as long as the selected window.",
  "- Final GPM validation subtracts each player's last value at or before game time zero from the last stored cumulative earned-gold value, normalizes it per minute over match duration, and compares that result with the final scoreboard GPM.",
  "- Browser render time measures a fresh 390 by 844 navigation until the granular GPM graph or explicit unavailable state is visible. It is collected for the normal and near-hour fixtures.",
  "- Acknowledgement is one browser measurement from activating the ingestion button until the queued or active job is visible. It mutates only the disposable benchmark job directory.",
  "- Container CPU and memory limits are part of the benchmark configuration recorded in the JSON report.",
  "",
  `Raw machine-readable results: \`${inputFile}\``,
  "",
);

await writeFile(outputFile, `${lines.join("\n")}\n`);

function median(runs, key) {
  const values = runs.map((run) => Number(run[key])).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function medianOptional(runs, key) {
  const values = runs.map((run) => run[key]).filter((value) => value != null).map(Number).sort((a, b) => a - b);
  return values.length === 0 ? null : values[Math.floor(values.length / 2)];
}

function medianNested(runs, objectKey, key) {
  const values = runs.map((run) => run[objectKey]?.[key]).filter((value) => value != null).map(Number).sort((a, b) => a - b);
  return values.length === 0 ? null : values[Math.floor(values.length / 2)];
}

function medianDeep(runs, path) {
  const values = runs.map((run) => path.reduce((value, key) => value?.[key], run))
    .filter((value) => value != null).map(Number).sort((a, b) => a - b);
  return values.length === 0 ? null : values[Math.floor(values.length / 2)];
}

function formatSeconds(milliseconds) {
  return `${(Number(milliseconds) / 1_000).toFixed(2)} s`;
}

function formatMiB(bytes) {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MiB`;
}

function formatOptionalBytes(bytes) {
  return bytes == null ? "not measured" : formatMiB(bytes);
}

function formatOptionalResponseBytes(bytes) {
  return bytes == null ? "not measured" : `${(Number(bytes) / 1024).toFixed(1)} KiB`;
}

function formatOptionalInteger(value) {
  return value == null ? "not measured" : formatInteger(value);
}

function formatOptionalMilliseconds(value) {
  return value == null ? "not measured" : `${Number(value).toFixed(2)} ms`;
}

function formatOptionalGpmDifference(value) {
  return value == null ? "not measured" : `${Number(value).toFixed(2)} GPM`;
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatGiB(bytes) {
  return `${(Number(bytes) / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

function formatInteger(value) {
  return Math.round(Number(value)).toLocaleString("en-US");
}

function formatDuration(seconds) {
  if (seconds == null) return "Unknown";
  const rounded = Math.round(Number(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
