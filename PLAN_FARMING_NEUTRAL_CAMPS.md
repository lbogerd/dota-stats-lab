# Plan: Neutral Camp Farming Action

## 1. Purpose

Implement the first derived player action.

The action name is `neutral_camp_farming`.

The first version must answer these questions:

- Which player farmed a neutral camp?
- Which camp did the player farm?
- When did the action start?
- When did the action end?
- Did the camp become clear during the action?

Keep this version small.

Do not make a general action framework now.

Create a typed table for this action only.

Review the table design after a second action type exists.

## 2. Confirmed Replay Facts

Use these facts as requirements:

- A camp creep has the class `CDOTA_BaseNPC_Creep_Neutral`.
- A camp creep has the field `m_hNeutralSpawner`.
- A valid field value resolves to a `CDOTA_NeutralSpawner` entity.
- The value `16777215` is an invalid entity handle.
- Some neutral-class units have the invalid handle.
- A spawner entity has a world position.
- A spawner entity has the integer field `m_Type`.
- A spawner handle is stable during one replay.
- A spawner handle is not stable between replays.

Do not use the neutral-creep class as the only camp-membership test.

Do not use a spawner handle as a permanent map camp identifier.

## 3. Version 1 Terms

Use one term for each item.

### Camp spawner

A camp spawner is a `CDOTA_NeutralSpawner` entity.

### Camp creep

A camp creep meets all these conditions:

- Its class is `CDOTA_BaseNPC_Creep_Neutral`.
- Its `m_hNeutralSpawner` value is not `16777215`.
- Its handle resolves to a camp spawner in the same extraction.

### Creep death

A creep death is the first applicable state change:

- `m_lifeState` changes from the alive value.
- `m_iHealth` changes to zero.

Do not treat an entity deletion as proof of death.

### Direct hero damage

A direct hero damage event meets all these conditions:

- Its event type is `DOTA_COMBATLOG_DAMAGE`.
- Its damage value is more than zero.
- Its target team is team `4`.
- Its target name starts with `npc_dota_neutral_`.
- Its attacker is a roster hero.
- Its attacker is not an illusion.

Version 1 includes attacks and spells from the main hero.

Version 1 does not include damage from a controlled unit.

### Farming action

A farming action is one player's damage session at one camp.

The action starts at the first assigned damage event.

The action can have the result `cleared` or `not_cleared`.

## 4. Version 1 Rules

Put all rule values in one named configuration object.

Use `neutral-camp-farming-v1` as the definition name.

Use these initial values:

| Rule | Value | Purpose |
|---|---:|---|
| Position time tolerance | 250 ms | Match a damage event to a hero position sample. |
| Camp radius | 1,200 world units | Match a hero position to a camp spawner. |
| Damage gap | 8,000 ms | Separate two actions at the same camp. |

The camp radius is a custom analysis radius.

It is not the in-game spawn box.

Apply these rules in this order:

1. Map the attacker name to exactly one roster player.
2. Find the nearest hero position sample within 250 ms.
3. Select the earlier sample when two samples are equally near.
4. Find the nearest applicable camp spawner within 1,200 world units.
5. An applicable camp spawner has one or more live camp creeps.
6. Assign the damage event to that player and camp.
7. Sort assigned events by game time and source sequence.
8. Group events independently for each player and camp.
9. Start a new action after a damage gap of more than 8,000 ms.

Use the current `getHeroCombatLogName` mapping for the attacker name.

Convert the normalized combat-log game-time seconds to milliseconds with
round-to-nearest arithmetic.

For `match-analysis-v4`, write the pause-safe entity `GameClock` value to the
combat event `gameTime` field at the combat callback. Keep Clarity's source
combat timestamp in `rawTime`. This clock normalization is required before a
combat event can be matched to a hero position sample.

Use the camp-creep set that is alive at the action start.

A creep is alive when it exists and has no earlier death time.

An applicable live creep must also have team number `4`.

Do not add later creep spawns to this set.

Set the result to `cleared` when all creeps in this set die.

Require the last death to occur no more than 8,000 ms after the last damage event.

Use the last creep death as the end time for a cleared action.

Set the result to `not_cleared` for all other actions.

Use the last assigned damage event as the end time for a not-cleared action.

Keep an action that has only one damage event.

This row records a short or failed farming attempt.

Permit actions from different players to overlap.

Do not assign sole credit for a camp clear.

The `cleared` result means that the camp became clear during the action.

## 5. Data Capture

Use the existing entity staging files.

Do not add a new manifest schema for this work.

### 5.1 Data check

Use one archived replay before you change the storage schema.

Confirm these fields in actual entity updates:

- `m_lifeState`
- `m_iHealth`
- `m_iTeamNum`
- `m_hNeutralSpawner`
- `m_Type`
- The spawner position fields

Confirm that the normalized combat-event `gameTime` agrees with the entity
clock. Confirm that the unchanged source combat timestamp remains in
`rawTime`.

Confirm that direct camp damage uses the required neutral target names.

Record the exact field paths and values in the parser test notes.

Stop this plan if a required field is not reliable.

Update the action rules before you continue.

#### Replay evidence amendment (2026-08-30)

The initial data check used archived TI 2026 match `8943142948`. It disproved
the original assumption that Clarity's source combat timestamp directly agrees
with the entity clock. The first inspected neutral damage had source timestamp
`1012.10004` while the entity clock was `63.066691`, a `949.033` second
pregame/network-clock offset. A later event showed the same offset. The entity
clock also excludes paused ticks, so subtracting one fixed offset in the loader
would not be reliable. The version 1 correction above records the parser's
pause-safe `GameClock` value as combat `gameTime` and preserves the source
timestamp as `rawTime`.

All other required assumptions passed on that replay: 28 camp spawners were
observed; 995 neutral-class creep creations contained 906 valid and 89 invalid
(`16777215`) spawner handles; all 28 distinct valid linked handles resolved to
observed spawners. Exact creation paths included
`CBodyComponent.m_cellX`, `CBodyComponent.m_cellY`,
`CBodyComponent.m_vecX`, `CBodyComponent.m_vecY`, `m_Type`, `m_iHealth`,
`m_lifeState`, `m_iTeamNum`, `m_bIsSummoned`, and
`m_hNeutralSpawner`. Positive team-4 damage used
`npc_dota_neutral_*` targets and roster-hero attacker names. A sampled death
changed `m_iHealth` from `4` to `0` and `m_lifeState` from `0` to `1` at
entity game time `123.2000289`; deletion followed later, independently, at
`129.266696`.

All 28 spawners were created before the entity `GameClock` initialized, so
their retained creation `gameTime` is `null`. Version 1 treats that null as
pre-game existence during derivation; it does not substitute Clarity's
unrelated source timestamp.

A second archived replay check, match `8943098449`, found eight `m_Type`
updates (six at about 900 seconds and two at about 1,800 seconds), disproving
an invariant interpretation. Version 1 therefore defines `camp_type` as the
initial creation-checkpoint value. This preserves the planned creation-only
spawner capture and leaves time-varying type interpretation for evidence-backed
future work.

### 5.2 Parser entity handlers

Add explicit Clarity handlers for these classes:

- `CDOTA_NeutralSpawner`
- `CDOTA_BaseNPC_Creep_Neutral`

Create one parser component named `NeutralCampTimeline`.

Keep all neutral-camp field handling in this component.

For each camp spawner, retain these fields:

- Entity instance identifier
- Entity handle
- `m_Type`
- World X position
- World Y position
- Creation game time
- Deletion game time, if present

Use the same world-coordinate conversion as the hero position sampler.

Use the first complete spawner position.

Store the initial raw `m_Type` value from the creation checkpoint.

Replay evidence shows that `m_Type` can change during a match. Version 1 uses
the initial value deliberately; it does not treat the value as invariant and
does not capture later `m_Type` changes.

Do not add a type label until replay evidence confirms the value mapping.

For each neutral creep, retain these fields:

- Entity instance identifier
- Entity handle
- `m_hNeutralSpawner`
- `m_lifeState`
- `m_iHealth`
- `m_iTeamNum`
- `m_bIsSummoned`
- Creation game time
- First known death game time
- Deletion game time, if present

Write entity identity rows to `entity_instances.ndjson`.

Write creation and deletion rows to `entity_events.ndjson`.

Write the selected initial properties to a creation checkpoint.

Write only selected health and life-state changes to `property_updates.ndjson`.

Do not write all neutral-creep property changes.

### 5.3 Parser contract

Keep manifest schema version 3.

Change the profile name to `match-analysis-v4`.

Increase `exportFormatVersion` to `2.2.0`.

Add the two entity class patterns to the exported profile configuration.

Do not change the Clarity revision unless Clarity needs a fix.

## 6. Typed Storage and Derivation

### 6.1 Database migration

Add `src/db/migrations/014_neutral_camp_farming.sql`.

Create this table:

```sql
analysis.neutral_camp_farming_actions
```

Use typed columns only.

Do not store action data in a JSON column.

Store these columns:

| Column | Meaning |
|---|---|
| `extraction_id` | The source extraction. |
| `action_index` | The ordered action number in the extraction. |
| `definition_name` | The value `neutral-camp-farming-v1`. |
| `player_slot` | The roster player slot. |
| `camp_id` | A replay-local camp number. |
| `spawner_handle` | The raw replay handle. |
| `camp_type` | The initial raw `m_Type` value. |
| `camp_world_x` | The spawner X position. |
| `camp_world_y` | The spawner Y position. |
| `start_game_time_ms` | The first assigned damage time. |
| `end_game_time_ms` | The rule-selected end time. |
| `result` | `cleared` or `not_cleared`. |
| `damage_event_count` | The number of assigned damage events. |
| `total_damage` | The sum of positive damage values. |
| `initial_creep_count` | The number of live creeps at the start. |
| `dead_initial_creep_count` | The number of these creeps that died. |

Use `(extraction_id, action_index)` as the primary key.

Add an index for extraction, player, and start time.

Assign `camp_id` after you sort spawners by world Y, world X, and handle.

Assign `action_index` after you sort by start time, player slot, camp ID, and first damage sequence.

Treat `camp_id` as local to one extraction.

Do not add a cross-match camp identifier in version 1.

### 6.2 Derivation code

Add `src/load/neutral-camp-farming.ts`.

Implement the action rules as a pure TypeScript function.

Give sorted facts to the function.

Return complete typed action rows from the function.

Keep DuckDB queries simple.

Use DuckDB to read these inputs:

- Roster players
- Combat damage events
- Hero position samples
- Camp spawner facts
- Camp creep facts

Build the camp facts from the existing raw entity tables.

Do not add a permanent camp-creep table in version 1.

Use TypeScript to match events and build actions.

Do not implement the action state machine as one large SQL statement.

Run the derivation after hero position import.

Insert all action rows in the current ingestion transaction.

Reject an invalid typed row before the insert.

Do not create action rows for an old extraction.

The old extraction must show that this action is unavailable.

## 7. Read API and User Interface

Add one DuckDB macro:

```sql
analysis.match_neutral_camp_farming_actions(requested_match_id)
```

The macro must use `analysis.latest_successful_extractions`.

Order rows by start time and action index.

Add `src/server/neutral-camp-farming.ts`.

Return an explicit `available` value.

Set `available` to true only for profile `match-analysis-v4`.

Validate all database values before you return them.

Add one server function and one query option.

Add a small section to the match page.

Show these values in a table:

- Player
- Start time
- End time
- Duration
- Camp number
- Camp type value
- Result
- Damage
- Creep count

Show an unavailable message for an old extraction.

Show an empty message when the extraction has no farming actions.

Do not add a chart or map in version 1.

## 8. Tests

### 8.1 Parser tests

Add unit tests for these cases:

- A valid spawner handle
- The invalid handle `16777215`
- A spawner creation checkpoint
- A camp-creep creation checkpoint
- A health change to zero
- A life-state change from alive
- An entity deletion without a known death
- World-coordinate conversion

Verify that unrelated entity properties do not enter the output.

### 8.2 Derivation tests

Use small in-memory facts.

Test these cases:

- One player clears one camp.
- One player leaves a camp alive.
- One damage event creates one not-cleared action.
- A gap of exactly 8,000 ms keeps one action.
- A larger gap creates two actions.
- An invalid spawner handle creates no camp creep.
- A missing hero position creates no action.
- A distant hero creates no action.
- The nearest applicable camp receives the damage event.
- A controlled unit creates no version 1 action.
- Two players can have overlapping actions.
- A deletion without a death does not clear a camp.
- A later creep spawn does not join an open action.

### 8.3 Loader and database tests

Test these cases:

- The loader stores neutral entity facts.
- The loader inserts the expected action rows.
- A failed derivation rolls back the full ingestion.
- A repeated ingestion does not add duplicate rows.
- The match macro selects the latest successful extraction.
- An old extraction reports unavailable data.

### 8.4 Server and interface tests

Test ready, empty, unavailable, loading, and error states.

Test the table on a phone width.

Test keyboard access and visible focus.

Do not add a browser test for a chart.

## 9. Real Replay Validation

Use three archived replays outside Git.

Use one short match, one normal match, and one large match.

For each replay, record these counts:

- Camp spawners
- Valid camp creeps
- Invalid-handle neutral creeps
- Resolved spawner handles
- Derived farming actions
- Cleared actions
- Not-cleared actions

Require every non-invalid spawner handle to resolve.

Inspect at least 20 action rows by hand.

Compare each row with replay damage events and hero positions.

Record known false matches and missed actions.

Change a rule value only when the replay evidence supports the change.

Do not add a confidence score in version 1.

Run the normal benchmark after the rules pass validation.

Measure parser time, output rows, output bytes, load time, and warehouse size.

Optimize only if a current safety limit or benchmark target fails.

## 10. Release Steps

Complete these steps in order:

1. Complete the data check with one archived replay.
2. Add the parser capture and parser tests.
3. Add migration 014.
4. Add the pure derivation function and its tests.
5. Add loader validation and transaction tests.
6. Add the read macro and server function.
7. Add the match-page table.
8. Validate three real replays.
9. Run `pnpm release:check`.
10. Build the parser image and run its tests.
11. Run the required browser tests.
12. Update the README extraction table and test description.
13. Re-extract selected cached replays with export format `2.2.0`.

## 11. Acceptance Conditions

The work is complete when all these statements are true:

- The parser stores only the required neutral-camp entity facts.
- Every stored camp creep has a valid spawner relationship.
- The derivation follows `neutral-camp-farming-v1` exactly.
- Each action has one player, one camp, one start time, and one end time.
- Each action has a deterministic result.
- The user can inspect the action rows on the match page.
- Old extractions show an unavailable state.
- All automated checks pass.
- Three real replays pass the validation checks.
- The benchmark stays inside the current safety limits.

## 12. Deferred Work

Do not include these items in version 1:

- Damage from summons or controlled units
- Shared action ownership
- Pull and stack labels
- Lane creep farming
- Roshan or Tormentor actions
- A confidence score
- A general action table
- A camp map
- Custom camp-zone shapes
- A cross-match camp identifier
- Automatic rule tuning

Use real version 1 results to select the next item.
