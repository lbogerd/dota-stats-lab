# Dota Replay Data Lab

A local, container-only lab for downloading Dota 2 replays, exporting parser-native Clarity data, loading immutable extractions into DuckDB, and exploring them with SQL.

## Quick start

Docker Engine with Compose v2 is the only host dependency.

```sh
./dota init
./dota ingest MATCH_ID
./dota sql
```

Compose builds missing service images on first use. Replay and warehouse data survive container removal in the external `dota-stats-replays` and `dota-stats-warehouse` volumes. Successful staging data is removed; failed parser or loader staging is retained for diagnosis.

The fetcher checks the replay cache first, then OpenDota metadata. If OpenDota has no replay URL, supply one directly:

```sh
DOTA_REPLAY_SOURCE='https://example/replay.dem.bz2' ./dota ingest MATCH_ID
DOTA_REPLAY_SOURCE='/absolute/path/replay.dem.bz2' ./dota ingest MATCH_ID
```

Replay downloads make three attempts by default for transient network failures, timeouts, HTTP 408/425/429 responses, and server errors. Backoff is exponential and capped at two seconds; permanent client errors and replay size violations fail immediately. Override the bounds with `FETCH_RETRY_ATTEMPTS`, `FETCH_RETRY_BASE_MS`, and `FETCH_RETRY_MAX_MS`.

## Protected web app

The mobile web interface is available at `https://dota.tainer.run` through the tainer Better Auth gateway. The origin is published only on IPv4 loopback at `127.0.0.1:3400`; do not expose that port to the LAN or public internet.

Initialize the external volumes, then start the two permanent services:

```sh
./dota init
docker compose up --detach --build --wait web parser-worker
```

The web app can submit one ingestion at a time, show current and recent job status, browse stored matches and immutable extractions, execute bounded read-only SQL, and manage saved `.sql` files. The saved-query editor completes the active DuckDB project schemas, tables, views, typed columns, and project macros. Qualify columns with a relation or alias, such as `r.sequence`, when you need column completion in clauses such as `ORDER BY`.

Saved queries live in the external `dota-stats-queries` volume and survive web-container replacement. Volume durability is not a backup; download important query files or copy the volume through your normal backup process.

The permanent `web` service owns network replay acquisition, job coordination, DuckDB loading and read-only browser queries. The separate `parser-worker` has no network, warehouse, or saved-query access. The `fetch`, `parser`, and `loader` services remain available as one-shot containers for the CLI workflow.

Job handoff files and failed extraction output live in the project-scoped `dota-stats-staging` volume. The volume has separate `inbox`, `claimed`, and `jobs` directories. The parser can write only to the inbox. The coordinator uses an atomic rename to give one extraction to one job. The loader then validates each NDJSON file in one read before it imports the file. Failed claimed extractions stay available for diagnosis.

This staging layout is different from the layout in earlier releases. Before you deploy this change, let all jobs in the old deployment finish. Then rebuild and recreate `web` and `parser-worker` together. Old failure directories at the staging-volume root stay in place, but the new services do not use them.

Before deleting retained failure data, confirm that no job is queued, fetching, parsing, or loading. Cached replays and committed warehouse data do not depend on failed staging directories.

## SQL queries

The shell accepts DuckDB SQL and prints one JSON object per result row. Match analysis uses the latest successful extraction for the requested match. The first macro returns the match summary; the second returns the final player scoreboard:

```sql
SELECT * FROM analysis.match_summary(8959222564);

SELECT * FROM analysis.match_players(8959222564);
```

Lower-level entity analysis table macros are also included:

```sql
SELECT * FROM analysis.entity_property_history(
  'EXTRACTION_ID', ENTITY_INSTANCE_ID, 'parser.native.property.path'
);

SELECT * FROM analysis.entity_state_at_game_time(
  'EXTRACTION_ID', ENTITY_INSTANCE_ID, GAME_TIME_SECONDS
);
```

Catalog tables describe replay acquisitions, extraction versions/configuration, timing, counts, and failures. The `raw` schema keeps generic protobuf records, blobs, and entity lifecycle/property/checkpoint data without friendly-name translation.

The parser manifest and extraction catalog deliberately describe two different boundaries:

- `catalog.extractions.manifest` preserves the complete parser manifest, including counts for all exported NDJSON rows.
- `catalog.extractions.output_size_bytes` is the total temporary parser-output size before loader filtering.
- `catalog.extractions.record_counts` contains the rows retained in DuckDB after loader filtering.

As a result, manifest counts and stored counts are not expected to match. Voice and presentation messages, selected non-gameplay entities, entity `update` events, interval checkpoints, and BLOBs without a retained owner are exported temporarily but are not permanent warehouse rows. Entity property updates remain the append-only history used for state reconstruction.

## Tests

All language tooling runs in containers:

```sh
docker compose build test parser e2e
docker compose up --detach --build --wait web parser-worker
docker compose run --rm --no-deps e2e
```

The Node test image covers IDs, manifests, checksums, bounded replay retries, locking, migrations, saved-query safety, SQL catalog metadata, job recovery, read-only SQL restrictions, atomic rollback, idempotency, and both analysis queries. The Playwright image checks the main workflow and touch-friendly SQL completion at a phone-sized viewport against the healthy web service. The parser image build compiles and tests the Clarity exporter. A real replay fixture is intentionally kept outside Git.

The parser and loader run without network access and with reduced container privileges. These controls reduce exposure; Docker is not a complete security boundary.

## Development notes

- Treat applied files in `src/db/migrations` as immutable. Add a later numbered migration for schema changes.
- Bump the exporter version in both the Java exporter and loader preflight whenever parser output semantics change. Extraction identity depends on this version and the extraction configuration.
- Keep parser-native paths and values in raw storage. Put friendly names and derived Dota statistics in analysis views and macros, not in raw tables.
- Failed staging directories are intentionally retained for diagnosis. Once investigated, they can be removed from the `dota-stats-staging` volume without affecting cached replays or committed warehouse data.
- Do not use `docker compose down --volumes` as routine cleanup. The replay and warehouse volumes are the durable source and analysis state.
