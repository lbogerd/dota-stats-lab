# Dota replay exporter

The exporter builds the Clarity fork in `vendor/clarity`. It turns a cached
replay into immutable NDJSON staging files. The root `parser-identity.json`
file records the Clarity release, fork commit, and export format. Java,
TypeScript, tests, and Docker builds all read that file.

The manifest stores each version separately. `parser.upstreamRelease` is the
fork base. `parser.forkRevision` is the parser source commit.
`parser.version` has the same fork commit for schema compatibility.
`exporterVersion` is the export format. Extraction IDs include the fork commit
and export format. A new parser version can therefore store a new extraction
without replacing an older one.

Initialize the submodule before a local build:

```sh
git submodule update --init --recursive
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

Limits use these environment variables:

- `PARSER_MAX_INPUT_BYTES`: 2 GiB by default.
- `PARSER_MAX_OUTPUT_BYTES`: 1 GiB by default.
- `PARSER_MAX_RECORDS`: 2,000,000 by default.
- `PARSER_TIMEOUT_SECONDS`: 180 seconds by default.
- `CHECKPOINT_INTERVAL_SECONDS`: 30 seconds by default. This value remains in
  the versioned profile for compatibility with older extractions.

The exporter publishes an extraction only after it closes and hashes all
files and the manifest. A failed partial extraction gets a `.failed-*` suffix.
It has no `manifest.json`, so the loader cannot import it.

The schema-version-3 manifest adds `win_probability.ndjson`. Each row contains
the extraction ID, a zero-based sample index, pause-safe game time, Radiant
probability from `0.0` through `1.0`, and the selected replay source. The
exporter prefers `CDOTASpectatorGraphManagerProxy` graph history and uses
`CDOTA_DataSpectator.m_fRadiantWinProbability` updates only when graph history
is not available. It does not calculate a prediction.

The graph stores integer percentages in 64 positions. The exporter divides
each value by 100. It calculates the graph duration from the graph start and
end fields, aligns the last graph position with the final match duration, and
removes negative pre-game positions. An all-zero graph is unused data. Current
spectator updates already use the normalized `0.0` through `1.0` scale.
