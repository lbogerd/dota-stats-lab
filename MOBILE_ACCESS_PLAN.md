# Mobile Access: Implementation Plan

## 1. Objective

Add protected mobile access to the Dota Replay Data Lab.

The user opens `https://dota.tainer.run` on a phone. The user can ingest matches, monitor jobs, examine extractions, save SQL files, and run read-only SQL.

Run all application code in Docker containers. Keep the Clarity parser isolated from the network and DuckDB.

## 2. Scope

The first release must provide these functions:

1. Sign in through the tainer authentication gateway.
2. Submit one match ID.
3. Show download, parse, and load status.
4. List stored matches and extractions.
5. Run read-only SQL.
6. Show SQL results on a phone.
7. Save, open, rename, download, and delete SQL files.
8. Keep saved queries after container replacement.

Keep the current command-line workflow.

## 3. Principles

- Use KISS. Add only the parts that the first release needs.
- Use YAGNI. Do not build for possible future requirements.
- Keep one Node.js package.
- Keep one web process and one separate parser worker.
- Use files for jobs and saved queries.
- Do not add Redis, PostgreSQL, or another service database.
- Do not optimize before measurement.
- Pin all dependency versions in `pnpm-lock.yaml`.

## 4. Architecture

Run two permanent application services:

```text
mobile browser
      |
      v
protected https://dota.tainer.run
      |
      v
web service
  - TanStack Start SPA and server functions
  - ingestion coordinator
  - saved-query file access
  - DuckDB access
      |
      v
staging job files
      |
      v
parser-worker service
  - Clarity exporter
  - no network
  - no DuckDB access
```

Keep the current one-shot services for the command-line workflow. Add `web` and `parser-worker` for mobile access.

Do not mount the Docker socket.

## 5. Frontend Stack

Use these required tools:

- Vite.
- React.
- TanStack Start in SPA mode.
- TanStack Router.
- TanStack Query.
- Tailwind CSS with its Vite plugin.

Enable SPA mode in `vite.config.ts`:

```ts
tanstackStart({
  spa: {
    enabled: true,
  },
})
```

Route server functions and `/health` before the SPA shell fallback.

TanStack Start is a release candidate at the time of this plan. Pin an exact version.

### 5.1 Dependencies

Add these runtime dependencies:

```text
react
react-dom
@tanstack/react-start
@tanstack/react-router
@tanstack/react-query
zod
@uiw/react-codemirror
@codemirror/lang-sql
lucide-react
```

Use Zod for server input validation. Use CodeMirror for SQL editing. Use Lucide for icons.

Add these build dependencies:

```text
vite
@vitejs/plugin-react
tailwindcss
@tailwindcss/vite
typescript
```

Add these test and development dependencies:

```text
vitest
@testing-library/react
@testing-library/user-event
jsdom
@playwright/test
@tanstack/react-query-devtools
@tanstack/eslint-plugin-query
```

Do not add another UI, form, state, chart, table, toast, or date library.

## 6. Application Routes

Create these routes:

```text
/                    Dashboard and recent jobs
/ingest              Match ingestion
/matches             Stored matches
/matches/$matchId    Match and extraction details
/queries             Saved queries
/queries/$queryName  Query editor and results
```

Use bottom navigation on small screens. Do not depend on hover.

Show SQL results as a scrolling table or JSON. Add Copy and Download actions. Limit the row count and response size.

Do not add charts.

## 7. TanStack Query

Use TanStack Query for jobs, matches, extractions, saved queries, and SQL results.

Use mutations for ingestion and saved-query changes. Invalidate related query keys after each successful mutation.

Poll active jobs at a fixed interval. Stop polling after success or failure. Do not add WebSockets or server-sent events.

Use route loaders with `queryClient.ensureQueryData` for required route data.

## 8. Saved Query Files

Create this external Docker volume:

```text
dota-stats-queries
```

Mount it only in the web service at `/data/queries`. Update `./dota init` to create it.

Store one query in one file:

```text
/data/queries/hero-property-history.sql
/data/queries/team-net-worth.sql
```

Use the file stem as the query name and ID. Accept only lowercase letters, numbers, hyphens, and underscores. Set a short maximum length.

Support list, read, save, rename, download, and delete operations. Confirm deletion in the user interface.

Write to a temporary file in the same directory. Rename the file after a successful write. Reject symbolic links and unsafe paths.

Do not add folders, tags, revisions, sharing, automatic save, an index file, or a metadata database.

The external volume survives container replacement. Document that volume durability is not a backup.

## 9. Ingestion Jobs

Use one directory for each job:

```text
/work/staging/jobs/JOB_ID/
```

Store a request file and a status file. Use these states:

```text
queued
fetching
parsing
loading
succeeded
failed
```

The web process runs one job at a time. Reuse the existing fetch and load code.

The web process downloads the replay and writes a parse request. The parser worker polls for requests and writes its normal output.

Use atomic file renames for handoff. Validate all parser output before load.

Inspect incomplete jobs when the web process starts. Resume a safe job or mark it as failed. Do not add a queue database.

## 10. DuckDB Access

Keep DuckDB access in the web process. Serialize database work with the existing warehouse lock.

For browser SQL:

1. Get the lock.
2. Open DuckDB in read-only mode.
3. Disable external access.
4. Set memory and thread limits.
5. Lock the DuckDB configuration.
6. Run one query.
7. Close DuckDB and release the lock.

For extraction load:

1. Get the lock.
2. Open DuckDB in read and write mode.
3. Run migrations.
4. Load one transaction.
5. Close DuckDB and release the lock.

Do not let browser SQL change DuckDB, access files, or load extensions.

## 11. Server Rules

Use TanStack Start server functions. Validate inputs with Zod.

Add `/health`. The route reports whether the web process can accept requests.

Use same-origin requests. Do not enable cross-origin resource sharing. Check the request origin for mutations.

Use the tainer authentication gateway. Do not add another account system.

## 12. Docker Services

Add `web` with these controls:

- Existing non-root user.
- Read-only container file system.
- Replay, staging, warehouse, and query volumes.
- Size-limited `tmpfs` for `/tmp`.
- Memory, CPU, and process limits.
- Health check for `/health`.
- One port on IPv4 loopback.

Use this port form:

```yaml
ports:
  - "127.0.0.1:HOST_PORT:3000"
```

Find an unused host port. Do not bind to `0.0.0.0`, `[::]`, the LAN, or WireGuard.

Add `parser-worker` with the existing parser controls:

- No network.
- Read-only container file system.
- Existing non-root user.
- All Linux capabilities removed.
- `no-new-privileges` enabled.
- Replay volume mounted read-only.
- Staging volume mounted read and write.
- No warehouse or query volume.
- Existing resource and time limits.

Do not expose parser or DuckDB ports.

## 13. Implementation Steps

### Step 1: Add the web toolchain

Add the listed dependencies. Create the SPA shell, route tree, Query client, Tailwind setup, and responsive navigation.

Keep the existing CLI build and tests. Build the web image in Docker.

### Step 2: Add the web service

Add the production server, health route, Compose service, loopback port, limits, and mounts.

Confirm that `/health` works on loopback. Confirm that no other port is published.

### Step 3: Add saved queries

Add the external query volume and server functions. Add the saved-query list and editor routes.

Test save, reopen, rename, download, delete, unsafe names, and container replacement.

### Step 4: Add read-only SQL

Add safe DuckDB configuration and result limits. Add CodeMirror, Run, table view, JSON view, Copy, and Download.

Test valid SQL, invalid SQL, write SQL, extension loading, and file access.

### Step 5: Add match browsing

Add match lists, extraction details, counts, and errors. Use the existing catalog. Do not add derived Dota data.

### Step 6: Add web ingestion

Add file job states, the single-job coordinator, parser-worker mode, and atomic handoff. Reuse existing ingestion code.

Test success, unavailable replay, parser failure, loader failure, and process restart.

### Step 7: Add focused tests

Add tests for files, validation, job states, DuckDB restrictions, and the main React routes.

Add one Playwright test with a mobile viewport. Run all tests in Docker.

### Step 8: Publish to tainer.run

Use `https://dota.tainer.run` as the canonical protected URL.

Start `web` and `parser-worker`. Require the web container to become healthy.

Add the exact host to `AUTH_ALLOWED_HOSTS`. Preserve all existing hosts. Recreate only the authentication gateway. Verify its live and ready routes.

Run:

```sh
/home/xub/.agents/skills/publish-tainer-docker-app/scripts/publish.sh \
  dota HOST_PORT --health-path /health
```

Do not pass `--public`. Do not add a UFW rule. Do not edit Caddy, DNS, route registry, or VPS files.

Verify the loopback origin, container health, DNS, TLS, Better Auth provider, and authentication behavior.

Inspect the tainer.run dashboard. Add a user-facing tile if appropriate. Rebuild and verify the dashboard after a change.

## 14. Completion Checks

Use a phone-sized browser viewport for these checks:

1. Sign in at `https://dota.tainer.run`.
2. Submit an available match ID.
3. Watch the job succeed.
4. Open its extraction details.
5. Run read-only SQL.
6. Save the SQL as a plain file.
7. Reopen and run the saved query.
8. Recreate the web container.
9. Confirm that saved queries and existing data remain.
10. Confirm that browser SQL cannot change DuckDB or read files.

Report the URL, authentication provider, origin port, container health, and verification result.

## 15. Non-Goals

Do not implement these items:

- A native mobile application.
- Public access without authentication.
- Server-side rendering.
- Offline PWA support.
- Multiple users or query sharing.
- Saved-query folders, tags, or revisions.
- Automatic query save.
- Charts or dashboards.
- WebSockets or server-sent events.
- Parallel ingestion.
- A service database or task queue.
- A component library.
- A new Dota analysis model.
- Browser media access.
