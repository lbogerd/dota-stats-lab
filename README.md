# Dota Replay Data Lab

This project is a small, container-first lab for Dota 2 replay data. Clarity parses replay files. DuckDB stores the data and runs the calculations. A TanStack Start site shows matches, scoreboards, team totals, net-worth analysis, and rolling gold per minute (GPM).

The default `match-analysis-v1` profile keeps the entire analytically useful match, not merely the fields currently drawn by the website:

- the complete final `CMsgDOTAMatch` document;
- the complete `CDOTAMatchMetadataFile`, including per-player and team graphs and snapshots;
- every Clarity combat-log entry in compact typed columns;
- cumulative earned-gold changes from `CDOTA_DataRadiant` and `CDOTA_DataDire`, timed by the game-rules clock.

The profile excludes packet transport, rendering, sound, voice, and generic entity history. These streams are large and have no defined use case here. The cached replay remains the source for a future extraction profile.

## Quick start

Docker Engine with Compose v2 is the only required runtime. The wrapper uses the four external volumes declared in `compose.yaml`.

```sh
git submodule update --init --recursive
./dota init
./dota ingest 8955653541
docker compose up --detach --build --wait web parser-worker
```

Open `http://127.0.0.1:3400` locally. The deployed, authenticated instance is at [dota.tainer.run](https://dota.tainer.run).

Download by match ID is the normal path. You can also use a local or remote replay. The code detects compression from the file contents, not the file name:

```sh
DOTA_REPLAY_SOURCE=/absolute/path/replay.dem ./dota ingest MATCH_ID
DOTA_REPLAY_SOURCE=/absolute/path/replay.dem.bz2 ./dota ingest MATCH_ID
DOTA_REPLAY_SOURCE=https://example/replay.dem.bz2 ./dota ingest MATCH_ID
```

### TI 2026 replay archive on this host

All 147 compressed TI 2026 replays are preserved outside this Git checkout at
`/home/xub/dota-stats-archives/ti2026`. The archive includes `matches.csv`, the
replays and acquisition metadata under `matches/`, per-match logs, and a
resumable bulk-import helper. It uses the local files through
`DOTA_REPLAY_SOURCE`, so restoration does not depend on the replay URLs or the
Docker cache:

```sh
/home/xub/dota-stats-archives/ti2026/import-all.sh
```

The helper defaults to two concurrent parser jobs. Override the checkout or
reduce concurrency when necessary:

```sh
DOTA_STATS_LAB_REPO=/path/to/dota-stats-lab TI2026_IMPORT_JOBS=1 \
  /home/xub/dota-stats-archives/ti2026/import-all.sh
```

Rerunning it is safe: the extraction identity skips exact successful imports,
while an exporter-version bump creates a new extraction. The archive files were
initially hard-linked from the Docker replay volume to avoid another 23 GiB of
disk use. Removing the Docker volume does not remove the archive names, but the
replay files must be treated as immutable because in-place edits would affect
both links. See the archive's own `README.md` for the same recovery instructions.

The first successful acquisition is cached with its size, SHA-256 checksum, source, and timestamp. Every cache hit checks the metadata, size, checksum, and file format again. A download stays in a temporary file until validation succeeds. Temporary network errors use a limited number of retries. This also applies to HTTP 408, 425, 429, and 5xx responses. The downloader honors a bounded `Retry-After` value and reports unavailable replays separately.

## One-command workflows

```sh
# Application and test images
sudo docker compose build test parser web parser-worker e2e

# All automated checks (web/CLI unit and integration tests, parser tests, browser tests)
pnpm check && pnpm build && pnpm test && pnpm test:web && sudo docker compose build parser e2e && sudo docker compose run --rm --no-deps e2e

# Reproducible real-replay benchmark
./scripts/benchmark.sh
```

Docker is the supported way to run the complete application. Host development needs Node.js 22 and pnpm 10. It also needs explicit host paths for replays, staging data, the warehouse, migrations, and saved queries.

The browser tests expect a healthy Compose web service. They also expect at least one stored match. [docs/BENCHMARK.md](docs/BENCHMARK.md) explains the benchmark. [docs/BENCHMARK_RESULTS.md](docs/BENCHMARK_RESULTS.md) is a reference report from the current extraction format.

## Architecture and ownership

There are two permanent processes:

1. `web` runs TanStack Start, downloads replays, coordinates durable jobs, performs serialized DuckDB loading, and serves read-only queries.
2. `parser-worker` runs the JVM Clarity parser without network or warehouse access.

The JVM worker is separate because Clarity is Java and replay parsing uses much CPU and memory. This keeps the web server responsive. It also avoids sending a large event stream through another API. Job request, status, and result files are published atomically in the staging volume. One coordinator advances one job at a time. After a restart, it resumes safe states or records a clear failure.

DuckDB uses a single-process ownership model. A local queue and a recoverable file lease serialize all warehouse access. A read cannot overlap a write from this application. Each reader opens DuckDB in read-only mode. An ingestion validates staging before `BEGIN`. It imports data and creates summaries in one transaction. The data becomes visible only after commit. The replay checksum, parser identity, export version, and profile configuration define the extraction ID. Repeated ingestion is therefore safe and does not add duplicate data.

One-shot `fetch`, `parser`, and `loader` services power the CLI. `warehouse-init` applies migrations before a fresh web container starts. The web origin is bound only to `127.0.0.1:3400`; the public hostname is protected by the tainer authentication gateway.

## Extraction and storage

The profile applies Clarity runner filters before generic message/entity handling. Explicit handlers retain three reliable analytical sources:

| Source | Permanent representation | Why it is retained |
|---|---|---|
| `CMsgDOTAMatch` | complete JSON plus typed `analysis.matches`, `analysis.players`, and `analysis.player_items` | authoritative final overview and scoreboard |
| `CDOTAMatchMetadataFile` | complete JSON plus typed `analysis.team_time_series` | graphs, inventory/ability snapshots, wards, support statistics, and other future analyses |
| `CMsgDOTACombatLogEntry` | typed `raw.combat_events` rows | every semantic field exposed by Clarity's combat-log API: combat, economy, levels, runes, wards, modifiers, visibility, abilities, objectives, and locations |
| `CDOTA_DataRadiant` + `CDOTA_DataDire` + `CDOTAGamerulesProxy` | targeted entity/property staging plus typed `analysis.player_gold_events` | pause-safe cumulative earned-gold changes used for rolling player and team GPM |

The two complete documents stay in `raw.records`. BLOB fields stay in `raw.record_blobs`. Common filters, joins, and totals use normalized fields, so they do not parse the large documents. Combat events use typed columns and an extraction/time/type index. Internal Clarity string-table indices are not stored. The resolved names contain the useful Dota information.

Key schemas:

- `catalog`: acquisitions, extraction versions, limits, phase times, row counts, failures, and manifests.
- `raw`: complete source documents, document BLOBs, and typed combat events.
- `analysis`: normalized match/player/item/time-series/gold facts plus reusable DuckDB macros.

Stored timestamps use UTC. The website shows the browser's named local time zone and also displays the UTC value. A missing name or statistic stays null and renders as `Unknown`; the application never invents a value.

Default safety limits are 2 GiB input, 1 GiB parser output, 2,000,000 output rows, 180 seconds of parser work, a four-minute worker boundary, and 4 GiB container memory. Override the parser environment variables only after measuring a legitimate replay that needs it.

Every ingestion phase writes one compact diagnostic line containing `ingestion`, `phase`, `elapsed_ms`, and `rows`. Full replay records and player identifiers are not logged.

## DuckDB examples

Match IDs remain decimal strings at JSON/browser boundaries and become DuckDB `UBIGINT` parameters only after full-range validation.

```sql
-- Final match summary.
SELECT * FROM analysis.match_summary(8955653541);

-- Final player scoreboard.
SELECT * FROM analysis.match_players(8955653541);

-- Team totals calculated by DuckDB.
SELECT * FROM analysis.match_team_totals(8955653541);

-- Net-worth time series and advantage for both teams.
SELECT sample_index, team_id, net_worth, net_worth_advantage
FROM analysis.match_net_worth(8955653541)
ORDER BY sample_index, team_id;

-- Explore the actual-game combat timeline retained from Clarity.
SELECT event_type, count(*) AS events, sum(value) AS total_value
FROM raw.combat_events AS event
WHERE event.extraction_id = (
  SELECT extraction_id FROM analysis.latest_successful_extractions
  WHERE match_id = 8955653541
)
AND analysis.is_actual_game(event.extraction_id, event.sequence)
GROUP BY event_type
ORDER BY events DESC;

-- Rolling player and complete five-player team GPM at one-second intervals.
SELECT *
FROM analysis.match_rolling_gpm(8955653541, 60, 1)
ORDER BY series_kind, team_id, player_slot NULLS FIRST, game_time_seconds;
```

The actual-game filter includes pre-game map activity from the pre-game state onward, as well as the complete match, and excludes post-game events.

Run these queries with `./dota sql`. The browser editor accepts one bounded, read-only `SELECT`. It rejects file access, extensions, attachments, copies, configuration changes, and data changes.

## Website

`/matches` reads the latest successful extraction for every stored match. It shows the match ID, local date and time, duration, result, and both scores. `/matches/:matchId` shows the overview, rosters, final items, totals, final net-worth comparison, and rolling GPM. The GPM section offers fixed 1, 5, 10, 30, 60, and 300-second windows, compares both teams, and limits the player chart to one selected team. Its exact values can be inspected with pointer input or the keyboard. Older extractions retain a clear unavailable state instead of using an approximation. Tables use clear headers and captions. On a phone, tables become statistic cards. The site has clear loading, empty, missing-data, and error states. Keyboard focus is visible, and winner text does not depend on color.

Hero and item images are served from Valve's public Steam CDN using Dota 2 asset paths. Dota and Dota 2 are Valve trademarks; this independent learning project is not affiliated with or endorsed by Valve. The local ID/name maps are project-authored compatibility data and unknown/new IDs deliberately fall back to text rather than a broken image.

## TanStack package decisions

The implementation follows the current official [TanStack Start](https://tanstack.com/start/latest), [Router](https://tanstack.com/router/latest), and [Query](https://tanstack.com/query/latest) documentation.

| Package | Decision | Reason |
|---|---|---|
| Start + Router | selected | supported full-stack routing, server functions, loaders, pending/error boundaries |
| Query | selected | loader hydration, remote-state caching, and job polling lifecycle |
| Table | rejected | match lists are small and each roster has ten rows; semantic HTML is less code |
| Form | rejected | ingestion is one validated field, so its abstraction would add more code than it removes |
| Charts | package rejected | a small reusable SVG line chart preserves exact unsmoothed GPM values, pointer/keyboard inspection, and mobile sizing without another dependency |
| Virtual | rejected | no normal list is long enough to justify virtualization |
| Pacer | rejected | a small `refetchInterval` plus provider-specific `Retry-After` logic is clearer |
| Store | rejected | Query owns remote state and no substantial shared client state remains |
| DB | rejected | DuckDB is authoritative and the small UI does not need a reactive client collection |
| Devtools | rejected | production deployment does not need a diagnostics bundle; existing browser/server tools suffice |

Package versions are pinned in `package.json` and `pnpm-lock.yaml`. No experimental TanStack package is required.

## Tests and real replay fixtures

Node tests cover IDs, replay validation, downloads, cache behavior, manifests, locks, recovery, rollback, repeated ingestion, storage rules, migrations, rolling-GPM analysis, server validation, SQL safety, and query files. Vitest covers missing overview fields, display conversions, GPM query keys, chart interaction, loading/error/empty states, and team/window selection. The parser image compiles the Clarity fork and runs Java tests for targeted gold and game-clock capture. Playwright covers the phone workflow and a real match overview, including its mobile GPM state.

Large or unlicensed replays are never committed. To use your own parser fixture, keep it outside Git and run:

```sh
DOTA_REPLAY_SOURCE=/absolute/path/to/fixture.dem ./dota ingest MATCH_ID
```

The repository includes the match IDs and acquisition URLs for all 147 TI 2026 matches. See [tests/fixtures/README.md](tests/fixtures/README.md). The replay files are not in Git.

The default benchmark uses three cached real matches (short, normal, and large), performs one warm-up and three measured fresh-warehouse ingestions apiece, samples peak RSS, and measures overview and rolling-GPM query/response/render costs. Download time is excluded. Each run owns a disposable database and cannot alter the live warehouse.

## Recovery and operations

- The replay cache is the source for re-extraction; parsed staging data is disposable.
- Failed parser/loader staging is retained for diagnosis. Successful staging is removed.
- An interrupted queued/fetching/loading job is recovered; an invalid or unsafe state is marked failed with its stage.
- If the same replay/profile already committed, both CLI and web paths report `already_loaded` without duplicating rows.
- Applied migration files are immutable. Add a later numbered migration for schema changes.
- `parser-identity.json` is the single source of truth for the Clarity fork revision and extraction contract. Bump the export format when output/import semantics change.
- Do not run `docker compose down --volumes` as routine cleanup. Named volumes are durable application state, though they are not backups.

The parser and loader have no network access. They run as non-root with reduced capabilities and read-only root file systems. They keep the replay after a parser or database failure. These controls reduce risk, but Docker is not a complete security boundary.
