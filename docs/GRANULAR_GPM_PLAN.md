# Granular Rolling GPM Implementation Plan

## Purpose

Add a web graph for rolling gold per minute (GPM).

The user must be able to select a short time window. The first version must support 1, 5, 10, 30, 60, and 300 seconds.

This plan uses source data with high detail. It does not store a different series for each time window.

## Current foundation

Migration `008_actual_game_filter.sql` supplies this macro:

```text
analysis.is_actual_game(extraction_id, sequence)
```

The macro uses combat-log game-state markers. It includes the first actual-game start marker. It excludes the first later stop marker and all later rows.

The filter includes pre-game map activity. It also isolates each extraction. It returns false when a marker or input is missing.

Use this macro for granular gold facts. Do not make a second actual-game boundary rule.

## Metric definition

Use cumulative earned gold for each player.

For player `p`, time `t`, and window `X`, calculate rolling GPM as follows:

```text
GPM(p, t, X) = 60 * (gold(p, t) - gold(p, t - X)) / X
```

Use game time, not wall-clock time. Exclude pause time from the window.

Keep actual-game gold changes that have negative pre-game time. Use the last value at or before game time zero as the graph baseline. Start the first web graph at game time zero. Thus, pre-game time is not part of the rolling window.

Use `analysis.is_actual_game` to exclude changes before the actual-game start marker and at or after the stop marker.

Treat cumulative gold as a step value. For a requested time, use the last known value at or before that time.

Return no value before a complete window is available. For example, a 10-second window has no value before game time 10.

Calculate team GPM as the sum of the five player GPM values. Do not calculate a team value if a required player value is missing.

## Scope

The first version will do these tasks:

1. Capture each change to player cumulative earned gold.
2. Store the shared timeline sequence, change time, and new cumulative value.
3. Calculate rolling GPM in DuckDB.
4. Show one team graph and one player graph.
5. Let the user select one of the six time windows.
6. Measure parser time, load time, query time, response size, and storage size.

The first version will not do these tasks:

- It will not calculate GPM from combat-log gold events.
- It will not use team metadata graphs for player GPM.
- It will not precompute each supported time window.
- It will not add a retention policy.
- It will not add a chart package unless a simple SVG chart is not sufficient.
- It will not add a free-form time-window input.

## Phase 1: Verify the replay source

Make a small parser test with one real replay before you change the storage contract.

1. Inspect `CDOTA_PlayerResource` updates.
2. Confirm the exact path for `m_iTotalEarnedGold`.
3. Confirm how the player index maps to `game_player_id`.
4. Confirm the game-clock properties on the game-rules entity.
5. Confirm that combat events and entity updates can use one timeline sequence.
6. Count gold changes for each player.
7. Confirm the value at game time zero.
8. Compare the last cumulative value with final `gold_per_min` and match duration.
9. Record the expected baseline and rounding rules.

Use [ReplayExporter.java](../parser/src/main/java/lab/dota/parser/ReplayExporter.java) for this test. The repository history also contains the old entity-clock code. Reuse only the clock code that this feature needs.

Stop this work if `m_iTotalEarnedGold` does not match final GPM within the expected rounding difference. Do not use combat-log sums as a fallback.

## Phase 2: Capture gold changes

Use the existing entity staging files. Do not add a new staging file.

Change [ReplayExporter.java](../parser/src/main/java/lab/dota/parser/ReplayExporter.java) as follows:

1. Add entity support with explicit class patterns.
2. Read only the player-resource entity and the game-rules clock entity.
3. Keep the game clock in parser memory.
4. Find changed `m_iTotalEarnedGold` fields in player-resource updates.
5. At tick end, emit at most one value for each changed player.
6. Keep negative-time changes that are inside the actual game.
7. Ensure that a value is available at or before game time zero.
8. Do not emit a row when the cumulative value did not change.
9. Do not emit unrelated entity properties, entity events, or checkpoints.

Use one timeline sequence for combat events and gold property updates. The actual-game macro compares a gold-update sequence with combat-marker sequences. Do not use a separate gold sequence.

Increase the timeline sequence for each combat event and each emitted gold update. Gaps in the combat-event sequence are valid. Preserve parser emission order for rows in the same tick.

Write the player-resource identity to `entity_instances.ndjson`. Write gold changes to `property_updates.ndjson`. The current loader already imports these files and checks their manifest data.

Each gold update must contain these values:

- extraction ID;
- update sequence;
- player-resource entity instance ID;
- exact property path;
- cumulative earned gold;
- demo tick;
- game time.

Update the profile description in [ExportConfig.java](../parser/src/main/java/lab/dota/parser/ExportConfig.java). List only the entity classes that the exporter reads.

Bump `exportFormatVersion` in [parser-identity.json](../parser-identity.json). This change must create a new extraction ID.

## Phase 3: Add the typed gold-event table

Add `src/db/migrations/009_granular_gpm.sql`. Do not change an applied migration. Migration 008 already contains the actual-game filter.

Create this table:

```sql
CREATE TABLE analysis.player_gold_events (
    extraction_id VARCHAR NOT NULL,
    sequence UBIGINT NOT NULL,
    game_player_id INTEGER NOT NULL,
    player_slot UINTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    game_time_seconds DOUBLE NOT NULL,
    total_gold_earned BIGINT NOT NULL,
    PRIMARY KEY (extraction_id, sequence)
);
```

Add one index for `(extraction_id, player_slot, game_time_seconds)`.

In [load-extraction.ts](../src/load/load-extraction.ts), materialize this table after the match documents and entity updates are available.

Use the property path to get `game_player_id`. Use the metadata player rows to map `game_player_id` to `player_slot` and `team_id`.

Require this predicate when you select source property updates:

```sql
analysis.is_actual_game(update.extraction_id, update.sequence)
```

This predicate keeps valid pre-game baseline rows. It removes post-game gold changes. If an extraction does not have both markers, insert no granular gold facts.

Reject invalid negative values and invalid player mappings. Keep multiple values at the same game time in sequence order.

Do not store calculated GPM in this table. Store only observed cumulative gold facts.

## Phase 4: Add the rolling GPM query

In migration 009, add a table macro with these parameters:

```text
analysis.match_rolling_gpm(match_id, window_seconds, output_step_seconds)
```

The macro must do these tasks:

1. Select the latest successful extraction.
2. Find the last pre-game value at or before game time zero.
3. Make an output time grid from zero to match duration.
4. Find the last cumulative value at or before each output time.
5. Find the last cumulative value at or before `time - window_seconds`.
6. Apply the rolling GPM formula.
7. Return player rows.
8. Sum complete player rows to make team rows.

Use DuckDB as-of joins or an equivalent simple query. Keep the source events unchanged.

Return these columns:

- series kind (`player` or `team`);
- player slot, when applicable;
- team ID;
- game time in seconds;
- window size in seconds;
- GPM.

The server will validate the macro parameters. The macro does not need a second validation system.

## Phase 5: Add a separate server query

Do not add all graph points to the current match-overview response.

Add a server function for GPM data. Use the existing match-ID validation.

Accept these integer inputs:

- `matchId`;
- `windowSeconds`;
- `outputStepSeconds`.

For the first version, the UI will always request an output step of one second. Keep the server parameter so tests and later measurements can use a larger step.

Validate the inputs with small fixed limits. Permit the six UI windows. Permit output steps from 1 through 60 seconds.

Add a TanStack Query key that contains the match ID, window size, and output step. Load the graph after the match overview loads.

Return grouped player and team series. Return an empty result when the extraction does not have granular gold data.

## Phase 6: Add the web graphs

Add a new GPM section to [matches.$matchId.tsx](../src/routes/matches.$matchId.tsx).

The section must contain these controls and graphs:

1. Add a selector for 1s, 5s, 10s, 30s, 60s, and 5m.
2. Select 60s by default.
3. Show Radiant and Dire in one team graph.
4. Show one team of five players in the player graph.
5. Add a Radiant/Dire control for the player graph.
6. Label the graph as `Rolling GPM - last X seconds`.
7. Show the selected time and values with keyboard focus and pointer input.
8. Show a short data summary for assistive technology.
9. Show a clear unavailable state for old extractions.
10. Keep the page within the mobile viewport.

Start with a reusable SVG line-chart component. Use team names, player names, and hero names from the current overview data.

Do not draw ten player lines at the same time. Do not add smoothing that changes the values.

## Phase 7: Test correctness

Add parser tests for these cases:

- player index extraction from the property path;
- one output per player per tick;
- duplicate-value removal;
- game time zero;
- negative game time;
- pause-safe game time.

Add loader and migration tests for these cases:

- metadata mapping from `game_player_id` to `player_slot`;
- event order at the same time;
- shared ordering of combat markers and gold updates;
- inclusion of a pre-game baseline row;
- exclusion of a row before the actual-game start marker;
- exclusion of a row at or after the actual-game stop marker;
- no gold facts when an actual-game marker is missing;
- a 1-second rolling window;
- a 60-second rolling window;
- no value before the complete window;
- team GPM from five complete player values;
- no team GPM when a player value is missing;
- selection of the latest successful extraction.

Add server and web tests for these cases:

- input limits;
- query-key changes after window selection;
- loading, empty, and error states;
- team selection;
- keyboard access;
- mobile width.

For one real replay, compare the stored final cumulative value with final `gold_per_min` and match duration. Apply the baseline rule from Phase 1. Permit only the documented rounding difference.

## Phase 8: Measure the impact

Measure before and after results with the same short, normal, and long benchmark replays.

Record these values:

- parser elapsed time;
- parser peak memory;
- parser output bytes;
- gold-event rows per match;
- loader elapsed time;
- DuckDB bytes per match;
- cold and warm GPM query time;
- response bytes for a one-second output step;
- browser render time for the normal and long match.

Use the current limits as safety limits. Do not add an optimization only because the result is large.

If a measured result causes a failure, apply changes in this order:

1. Increase the output step for long matches.
2. Request fewer visible player series.
3. Add one simple query index if the query plan uses it.
4. Consider a compact dedicated staging format only if parser output is the measured problem.

Do not precompute window results unless measurements show that the rolling query is the problem.

Add the measured results to the benchmark documentation.

## Phase 9: Roll out the new extraction

Apply migration 009 before you load the new parser output.

Re-extract one short match, one normal match, and one long match. Verify the values and measurements.

Old extractions do not contain granular player gold. Keep their GPM graph unavailable. Do not create approximate player data from team metadata or combat logs.

After verification, re-extract the other retained replays. Keep the old successful extractions until normal retention work removes them.

Update the README schema description and the chart-package decision.

## Completion conditions

The work is complete when all these statements are true:

- A user can select a 1-second rolling GPM window.
- Player GPM uses cumulative earned gold from the player resource.
- Team GPM is the complete sum of player GPM.
- Pause time and pre-game time do not change the metric.
- Granular gold facts use `analysis.is_actual_game`.
- Pre-game actual-game data supplies the game-time-zero baseline.
- Post-game gold changes do not enter the typed gold-event table.
- Old extractions show an unavailable state.
- Unit, integration, web, and mobile tests pass.
- The three benchmark replays stay inside the current safety limits.
- The benchmark report shows the measured performance and storage changes.
