# Hero Statistics Overview Plan

## Goal

Add one hero statistics overview page at `/heroes`.

Show these values for each hero:

- average GPM;
- average XPM;
- wins and losses;
- win rate and loss rate;
- picks and pick rate;
- bans and ban rate.

Do not add a hero details page. Do not add a hero details route. Do not make a hero row a link.

## Research result

The current parser already exports all required source data.

[ReplayExporter.java](../../parser/src/main/java/lab/dota/parser/ReplayExporter.java) stores the complete final `CMsgDOTAMatch` document in `raw.records`. The document has these fields:

```text
players[].hero_id
players[].team_number
players[].gold_per_min
players[].xp_per_min
picks_bans[].hero_id
picks_bans[].is_pick
picks_bans[].team
```

[load-extraction.ts](../../src/load/load-extraction.ts) already copies the player fields to `analysis.players`. It also stores the match winner in `analysis.matches`. It does not copy `picks_bans` to a typed table.

The live warehouse had these values on 2026-08-25:

- 294 stored `CMsgDOTAMatch` documents;
- 147 latest successful matches;
- 1,470 player rows in the latest matches;
- 1,470 pick events in the latest matches;
- 2,058 ban events in the latest matches;
- 24 draft events in each latest match;
- no missing hero ID, GPM, or XPM in the latest player rows;
- no latest pick without a matching player row.

The warehouse has more source documents than current matches because it keeps old extractions. Use `analysis.latest_successful_extractions` in all overview calculations. Do not count old extractions.

No Java parser change is necessary. Do not change `ReplayExporter.java`. Do not change `parser-identity.json`. Do not increase the export format version. Existing replay data is sufficient, so a replay re-extraction is not necessary.

A database change is necessary for ban statistics. Normalize the stored `picks_bans` array. Add normalized rows for existing extractions.

## Metric rules

Use one fixed data scope. The scope is all matches that have a latest successful extraction and a row in `analysis.matches`.

Calculate the metrics as follows:

```text
picks = number of scope matches in which the hero occurs in analysis.players
bans = number of scope matches in which the hero has a valid ban event
wins = hero picks in which player.team_id equals match.winner_team_id
losses = hero picks in which player.team_id does not equal match.winner_team_id
pick rate = picks / scope match count
ban rate = bans / scope match count
win rate = wins / (wins + losses)
loss rate = losses / (wins + losses)
average GPM = mean of non-null player.gold_per_min values for the hero
average XPM = mean of non-null player.xp_per_min values for the hero
```

Use distinct match IDs for pick and ban counts. This rule prevents a bad duplicate event from increasing a rate.

Do not include a pick with an unknown winner in wins, losses, win rate, or loss rate. Keep the pick in the pick rate and in the GPM and XPM averages.

Return rates as numbers from 0 through 1. Show them as percentages in the web page. Show one digit after the decimal point. Show average GPM and XPM with one digit after the decimal point.

Return null for an average that has no input value. Return null for win rate and loss rate when the hero has no decided pick. Show `Unknown` for these null values.

Include each hero that occurs in a player row or in a valid ban event. Use the local hero asset map for the name and image. Keep the current `Hero #ID` and unavailable-image fallback for an unknown hero ID.

## Step 1: Normalize draft events

Add `src/db/migrations/011_hero_stats.sql`. Do not change an applied migration.

Create `analysis.hero_draft_events` with these columns:

```text
extraction_id VARCHAR
draft_order UINTEGER
hero_id INTEGER
is_pick BOOLEAN
team_index INTEGER
```

Use `(extraction_id, draft_order)` as the primary key. Add an index on `(extraction_id, hero_id, is_pick)`.

In the migration, read `picks_bans` from every stored `CMsgDOTAMatch`. Insert one row for each valid event. Use the JSON array key as `draft_order`. Accept only a positive hero ID, a Boolean `is_pick` value, and team index 0 or 1.

This insert supplies draft rows for existing extractions. Make the insert safe when the table has no source rows.

In `materializeMatchAnalysis()` in [load-extraction.ts](../../src/load/load-extraction.ts), add the same insert for each new extraction. Keep the migration query and the loader query equivalent.

Add `analysis.hero_draft_events` to `analysisRowCount()`. This keeps the ingestion summary correct.

## Step 2: Add the DuckDB overview query

In migration 011, add this table macro:

```text
analysis.hero_stats()
```

Use `analysis.latest_successful_extractions` and `analysis.matches` to make the match scope. Aggregate player facts and ban facts in separate common table expressions. Join the aggregates only after each aggregate has one row for each hero. This rule prevents a draft event from multiplying player values.

Return these columns:

```text
hero_id
match_count
picks
bans
wins
losses
pick_rate
ban_rate
win_rate
loss_rate
average_gpm
average_xpm
```

Return one row for a hero that is only banned. Return zero picks, zero wins, and zero losses for this row. Return null for its win rate, loss rate, average GPM, and average XPM.

Order rows by pick rate from high to low. Use ban rate and hero ID as stable second and third order values.

## Step 3: Add the server and query interfaces

Add `src/server/hero-stats.ts`.

Define one JSON-safe result with the scope match count and an array of hero statistic rows. Use one read-only warehouse callback. Query the scope match count and `analysis.hero_stats()` in that callback. Validate finite numbers and nonnegative integer counts before you return the result.

Add `listHeroStatsFn` to [functions.tsx](../../src/web/functions.tsx).

Add `src/web/hero-stats-data.ts`. Add the TanStack Query key `['hero-stats']`. Add the query options for `listHeroStatsFn`.

Do not add data to the match overview response. Hero statistics have a separate route and a separate cache key.

## Step 4: Add the overview page

Add `src/routes/heroes.tsx` for `/heroes`.

Add `Heroes` to the desktop and mobile navigation in [app-shell.tsx](../../src/web/app-shell.tsx). Change the mobile navigation grid from four columns to five columns.

Use the standard page heading and card styles. State the number of matches in the metric scope.

Use one semantic table on wide screens. Use statistic cards on small screens. Show these columns or fields:

```text
Hero
Average GPM
Average XPM
Wins-Losses
Win-Loss rate
Picks and pick rate
Bans and ban rate
```

Show the hero image, hero name, and hero ID. Use [dota-assets.ts](../../src/web/dota-assets.ts). Use text with color for all results. Do not use color as the only meaning.

Add a loading state, an error state with a retry control, and an empty state. Keep the page within the mobile viewport.

Do not add a chart. Do not add date, patch, tournament, team, or player filters in this change. Do not add pagination unless a measured browser problem requires it.

## Step 5: Test the data and the page

Add a DuckDB integration test for `analysis.hero_stats()`.

Test these cases:

- an older successful extraction for the same match does not change a value;
- one hero has one win and one loss;
- one hero has an unresolved match result;
- one hero is banned but is not picked;
- a duplicate draft event does not increase the ban count;
- a null GPM or XPM value does not become zero;
- an empty warehouse returns an empty result;
- all rates use the specified denominators.

Extend the loader test. Confirm that `picks_bans` becomes typed draft rows for a new extraction. Confirm that the ingestion analysis-row count includes these rows.

Add a server test. Confirm JSON-safe types, null values, and stable row order.

Add a Vitest page test. Confirm the loading, error, empty, desktop, and mobile content. Confirm that a hero name is not a link to a details route.

Extend [mobile.spec.ts](../../e2e/mobile.spec.ts). Open `Heroes` from the mobile navigation. Confirm that the page shows all required metrics and does not make the document wider than the viewport.

Run these checks:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:web
sudo docker compose build parser e2e
sudo docker compose run --rm --no-deps e2e
```

After the migration, compare one hero row with a direct query of `analysis.players`, `analysis.matches`, and `raw.records.picks_bans`. Confirm the counts, averages, and denominators.

## Documentation and completion

Update the README. Add the hero overview route, the typed draft table, and the metric definitions. State that the page uses only the latest successful extraction for each match.

The work is complete when all these statements are true:

- `/heroes` shows average GPM and XPM for each hero in the data scope.
- `/heroes` shows wins, losses, win rate, and loss rate.
- `/heroes` shows picks, bans, pick rate, and ban rate.
- The values use only the latest successful extraction for each match.
- Existing stored matches supply ban data without replay re-extraction.
- New extractions create typed draft rows during loading.
- Unknown values stay unknown.
- Desktop and mobile users can read the same metrics.
- No hero details route or page exists.
- All required tests pass.
