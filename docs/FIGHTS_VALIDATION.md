# Fights version 1 validation

The death-anchored fights field audit was run on 2026-09-01. It opened
DuckDB with `access_mode=READ_ONLY`, one thread, external access disabled, and
the five-match default in `scripts/audit-fights.mjs`. The script emits match
IDs, counts, availability states, and extraction-format metadata. It does not
emit player names, hero names, account IDs, or extraction IDs.

## Five newest stored matches

The available local warehouse snapshot contains 147 successful matches. The
audit selected the newest five with the same successful-match order used by
the matches page: match start time descending, then match ID descending.

| Match | Start (UTC) | Duration | Hero deaths | Assist credits | Enemy hero-damage rows | Position rows |
|---|---|---:|---:|---:|---:|---:|
| `8960991322` | 2026-08-23 12:08:38 | 64:22 | 66 | 222 | 17,071 | 358,548 |
| `8960882635` | 2026-08-23 10:49:41 | 44:18 | 45 | 140 | 6,144 | 247,782 |
| `8960762254` | 2026-08-23 09:14:12 | 45:56 | 52 | 154 | 6,959 | 252,899 |
| `8960655084` | 2026-08-23 07:36:03 | 64:29 | 96 | 321 | 17,118 | 341,750 |
| `8960577698` | 2026-08-23 06:15:57 | 46:15 | 59 | 167 | 7,846 | 255,586 |

These selected rows use export format `2.0.0`, manifest schema 2, and profile
`match-analysis-v2`. All 1,456,565 position rows use exact 100 ms boundaries.

Across the five matches:

- all 318 team-2/team-3 hero deaths were non-illusion deaths with finite game
  time and a populated victim field;
- all 318 had both attacker and credited-damage-source fields. Seven credited
  sources differed from the attacker, which confirms that the credited source
  must be tried first;
- all 1,004 assist game-player IDs mapped to exactly one of the 50 metadata
  roster IDs. No ambiguous or unmapped assist credit was observed;
- none of the 318 hero deaths had finite combat-event coordinates;
- 266,498 damage rows included 108,916 hero-target rows and 55,138 positive,
  finite-time, cross-team hero-target rows. Of the hero-target rows, 1,738 had
  a hero-shaped credited source distinct from the attacking unit, confirming
  the need for controlled-unit attribution;
- 23,773 damage rows had an attacker- or target-illusion flag and must remain
  eligible for the version-one exclusions;
- 48,543 heal rows included 39,989 hero-target rows. All 39,989 had a
  hero-shaped credited source, while 46 heal sources differed from the
  attacker;
- all 30,125 `DOTA_COMBATLOG_XP` rows had a finite time and value and used the
  target field for a hero-shaped identity. They had no attacker or credited
  damage source, so experience attribution must use the target-to-roster map;
- objective-shaped deaths included 73 towers, 21 barracks, and 23 Roshan
  deaths. No Tormentor death was present in this five-match sample; absence is
  not evidence that the field is unsupported.

The audit counts only rows inside the first in-progress game-state interval.
It does not treat the presence of a name-shaped field as proof of an
unambiguous roster match; the server still rejects ambiguous mappings.

## Supplementary current-format check

A supplementary read-only run used three available export-format `2.2.0`,
manifest-schema-3, `match-analysis-v4` extractions:

| Match | Duration | Hero deaths | Position rows | Exact 100 ms boundaries |
|---|---:|---:|---:|---|
| `8955653541` | 38:28 | 51 | 208,166 | yes |
| `8946303764` | 55:27 | 51 | 312,089 | yes |
| `8946228107` | 18:22 | 27 | 103,542 | yes |

All 623,797 stored position rows were on exact 100 ms boundaries. None of the
129 hero deaths had event coordinates, so the nearest victim position before
death is the normal location source for current extractions, not merely a
legacy fallback. A combat-only extraction without this stream must return an
unavailable location and map rather than inventing coordinates.

Of 12,297 current-format XP rows, all used a hero-shaped target identity and
12,296 also had a finite time and value. The one incomplete row must be
excluded. This supports per-player experience only after an exact, unique
target-to-roster match; otherwise the value remains unavailable.

## Rule decision

No fixed detector threshold changed. The observed data supports the planned
source order and missing-location rule:

1. use finite event coordinates when present;
2. otherwise use the victim's nearest preceding 100 ms position sample;
3. otherwise keep the death without a location and require a shared active
   participant when linking it.

The audit also supports retaining the credited-source-first kill rule, the
metadata game-player-ID assist map, illusion exclusions, and controlled-unit
damage attribution.

## Reproducing the audit

Run against a warehouse copy or while no writer owns the warehouse:

```sh
WAREHOUSE_PATH=/absolute/path/dota.duckdb pnpm audit:fights
```

`FIGHTS_AUDIT_MATCH_COUNT` changes the count for an exploratory run; release
validation uses the default of five. If fewer successful matches exist, the
script reports the smaller observed selection without fabricating rows. It
also reports position-schema absence separately from an extraction with zero
position rows.

## Performance measurement

`scripts/measure-fights.mjs` times cold and warm list and detail server reads,
records JSON response sizes, validates strict 100 ms detail-frame order, and
fails if a list response contains position frames. It selects the middle
engagement unless `BENCHMARK_FIGHT_ID` is set. Optional browser timings are
recorded only when `BENCHMARK_FIGHTS_BASE_URL` is supplied; the script does not
substitute a server timing for a browser-render result.

Run it once each for the selected short, normal, and large matches after the
CLI build:

```sh
pnpm build:cli
WAREHOUSE_PATH=/absolute/path/dota.duckdb \
BENCHMARK_MATCH_ID=MATCH_ID pnpm measure:fights
```

For a host build, set `BENCHMARK_FIGHTS_MODULE` to the absolute path of
`dist/src/server/fights.js`. Add
`BENCHMARK_FIGHTS_BASE_URL=http://127.0.0.1:3400` only when a healthy local web
service and Playwright browser are available.

The three current-format matches above were measured after `pnpm build:cli`
with one cold and three warm server reads. These times include the read-only
DuckDB work, detector, metric derivation, and response construction:

| Fixture | List cold | List warm median | List JSON | Detail cold | Detail warm median | Detail JSON | Frames | Browser render |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Short (`8946228107`) | 295.14 ms | 249.70 ms | 26,997 B | 241.17 ms | 241.52 ms | 43,740 B | 147 | not measured |
| Normal (`8955653541`) | 831.39 ms | 761.12 ms | 39,948 B | 787.73 ms | 764.17 ms | 210,621 B | 355 | not measured |
| Large (`8946303764`) | 877.64 ms | 780.72 ms | 47,062 B | 792.20 ms | 764.47 ms | 12,629 B | 36 | not measured |

The chosen detail is the middle chronological engagement in each list, so its
payload size depends on that interval rather than full-match duration. All
three list responses passed the no-position-frame assertion. Detail frames
were fetched only by the detail call and passed the exact-100 ms ordering
check. Browser render is explicitly unmeasured because no application server
was started for this read-only audit; run the optional browser mode in the
target deployment environment instead of treating server time as render time.
