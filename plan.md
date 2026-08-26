# Hero Position Heat Map Plan

## 1. Goal

Add a hero position heat map to each match page.

Let the user set a start time and an end time.

Update the heat map when the time range changes.

Let the user show all heroes or one hero.

Use all heroes as the initial selection.

Keep the page usable on desktop and mobile screens.

## 2. Terms

In this plan, a **position sample** is one hero location at one 100 ms sample time.

In this plan, a **main hero** is the player hero. It is not an illusion or a temporary copy.

In this plan, **game time** starts at `0:00`. Pauses do not increase game time.

In this plan, a **grid cell** is one square area on the map.

## 3. Current State

The parser does not export continuous hero positions.

`raw.combat_events` has locations for some combat events. These locations cannot show the complete hero path.

Do not use combat event locations as a substitute for position samples.

The parser currently reads only team data and game rule entities. It does not read hero entities.

The loader has no typed table for hero positions.

The match page has no map asset and no position query.

Old extractions do not have sufficient data for this feature. A database migration cannot make the missing data.

## 4. Product Rules

Show samples from `0:00` through the match duration.

Use a sample interval of 100 ms.

Use the pause-safe clock from `GameClock`.

Include the start time and the end time in the selected range.

Show samples only for a living main hero.

Do not show illusions, clones, couriers, wards, or other units.

Use the latest successful extraction for the match.

Show all heroes in one heat map by default.

Let the user select one roster hero from a control.

Show `0:00` as the initial start time.

Show the match end as the initial end time.

Accept time values with a precision of 100 ms.

Do not let the start time be after the end time.

Do not let a time be less than zero or more than the match duration.

## 5. First Investigation

Use one short replay and one normal replay for this investigation.

Temporarily log the field names for `CDOTA_Unit_Hero_*` entities.

Find the fields for the player ID, hero ID, life state, illusion state, and world position.

Confirm the coordinate calculation for Source 2 cell coordinates and offset coordinates.

Confirm that a replay gives position data for both teams at the same time.

Confirm that Arc Warden copies and other duplicate hero entities have a reliable exclusion field.

Confirm that one player ID maps to one row in `analysis.players`.

Measure the minimum and maximum valid coordinates in the two replays.

Compare known locations with the proposed map image. Check both axes and all four corners.

Write the accepted field names and coordinate rules in parser tests.

Remove the temporary logs after the investigation.

Stop implementation if the parser cannot identify main heroes or complete positions reliably.

## 6. Parser Changes

Add a small `HeroPositionTimeline` class in the Java parser.

Keep Clarity field handling in this class. Do not put field aliases in the web application.

Add `CDOTA_Unit_Hero_*` to the entity class patterns in `ExportConfig`.

Observe hero creation, update, and deletion events in `ReplayExporter`.

Track these values for each active hero entity:

- the game player ID;

- the hero ID;

- the team ID;

- the life state;

- the illusion or copy state;

- the world X coordinate;

- the world Y coordinate.

At each tick end, emit samples for each 100 ms sample boundary that the parser reached.

Emit a sample only when all required values are valid.

Emit no more than one sample for one player at one sample boundary.

Resolve entity replacement after death or reconnect without a duplicate sample.

Do not emit a sample when the game clock is negative.

Do not emit a sample after the game end marker.

Write position rows to a new `hero_positions.ndjson` file.

Use this row contract:

```text
extractionId
sequence
demoTick
gameTimeMilliseconds
gamePlayerId
heroId
teamId
worldX
worldY
```

Store world coordinates in the parser output. Do not store image pixel coordinates.

Reject a nonfinite coordinate.

Reject a coordinate outside the verified world limit.

Add `heroPositions` to `NdjsonSet.FILES` and to all manifest counts.

Change the extraction profile to `match-analysis-v2`.

Increase `exportFormatVersion` in `parser-identity.json`.

This change gives each new extraction a new extraction ID.

Add the position sample interval to the canonical extraction configuration.

Use a fixed 100 ms interval for the first version.

Do not add a user environment setting for this interval.

## 7. Manifest and Loader Changes

Add `heroPositions` and `hero_positions.ndjson` to `stagedFiles` in `src/load/manifest.ts`.

Increase the manifest schema version for the new file contract.

Let the manifest reader accept schema version 1 and the new schema version.

Treat `heroPositions` as absent for a schema version 1 manifest.

This rule lets the coordinator recover an old parser result after a deployment.

Validate the file size, checksum, row count, and final newline.

Import position rows in the same transaction as the other extraction rows.

Validate all position fields before the transaction commits.

Require a player ID from 0 through 9.

Require team ID 2 or team ID 3.

Require a positive hero ID.

Require a nonnegative integer game time in milliseconds.

Require the game time to be a multiple of 100 ms.

Require finite world coordinates inside the verified limits.

Map the game player ID to `analysis.players.player_slot`.

Confirm that the row hero ID and team ID agree with the roster row.

Fail the extraction when one position row does not agree with the roster.

Add the stored position count to the extraction record counts.

Add the position count to the analysis row count in the ingestion log.

## 8. Database Changes

Add the next append-only migration, `src/db/migrations/012_hero_positions.sql`.

Do not change an applied migration.

Create `analysis.hero_position_samples` with these columns:

```text
extraction_id VARCHAR
sequence UBIGINT
game_time_milliseconds UINTEGER
player_slot UINTEGER
hero_id INTEGER
team_id INTEGER
world_x FLOAT
world_y FLOAT
```

Use `(extraction_id, game_time_milliseconds, player_slot)` as the primary key.

Add an index on `(extraction_id, player_slot, game_time_milliseconds)`.

Keep world coordinates in this table.

Do not put one row in the table for each heat map grid cell.

Add a table macro named `analysis.match_hero_heatmap`.

Give the macro these inputs:

```text
requested_match_id
requested_start_milliseconds
requested_end_milliseconds
requested_player_slot
requested_grid_size
```

Use `NULL` for `requested_player_slot` when all heroes are selected.

Use one fixed grid size of 64 for the first web version.

Select data only from `analysis.latest_successful_extractions`.

Convert world coordinates to normalized map coordinates in the macro.

Keep the verified map bounds in one clearly named macro or table.

Flip the Y axis only if the map calibration test requires it.

Clamp a coordinate on the maximum boundary to grid cell 63.

Return these values for each nonempty grid cell:

```text
cell_x
cell_y
sample_count
```

Also calculate the total selected sample count in the server query.

Do not calculate density from movement update frequency. Use the 100 ms samples.

## 9. Map Asset and Heat Map Rules

Add one local map image below `public/assets`.

Use the Dota map version that matches the replay set.

Record the image source, game patch, and use terms in the README.

Do not load the base map from a third-party host at page run time.

Keep the map image square.

Keep the coordinate calibration next to the map documentation.

Render the base map as an image.

Render the heat layer on a canvas above the image.

Scale the canvas for the device pixel ratio.

Use the 64 by 64 result grid as the heat layer input.

Calculate cell intensity from `sample_count / maximum_cell_count`.

Use one documented square-root scale. This scale keeps low-density paths visible.

Show a legend from low density to high density.

Show the selected sample count and the selected time range as text.

Show a text summary when the heat map has no samples.

Do not use color as the only indication of an unavailable or empty result.

## 10. Server Interface

Add `src/server/hero-positions.ts`.

Add a Zod input schema with these fields:

```text
matchId
startMilliseconds
endMilliseconds
playerSlot
```

Use `null` for the all-hero player selection.

Validate the match ID with the current match ID rules.

Validate integer milliseconds and the player slot.

Require each time to be a multiple of 100 ms.

Read the match duration from the latest extraction.

Reject a time outside the match duration.

Reject a start time that is after the end time.

Query the 64 by 64 heat map with a read-only warehouse connection.

Return only JSON-safe numbers and strings.

Return this result state:

```text
matchId
available
startMilliseconds
endMilliseconds
playerSlot
sampleCount
maximumCellCount
cells[]
```

Set `available` to false when the latest extraction has no position stream.

Keep `available` true when the selected hero has no living sample in the selected range.

Add `getMatchHeroHeatmapFn` to `src/web/functions.tsx`.

Add a separate query key in `src/web/overview-data.ts`.

Include the match ID, time range, and player slot in the query key.

Do not add heat map cells to the match overview response.

## 11. Match Page Changes

Add `src/web/hero-heatmap-section.tsx`.

Add `src/web/hero-heatmap.tsx` for the map and canvas.

Place the new section on `src/routes/matches.$matchId.tsx` near the other match analysis sections.

Use the match duration and roster from the existing overview result.

Add a hero selection control with `All heroes` and the ten roster heroes.

Use the player slot as the control value.

Show the player name and hero name in each hero option.

Add one range control and one text control for the start time.

Add one range control and one text control for the end time.

Set each range control step to 100 ms.

Keep all client time values as integer milliseconds.

Use `m:ss.s` or `h:mm:ss.s` in the text controls.

Keep the range controls usable with a keyboard.

Show a clear validation message for an invalid text value.

Keep the last valid heat map until the new query completes.

Wait 200 milliseconds after a range control changes before a new query starts.

Do not send a server request for each pointer movement.

Add these visible states:

- a loading state;

- an error state with a retry control;

- an unavailable state that asks for replay re-extraction;

- an empty range state;

- a ready state.

In the unavailable state, do not use sparse combat locations.

Keep all controls and the map inside the mobile viewport.

## 12. Tests

### 12.1 Parser Tests

Add unit tests for `HeroPositionTimeline`.

Test coordinate field aliases from the inspected replays.

Test the Source 2 coordinate calculation.

Test one sample for each 100 ms sample boundary.

Test that a pause does not add samples.

Test that a dead hero does not add a sample.

Test that an illusion or copy does not add a sample.

Test entity deletion, respawn, and entity replacement.

Test invalid player IDs and nonfinite coordinates.

Test that one player cannot add two samples for one sample boundary.

Update `ExportConfigTest` for the new hero entity pattern and profile configuration.

### 12.2 Manifest and Loader Tests

Test a valid new manifest with `hero_positions.ndjson`.

Test recovery of a schema version 1 manifest without this file.

Test checksum, count, and size failures for the new file.

Extend `tests/loader.test.ts` with valid position rows.

Confirm the player slot mapping and the stored values.

Test a roster mismatch, an invalid time, a duplicate sample, and an invalid coordinate.

Confirm that each failure rolls back the complete extraction.

Confirm that record and analysis row counts include position rows.

### 12.3 Database and Server Tests

Add `tests/hero-positions.test.ts` for the heat map macro.

Test the full match range and a 100 ms range.

Test both inclusive time boundaries.

Test all heroes and one player slot.

Test the latest successful extraction rule.

Test all four map boundaries and the Y axis direction.

Test a zero-row range and a match without position data.

Add server tests for time validation, JSON-safe values, cell order, and availability.

Confirm that the sum of all cell counts equals `sampleCount`.

### 12.4 Web Tests

Add unit tests for time text parsing and formatting.

Add unit tests for the range limits and the query debounce.

Add unit tests for heat cell intensity.

Add Vitest tests for all visible states.

Confirm that a hero change updates the query key.

Confirm that a start or end change updates the text summary.

Confirm that keyboard controls can change both times.

Extend `e2e/mobile.spec.ts`.

Open a match that has the new position data.

Select one hero and a shorter time range.

Confirm that the ready summary shows the new selection.

Confirm that the document is not wider than the mobile viewport.

## 13. Verification and Performance

Re-extract the short, normal, and large benchmark replays.

Confirm that each 100 ms sample boundary has at most ten position rows.

Confirm that most living sample boundaries have the expected hero rows.

Inspect lane movement, fountain positions, deaths, teleports, and respawns on the map.

Compare at least five known replay moments with the heat map coordinates.

Measure parser time, output bytes, warehouse bytes, query time, and response bytes.

Add the new values to the benchmark report.

Record the performance impact. Do not use it as a release blocker for this change.

Do not increase the 100 ms sample interval to improve performance.

Increase a parser output limit if a valid benchmark replay needs the increase.

Run these checks:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:web
sudo docker compose build parser e2e
sudo docker compose run --rm --no-deps e2e
```

## 14. Documentation and Release

Update the README architecture table with the hero position stream.

Document the sample interval and the living-main-hero rule.

Document the map image source and coordinate calibration.

State that old extractions need replay re-extraction.

Update the extraction profile name and export format description.

Re-extract the required stored matches after deployment.

Use the archived replay files for the TI 2026 data set.

Do not delete an old successful extraction during this work.

## 15. Completion Criteria

The work is complete when all these statements are true:

- The parser stores 100 ms position samples for living main heroes.

- The loader rejects invalid or mismatched position data.

- DuckDB uses only the latest successful extraction for the heat map.

- A user can select any valid start time and end time at 100 ms precision.

- A user can show all heroes or one roster hero.

- The heat map updates after a time or hero change.

- The heat map coordinates agree with the verified map image.

- Old extractions show a clear re-extraction message.

- Loading, error, empty, unavailable, and ready states are clear.

- Desktop and mobile users can use the same controls.

- The benchmark limits are satisfied.

- All required tests pass.
