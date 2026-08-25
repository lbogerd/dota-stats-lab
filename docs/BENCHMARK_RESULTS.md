# Dota replay ingestion benchmark

Generated: 2026-08-25T20:22:06Z

## Environment

- CPU: 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 logical CPUs)
- Memory: 31.1 GiB
- Operating system: Ubuntu 24.04.4 LTS; kernel Linux 6.8.0-136-generic x86_64 GNU/Linux
- Docker: 29.6.1; Compose: 5.3.1
- Git revision: fb12fd151ab40df45e71f376060387ee06277325 (dirty)
- Clarity fork: 11df6814e80b386a299aab3878ab34709d7e35f3
- Export format: 1.3.0
- DuckDB Node API: 1.5.5-r.4

## Median measured results

| Replay | Match | Runs | Duration | Replay | Preparation | Clarity | DuckDB writes | Summary | Complete | Peak RSS | Rows | Overview p95 | Ack |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| short | 8946228107 | 3 | 18:22 | 51.8 MiB | 0.10 s | 2.44 s | 0.90 s | 0.95 s | 5.69 s | 428.4 MiB | 53,058 | not measured | not measured |
| normal | 8955653541 | 3 | 38:28 | 158.9 MiB | 0.24 s | 4.92 s | 1.30 s | 4.72 s | 13.64 s | 608.2 MiB | 147,852 | 79.64 ms | 61.28 ms |
| large | 8946303764 | 3 | 55:27 | 170.7 MiB | 0.26 s | 5.95 s | 1.42 s | 11.06 s | 21.38 s | 644.5 MiB | 184,893 | 89.15 ms | not measured |

## Granular GPM measurements

| Replay | Match | Gold events | Warehouse | Cold GPM | Warm GPM | 1s response | Max final GPM diff | Browser render p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| short | 8946228107 | 18,060 | 14.5 MiB | 63.02 ms | 44.10 ms | 418.1 KiB | 1.00 GPM | not measured |
| normal | 8955653541 | 42,443 | 25.0 MiB | 94.08 ms | 74.99 ms | 916.1 KiB | 1.00 GPM | 954.27 ms |
| large | 8946303764 | 64,451 | 28.5 MiB | 169.63 ms | 99.32 ms | 1338.0 KiB | 1.00 GPM | 982.28 ms |

## Measurement boundaries and limitations

- Replay download time is excluded; every run mounts an existing cached replay read-only.
- Each warm-up and measured run uses a newly created staging directory and DuckDB warehouse.
- Preparation is the parser's decompression/input-preparation timer. Replay hashing and container startup are represented only in complete wall time.
- DuckDB write time is the loader transaction time less its nested summary-materialization timer.
- Complete time is parser-container wall time plus loader-container wall time. Report generation and HTTP probes are excluded.
- Peak RSS is the largest sum of process RSS observed with `docker top` in either ingestion container at 200 ms intervals; a narrow spike between samples may be missed.
- The overview result uses one unmeasured warm request followed by 30 sequential loopback HTTP requests.
- Warehouse size is the exact DuckDB file size after loading one match into a fresh database and before running GPM probes.
- Cold GPM is the first rolling-macro query on a new read-only DuckDB connection. Warm GPM is the median of repeated materialized queries on that same connection.
- The GPM response size is the UTF-8 JSON byte length of the grouped 60-second-window response at a one-second output step.
- The real-replay validation requires ten non-empty player series, two non-empty complete-team series, and five players per team when the match is at least as long as the selected window.
- Final GPM validation subtracts each player's last value at or before game time zero from the last stored cumulative earned-gold value, normalizes it per minute over match duration, and compares that result with the final scoreboard GPM.
- Browser render time measures a fresh 390 by 844 navigation until the granular GPM graph or explicit unavailable state is visible. It is collected for the normal and near-hour fixtures.
- Acknowledgement is one browser measurement from activating the ingestion button until the queued or active job is visible. It mutates only the disposable benchmark job directory.
- Container CPU and memory limits are part of the benchmark configuration recorded in the JSON report.

Raw machine-readable results: `/home/xub/src/dota-stats-lab/benchmark-results/session-cleanup-20260825/results.json`
