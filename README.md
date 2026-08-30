# Dota Replay Data Lab

This project is a small, container-first lab for Dota 2 replay data. Clarity parses replay files. DuckDB stores the data and runs the calculations. A TanStack Start site shows matches, scoreboards, team totals, net-worth analysis, Valve win probability, rolling gold per minute (GPM), combat-log damage timelines, hero position heat maps, and derived neutral-camp farming sessions. TanStack Charts renders every graph and heat map.

The default `match-analysis-v4` profile keeps the entire analytically useful match, not merely the fields currently drawn by the website:

- the complete final `CMsgDOTAMatch` document;
- the complete `CDOTAMatchMetadataFile`, including per-player and team graphs and snapshots;
- every Clarity combat-log entry in compact typed columns;
- cumulative earned-gold changes from `CDOTA_DataRadiant` and `CDOTA_DataDire`, timed by the game-rules clock;
- the server's Radiant win-probability history, with spectator updates as a fallback source;
- living main-hero positions at pause-safe 100 ms intervals;
- selected neutral-spawner and camp-creep state used to derive typed
  `neutral-camp-farming-v1` actions.

The profile excludes packet transport, rendering, sound, voice, and generic entity history. These streams are large and have no defined use case here. The cached replay remains the source for a future extraction profile.

## Quick start

Docker Engine with Compose v2 is the only required runtime. The wrapper uses the four external volumes declared in `compose.yaml`.

```sh
git submodule update --init --recursive
./dota init
./dota ingest 8955653541
docker compose up --detach --build --wait web parser-worker sampler
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
while an exporter-version bump creates a new extraction. The replay payloads
were initially hard-linked from the Docker replay volume to avoid another 23
GiB of disk use. Removing the Docker volume does not remove the archive names,
but this is not protection from disk failure or in-place corruption; keep the
payloads immutable and replicate them off-host for a true backup. Their legacy
`.dem.bz2` names contain Zstandard streams, so never choose a decompressor from
the suffix. Ingestion detects compression from the file magic. See the
archive's own `README.md` for checksum and recovery instructions.

The first successful acquisition is cached with its size, SHA-256 checksum, source, and timestamp. Every cache hit checks the metadata, size, checksum, and file format again. A download stays in a temporary file until validation succeeds. Temporary network errors use a limited number of retries. This also applies to HTTP 408, 425, 429, and 5xx responses. The downloader honors a bounded `Retry-After` value and reports unavailable replays separately. Manual jobs keep this cache. Sampled jobs remove their replay directory only after the database load succeeds; failed jobs keep it for diagnosis.

## Ranked match sampler

The `sampler` service polls OpenDota's public-match feed and keeps only ranked matches (`lobby_type = 7`). It stores candidate match IDs and its cursor in a small DuckDB file under the staging volume. It does not store player names or account IDs.

Each closed UTC hour targets 30 matches. The deterministic selection takes up to 24 matches with the highest known average rank tier, then 6 hash-selected control matches. If one group is short, it fills from the remaining matches without duplicates. OpenDota's public feed is smaller than the full Dota match stream, so 30 is a best-effort target and under-target hours are reported clearly.

The default service is live, not a dry run. These settings can be changed in `compose.yaml` or through environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `SAMPLER_TARGET_PER_HOUR` | `30` | Maximum selected matches per UTC hour |
| `SAMPLER_PRIORITY_PER_HOUR` | `24` | High-rank part of the target |
| `SAMPLER_CONTROL_PER_HOUR` | `6` | Deterministic control part of the target |
| `SAMPLER_WINDOW_DELAY_MINUTES` | `90` | Wait after an hour ends before selection |
| `SAMPLER_POLL_INTERVAL_MS` | `60000` | Delay between provider polls |
| `SAMPLER_BACKFILL_HOURS` | `6` | History collected at first start |
| `SAMPLER_MAX_ACTIVE_JOBS` | `60` | Backpressure limit for the shared ingestion queue |
| `SAMPLER_DRY_RUN` | `false` | Select IDs but do not create ingestion jobs |

The sampler writes an atomic heartbeat every 30 seconds. Open `/operations/sampler` for the operations page, `/api/sampler/status` for JSON, or `/health/sampler` for a health response. Monitoring warns after 15 minutes without a successful provider request and becomes critical after 30 minutes. A heartbeat older than 2 minutes is critical. Queue depth, oldest queued job, failed work, and disk use are also shown. The main `/health` endpoint stays separate so a provider outage does not restart the website.

## One-command workflows

```sh
# Application and test images
sudo docker compose build test parser web parser-worker e2e

# All automated checks (catalog, web/CLI, parser, and browser tests)
pnpm release:check && sudo docker compose build parser e2e && sudo docker compose run --rm --no-deps e2e

# Reproducible real-replay benchmark
./scripts/benchmark.sh
```

Docker is the supported way to run the complete application. Host development needs Node.js 22 and pnpm 10. It also needs explicit host paths for replays, staging data, the warehouse, migrations, and saved queries.

The browser tests expect a healthy Compose web service. They also expect at least one stored match. Set `E2E_MATCH_ID` to target a known extraction. Set `E2E_REQUIRE_WIN_PROBABILITY=1` to require the Valve-graph ready state, `E2E_REQUIRE_HERO_POSITIONS=1` to require the heat-map ready state, and `E2E_REQUIRE_NEUTRAL_CAMP_FARMING=1` to require the current neutral-farming stream (which may validly contain no actions). [docs/BENCHMARK.md](docs/BENCHMARK.md) explains the benchmark. [docs/BENCHMARK_RESULTS.md](docs/BENCHMARK_RESULTS.md) is the last recorded reference report; its environment section identifies the measured extraction format. [docs/NEUTRAL_CAMP_FARMING_VALIDATION.md](docs/NEUTRAL_CAMP_FARMING_VALIDATION.md) records the version-1 replay audit.

## Architecture and ownership

There are three permanent processes:

1. `web` runs TanStack Start, downloads replays, coordinates durable jobs, performs serialized DuckDB loading, and serves read-only queries.
2. `parser-worker` runs the JVM Clarity parser without network or warehouse access.
3. `sampler` collects ranked match IDs, closes hourly selection windows, and writes durable ingestion requests. It has network and staging access, but no replay or warehouse volume.

The JVM worker is separate because Clarity is Java and replay parsing uses much CPU and memory. This keeps the web server responsive. It also avoids sending a large event stream through another API. Job request, status, and result files are published atomically in the staging volume. One coordinator advances one job at a time. After a restart, it resumes safe states or records a clear failure.

DuckDB uses a single-process ownership model. A local queue and a recoverable file lease serialize all warehouse access. A read cannot overlap a write from this application. Each reader opens DuckDB in read-only mode. An ingestion validates staging before `BEGIN`. It imports data and creates summaries in one transaction. The data becomes visible only after commit. The replay checksum, parser identity, export version, and profile configuration define the extraction ID. Repeated ingestion is therefore safe and does not add duplicate data.

One-shot `fetch`, `parser`, and `loader` services power the CLI. `warehouse-init` applies migrations before a fresh web container starts. The web origin is bound only to `127.0.0.1:3400`; the public hostname is protected by the tainer authentication gateway.

## Extraction and storage

The profile applies Clarity runner filters before generic message/entity handling. Explicit handlers retain three reliable analytical sources:

| Source | Permanent representation | Why it is retained |
|---|---|---|
| `CMsgDOTAMatch` | complete JSON plus typed `analysis.matches`, `analysis.players`, `analysis.player_items`, and `analysis.hero_draft_events` | authoritative final overview, scoreboard, and draft facts |
| `CDOTAMatchMetadataFile` | complete JSON plus typed `analysis.team_time_series` | graphs, inventory/ability snapshots, wards, support statistics, and other future analyses |
| `CMsgDOTACombatLogEntry` | typed `raw.combat_events` rows | every semantic field exposed by Clarity's combat-log API: combat, economy, levels, runes, wards, modifiers, visibility, abilities, objectives, and locations |
| `CDOTA_DataRadiant` + `CDOTA_DataDire` + `CDOTAGamerulesProxy` | targeted entity/property staging plus typed `analysis.player_gold_events` | pause-safe cumulative earned-gold changes used for rolling player and team GPM |
| `CDOTASpectatorGraphManagerProxy` + `CDOTA_DataSpectator` | compact `analysis.win_probability_samples` | the server's Radiant win-probability history; the application derives Dire as the complement and does not estimate either series |
| `CDOTA_Unit_Hero_*` | compact staging rows plus typed `analysis.hero_position_samples` | pause-safe 100 ms world positions for living main heroes; illusions and temporary copies are excluded |
| `CDOTA_NeutralSpawner` + `CDOTA_BaseNPC_Creep_Neutral` | selected entity checkpoints/updates plus typed `analysis.neutral_camp_farming_actions` | replay-local camps, creep deaths, and direct main-hero damage sessions derived by the fixed `neutral-camp-farming-v1` rules |

The two complete documents stay in `raw.records`. BLOB fields stay in `raw.record_blobs`. Common filters, joins, and totals use normalized fields, so they do not parse the large documents. Combat events use typed columns and an extraction/time/type index; profile v4 records the pause-safe entity clock in `game_time` and preserves Clarity's source timestamp in `raw_time`. Hero samples keep world coordinates in DuckDB and convert them to a fixed display grid only when a heat map is requested. Neutral-camp capture retains only selected creation properties, health/life-state changes, and creation/deletion events; it does not enable generic entity history. Internal Clarity string-table indices are not stored. The resolved names contain the useful Dota information.

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

-- Hero picks, bans, results, rates, and average GPM/XPM.
SELECT * FROM analysis.hero_stats();

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

-- Valve's server-side win-probability samples for the latest extraction.
SELECT game_time_seconds, radiant_probability, source
FROM analysis.match_win_probability(8955653541)
ORDER BY game_time_seconds;

-- A 64 by 64 hero-position grid from 10:00.0 through 20:00.0.
SELECT *
FROM analysis.match_hero_heatmap(8955653541, 600000, 1200000, NULL, 64)
ORDER BY cell_y, cell_x;

-- Derived direct-hero farming sessions at replay-local neutral camps.
SELECT *
FROM analysis.match_neutral_camp_farming_actions(8955653541)
ORDER BY start_game_time_ms, action_index;
```

The actual-game filter includes pre-game map activity from the pre-game state onward, as well as the complete match, and excludes post-game events.

Run these queries with `./dota sql`. The browser editor accepts one bounded, read-only `SELECT`. It rejects file access, extensions, attachments, copies, configuration changes, and data changes.

## Website

`/matches` reads the latest successful extraction for every stored match. It shows the match ID, local date and time, duration, result, and both scores. `/matches/:matchId` shows the overview, rosters, final items, totals, final net-worth comparison, Valve win probability, rolling GPM, combat-log damage, a hero position heat map, and a typed neutral-camp farming table. The farming table reports the player, replay-local camp, times, result, direct damage, and initial-creep deaths; it does not infer controlled-unit damage, shared credit, stacks, or pulls. The two damage timelines show damage taken by source and damage done by target in fixed 30-second intervals. Their detail views preserve controlled-unit, illusion, mechanism, and event attribution. The probability chart uses the server values in the replay. It does not estimate values from net worth, kills, or other match data. The heat map accepts any start and end time on a 100 ms boundary. It can combine all ten heroes or show one roster hero. It uses living main heroes only. The GPM section offers fixed 1, 5, 10, 30, 60, and 300-second windows, compares both teams, and limits the player chart to one selected team. Exact probability, GPM, and damage values can be inspected with pointer input or the keyboard.

Schema-version-1 and schema-version-2 extractions have no win-probability staging file. The match page shows an unavailable state for them. Re-extract a cached or archived replay with the current parser to add the server series; the application does not construct a replacement series when the replay is unavailable.

Profiles before `match-analysis-v4` have no neutral-camp farming action data.
The match page shows a separate unavailable state for those extractions; an
empty v4 action table is available data and renders a different message.

`/heroes` summarizes every hero picked or validly banned in matches that have both a normalized match row and a latest successful extraction. Picks and bans are distinct match counts; their rates use the number of matches in that fixed scope. Wins and losses use only picks with a known winner, while average GPM and XPM use the available player values. Missing averages and undecided win/loss rates remain `Unknown`. Existing stored match documents backfill the normalized draft table during migration, so ban statistics do not require replay re-extraction.

Tables use clear headers and captions. On a phone, tables become statistic cards. The site has clear loading, empty, missing-data, and error states. Keyboard focus is visible, and winner text does not depend on color.

Hero and item images are served from Valve's public Steam CDN using Dota 2 asset paths. Hero IDs use a small local compatibility map. Item IDs use the generated, versioned Valve item catalog in `src/web/dota-items.generated.json`. Unknown or new IDs fall back to text instead of a broken image. The local patch 7.40 map base is from the MIT-licensed OpenDota web project. Its exact source revision and license are in `public/assets/dota-map-LICENSE.txt`. Dota and Dota 2 are Valve trademarks; this independent learning project is not affiliated with or endorsed by Valve.

### Item catalog maintenance

Refresh the item catalog after a Dota patch, then review the reported additions, removals, changes, and unavailable CDN images:

```sh
pnpm catalog:items:update
pnpm catalog:items:verify
```

The update command stores the unmodified Valve response under `data/dota/items/snapshots/` and regenerates the web catalog deterministically. Commit both files together. Do not edit a snapshot or the generated catalog. Use `data/dota/items/overrides.json` only for a documented compatibility correction. The update command uses the network; verification is local and is part of `pnpm release:check`.

## TanStack package decisions

The implementation follows the current official [TanStack Start](https://tanstack.com/start/latest), [Router](https://tanstack.com/router/latest), [Query](https://tanstack.com/query/latest), and [Charts](https://tanstack.com/charts/latest) documentation.

| Package | Decision | Reason |
|---|---|---|
| Start + Router | selected | supported full-stack routing, server functions, loaders, pending/error boundaries |
| Query | selected | loader hydration, remote-state caching, and job polling lifecycle |
| Table | rejected | match lists are small and each roster has ten rows; semantic HTML is less code |
| Form | rejected | ingestion is one validated field, so its abstraction would add more code than it removes |
| Charts | selected | typed `lineY`, `ruleY`, and `cell` marks render the Valve probability and unsmoothed rolling-GPM graphs plus the 64×64 hero-position heat map with responsive SVG, shared scales, tooltips, and keyboard focus |
| Virtual | rejected | no normal list is long enough to justify virtualization |
| Pacer | rejected | a small `refetchInterval` plus provider-specific `Retry-After` logic is clearer |
| Store | rejected | Query owns remote state and no substantial shared client state remains |
| DB | rejected | DuckDB is authoritative and the small UI does not need a reactive client collection |
| Devtools | rejected | production deployment does not need a diagnostics bundle; existing browser/server tools suffice |

Package versions are pinned in `package.json` and `pnpm-lock.yaml`.

## Tests and real replay fixtures

Node tests cover IDs, replay validation, downloads, cache behavior, manifests, locks, recovery, rollback, repeated ingestion, storage rules, migrations, rolling-GPM and win-probability analysis, combat-log damage attribution, hero-position grids, neutral-camp farming derivation and transactional loading, item-catalog generation, server validation, SQL safety, and query files. Vitest covers Dota asset lookup, missing overview fields, display conversions, query keys, TanStack chart interaction, damage timeline details, heat-map controls and rendering, neutral-farming ready/empty/unavailable/loading/error states, and team/window selection. The parser image compiles the Clarity fork and runs Java tests for targeted gold, server win-probability capture, game-clock capture, 100 ms hero-position sampling, and selective neutral-spawner/creep capture. Playwright covers the phone workflow and a real match overview, including its mobile probability, GPM, damage timeline, heat-map, and keyboard-accessible neutral-farming states.

Large or unlicensed replays are never committed. To use your own parser fixture, keep it outside Git and run:

```sh
DOTA_REPLAY_SOURCE=/absolute/path/to/fixture.dem ./dota ingest MATCH_ID
```

The repository includes the match IDs and acquisition URLs for all 147 TI 2026 matches. See [tests/fixtures/README.md](tests/fixtures/README.md). The replay files are not in Git.

An extraction made before the hero-position export does not contain continuous positions. Re-ingest its cached replay with the current parser to create a new extraction. The application keeps the old successful extraction and selects the newest successful one.

The default benchmark uses three cached real matches (short, normal, and large), performs one warm-up and three measured fresh-warehouse ingestions apiece, samples peak RSS, and measures overview, rolling-GPM, and hero-position query/response/render costs. Download time is excluded. Each run owns a disposable database and cannot alter the live warehouse.

## Recovery and operations

- The manual replay cache is the source for re-extraction; sampled replay files are intentionally removed after a successful load. Parsed staging data is disposable.
- Failed parser/loader staging is retained for diagnosis. Successful staging is removed.
- An interrupted queued/fetching/loading job is recovered; an invalid or unsafe state is marked failed with its stage.
- If the same replay/profile already committed, both CLI and web paths report `already_loaded` without duplicating rows.
- Applied migration files are immutable. Add a later numbered migration for schema changes.
- `parser-identity.json` is the single source of truth for the Clarity fork revision and extraction contract. Bump the export format when output/import semantics change.
- Do not run `docker compose down --volumes` as routine cleanup. Named volumes are durable application state, though they are not backups.

The parser and loader have no network access. They run as non-root with reduced capabilities and read-only root file systems. They keep the replay after a parser or database failure. These controls reduce risk, but Docker is not a complete security boundary.
