# Dota Replay Data Lab

A local, container-only lab for downloading Dota 2 replays, exporting parser-native Clarity data, loading immutable extractions into DuckDB, and exploring them with SQL.

## Quick start

Docker Engine with Compose v2 is the only host dependency.

```sh
./dota init
./dota ingest MATCH_ID
./dota sql
```

The first ingestion builds the images. Replay and warehouse data survive container removal in the external `dota-stats-replays` and `dota-stats-warehouse` volumes. Successful staging data is removed; failed parser or loader staging is retained for diagnosis.

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
docker compose up --detach --wait web parser-worker
```

The web app can submit one ingestion at a time, show current and recent job status, browse stored matches and immutable extractions, execute bounded read-only SQL, and manage saved `.sql` files. The parser worker has no network, warehouse, or saved-query access.

Saved queries live in the external `dota-stats-queries` volume and survive web-container replacement. Volume durability is not a backup; download important query files or copy the volume through your normal backup process.

## SQL queries

The shell accepts DuckDB SQL and prints one JSON object per result row. Two analysis table macros are included:

```sql
SELECT * FROM analysis.entity_property_history(
  'EXTRACTION_ID', ENTITY_INSTANCE_ID, 'parser.native.property.path'
);

SELECT * FROM analysis.entity_state_at_game_time(
  'EXTRACTION_ID', ENTITY_INSTANCE_ID, GAME_TIME_SECONDS
);
```

Catalog tables describe replay acquisitions, extraction versions/configuration, timing, counts, and failures. The `raw` schema keeps generic protobuf records, blobs, and entity lifecycle/property/checkpoint data without friendly-name translation.

## Tests

All language tooling runs in containers:

```sh
docker compose build test parser
docker compose run --rm e2e
```

The Node test image covers IDs, manifests, checksums, locking, migrations, saved-query safety, job recovery, read-only SQL restrictions, atomic rollback, idempotency, and both analysis queries. The Playwright image checks the main workflow at a phone-sized viewport against the healthy web service. The parser image build compiles the Clarity exporter; its focused Java tests can be run with the Gradle builder target. A real replay fixture is intentionally kept outside Git.

The parser and loader run without network access and with reduced container privileges. These controls reduce exposure; Docker is not a complete security boundary.

## Development notes

- Treat applied files in `src/db/migrations` as immutable; add a later numbered migration for schema changes.
- Bump the exporter version in both the Java exporter and loader preflight whenever parser output semantics change. Extraction identity depends on this version and the extraction configuration.
- Keep parser-native paths and values in raw storage. Friendly names and derived Dota statistics remain outside the first-release data contract.
- Failed staging directories are intentionally retained for diagnosis. Once investigated, they can be removed from the `dota-stats-staging` volume without affecting cached replays or committed warehouse data.
- Do not use `docker compose down --volumes` as routine cleanup. The replay and warehouse volumes are the durable source and analysis state.
