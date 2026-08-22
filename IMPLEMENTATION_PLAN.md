# Dota Replay Data Lab: Implementation Plan

## 1. Objective

Build a local data lab for Dota 2 replay files.

The user supplies a match ID. The system gets the replay and stores it. The system parses the replay and loads the data into DuckDB. The user examines the data with SQL.

Run all development tools and application code in Docker containers. Keep durable data after container removal.

## 2. First Release

Provide these commands:

```sh
./dota init
./dota ingest MATCH_ID
./dota sql
```

The `dota` host script only starts Docker Compose services. Do not run Node.js, Java, or DuckDB on the host.

Use these fixed design choices:

- Use TypeScript for replay download, data load, and database access.
- Use a small Java exporter with Clarity for replay parsing.
- Use `@duckdb/node-api` and plain SQL.
- Keep parser-native names and values in the raw data.
- Store every entity property update.
- Store full entity checkpoints every 30 seconds of game time.
- Keep each successful extraction immutable.
- Keep the replay file as the source of truth.

## 3. Principles

- Use KISS. Add only the parts that the first release needs.
- Use YAGNI. Do not build for possible future requirements.
- Prefer clear code to general frameworks.
- Do not optimize before measurement.
- Make each database load atomic.
- Make repeated commands safe.
- Record tool versions and extraction settings.

## 4. Architecture

Use three one-shot Docker Compose services.

```text
match ID
   |
   v
fetch service ---> replay volume
                       |
                       v (read-only)
                  parser service ---> staging volume
                                            |
                                            v
                                       loader service ---> warehouse volume
```

### 4.1 Fetch service

Give the fetch service network access. Give it read and write access to the replay volume. Do not give it access to the warehouse volume.

Use this source order:

1. Use a replay that is already in the replay volume.
2. Get replay metadata from OpenDota.
3. Use a direct replay URL or file when the user supplies one.

Return `replay_unavailable` when no replay is available. Do not add Steam Game Coordinator access.

### 4.2 Parser service

Disable all network access for the parser service. Mount the replay volume as read-only. Mount only the assigned staging area as read and write.

Emit newline-delimited JSON files and one extraction manifest. Use one total sequence number across all emitted records.

Keep parser message names, entity class names, property paths, IDs, and value types unchanged.

### 4.3 Loader service

Disable all network access for the loader service. Give it access only to staging and the warehouse volume.

Validate the manifest and staged files. Use fixed SQL for all imports. Do not accept SQL text, table names, or file paths from parser data.

Load one extraction in one transaction. Commit only after all imports succeed.

## 5. Durable Data

Create these Docker volumes:

```text
dota-stats-replays
dota-stats-warehouse
dota-stats-staging
```

Make the replay and warehouse volumes external. Create them with `./dota init`. Normal container removal must not remove these volumes.

Use these container paths:

```text
/data/replays
/data/warehouse/dota.duckdb
/work/staging
```

Store each replay in this form:

```text
/data/replays/MATCH_ID/replay.dem.bz2
/data/replays/MATCH_ID/acquisition.json
```

Download to a temporary file. Check the response and calculate SHA-256. Rename the file only after a successful download.

Delete staging data after a successful database commit. Keep failed staging data for fault analysis.

Volume persistence is not a backup. Do not add automatic backups in the first release.

## 6. Container Safety

Apply these controls to the parser service:

- Run as a fixed non-root user.
- Use a read-only container file system.
- Disable network access.
- Drop all Linux capabilities.
- Set `no-new-privileges`.
- Keep the default Docker seccomp profile.
- Set memory, CPU, and process limits.
- Use a size-limited `tmpfs` for `/tmp`.
- Set input-size, output-size, and time limits.
- Do not mount the Docker socket.
- Do not mount the source tree.
- Do not mount the warehouse volume.

Apply the applicable controls to the loader service. Do not describe Docker as a complete security boundary.

## 7. Extraction Identity

Use `UBIGINT` for match IDs. Use JavaScript `bigint` in TypeScript.

Calculate the extraction identity from these values:

- Replay SHA-256.
- Parser name and version.
- Exporter version.
- Extraction configuration.

Skip the parse when an identical successful extraction exists. Do not implement a force option in the first release.

Do not replace a successful extraction. A new parser version creates a new extraction.

## 8. Initial DuckDB Data

Use these schemas:

```text
catalog
raw
analysis
```

Use ordered SQL migration files. Do not change a migration after use.

### 8.1 Catalog data

Store these items in `catalog`:

- Replay acquisition results.
- Extraction attempts and results.
- Parser and exporter versions.
- Extraction configuration.
- Record counts, elapsed times, and errors.

### 8.2 Generic raw records

Store decoded parser records with these main fields:

```text
extraction_id
sequence
demo_tick
net_tick
game_time
category
record_type
payload JSON
```

Allow null clock values. Do not invent a clock value when Clarity does not supply one.

Do not copy the complete replay byte stream into DuckDB. If Clarity exposes a field as bytes, store that field once as a `BLOB`. Link the `BLOB` to its parser record and field path.

Fail the complete extraction if it exceeds the configured output limit. Do not omit byte fields from a successful extraction. The replay retains all original bytes.

### 8.3 Entity data

Create these raw tables:

- Entity instances.
- Entity create, update, and delete events.
- Entity property updates.
- Entity checkpoints.

Assign an internal ID to each entity instance. Do not use the entity index as a unique ID. The game can reuse an entity index.

Store one property-update row for each changed property. Keep the parser-native property path, value type, and value.

Store a full checkpoint for each active entity at these times:

- At entity creation.
- At each 30-second game-time interval.
- At replay completion.

Do not make interval checkpoints while the game clock is paused. Store the interval in the extraction configuration.

### 8.4 First analysis queries

Add only these analysis queries:

1. Show the history of one entity property.
2. Reconstruct one entity state at a selected game time.

Do not add friendly Dota names or derived game statistics.

## 9. DuckDB Access

Permit only one read and write process at one time. Use a lock file in the warehouse volume.

The loader and writable SQL shell must get the lock before they open DuckDB. They must close DuckDB before they release the lock.

Do not add a permanent database service.

## 10. Repository Layout

Start with this small layout:

```text
compose.yaml
Dockerfile
dota
package.json
pnpm-lock.yaml
src/
  cli/
  fetch/
  load/
  db/migrations/
parser/
  build.gradle.kts
  src/
tests/
```

Use one Node.js package. Use one multi-stage Dockerfile unless separate files are clearer.

## 11. Implementation Steps

### Step 1: Create the container project

Create the TypeScript package, Java project, Dockerfile, Compose file, and host launcher. Add the three services and their volume mounts. Add the parser safety controls.

Check that `./dota init` creates the durable volumes. Check that all images build without host language tools.

### Step 2: Get and store a replay

Implement the replay cache and OpenDota lookup. Add limits, a timeout, SHA-256, and an atomic file rename. Write `acquisition.json`.

Check an available match ID and an unavailable match ID. Check that a second request uses the cached replay.

### Step 3: Inventory Clarity output

Build the smallest useful Clarity exporter. Count each message type, entity class, and property path in one replay. Record parse time and output size.

Use this inventory to confirm the output categories. Do not create special tables before this test.

### Step 4: Export parser-native records

Export generic records, entity lifecycle events, property updates, and checkpoints. Write the extraction manifest and record counts.

Check that the parser has no network access. Check that it cannot write to the replay or warehouse volumes.

### Step 5: Load DuckDB

Create the initial SQL migration. Validate and import the staged files in one transaction. Record success or failure in `catalog`.

Check that a failed import leaves no partial raw records. Check that a repeated ingestion does not create duplicate data.

### Step 6: Add the first queries

Add the property-history query and the state-reconstruction query. Check both queries with selected data from the test replay.

### Step 7: Add focused tests

Add tests for match IDs, checksums, manifests, limits, idempotency, migrations, and rollback. Test a truncated replay and malformed staged JSON.

Run all tests in Docker with one command. Keep the integration replay outside Git.

### Step 8: Measure one extraction

Report replay size, parse time, load time, table row counts, database growth, peak parser memory, and checkpoint size.

Fix only clear problems. Do not optimize acceptable performance.

## 12. Completion Checks

Start with empty volumes. Ingest one available match ID. Query one property history. Reconstruct one entity state.

Remove all containers. Rebuild all images. Open the SQL shell again. Confirm that the replay and DuckDB data remain.

Ingest the same match again. Confirm that the command does not add duplicate data.

Parse a bad replay. Confirm that existing warehouse data does not change.

## 13. Non-Goals

Do not implement these items:

- A browser user interface.
- An HTTP API.
- A task queue.
- Parallel ingestion.
- Steam Game Coordinator login.
- Automatic replay discovery.
- An ORM.
- A server database.
- Object storage.
- Automatic backups.
- A plugin system.
- Friendly Dota domain tables.
- General performance tuning.
