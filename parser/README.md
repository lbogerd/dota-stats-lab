# Dota replay exporter

The exporter builds the Clarity fork pinned by `vendor/clarity` and turns a
cached replay into immutable NDJSON staging files. `parser-identity.json` at
the repository root records the upstream Clarity release, exact fork commit,
and export-format version. Java, TypeScript, tests, and Docker builds all read
that file instead of declaring their own version strings.

The manifest keeps these concepts separate. `parser.upstreamRelease` describes
the fork base, `parser.forkRevision` identifies the parser source, and the
legacy-compatible `parser.version` contains that same fork revision.
`exporterVersion` contains the export-format version. Extraction IDs include
the fork revision and export-format version, so a replay can be parsed again
and stored alongside an older parser identity.

Initialize the submodule before a local build:

```sh
git submodule update --init vendor/clarity
```

The container entry point is:

```sh
java -jar /app/parser.jar MATCH_ID
```

By default it reads `/data/replays/MATCH_ID/replay.dem.bz2` (or `replay.dem`),
uses the SHA-256 from `acquisition.json` when present, and publishes to
`/work/staging/MATCH_ID/EXTRACTION_ID`. Explicit paths are useful in tests:

```sh
java -jar parser.jar MATCH_ID --replay /path/replay.dem \
  --staging-root /tmp/staging --replay-sha256 HEX
```

Replay files named `.bz2` are detected by their magic bytes and may contain
either BZip2 or Zstandard data.

Limits are configured with `PARSER_MAX_INPUT_BYTES` (default 2 GiB),
`PARSER_MAX_OUTPUT_BYTES` (12 GiB), `PARSER_MAX_RECORDS` (50 million),
`PARSER_TIMEOUT_SECONDS` (1800), and `CHECKPOINT_INTERVAL_SECONDS` (30).
An extraction is only published after all files and their manifest have been
closed and hashed. A failed partial extraction is retained with a `.failed-*`
suffix and is never loadable because it has no `manifest.json`.
