# Dota replay ingestion benchmark

This report is a historical reference for export format 2.0.0. The current
export format is 2.1.0. Run `./scripts/benchmark.sh` to measure the current
format. Do not compare the old row counts or file sizes with a 2.1.0 extraction.

Generated: 2026-08-26T11:41:01Z

## Environment

- CPU: 11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz (16 logical CPUs)
- Memory: 31.1 GiB
- Operating system: Ubuntu 24.04.4 LTS; kernel Linux 6.8.0-136-generic x86_64 GNU/Linux
- Docker: 29.6.1; Compose: 5.3.1
- Git revision: c50d4151b8c4a7b55f0a6ba0739369c84ac29968
- Clarity fork: 11df6814e80b386a299aab3878ab34709d7e35f3
- Export format: 2.0.0
- DuckDB Node API: 1.5.5-r.4

## Median measured results

| Replay | Match | Runs | Duration | Replay | Preparation | Clarity | DuckDB writes | Summary | Complete | Peak RSS | Rows | Overview p95 | Ack |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| short | 8946228107 | 3 | 18:22 | 51.8 MiB | 0.10 s | 3.35 s | 0.94 s | 1.32 s | 7.44 s | 456.2 MiB | 156,600 | not measured | not measured |
| normal | 8955653541 | 3 | 38:28 | 158.9 MiB | 0.27 s | 6.49 s | 1.38 s | 5.62 s | 16.57 s | 605.0 MiB | 356,018 | not measured | not measured |
| large | 8946303764 | 3 | 55:27 | 170.7 MiB | 0.28 s | 7.69 s | 1.48 s | 11.87 s | 24.43 s | 682.9 MiB | 496,982 | not measured | not measured |

## Hero position and heat-map measurements

| Replay | Match | Positions | Stored | Position output | Total output | Warehouse | Cold heat map | Warm heat map | API response | Response |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| short | 8946228107 | 103,542 | 103,542 | 22.6 MiB (25.0%) | 90.4 MiB | 21.0 MiB | 8.46 ms | 12.41 ms | 66.35 ms | 45.0 KiB |
| normal | 8955653541 | 208,166 | 208,166 | 45.7 MiB (18.3%) | 249.7 MiB | 36.5 MiB | 9.99 ms | 10.19 ms | 74.59 ms | 48.0 KiB |
| large | 8946303764 | 312,089 | 312,089 | 68.7 MiB (22.5%) | 305.4 MiB | 45.0 MiB | 10.45 ms | 10.32 ms | 80.97 ms | 75.4 KiB |

The exported and stored position counts are equal for all measured runs. The
64 by 64 heat-map cell totals are also equal to the selected sample totals.
The measurements use a 300-second range with 100 ms time precision.

## Real-replay position validation

The final parser was also checked with match `8943142948`. It exported 144,126
position rows for all ten roster players. The file had 15,152 sample
boundaries. No boundary had more than ten rows. The average was 9.512 rows per
boundary; 13,585 boundaries had at least nine rows. There were no duplicate
time and player keys.

The Y axis was inverted only when the heat-map grid was made. Five observed
respawns confirmed the image direction and fountain calibration:

| Player | Team | Time | World position | Map location |
|---:|---:|---:|---:|---|
| 6 | Dire | 1:16.1 | (6902, 6420) | top-right Dire fountain |
| 9 | Dire | 1:59.1 | (7036, 6312) | top-right Dire fountain |
| 3 | Radiant | 4:44.7 | (-6700, -6700) | bottom-left Radiant fountain |
| 2 | Radiant | 5:57.1 | (-6750, -6550) | bottom-left Radiant fountain |
| 5 | Dire | 6:32.9 | (7076, 6359) | top-right Dire fountain |

The strict mobile browser test targeted this extraction. It required the ready
state, selected one hero, changed the range to `0:00.0` through `0:10.0`, and
confirmed that the page did not exceed a 390-pixel viewport.

## Granular GPM measurements

| Replay | Match | Gold events | Warehouse | Cold GPM | Warm GPM | 1s response | Max final GPM diff | Browser render p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| short | 8946228107 | 18,060 | 21.0 MiB | 53.07 ms | 37.68 ms | 418.1 KiB | 1.00 GPM | not measured |
| normal | 8955653541 | 42,443 | 36.5 MiB | 95.18 ms | 81.53 ms | 916.1 KiB | 1.00 GPM | not measured |
| large | 8946303764 | 64,451 | 45.0 MiB | 163.27 ms | 106.52 ms | 1338.0 KiB | 1.00 GPM | not measured |

## Measurement boundaries and limitations

- Replay download time is excluded; every run mounts an existing cached replay read-only.
- Each warm-up and measured run uses a newly created staging directory and DuckDB warehouse.
- Preparation is the parser's decompression/input-preparation timer. Replay hashing and container startup are represented only in complete wall time.
- DuckDB write time is the loader transaction time less its nested summary-materialization timer.
- Complete time is parser-container wall time plus loader-container wall time. Report generation and HTTP probes are excluded.
- Peak RSS is the largest sum of process RSS observed with `docker top` in either ingestion container at 200 ms intervals; a narrow spike between samples may be missed.
- The overview result uses one unmeasured warm request followed by 30 sequential loopback HTTP requests.
- Warehouse size is the exact DuckDB file size after loading one match into a fresh database and before running GPM probes.
- Position output is the exact byte size of `hero_positions.ndjson`; its percentage is its share of all exported NDJSON bytes.
- Heat-map latency uses all heroes in a centered 300-second range on a 64 by 64 grid.
- The API measurement includes a read-only connection, the availability query, the heat-map query, and response assembly.
- Cold GPM is the first rolling-macro query on a new read-only DuckDB connection. Warm GPM is the median of repeated materialized queries on that same connection.
- The GPM response size is the UTF-8 JSON byte length of the grouped 60-second-window response at a one-second output step.
- The real-replay validation requires ten non-empty player series, two non-empty complete-team series, and five players per team when the match is at least as long as the selected window.
- Final GPM validation subtracts each player's last value at or before game time zero from the last stored cumulative earned-gold value, normalizes it per minute over match duration, and compares that result with the final scoreboard GPM.
- Browser render time measures a fresh 390 by 844 navigation until the granular GPM graph or explicit unavailable state is visible. It is collected for the normal and near-hour fixtures.
- Acknowledgement is one browser measurement from activating the ingestion button until the queued or active job is visible. It mutates only the disposable benchmark job directory.
- Container CPU and memory limits are part of the benchmark configuration recorded in the JSON report.

The benchmark used three measured runs after one warm-up for each replay. Run
`./scripts/benchmark.sh` to create a new machine-readable result set.
