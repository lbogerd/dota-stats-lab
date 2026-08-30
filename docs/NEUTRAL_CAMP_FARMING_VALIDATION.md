# Neutral-camp farming version 1 validation

Validation was completed on 2026-08-30 with export format `2.2.0`, manifest
schema 3, and profile `match-analysis-v4`. Replay payloads and import logs stay
outside Git under `/home/xub/dota-stats-archives/ti2026`.

## Replay results

| Fixture | Match | Duration | Spawners | Valid camp creeps | Invalid handles | Resolved handles | Actions | Cleared | Not cleared |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Short | `8946228107` | 18:22 | 28 | 561 | 47 | 28 | 147 | 15 | 132 |
| Normal | `8955653541` | 38:29 | 28 | 1,131 | 130 | 28 | 396 | 51 | 345 |
| Large | `8946303764` | 55:28 | 28 | 1,804 | 217 | 28 | 639 | 108 | 531 |

Every retained non-invalid creep link resolved to exactly one spawner: 561 of
561, 1,131 of 1,131, and 1,804 of 1,804 creeps respectively. Each replay used
all 28 observed spawner handles. Invalid-handle counts came from the parser's
semantic completion counters; those units were deliberately excluded from the
staged camp-creep facts.

## Manual action audit

Twenty-one representative action rows were inspected against raw combat
events, roster heroes, 100 ms hero-position samples, camp coordinates, and
creep death updates. The sample used action indexes `0` through `6` from each
replay. Six additional cleared rows were checked at indexes `26` and `35`
(short), `41` and `54` (normal), and `19` and `28` (large).

For the 21-row sample:

- the action's player hero matched the combat-log attacker name;
- the first event was positive `DOTA_COMBATLOG_DAMAGE` against a team-4
  `npc_dota_neutral_*` target and was not illusion damage;
- the nearest player position was 0 or 33 ms from the event, within the 250 ms
  rule;
- the hero-to-spawner distance was between 313 and 849 world units, within the
  1,200-unit rule;
- each not-cleared row ended at its last assigned damage event. A creep could
  die at that instant without clearing the whole initial set, or all initial
  creeps could die later than the version-1 deadline; both correctly remained
  `not_cleared`.

Each of the six cleared checks had all initial creeps dead and one or more raw
health/life-state updates at the recorded end time.

No false match or missed direct-main-hero farming session was found in the
sample. Across the full corpus, the roster heroes produced 3,592, 18,985, and
12,986 eligible direct-damage candidates; 85, 1,087, and 400 respectively were
not assigned because one of the later position/camp/applicable-live-creep
rules did not match. Another 80, 314, and 0 non-illusion neutral damage events
came from non-roster attacker names, and 43, 4, and 257 were illusion damage.
Those exclusions are required v1 behavior, not recorded missed actions. This
audit does not reinterpret shared credit, pulls, or stacks.

## Performance safety

The normal benchmark ran one warm-up and three measured fresh-warehouse
ingestions for the short, normal, and large fixtures. Median results were:

| Fixture | Parser | Output rows | Output | DuckDB writes | Summary | Warehouse | Peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|
| Short | 5.34 s | 169,700 | 94.4 MiB | 1.30 s | 1.98 s | 24.3 MiB | 417.4 MiB |
| Normal | 9.63 s | 408,440 | 264.7 MiB | 1.95 s | 8.41 s | 42.8 MiB | 628.4 MiB |
| Large | 10.00 s | 544,475 | 319.7 MiB | 1.76 s | 14.38 s | 51.8 MiB | 716.4 MiB |

The largest result remained below the current 180-second parser, 1 GiB
output, 2,000,000-row, and 4 GiB memory limits. The complete report is recorded
in [BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md).

## Evidence-backed plan changes

The initial probe changes are documented in the plan and parser notes. Clarity's
source combat timestamp did not share the entity clock, so profile v4 records
the pause-safe `GameClock` in `gameTime` and preserves the source timestamp in
`rawTime`. A second replay showed `m_Type` can change during a match, so version
1 intentionally retains its initial creation-checkpoint value. No rule values
were changed during the three-replay validation.
