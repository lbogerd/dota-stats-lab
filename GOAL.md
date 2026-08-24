# Goal: High-Performance Dota Replay Data Lab

## 1. Mission

Build a new experimental application for Dota 2 replay analysis.

Use Clarity to parse Dota 2 replay files.

Use DuckDB to store and analyze the parsed data.

Build a small website that shows a clear match overview.

The website must have the basic information that a Dotabuff match page has.

Do not copy the Dotabuff name, brand, text, or visual design.

Use TanStack Start for the full-stack web application.

Use Tailwind CSS for the website styles.

Use other TanStack packages when they remove useful custom code.

Treat this work as a new project.

Do not preserve the current application, database, interfaces, or data.

## 2. Meaning of Requirement Words

In this file, **must** identifies a requirement.

In this file, **should** identifies guidance.

In this file, a **replay** is a Dota 2 replay file.

In this file, **ingestion** is all work from replay input through the DuckDB commit.

In this file, the **normal path** is the ingestion path that users use by default.

An **extraction profile** is a named set of parser filters and output fields.

## 3. Fixed Technical Constraints

Use Clarity as the Dota 2 replay parser.

The repository contains a Clarity fork in `vendor/clarity`.

The fork has parser filters.

You can use this fork, change this fork, or use another suitable Clarity revision.

Do not replace Clarity with a different replay parser.

Use DuckDB as the main data store and analysis engine.

Use TanStack Start as the web framework.

Use Tailwind CSS for all normal application styles.

These constraints do not select the application language or process layout.

They do not select the API, job mechanism, schema, or deployment method.

Select those parts during implementation.

## 4. Design Principles

Make the simplest design that meets this goal.

Keep the number of processes and data conversions small.

Keep high-volume replay data away from unnecessary process boundaries.

If you add a service, document why a simpler process layout is not sufficient.

Choose common dependencies when they reduce code or risk.

Do not add a dependency only for a small convenience.

Document each important design decision and its reason.

Measure performance before you add performance-specific complexity.

Stop performance work when the lenient targets in this file pass.

## 5. Replay Input

Support at least one local replay input method.

Accept an uncompressed `.dem` file or a compressed replay file.

Support replay download by match identifier.

Keep the input replay as the source for future extraction.

Do not depend on old parsed data when a replay can be parsed again.

Validate the replay input before ingestion.

Reject an unsupported file with a clear error message.

Set practical file-size and operation-time limits.

Do not put large replay files in Git.

### 5.1 Replay Download Guidance

Keep each match identifier as a decimal string across JSON and browser interfaces.

Do not store a match identifier in a floating-point number.

Validate the full DuckDB `UBIGINT` range at the first application boundary.

Use replay metadata from a current public provider when a user gives a match identifier.

Prefer the complete replay URL that the provider returns.

The URL can use a regional host.

Do not assume that all replay URLs use a `valve.net` host.

Only construct a replay URL when the provider does not return one.

Use the provider's current cluster and replay-salt rules for a constructed URL.

Download the replay in the server environment.

Some valid replay sources use HTTP instead of HTTPS.

Do not make the browser fetch an HTTP replay through an HTTPS page.

Stream each replay to a temporary file.

Calculate its byte count and checksum during the download.

Enforce the size limit when the response has no correct `Content-Length` value.

Publish the cache file only after the download is complete.

Remove an incomplete temporary file after an error.

Verify a cache entry before you report a cache hit.

Retry network errors and temporary HTTP errors with a bounded delay.

Treat HTTP 408, 425, 429, and server errors as temporary errors.

Honor a `Retry-After` value when the provider sends one.

Do not retry a permanent client error without a specific reason.

Report replay unavailability separately from a temporary provider failure.

Keep replay acquisition information with the checksum and source type.

## 6. Clarity Parsing

Inspect the Clarity fork before you design the ingestion path.

Identify the messages and entity properties that the match overview needs.

Configure Clarity to select that data as early as practical.

Confirm that each filter reduces work, object creation, or stored output.

Measure filters instead of assuming that callback filters reduce decoding work.

Do not export every protobuf message by default.

Do not export every entity property by default.

Prefer a normal path that does not create a complete text copy of parsed events.

If you use a full text staging format, measure its time and storage cost.

Record the reason for that design in the benchmark report.

Provide one default extraction profile for the match overview.

You can add more extraction profiles when they have a clear analysis purpose.

Record the Clarity revision and extraction profile for each ingestion.

## 7. DuckDB Storage and Analysis

Select the DuckDB write method from measurements and current DuckDB guidance.

Use typed columns for data that users filter, sort, join, or aggregate.

Common analysis queries must not parse large JSON text for each result.

Keep repeated high-volume data compact.

Store only the event history that supports a defined use case.

Keep match facts separate from time-series events when this improves queries.

Let DuckDB calculate summaries and analysis results with SQL.

Do not calculate the same derived value in many application components.

Store enough version data to reproduce an extraction.

Store phase times, input bytes, output rows, and failure information.

Make ingestion atomic.

A failed ingestion must not show a partial match.

Make repeated ingestion safe.

The same replay and extraction profile must not create accidental duplicate data.

Review the current DuckDB guidance for bulk import and concurrency.

Select one clear ownership model for DuckDB writes.

Document how reads and writes operate at the same time.

## 8. Website Scope

Build a small, complete showcase website.

The website must work with the DuckDB data from this project.

Do not use fixed match data in the normal application path.

Provide a match list page.

The match list must show the match identifier, date, duration, and result.

The match list must also show both team scores.

Provide a match overview page.

The overview header must show these fields when the replay contains them:

- Match identifier.

- Start date and time.

- Match duration.

- Game mode.

- Lobby type.

- Winning team.

- Radiant score.

- Dire score.

The overview must show one roster for each team.

Each player row must show these fields when the replay contains them:

- Player name or an anonymous label.

- Hero name and hero image.

- Player level.

- Kills, deaths, and assists.

- Last hits and denies.

- Gold per minute and experience per minute.

- Final net worth.

- Hero damage, tower damage, and hero healing.

- Final items.

Show team totals for important numeric fields.

Use a clear value such as `Unknown` when the replay does not contain a field.

Do not invent a value for missing data.

Use licensed or permitted hero and item images.

Document the image source and required attribution.

Provide a small ingestion view.

The view must let a user select a supported replay input.

The view must show pending, active, successful, and failed states.

The web server must stay responsive during replay ingestion.

Do not attach a long ingestion lifetime to one browser request.

Make one application component the clear owner of each active ingestion.

Prevent a server restart or development reload from starting duplicate work.

Recover or clearly fail an interrupted ingestion after application restart.

Provide useful empty, loading, and error states.

Make the main pages usable on a phone and on a desktop display.

Use semantic HTML and visible keyboard focus.

Use sufficient color contrast.

Do not use color as the only indication of the winning team.

## 9. Analysis Showcase

Make DuckDB analysis visible in the website.

The match overview must use DuckDB queries for its summary and roster data.

Add at least one small analysis that is not a direct field list.

Examples are team totals, a net-worth difference, or a kill-time summary.

The agent must select the analysis from data that Clarity supplies reliably.

Include at least three documented SQL examples for direct DuckDB use.

One example must return the match summary.

One example must return the player scoreboard.

One example must show an aggregate or time-series result.

An interactive SQL editor is optional.

If you add an SQL editor, allow read-only and bounded queries only.

## 10. TanStack Guidance

Read the current official TanStack documentation before implementation.

TanStack adds packages frequently.

The package list and package status can change after this file is written.

Use the current supported TanStack Start setup.

TanStack Start includes TanStack Router.

Use its routing and full-stack features where they keep the design simple.

Evaluate relevant TanStack packages before you write equivalent custom code.

At minimum, evaluate these packages:

- TanStack Query for remote server state.

- TanStack Table for the match list and player scoreboards.

- TanStack Form for replay input and validation.

- TanStack Charts for a small analysis chart.

- TanStack Virtual for a long list.

- TanStack Pacer for controlled polling or noisy input.

- TanStack Store for shared client state.

- TanStack DB for reactive client collections.

- TanStack Devtools for development diagnostics.

Do not use all these packages without a need.

Record the selected packages and the rejected packages in the README.

Give one short reason for each decision.

Prefer a stable package for an optional feature.

Use a preview package only when its value is larger than its risk.

Pin package versions with a lock file.

If you use an experimental feature, document the need and the known risk.

## 11. Performance Measurements

Add one repeatable benchmark command.

The command must measure ingestion without replay download time.

Measure these phases separately:

- Replay decompression or input preparation.

- Clarity parsing and filtering.

- DuckDB data writes.

- DuckDB summary creation.

- Complete ingestion.

Record replay size, match duration, row counts, and peak memory.

Record the processor, memory, operating system, and software versions.

Use a new database or remove the test match before each measured ingestion.

Run one unmeasured warm-up before the measured runs.

Run each measured replay three times when practical.

Report the median time.

Use at least three real replays when they are available.

Use one short match, one normal match, and one long or large match.

A normal match has a game duration from 30 minutes through 60 minutes.

If three replays are not available, use one replay and report this limit.

Do not block the first working version because test replays are not available.

### 11.1 Lenient Acceptance Limits

These limits apply on the documented development computer.

The median complete ingestion time for a normal match must be 60 seconds or less.

The median ingestion time for a long or large match must be 120 seconds or less.

Peak resident memory during ingestion must be 4 GiB or less.

A warm match-overview request must complete in 1 second or less at the 95th percentile.

Measure the overview request at least 30 times.

The user interface must acknowledge an ingestion request in 1 second or less.

The ingestion operation can continue after this acknowledgement.

Treat these values as upper limits, not optimization targets.

Do not add complex optimizations only to make an already passing result faster.

If a limit does not pass, use a profiler before you change the design.

Document the cause and the measured change.

## 12. Correctness and Failure Behavior

Show a clear error when Clarity cannot parse a replay.

Show a clear error when DuckDB cannot commit an ingestion.

Keep the original replay after a parse or database failure.

Do not show a successful state before the DuckDB transaction commits.

Do not mix data from different parser versions without version information.

Use UTC for stored times.

Show the user time zone clearly when the website converts a time.

Treat a missing player name as normal data.

Treat a missing optional statistic as normal data.

## 13. Tests

Add unit tests for important data conversions and calculations.

Add an integration test for DuckDB schema creation and queries.

Add an integration test for atomic ingestion failure.

Add a parser test with a real replay when a suitable fixture is available.

Do not commit an unlicensed or very large replay fixture.

Provide a documented method to supply a local replay fixture.

Add one browser test for the main match-overview flow.

Test one small-screen layout.

Test missing optional replay data.

Test repeated ingestion of the same replay and profile.

## 14. Operations and Diagnostics

Provide one documented command to start development.

Provide one documented command to build a production version.

Provide one documented command to run all automated tests.

Provide one documented command to run the benchmarks.

Container support is required for the final deployment.

Do not require external credentials for the basic local workflow.

Log one ingestion identifier with each phase message.

Log the elapsed time and row count for each ingestion phase.

Do not log full replay records by default.

Do not log secrets or personal identifiers that are not necessary.

## 15. Deployment to `dota.tainer.run`

Package the final application as a Docker Compose web application.

Use the `publish-tainer-docker-app` skill for the deployment.

Treat the skill as the authority for all deployment and verification operations.

Do not copy the skill procedure into the project documentation.

Deploy the application to `https://dota.tainer.run`.

Use the protected route mode unless the user gives a different instruction.

Make the production container configuration pass the skill preconditions.

Run the skill verification after each deployment change.

Record the deployment result that the skill requires.

Do not report the deployment as complete when the skill verification fails.

## 16. Final The International 2026 Test

Run this test after the other acceptance tests pass.

Run this test against the deployed production containers.

Download and ingest ten distinct replays from The International 2026.

Use matches from the main tournament.

Do not use an open qualifier or a regional qualifier.

Use matches from at least three different series.

Verify tournament membership with a current public tournament source.

At the time of writing, OpenDota uses league identifier `19719` for the main tournament.

If you use OpenDota, verify this identifier before you select the matches.

Store the ten selected match identifiers in a small test manifest.

Store each identifier as a decimal string.

Record the source that proves tournament membership.

Do not store the downloaded replay files in Git.

Use an isolated test cache for the first run.

The isolated cache must not contain the ten selected replays.

Do not delete or change an unrelated replay cache.

A cache hit does not satisfy the first download of a replay.

Use a low request rate or bounded concurrency for external providers.

Apply the replay download guidance in Section 5.1.

Honor the complete replay URL from the metadata provider.

TI 2026 replay URLs can use a regional `dota2.com.cn` host.

If a selected replay is no longer available, select another main-tournament replay.

Update the test manifest and record the reason for the replacement.

The test must fail if fewer than ten distinct replays complete ingestion.

For each replay, verify these results:

- The network download completes.

- The stored byte count is greater than zero.

- The application records a SHA-256 checksum.

- Decompression completes.

- Clarity completes the selected extraction profile.

- DuckDB commits one complete match.

- The match overview returns a successful response.

- The overview shows both teams and ten player slots.

- The overview shows the result, duration, and team scores.

After all downloads, verify that DuckDB has ten distinct selected matches.

Verify that no selected ingestion is active or failed.

Verify that the deployed match list shows all ten selected matches.

Open at least one overview through an authenticated `dota.tainer.run` session.

Run the same ten-match test a second time without an empty cache.

The second run must use valid cache entries when they are present.

The second run must not create duplicate match or player facts.

Record the identifier, source host, bytes, checksum, and phase times for each replay.

Record the final page URL and result for each replay.

Keep download time separate from the ingestion benchmark in Section 11.

Do not set a total-time limit for this network test.

External network speed must not cause performance optimization work.

## 17. Deliverables

Deliver all source code and configuration that the application needs.

Deliver the DuckDB schema and its change mechanism.

Deliver the Clarity integration and extraction-profile configuration.

Deliver the TanStack Start website and Tailwind CSS styles.

Deliver automated tests.

Deliver the repeatable benchmark command.

Deliver an initial benchmark report with raw measurements.

Deliver the final ten-replay test command and its test manifest.

Deliver the final ten-replay test report.

Deliver a README with setup, use, test, and benchmark instructions.

Deliver a short design document.

The design document must explain the data flow and DuckDB ownership model.

The design document must identify each process and serialization boundary.

The design document must explain why each boundary is necessary.

Include a sample screenshot of the match overview.

Deliver the Docker Compose configuration that the deployment skill needs.

## 18. Acceptance Checklist

The goal is complete only when all applicable items pass.

- A new user can follow the README on a clean computer.

- The user can ingest a supported local replay.

- Clarity parses the replay with a documented extraction profile.

- The design measures and explains each full-data intermediate copy.

- DuckDB stores typed match and player data.

- A failed ingestion does not expose partial match data.

- Repeated ingestion does not create accidental duplicates.

- The website lists ingested matches.

- The website shows a responsive Dotabuff-like match overview.

- The overview shows both teams and their player scoreboards.

- The overview uses DuckDB analysis results.

- The required SQL examples return correct results.

- The automated tests pass.

- The benchmark report contains phase measurements.

- The lenient performance limits pass or have a documented test-data exception.

- The README records the TanStack package decisions.

- The deployment skill verifies `https://dota.tainer.run`.

- The final test downloads and ingests ten TI 2026 main-tournament replays.

- All ten deployed match-overview pages show the required match data.

- The repeated ten-match run creates no duplicate facts.

## 19. Non-Goals

Do not migrate the current project data.

Do not keep compatibility with the current interfaces.

Do not reproduce all Dotabuff features.

Do not make an exact visual copy of Dotabuff.

Do not build live match tracking.

Do not build a general archive for every Clarity event.

Do not rewrite Clarity in another programming language.

Do not build a distributed production platform.

Do not optimize for millions of stored matches in this experiment.

## 20. Agent Decision Rule

When this file does not select a design, select the simplest suitable design.

Use measurements and current official documentation for the decision.

Record assumptions that can change correctness or performance.

Implement a complete working flow before you add optional features.

The first working flow must parse one replay, write DuckDB, and show one match page.

## 21. Current Reference Documents

These links were current on 2026-08-24.

Check for newer official guidance before you start implementation.

- [TanStack Start overview](https://tanstack.com/start/latest/docs/framework/react/overview)

- [TanStack Start getting started](https://tanstack.com/start/latest/docs/framework/react/getting-started)

- [TanStack libraries](https://tanstack.com/)

- [TanStack Query](https://tanstack.com/query/latest)

- [TanStack Table](https://tanstack.com/table/latest)

- [TanStack Form](https://tanstack.com/form/latest)

- [TanStack Charts](https://tanstack.com/charts/latest)

- [TanStack Virtual](https://tanstack.com/virtual/latest)

- [TanStack Pacer](https://tanstack.com/pacer/latest)

- [TanStack DB](https://tanstack.com/db/latest)

- [DuckDB performance guidance](https://duckdb.org/docs/stable/guides/performance/how_to_tune_workloads)

- [DuckDB concurrency](https://duckdb.org/docs/stable/connect/concurrency)

- [OpenDota API documentation](https://docs.opendota.com/)

- [OpenDota TI 2026 main-tournament matches](https://api.opendota.com/api/leagues/19719/matches)

- [The International 2026 event](https://liquipedia.net/dota2/The_International/2026)

- [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf)
