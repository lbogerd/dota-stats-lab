import { readFile, writeFile } from "node:fs/promises";

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || !outputFile) throw new Error("Usage: render-benchmark.mjs RESULTS.json REPORT.md");

const report = JSON.parse(await readFile(inputFile, "utf8"));
const groups = Map.groupBy(report.runs.filter((run) => run.kind === "measured"), (run) => run.label);
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
  "## Measurement boundaries and limitations",
  "",
  "- Replay download time is excluded; every run mounts an existing cached replay read-only.",
  "- Each warm-up and measured run uses a newly created staging directory and DuckDB warehouse.",
  "- Preparation is the parser's decompression/input-preparation timer. Replay hashing and container startup are represented only in complete wall time.",
  "- DuckDB write time is the loader transaction time less its nested summary-materialization timer.",
  "- Complete time is parser-container wall time plus loader-container wall time. Report generation and HTTP probes are excluded.",
  "- Peak RSS is the largest sum of process RSS observed with `docker top` in either ingestion container at 200 ms intervals; a narrow spike between samples may be missed.",
  "- The overview result uses one unmeasured warm request followed by 30 sequential loopback HTTP requests.",
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

function formatSeconds(milliseconds) {
  return `${(Number(milliseconds) / 1_000).toFixed(2)} s`;
}

function formatMiB(bytes) {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MiB`;
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
