# Dota Replay Data Lab

A compact, container-first laboratory for learning how a complete Dota 2 match becomes useful analytical data. Clarity parses replay files, DuckDB owns the durable warehouse and calculations, and a TanStack Start site presents the match list, scoreboards, team totals, and net-worth analysis.

The default `match-analysis-v1` profile keeps the entire analytically useful match, not merely the fields currently drawn by the website:

- the complete final `CMsgDOTAMatch` document;
- the complete `CDOTAMatchMetadataFile`, including per-player and team graphs and snapshots;
- every Clarity combat-log entry in compact typed columns.

It intentionally excludes packet transport, rendering, sound, voice, and generic entity history. Those streams are large and have no defined use case here; the cached replay remains the durable source if a future extraction profile needs them.

## Quick start

Docker Engine with Compose v2 is the only required runtime. The wrapper uses the four external volumes declared in `compose.yaml`.

```sh
./dota init
./dota ingest 8955653541
docker compose up --detach --build --wait web parser-worker
```

Open `http://127.0.0.1:3400` locally. The deployed, authenticated instance is at [dota.tainer.run](https://dota.tainer.run).

Download by match ID is the normal path. A local uncompressed or compressed replay is also supported; its suffix is irrelevant because the content is identified by magic bytes:

```sh
DOTA_REPLAY_SOURCE=/absolute/path/replay.dem ./dota ingest MATCH_ID
DOTA_REPLAY_SOURCE=/absolute/path/replay.dem.bz2 ./dota ingest MATCH_ID
DOTA_REPLAY_SOURCE=https://example/replay.dem.bz2 ./dota ingest MATCH_ID
```

The first successful acquisition is cached with its size, SHA-256 checksum, source, and timestamp. Every cache hit rechecks the metadata, size, checksum, and file format. Downloads stream through a temporary file and are published only after validation. Temporary network errors and HTTP 408, 425, 429, and 5xx responses use bounded retries and honor a bounded `Retry-After`; unavailable replays are reported separately.

## One-command workflows

```sh
# Development server (after ./dota init)
pnpm dev

# Production images
sudo docker compose build test parser web parser-worker e2e

# All automated checks (web/CLI unit and integration tests, parser tests, browser tests)
pnpm check && pnpm build && pnpm test && pnpm test:web && sudo docker compose build parser e2e && sudo docker compose run --rm --no-deps e2e

# Reproducible real-replay benchmark
./scripts/benchmark.sh
```

The browser tests expect the Compose web service to be healthy and at least one successfully ingested match to be available. The benchmark procedure and corpus are documented in [docs/BENCHMARK.md](docs/BENCHMARK.md); the latest measured report is [docs/BENCHMARK_RESULTS.md](docs/BENCHMARK_RESULTS.md).

## Architecture and ownership

There are two permanent processes:

1. `web` runs TanStack Start, downloads replays, coordinates durable jobs, performs serialized DuckDB loading, and serves read-only queries.
2. `parser-worker` runs the JVM Clarity parser without network or warehouse access.

The JVM worker is separate because Clarity is Java and replay parsing is CPU/memory intensive. Process isolation keeps the web server responsive and avoids a high-volume event stream crossing another API boundary. Job request, status, and result files are atomically published in the staging volume. One coordinator advances one job at a time; restart recovery resumes safe states or records a clear failure instead of duplicating work.

DuckDB uses a single-process ownership model. A process-local queue plus a recoverable file lease serializes all warehouse opens, so a read never overlaps a write from this application. Each reader opens DuckDB read-only. Each ingestion validates staging before `BEGIN`, imports and materializes summaries in one transaction, marks success immediately before commit, and becomes visible only after commit. A replay checksum plus parser identity, export version, and canonical profile configuration determine the extraction ID, making repeated ingestion idempotent and keeping versions explicit.

One-shot `fetch`, `parser`, and `loader` services power the CLI. `warehouse-init` applies migrations before a fresh web container starts. The web origin is bound only to `127.0.0.1:3400`; the public hostname is protected by the tainer authentication gateway.

## Extraction and storage

The profile applies Clarity runner filters before generic message/entity handling. Explicit handlers retain three reliable analytical sources:

| Source | Permanent representation | Why it is retained |
|---|---|---|
| `CMsgDOTAMatch` | complete JSON plus typed `analysis.matches`, `analysis.players`, and `analysis.player_items` | authoritative final overview and scoreboard |
| `CDOTAMatchMetadataFile` | complete JSON plus typed `analysis.team_time_series` | graphs, inventory/ability snapshots, wards, support statistics, and other future analyses |
| `CMsgDOTACombatLogEntry` | typed `raw.combat_events` rows | every semantic field exposed by Clarity's combat-log API: combat, economy, levels, runes, wards, modifiers, visibility, abilities, objectives, and locations |

The two complete documents stay in `raw.records`; BLOB fields are kept in `raw.record_blobs`. Common filters, joins, and aggregates never need to parse the large documents because their current fields are normalized. Combat events use typed scalar columns and an extraction/time/type index rather than a full text copy. Internal Clarity string-table indices are omitted because the resolved names are retained and the indices have no independent Dota meaning.

Key schemas:

- `catalog`: acquisitions, extraction versions, limits, phase times, row counts, failures, and manifests.
- `raw`: complete source documents, document BLOBs, and typed combat events.
- `analysis`: normalized match/player/item/time-series facts plus reusable DuckDB macros.

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

-- Explore the entire combat timeline retained from Clarity.
SELECT event_type, count(*) AS events, sum(value) AS total_value
FROM raw.combat_events
WHERE extraction_id = (
  SELECT extraction_id FROM analysis.latest_successful_extractions
  WHERE match_id = 8955653541
)
GROUP BY event_type
ORDER BY events DESC;
```

Run these in the containerized shell with `./dota sql`. The optional browser editor accepts only one bounded, read-only `SELECT` and rejects file access, extensions, attachment, copying, configuration, and mutations.

## Website

`/matches` reads the latest successful extraction for every stored match and shows match ID, local date/time, duration, result, and both scores. `/matches/:matchId` queries DuckDB for the overview, both rosters, final items, totals, and a derived final-net-worth comparison. Tables use semantic headers/captions; the phone layout becomes readable statistic cards. Loading, empty, missing-data, and error states are explicit, keyboard focus is visible, and winner text supplements color.

Hero and item images are served from Valve's public Steam CDN using Dota 2 asset paths. Dota and Dota 2 are Valve trademarks; this independent learning project is not affiliated with or endorsed by Valve. The local ID/name maps are project-authored compatibility data and unknown/new IDs deliberately fall back to text rather than a broken image.

## TanStack package decisions

The implementation follows the current official [TanStack Start](https://tanstack.com/start/latest), [Router](https://tanstack.com/router/latest), and [Query](https://tanstack.com/query/latest) documentation.

| Package | Decision | Reason |
|---|---|---|
| Start + Router | selected | supported full-stack routing, server functions, loaders, pending/error boundaries |
| Query | selected | loader hydration, remote-state caching, and job polling lifecycle |
| Table | rejected | match lists are small and each roster has ten rows; semantic HTML is less code |
| Form | rejected | ingestion is one validated field, so its abstraction would add more code than it removes |
| Charts | rejected | the required analysis is clearer as exact team totals; current chart packages are optional/preview |
| Virtual | rejected | no normal list is long enough to justify virtualization |
| Pacer | rejected | a small `refetchInterval` plus provider-specific `Retry-After` logic is clearer |
| Store | rejected | Query owns remote state and no substantial shared client state remains |
| DB | rejected | DuckDB is authoritative and the small UI does not need a reactive client collection |
| Devtools | rejected | production deployment does not need a diagnostics bundle; existing browser/server tools suffice |

Package versions are pinned in `package.json` and `pnpm-lock.yaml`. No experimental TanStack package is required.

## Tests and real replay fixtures

Node tests cover UBIGINT boundaries, format validation, acquisition/cache/retry behavior, manifests, locking, job recovery, atomic rollback, repeated ingestion, storage policy, migrations, analysis macros, SQL safety, and query files. Vitest covers missing optional overview fields and display conversions. The parser image compiles the Clarity fork and runs Java tests. Playwright covers the phone workflow and the real match-overview path.

Large or unlicensed replays are never committed. To use your own parser fixture, keep it outside Git and run:

```sh
DOTA_REPLAY_SOURCE=/absolute/path/to/fixture.dem ./dota ingest MATCH_ID
```

The default benchmark uses three cached real matches (short, normal, and large), performs one warm-up and three measured fresh-warehouse ingestions apiece, samples peak RSS, and measures 30 warm overview requests. Download time is excluded. Each run owns a disposable database and cannot alter the live warehouse.

## Recovery and operations

- The replay cache is the source for re-extraction; parsed staging data is disposable.
- Failed parser/loader staging is retained for diagnosis. Successful staging is removed.
- An interrupted queued/fetching/loading job is recovered; an invalid or unsafe state is marked failed with its stage.
- If the same replay/profile already committed, both CLI and web paths report `already_loaded` without duplicating rows.
- Applied migration files are immutable. Add a later numbered migration for schema changes.
- `parser-identity.json` is the single source of truth for the Clarity fork revision and extraction contract. Bump the export format when output/import semantics change.
- Do not run `docker compose down --volumes` as routine cleanup. Named volumes are durable application state, though they are not backups.

The parser and loader have no network, run as non-root with reduced capabilities and read-only root filesystems, and retain the original replay after parse or database failure. These controls reduce exposure; Docker is not a complete security boundary.
