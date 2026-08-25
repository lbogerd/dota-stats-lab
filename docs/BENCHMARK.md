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
tree and a new DuckDB file. Download time is not measured. A disposable web
container serves the final normal-match warehouse on loopback. The benchmark
sends one warm overview request and 30 measured overview requests. It also
runs one browser acknowledgement probe. Benchmark containers do not join or
change the deployed Compose application.

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
```

`BENCHMARK_RUNS` can change the measured-run count, but acceptance reports
should retain at least three. `BENCHMARK_HTTP_MATCH_ID` selects which final
measured warehouse supplies the HTTP probes. Image names can be overridden
with `BENCHMARK_PARSER_IMAGE`, `BENCHMARK_APP_IMAGE`,
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
- Overview latency is one unmeasured warm request followed by 30 sequential
  loopback requests. The report uses the nearest-rank p95.
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
- The large fixture is under 60 minutes but is materially larger than the short
  fixture. Replace it with a longer replay when one becomes available.
- Image builds are outside measured ingestion time. BuildKit cache state does
  not affect the reported phase timings.
- Host contention can affect results. Record competing workloads or rerun the
  benchmark on an otherwise idle development computer.
