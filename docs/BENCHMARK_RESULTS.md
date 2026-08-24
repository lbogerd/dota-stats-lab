# Dota replay ingestion benchmark

Generated: 2026-08-24T23:48:31Z

## Environment

- CPU: 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 logical CPUs)
- Memory: 31.1 GiB
- Operating system: Ubuntu 24.04.4 LTS; kernel Linux 6.8.0-136-generic x86_64 GNU/Linux
- Docker: 29.6.1; Compose: 5.3.1
- Git revision: 6a95cb57749f8d8c70bde1453d15d193ecbe5098 (dirty)
- Clarity fork: 11df6814e80b386a299aab3878ab34709d7e35f3
- Export format: 1.0.0
- DuckDB Node API: 1.5.5-r.4

## Median measured results

| Replay | Match | Runs | Duration | Replay | Preparation | Clarity | DuckDB writes | Summary | Complete | Peak RSS | Rows | Overview p95 | Ack |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| short | 8946228107 | 3 | 18:22 | 51.8 MiB | 0.10 s | 0.96 s | 0.42 s | 0.06 s | 2.62 s | 345.1 MiB | 34,770 | not measured | not measured |
| normal | 8955653541 | 3 | 38:28 | 158.9 MiB | 0.26 s | 1.71 s | 0.61 s | 0.08 s | 4.24 s | 494.3 MiB | 105,153 | 75.45 ms | 68.90 ms |
| large | 8946303764 | 3 | 55:27 | 170.7 MiB | 0.28 s | 1.80 s | 0.67 s | 0.10 s | 4.58 s | 511.0 MiB | 120,439 | not measured | not measured |

## Measurement boundaries and limitations

- Replay download time is excluded; every run mounts an existing cached replay read-only.
- Each warm-up and measured run uses a newly created staging directory and DuckDB warehouse.
- Preparation is the parser's decompression/input-preparation timer. Replay hashing and container startup are represented only in complete wall time.
- DuckDB write time is the loader transaction time less its nested summary-materialization timer.
- Complete time is parser-container wall time plus loader-container wall time. Report generation and HTTP probes are excluded.
- Peak RSS is the largest sum of process RSS observed with `docker top` in either ingestion container at 200 ms intervals; a narrow spike between samples may be missed.
- The overview result uses one unmeasured warm request followed by 30 sequential loopback HTTP requests.
- Acknowledgement is one browser measurement from activating the ingestion button until the queued or active job is visible. It mutates only the disposable benchmark job directory.
- Container CPU and memory limits are part of the benchmark configuration recorded in the JSON report.

Raw machine-readable results were retained locally under the ignored `benchmark-results/20260824T234711Z/` directory. Re-run `./scripts/benchmark.sh` to reproduce them.
