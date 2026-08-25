# Dota replay ingestion benchmark

Generated: 2026-08-24T23:57:11Z

## Environment

- CPU: 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 logical CPUs)
- Memory: 31.1 GiB
- Operating system: Ubuntu 24.04.4 LTS; kernel Linux 6.8.0-136-generic x86_64 GNU/Linux
- Docker: 29.6.1; Compose: 5.3.1
- Git revision: 241872b9884456a6d7b2e1bb2d0def7564df666d (dirty)
- Clarity fork: 11df6814e80b386a299aab3878ab34709d7e35f3
- Export format: 1.1.0
- DuckDB Node API: 1.5.5-r.4

## Median measured results

| Replay | Match | Runs | Duration | Replay | Preparation | Clarity | DuckDB writes | Summary | Complete | Peak RSS | Rows | Overview p95 | Ack |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| short | 8946228107 | 3 | 18:22 | 51.8 MiB | 0.09 s | 1.12 s | 0.78 s | 0.06 s | 3.33 s | 359.0 MiB | 34,770 | not measured | not measured |
| normal | 8955653541 | 3 | 38:28 | 158.9 MiB | 0.23 s | 2.25 s | 1.13 s | 0.08 s | 5.84 s | 498.0 MiB | 105,153 | 74.89 ms | 76.87 ms |
| large | 8946303764 | 3 | 55:27 | 170.7 MiB | 0.27 s | 2.58 s | 1.21 s | 0.10 s | 6.53 s | 534.7 MiB | 120,439 | not measured | not measured |

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

Raw machine-readable results were retained locally under the ignored `benchmark-results/20260824T235552Z/` directory. Re-run `./scripts/benchmark.sh` to reproduce them.
