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
```

The Node test image covers IDs, manifests, checksums, locking, migrations, atomic rollback, idempotency, and both analysis queries. The parser image build compiles the Clarity exporter; its focused Java tests can be run with the Gradle builder target. A real replay fixture is intentionally kept outside Git.

The parser and loader run without network access and with reduced container privileges. These controls reduce exposure; Docker is not a complete security boundary.

## Development notes

- Treat applied files in `src/db/migrations` as immutable; add a later numbered migration for schema changes.
- Bump the exporter version in both the Java exporter and loader preflight whenever parser output semantics change. Extraction identity depends on this version and the extraction configuration.
- Keep parser-native paths and values in raw storage. Friendly names and derived Dota statistics remain outside the first-release data contract.
- Failed staging directories are intentionally retained for diagnosis. Once investigated, they can be removed from the `dota-stats-staging` volume without affecting cached replays or committed warehouse data.
- Do not use `docker compose down --volumes` as routine cleanup. The replay and warehouse volumes are the durable source and analysis state.
