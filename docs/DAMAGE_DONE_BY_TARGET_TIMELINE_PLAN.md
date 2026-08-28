# Damage Done by Target Timeline Implementation Plan

## 1. Purpose

Add a damage-done timeline to each match page.

The user selects one roster hero. The graph shows the combat-log damage that this hero and its attributed units did in each 30-second interval. The graph groups damage by the target or target controller. A detail view shows the target unit or illusion, the attack, spell, or item, the selected hero's attacking unit when applicable, and the exact combat event.

This feature uses the combat-log data that is already in `raw.combat_events`. It complements the implemented `Damage taken by source` section and does not replace it.

## 2. Fixed decisions

- Use fixed 30-second intervals.
- Use an interval graph. Do not use a cumulative graph.
- Include damage to enemy, neutral, controlled, illusion, allied, self, creep, and building targets.
- Attribute outgoing damage to the selected hero through `damage_source_name`, with `attacker_name` as the fallback.
- Require `attacker_team` to match the selected roster player's team.
- Assign damage to a controlled target to its controller in `target_source_name`.
- Assign damage to a target illusion to its controller in `target_source_name`.
- Show the controlled target unit or target illusion as a `via` value.
- Include target illusions. Do not apply the damage-taken feature's target-illusion exclusion.
- Group targets by controller name and `target_team`. Group equal `via` names within that target group. Do not try to identify each physical unit instance.
- Preserve the selected dealer's controlled unit or illusion on the exact event as a `dealt by` value.
- Use `inflictor_name` for a spell or item. Use `Attack` when `inflictor_name` is empty.
- Use TanStack Charts for the graph.
- Call the value `combat-log damage`. Do not call it net health loss, hero damage, or post-mitigation health loss.
- Keep the implemented damage-taken endpoint, section, chart behavior, and tests working.

## 3. Scope

### 3.1 In scope

- One new section on the match page.
- One hero selector for the ten roster players.
- One stacked interval graph.
- A detail view for the selected interval.
- Exact event time, combat-log damage value, target, target `via` value, mechanism, and attacking unit when applicable.
- Loading, error, unavailable, and empty states.
- Server and web tests.
- A small shared chart or label-formatting extraction when it reduces duplication and preserves the current damage-taken API.

### 3.2 Out of scope

- Replay parser changes.
- Database schema changes.
- Individual creep, summon, clone, or illusion identity.
- Damage filters.
- A selectable interval size.
- A cumulative view.
- A new ability, building, or unit catalog.
- A change to the existing damage-taken attribution rules.
- Precomputed aggregates, caches, pagination, or a second detail endpoint.
- A comparison between two selected heroes.
- Combined damage-taken and damage-done charts.

Do not add an out-of-scope item unless tests or measured data show that it is necessary.

## 4. Data limits

The combat log does not give a universal entity handle for each damage event. Therefore, the feature cannot separate two units that have the same combat-log name.

The selected dealer lookup uses the roster hero name and team. A standard match has one copy of a hero on each team. A mode that permits duplicate heroes on one team can combine their outgoing damage.

Meepo clones have the same hero name and do not have a reliable separate identity in these records. Their outgoing damage can be combined with the selected Meepo.

`damage_source_name` attributes controlled units and attacker illusions to a controller. `attacker_name` identifies the physical unit that caused the event. If both fields are absent, the event cannot be attributed to the selected dealer and is not selected.

`target_source_name` usually equals `target_name` for a direct target. It can contain the controller for a summon, controlled unit, or target illusion. When both target fields are absent, keep the event under `Unknown target`.

Target groups use the target controller name and `target_team`. Two physical targets with the same controller, team, and `via` name are combined.

`value` is the damage value in the combat log. It is not always equal to the target's health change. This feature does not attempt to match the scoreboard's hero-damage statistic because it also includes creeps, neutrals, buildings, illusions, allied units, and self damage.

Outgoing damage can contain substantially more exact events than received hero damage. Measure response size and query time on real matches before adding an optimization.

## 5. Data rules

Use the latest successful extraction for the match.

Resolve the selected `playerSlot` through `analysis.match_players(matchId)`. Get its `hero_id` and `team_id`. Convert `hero_id` to the combat-log name, for example `npc_dota_hero_enchantress`.

Select records from `raw.combat_events` with these rules:

- `event_type = 'DOTA_COMBATLOG_DAMAGE'`.
- The extraction is the latest successful extraction.
- `analysis.is_actual_game(extraction_id, sequence)` is true.
- `coalesce(nullif(damage_source_name, ''), nullif(attacker_name, ''))` is the selected hero's combat-log name.
- `attacker_team` is the selected player's team.
- `game_time` and `value` are not null.
- Do not exclude `target_illusion` events.
- Do not filter by `target_team`, `damage_type`, or target class.

Keep pre-horn events when `analysis.is_actual_game` includes them. Use a signed game-time label for a negative time.

Use this interval formula:

```text
intervalStartSeconds = floor(game_time / 30) * 30
intervalEndSeconds = intervalStartSeconds + 30
```

Sort intervals by `intervalStartSeconds`. Sort exact events by `game_time`, then by numeric `sequence`.

For each event, use these target-attribution rules:

```text
target = target_source_name, else target_name, else "Unknown target"

if target_illusion is true:
    targetVia = target_name + " illusion"
else if target_name is present and target_name is not target:
    targetVia = target_name
else:
    targetVia = "Direct"

mechanism = inflictor_name, else "Attack"
```

Use these selected-dealer `dealt by` rules on each exact event:

```text
dealer = damage_source_name, else attacker_name

if attacker_illusion is true:
    dealerVia = attacker_name + " illusion"
else if attacker_name is present and attacker_name is not dealer:
    dealerVia = attacker_name
else:
    dealerVia = "Direct"
```

Example for a selected Enchantress:

```text
Lone Druid
  via Spirit Bear
    Impetus

Phantom Lancer
  via Phantom Lancer illusion
    Attack

Axe
  Direct
    Attack

Neutral Froglet
  Direct
    Attack
```

If a controlled Centaur Conqueror caused an exact event for the selected Enchantress, show `dealt by Centaur Conqueror` on that event. If a selected Phantom Lancer illusion caused an event, show `dealt by Phantom Lancer illusion`.

Preserve `attacker_name`, `attacker_illusion`, `attacker_team`, `target_team`, `damage_type`, `spell_generated_attack`, `raw_time`, and `sequence` in each exact event or its derived dealer-attribution object. These fields are useful in the detail view and in tests. Do not add a filter for them in this version.

## 6. Shared metadata and formatting

Reuse `src/lib/dota-heroes.ts` for hero display data and combat-log unit names. Do not copy the hero map and do not change the current hero image behavior in `src/web/dota-assets.ts`.

The current damage-taken server has a small formatter for raw Dota names. Move that formatter to a small shared module only if both server features use it. Preserve the current labels and tests when it moves.

Return a clear unavailable result when the selected roster row has no known hero ID or combat-log name.

Do not change the generated item catalog and do not build a complete unit, building, item, or ability catalog.

## 7. Server model and query

Add `src/server/damage-done-by-target.ts`.

Validate this input with Zod:

```ts
{
  matchId: string;
  playerSlot: number;
}
```

Use the existing match ID validator. Require an integer player slot in the valid replay slot range. Also confirm that the slot exists in the selected match.

Use a response with this shape. Names can change during implementation, but the meaning must not change.

```ts
interface MatchHeroDamageDoneTimeline {
  matchId: string;
  playerSlot: number;
  intervalSeconds: 30;
  available: boolean;
  dealer: {
    heroId: number | null;
    heroName: string;
    playerName: string | null;
    teamId: number;
  } | null;
  totalDamage: number;
  intervals: DamageDoneInterval[];
}

interface DamageDoneInterval {
  startSeconds: number;
  endSeconds: number;
  totalDamage: number;
  targets: DamageTarget[];
}

interface DamageTarget {
  rawName: string;
  label: string;
  teamId: number | null;
  damage: number;
  via: DamageTargetVia[];
}

interface DamageTargetVia {
  rawName: string | null;
  label: string;
  kind: "direct" | "unit" | "illusion";
  damage: number;
  mechanisms: DamageDoneMechanism[];
}

interface DamageDoneMechanism {
  rawName: string | null;
  label: string;
  damage: number;
  events: DamageDoneEvent[];
}

interface DamageDoneEvent {
  sequence: string;
  gameTimeSeconds: number;
  rawTimeSeconds: number | null;
  damage: number;
  attackerTeam: number | null;
  targetTeam: number | null;
  damageType: number | null;
  spellGeneratedAttack: boolean;
  dealerVia: {
    rawName: string | null;
    label: string;
    kind: "direct" | "unit" | "illusion";
  };
}
```

Use strings for `sequence` because DuckDB can return a value outside the JavaScript safe integer range.

Group rows in TypeScript. Keep the SQL query direct and easy to inspect. Do not add a macro or materialized table in this version.

Group a target by its attributed raw name and `target_team`. Group `via` values by kind and raw name. This prevents an allied and enemy copy of the same target from merging when their team IDs differ.

The response can contain all exact events for one selected hero. Measure serialized response bytes and server duration on representative matches. Do not add lazy detail loading until measured data requires it.

Set `available` to true when the extraction has the game-state markers that `analysis.is_actual_game` needs. An available result can have zero damage events. Set `available` to false when the extraction cannot support the query or the selected roster hero has no combat-log name.

Use the shared small label formatter for raw Dota names. Use shared hero metadata when it has a better hero label. Keep `rawName` in the response.

## 8. Server function and query option

Update `src/web/functions.tsx` with one GET server function for the new query.

Update `src/web/overview-data.ts` with:

- A query key that contains `matchId` and `playerSlot` and is distinct from the damage-taken key.
- A query option that calls the new server function.
- The exported response type.

Do not load this data in the route loader. Load it when the section renders. This rule matches the other analysis sections and keeps the match overview request small.

## 9. Web section

Add `src/web/damage-done-by-target-section.tsx`.

Place the section immediately after `DamageBySourceSection` and before `HeroHeatmapSection` in `src/routes/matches.$matchId.tsx`.

The section must contain:

- The title `Damage done by target`.
- A short statement that values are combat-log damage in 30-second intervals.
- One hero selector.
- The stacked graph.
- The selected interval detail view.

Select the first roster player by default. Keep the selection in local component state. Use the player name, hero name, and team in each option label.

Show these states:

- Loading: the query is in progress.
- Error: show the message and a retry button.
- Unavailable: explain that the extraction has no usable combat-log timeline or the selected hero cannot be resolved.
- Empty: explain that the selected hero has no recorded combat-log damage done.
- Success: show the graph and interval detail.

Do not add filter controls or an interval selector.

## 10. TanStack Charts graph

Add a damage-done chart wrapper or section-specific chart such as `src/web/damage-done-by-target-chart.tsx`.

Extract a small domain-neutral stacked interval chart from `src/web/damage-by-source-chart.tsx` when this avoids copying its complete chart implementation. Keep `DamageBySourceChart` as a compatible wrapper so the implemented section and tests do not change behavior. Keep domain-specific accessible names, descriptions, focused summaries, and legend labels in each wrapper.

Use `barY` and `stack()` from TanStack Charts. Use a linear game-time X axis. Cap each bar to the width of one 30-second interval so quiet time gaps remain visible. Use combat-log damage on the Y axis.

Use the seven largest target groups by whole-match damage as separate color series. Put all remaining target groups in an `Other` graph series. The target group identity includes `target_team`, even when two groups have the same display name. Add a concise team qualifier when two visible target labels would otherwise be identical.

The selected interval detail must still show every target by name. Order the target series by whole-match damage. Use a stable color for each target during the current hero selection.

The graph must support pointer and keyboard inspection. Use the TanStack Charts focus-group callback to select an interval. Use the last interval with damage as the initial selection.

Show this information for a focused interval:

- The signed interval time range.
- Total combat-log damage.
- The damage for each visible graph series.

Use a time formatter that supports negative game time and milliseconds. Do not reuse a formatter that clamps negative values to zero.

Give the chart an accessible name and description. State that the left and right arrow keys inspect intervals. Keep the current focus-ring style.

## 11. Interval detail view

Show the complete target hierarchy for the selected interval:

```text
target or target controller -> target via -> mechanism -> exact events
```

Sort targets, target `via` groups, and mechanisms by combat-log damage from large to small. Use the raw target name and team as stable tie-breakers. Sort exact events by game time and use numeric `sequence` as the final tie-breaker.

For each exact event, show:

- Signed game time with millisecond precision.
- Combat-log damage value.
- `Attack`, spell name, or item name through the mechanism parent.
- `dealt by <unit>` when a controlled unit caused the event.
- `dealt by <hero> illusion` when an attacker illusion caused the event.

Do not repeat `dealt by` for direct selected-hero events. The parent labels make the target, target `via`, and mechanism clear. Do not repeat all parent labels on each event row.

Use semantic HTML. A list or table is sufficient. Do not add a second chart for the detail view.

## 12. Tests

### 12.1 Server tests

Add `tests/damage-done-by-target-server.test.ts` with a temporary DuckDB warehouse.

Test these cases:

- The input schema rejects an invalid match ID, slot, and extra field.
- The query uses only the latest successful extraction.
- The query excludes records outside the actual game.
- The query selects the dealer hero name and team for the roster slot.
- A direct hero attack is attributed to the selected dealer.
- A controlled attacker's damage is attributed to the selected dealer and preserves its `dealt by` unit.
- A same-name attacker illusion is attributed to the selected dealer and preserves its illusion `dealt by` value.
- Damage from the same hero name on another team is excluded.
- A controlled target is grouped under `target_source_name` with the physical target in its `via` group.
- A target illusion remains included and appears in an illusion `via` group.
- An uncontrolled neutral target remains its own direct target.
- A building target remains in the result.
- A null or empty target becomes `Unknown target`.
- A null inflictor becomes `Attack`.
- A named inflictor remains a separate mechanism.
- Events in one interval use correct damage totals and numeric sequence order.
- Enemy, neutral, allied, self, creep, illusion, and building targets remain in the result.
- Targets with the same raw name on different teams remain separate.
- A valid timeline with no matching damage is available and empty.
- Missing game-state markers make the result unavailable.
- An unknown roster hero returns a clear unavailable result.
- A missing roster slot returns a clear validation or not-found error.

### 12.2 Web tests

Add `src/web/damage-done-by-target-section.test.tsx`.

Test these cases:

- The first roster player is the default selection.
- A hero change uses a new query key and result.
- Loading, error, retry, unavailable, and empty states are clear.
- The success state shows the graph and complete target hierarchy.
- A selected interval shows exact event time and combat-log damage.
- A controlled attacker and an attacker illusion show the correct `dealt by` label.
- A direct selected-hero event does not show a redundant `dealt by` label.

Add or update chart tests for these cases:

- TanStack Charts renders a stacked bar graph for target series.
- The graph is keyboard focusable.
- Arrow keys change the selected interval.
- Pointer focus changes the selected interval.
- Negative and positive game times have correct labels.
- The graph shows seven target series and `Other` when more target groups exist.
- Same-name targets on different teams remain distinct series.
- Quiet time gaps remain visible.
- The accessible description includes the time range and keyboard instruction.
- Existing damage-taken chart tests continue to pass after any shared-chart extraction.

Update an existing match route or browser test only when the new section requires it.

## 13. Verification

Run these commands after implementation:

```text
pnpm check
pnpm build
pnpm test
pnpm test:web
```

Then open imported matches that contain these events for one or more selected heroes:

- Direct hero damage to another hero.
- Damage to a lane creep or neutral creep.
- Damage to a building.
- Damage to a controlled target.
- Damage to a target illusion.
- Damage caused by a controlled attacker.
- Damage caused by an attacker illusion.
- Self or allied damage, if available.

Confirm these results:

- The interval totals equal the visible target totals.
- The detail totals equal the interval total.
- A controlled target receives target credit under its controller.
- The controlled target unit appears in the target `via` label.
- A target illusion appears in an illusion target `via` label.
- A selected hero receives dealer credit for its controlled unit and attacker illusion.
- The physical attacking unit appears only as the exact event's `dealt by` value.
- Equal target unit names use one `via` group within the same target and team.
- Same-name targets on different teams remain separate.
- Exact events keep game-time and numeric sequence order.
- Quiet time gaps remain visible on the X axis.
- The graph works with a pointer and a keyboard.
- The existing damage-taken section still works with a pointer and a keyboard.

Measure and record these values for at least one normal and one event-heavy match:

- Server query duration.
- Serialized response bytes.
- Exact event count.
- Browser render time when practical.

Do not add pagination, caching, precomputation, or lazy detail loading unless these measurements show a concrete problem.

## 14. Implementation order

1. Add server fixtures that establish the outgoing-dealer and target-controller rules.
2. Extract the small shared Dota-name formatter if both server modules need it.
3. Add the server input, direct SQL query, TypeScript grouping code, and server tests.
4. Add the GET server function and React Query option.
5. Extract or extend the shared stacked interval chart while preserving the damage-taken wrapper and tests.
6. Add the damage-done target chart wrapper and chart tests.
7. Add the section, target detail view, and section tests.
8. Add the section to the match route after the damage-taken section.
9. Run all verification commands, inspect real matches, and record response measurements.

Stop after this scope is complete. Record any measured problem before work starts on an optimization or a new filter.
