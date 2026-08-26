# Benchmark workflow

The benchmark uses cached real replays and disposable bind-mounted staging and
DuckDB directories. It never mounts the live warehouse or staging volumes and
does not download a replay. The default replay source is the existing
`dota-stats-replays` Docker volume.

Run the complete benchmark from the repository root:

```sh
./scripts/benchmark.sh
```

The default corpus is:

| Class | Match ID | Known duration | Cached size |
|---|---:|---:|---:|
| Short | `8946228107` | 18:22 | 54.3 MB |
| Normal | `8955653541` | 38:29 | 166.6 MB |
| Large/near-hour | `8946303764` | 55:28 | 178.9 MB |

For every replay, the command performs one warm-up and three measured
ingestions. The warm-up is not measured. Every ingestion gets a new staging
tree and a new DuckDB file. Download time is not measured. Disposable web
containers serve the final normal- and near-hour-match warehouses on loopback.
For each, the benchmark sends one warm overview request and 30 measured
overview requests, and measures mobile browser rendering through the granular
GPM ready state. It also runs one browser acknowledgement probe against the
match selected by `BENCHMARK_HTTP_MATCH_ID`. Benchmark containers do not join or
change the deployed Compose application.

Each ingestion also measures the 100 ms hero-position data. The benchmark
records the exported and stored position row counts, the position-file bytes,
the total parser output bytes, and the DuckDB warehouse bytes. It queries a
64 by 64 all-hero heat map for a range at the center of the match. The initial
range is five minutes. It records the first query, the median of five later
queries, one server response, and the response size.

Results are written beneath `benchmark-results/TIMESTAMP/` as raw JSONL,
environment JSON, a combined `results.json`, and a rendered `BENCHMARK.md`.
Scratch data is removed after each run by default.

## Configuration

Examples:

```sh
# Use a host replay directory rather than the named volume.
BENCHMARK_REPLAY_SOURCE=/srv/dota/replays ./scripts/benchmark.sh

# Reuse images that were already built and skip browser/HTTP measurements.
BENCHMARK_BUILD=0 BENCHMARK_HTTP=0 ./scripts/benchmark.sh

# Smoke-test only the short replay with one measured run.
BENCHMARK_ONLY=short BENCHMARK_RUNS=1 BENCHMARK_HTTP=0 ./scripts/benchmark.sh

# Keep scratch databases and parser output for diagnosis.
BENCHMARK_KEEP_SCRATCH=1 ./scripts/benchmark.sh

# Override the corpus or output directory.
BENCHMARK_SHORT_MATCH_ID=123 \
BENCHMARK_NORMAL_MATCH_ID=456 \
BENCHMARK_LARGE_MATCH_ID=789 \
BENCHMARK_OUTPUT_DIR=/tmp/dota-results \
./scripts/benchmark.sh

# Use a two-minute heat-map range and seven warm query samples.
BENCHMARK_HEATMAP_RANGE_SECONDS=120 \
BENCHMARK_HEATMAP_WARM_SAMPLES=7 \
./scripts/benchmark.sh
```

`BENCHMARK_RUNS` can change the measured-run count, but acceptance reports
should retain at least three. `BENCHMARK_HTTP_MATCH_ID` selects which final
measured warehouse supplies the ingestion acknowledgement probe; normal and
near-hour warehouses always supply overview and browser-render probes when HTTP
measurement is enabled. `BENCHMARK_GPM_WINDOW_SECONDS` selects one of the six
supported rolling windows and defaults to 60. `BENCHMARK_GPM_WARM_SAMPLES`
defaults to five query calls, and `BENCHMARK_BROWSER_RENDER_SAMPLES` defaults
to three fresh mobile navigations. `BENCHMARK_GPM_MAX_ROUNDING_DIFFERENCE`
defaults to 1 GPM and is the acceptance tolerance for the final cumulative-gold
comparison. `BENCHMARK_HEATMAP_RANGE_SECONDS` sets the length of the range at
the center of the match and defaults to 300. A shorter match uses its full
duration. `BENCHMARK_HEATMAP_WARM_SAMPLES` defaults to five. You can override
image names with `BENCHMARK_PARSER_IMAGE`, `BENCHMARK_APP_IMAGE`,
`BENCHMARK_WEB_IMAGE`, and `BENCHMARK_E2E_IMAGE`.

The host needs Bash, Docker with Compose, `jq`, `curl`, and Node.js. The script
uses Docker directly when the current user can access it and otherwise uses
`sudo docker`.

## Measurement definitions

- Preparation is replay decompression or input preparation reported by the
  parser manifest.
- Clarity parsing is the parser's filtered Clarity runner and exporter time.
- DuckDB writes are the loader transaction time minus the nested summary
  materialization time.
- Summary creation is the materialization timer recorded by the loader.
- Complete ingestion is parser-container wall time plus loader-container wall
  time. It includes checksum work and container startup, but excludes download,
  report generation, and the later HTTP probes.
- Peak RSS is the largest sum of process RSS observed with `docker top` for
  either ingestion container, sampled every 200 ms.
- Row counts include both exported staging rows and rows retained in DuckDB.
- Gold-event rows count the typed `analysis.player_gold_events` facts retained
  for the selected extraction.
- Warehouse bytes are the exact file size after loading one replay into its
  fresh DuckDB database and before query probes run.
- Position output bytes are the exact size of `hero_positions.ndjson`. The
  report also shows this size as a percentage of all exported NDJSON bytes.
- Position row counts show both the parser manifest count and the retained
  `analysis.hero_position_samples` count. A new extraction must store position
  rows and must give equal cell and selected-sample totals for the measured
  range.
- Cold heat-map latency is the first 64 by 64 macro query on a new read-only
  DuckDB connection. Warm heat-map latency is the median of five later queries
  on that connection. The query uses all heroes and times with 100 ms
  precision.
- Heat-map response latency includes a new read-only connection, the
  availability query, the heat-map query, and response assembly. Heat-map
  response bytes are the UTF-8 JSON size of that response.
- A schema-version-1 extraction has no position data. The benchmark reports
  the position measurements as unavailable and continues with the other
  measurements and all GPM acceptance checks.
- Cold rolling GPM latency is the first materialized macro query on a new
  read-only DuckDB connection. Warm latency is the median of five later queries
  on that connection.
- GPM response bytes are the UTF-8 JSON size of the grouped server response for
  a one-second output step. The rolling window defaults to 60 seconds.
- Matches at least as long as the selected window must produce ten non-empty
  player series, two non-empty team series, and five players per team. The
  benchmark fails instead of timing an empty or incomplete result.
- The Phase-1 final-GPM check subtracts each player's last cumulative value at
  or before game time zero from the last stored cumulative earned-gold value,
  divides that earned gold over match duration, rounds the result to the same
  integer precision as the scoreboard, and compares it to final `gold_per_min`.
  All ten players must compare within the configured 1 GPM rounding tolerance;
  the report includes the maximum difference.
- Overview latency is one unmeasured warm request followed by 30 sequential
  loopback requests. The report uses the nearest-rank p95.
- Browser render latency starts immediately before a fresh 390 by 844 browser
  navigation and stops when either the granular GPM graph or its explicit
  unavailable state is visible. Three samples are collected for the normal and
  near-hour fixtures, and the report uses nearest-rank p95.
- Acknowledgement latency starts when the browser activates the ingestion
  button and stops when the queued or active job is visibly confirmed.

## Limitations

- The current parser starts its preparation timer after replay checksum
  validation. Checksum and setup work therefore appear in complete time but not
  in the preparation phase.
- Docker memory polling can miss a spike shorter than 200 ms. The result is a
  conservative sampled peak, not an exact high-water mark from the process.
- The acknowledgement probe is a single end-to-end browser observation. It is
  intentionally not repeated because each submission creates a job, although
  only the disposable benchmark job directory is affected.
- Browser render time includes navigation, server queries, React rendering, and
  browser layout; it is an end-to-end readiness measurement rather than an
  isolated JavaScript render-duration profile.
- The large fixture is under 60 minutes but is materially larger than the short
  fixture. Replace it with a longer replay when one becomes available.
- Image builds are outside measured ingestion time. BuildKit cache state does
  not affect the reported phase timings.
- Host contention can affect results. Record competing workloads or rerun the
  benchmark on an otherwise idle development computer.
- Position-file bytes show the parser-output impact directly. The warehouse
  value is the complete database size. It does not isolate the position table
  from indexes, other tables, or DuckDB storage overhead.
