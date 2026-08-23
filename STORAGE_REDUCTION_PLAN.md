# DuckDB Storage Reduction: Implementation Plan

## 1. Objective

Reduce the permanent DuckDB storage for one parsed match.

Keep the Java Clarity parser unchanged. Let the parser export its current complete data set. Make the TypeScript loader decide which data enters DuckDB.

Keep data that supports player and match analysis. Do not store voice data, presentation data, interval checkpoints, or duplicate entity update events in DuckDB.

## 2. Main Decisions

- Reset the complete development warehouse before the new schema is used.
- Keep the Java parser unchanged.
- Keep the parser configuration and manifest format unchanged.
- Keep exporter version `0.1.3`.
- Apply all storage filters in the TypeScript loader.
- Use exact message names and exact entity class names.
- Store every property update for each retained entity.
- Store entity creation and deletion events only.
- Store entity creation and completion checkpoints only.
- Import BLOB data only when its owner row is stored.
- Do not add automatic old-extraction delete logic.
- Do not change indexes in this work.
- Measure index storage after all other changes.

## 3. Scope

Change these parts of the project:

- The TypeScript loader.
- The DuckDB raw schema.
- Loader and analysis tests.
- Storage and data-boundary documentation.

Do not change these parts:

- Java parser source files.
- Java parser tests.
- Parser environment settings.
- Parser manifest structure.
- Parser output files.
- Parser output limits.

The parser will continue to create large temporary NDJSON files. The loader will delete the staged extraction after a successful load, as it does now.

## 4. Development Reset

Reset the complete development warehouse before other implementation work.

Use this sequence:

1. Stop services that use the warehouse.
2. Delete the development warehouse volume.
3. Create a new empty warehouse volume.
4. Clear staged extraction and ingestion-job files.
5. Keep the replay volume.
6. Keep the saved-query volume.
7. Make the code and schema changes.
8. Start the services.
9. Parse and load one known match.

This reset removes all old parser versions and all current DuckDB data.

Do not add per-match delete logic. Do not add an extraction-history setting. Do not add an automatic database reset.

Keep the current exact-extraction check. The loader can return `already_loaded` when the exact extraction is present.

For this development phase, reset the complete warehouse before a parser output format changes. Do not keep different parser-output versions in one warehouse.

Do not put the reset in application startup code. Do not add a reset control to the web interface.

## 5. Loader Storage Policy

Create one small TypeScript module for the storage policy. For example:

```text
src/load/storage-policy.ts
```

The module must export pure decisions for:

- Stored message types.
- Stored entity classes.
- Stored entity event types.
- Stored checkpoint kinds.

Use constant sets. Do not use regular expressions. Do not add configuration or a user interface.

The loader must apply the same policy during import and validation.

## 6. Message Filter

Reject these exact protobuf record types during the `raw.records` import:

```text
CSVCMsg_VoiceData
CSVCMsg_VoiceInit
CUserMessageVoiceMask
CUserMessageSendAudio
CUserMsg_ParticleManager
CMsgSosStartSoundEvent
CMsgSosSetSoundEventParams
CMsgSosStopSoundEvent
CMsgSosStopSoundEventHash
CDOTAUserMsg_TE_UnitAnimation
CDOTAUserMsg_TE_UnitAnimationEnd
CDOTAUserMsg_TE_DotaBloodImpact
CDOTAUserMsg_TE_Projectile
CDOTAUserMsg_TE_ProjectileLoc
CMsgTEEffectDispatch
CDOTAUserMsg_KillEffect
CSVCMsg_HLTVStatus
CSVCMsg_PacketEntities
```

`CSVCMsg_PacketEntities` contains a raw copy of packet entity data. The entity files contain the decoded data.

Keep these important examples:

```text
CMsgDOTACombatLogEntry
CDOTAUserMsg_SpectatorPlayerUnitOrders
CDOTAUserMsg_OverheadEvent
CDOTAUserMsg_UnitEvent
CDOTAUserMsg_FoundNeutralItem
CDOTAUserMsg_CourierKilledAlert
CMsgDOTAMatch
CDOTAMatchMetadataFile
```

Do not reject a message only because its name contains `Spectator` or `Observer`.

## 7. Entity Filter

Reject these exact entity classes during the `raw.entity_instances` import:

```text
CParticleSystem
CDOTA_DataSpectator
CDOTASpectatorGraphManagerProxy
CDOTACameraBounds
```

Use the retained rows in `raw.entity_instances` as the source of valid entity instance IDs.

When the loader imports entity events, property updates, and checkpoints, join them to the retained entity instance IDs. Do not store data for a rejected entity.

Keep these gameplay classes:

```text
CDOTA_NPC_Observer_Ward
CDOTA_NPC_Observer_Ward_TrueSight
CDOTA_Item_ObserverWard
```

Do not try to classify every entity in this release. Add a class to the reject list only when its purpose is clear.

## 8. Entity Events

The Java parser will continue to export `create`, `update`, and `delete` events.

The loader must import only:

```text
create
delete
```

Remove `changed_property_paths` from `raw.entity_events`. The retained event types do not need this column.

Keep the `synthetic` column. It identifies a delete event that the parser creates when an entity index is reused.

Change the DuckDB event-type constraint so that it accepts only `create` and `delete`.

Do not add an event-group identifier to property updates. No current analysis needs it.

## 9. Checkpoints

The Java parser will continue to export interval checkpoints.

The loader must import only:

```text
creation
completion
```

Change the DuckDB checkpoint-kind constraint so that it accepts only these two values.

Keep `checkpointIntervalSeconds` in the parser configuration, extraction identity, manifest, preflight check, and catalog. It describes the exported parser data, even when the loader does not store the interval rows.

Keep `checkpoint_game_time`. State reconstruction uses a creation checkpoint and all later property updates. Final analysis uses completion checkpoints.

Do not add a new checkpoint schedule.

## 10. BLOB Import

Import `blobs.ndjson` after all other raw files.

Each BLOB row has a `recordSequence` value. This value identifies the row that owns the BLOB.

Keep a BLOB only when its owner sequence exists in one of these retained tables for the same extraction:

```text
raw.records
raw.entity_property_updates
raw.entity_checkpoints
```

This rule removes BLOBs from rejected voice messages, packet-entity messages, entities, and interval checkpoints.

Do not add a shared BLOB store or cross-extraction deduplication in this release.

## 11. Catalog Counts

The parser manifest must remain unchanged. Its file counts and byte sizes describe exported data.

Store the complete parser manifest in `catalog.extractions.manifest`, as the loader does now.

Use `catalog.extractions.output_size_bytes` for the exported NDJSON size.

Use `catalog.extractions.record_counts` for the rows that DuckDB stores. Calculate these counts after the filtered import.

Document this difference:

```text
manifest counts       exported parser rows
record_counts         stored DuckDB rows
output_size_bytes     temporary parser output bytes
```

Do not add another count column.

## 12. Schema Changes

The current warehouse has no data that must survive. Update the baseline migrations for a new empty warehouse.

Change `raw.entity_events`:

- Remove `changed_property_paths`.
- Permit only `create` and `delete` event types.

Change `raw.entity_checkpoints` so that it permits only `creation` and `completion` checkpoint kinds.

Keep the checkpoint interval catalog column. Keep all current indexes.

Do not add a migration that copies or deletes old raw rows.

## 13. Import Order

Use this import order inside the existing load transaction:

1. Records, with the message filter.
2. Entity instances, with the entity filter.
3. Entity events, with the entity and event filters.
4. Property updates, with the entity filter.
5. Checkpoints, with the entity and checkpoint filters.
6. BLOBs, with the retained-owner filter.

If import or validation fails, roll back the existing load transaction.

Do not add another transaction or a temporary application database.

## 14. Validation

Do not compare stored row counts directly with the unfiltered manifest counts.

For each staged file, calculate the expected stored count with the same policy that the import uses. Compare it with the stored table count before commit.

Also confirm these conditions before commit:

- Each stored entity child row has a retained entity instance.
- Each stored BLOB has a retained owner row.
- No rejected message type is stored.
- No rejected entity class is stored.
- No `update` entity event is stored.
- No `interval` checkpoint is stored.
- Property update sequences remain unique.

Keep this validation in the loader. Do not add validation to the Java parser.

## 15. Tests

### 15.1 Storage policy tests

Test the TypeScript storage decisions as pure functions.

Confirm these results:

1. Voice, sound, visual-effect, HLTV, and packet-entity records are rejected.
2. Combat-log records are retained.
3. `CDOTAUserMsg_SpectatorPlayerUnitOrders` is retained.
4. Spectator data, camera bounds, and particle-system entities are rejected.
5. Observer wards are retained.
6. Only `create` and `delete` events are retained.
7. Only `creation` and `completion` checkpoints are retained.

### 15.2 Loader tests

Use a small synthetic manifest and a temporary DuckDB warehouse.

Include retained and rejected records, entities, events, checkpoints, and BLOB owners in the fixture.

Confirm these results:

1. The loader stores only retained rows.
2. A BLOB for a rejected row is not stored.
3. A BLOB for a retained row is stored.
4. Stored counts match the filtered rows.
5. The catalog manifest keeps the exported counts.
6. The catalog `record_counts` value contains stored counts.
7. A failed validation leaves no partial raw rows.
8. The exact-extraction check still prevents a duplicate load.

### 15.3 Analysis regression tests

Run the existing analysis tests.

After a real replay load, confirm these results:

1. `analysis.match_summary()` returns the match.
2. `analysis.match_players()` returns all ten players.
3. Combat-log gold events remain available.
4. Player gold property updates remain available.
5. State reconstruction works before the completion checkpoint.

Do not add Java tests for this work because Java behavior does not change.

## 16. Storage Measurement

Use one known replay for the before-and-after comparison.

After the clean load, record:

- The replay size.
- The temporary parser output size.
- The exported parser row counts.
- The stored DuckDB row counts.
- The DuckDB file size.
- The result of `pragma_database_size()`.
- Persistent blocks for each raw table.
- The peak staging-volume use during parsing and loading.

Confirm these conditions:

- The clean warehouse has one successful extraction.
- No rejected message type is present.
- No rejected entity class is present.
- No interval checkpoint is present.
- No entity update event is present.
- No orphan BLOB is present.
- No old staged extraction is present after a successful load.

Report the permanent DuckDB reduction and the temporary staging cost separately.

Do not remove or change indexes. Use the new measurement for the next index decision.

## 17. Implementation Order

1. Stop the services and reset the development warehouse and staging data.
2. Update the DuckDB baseline schema.
3. Add the TypeScript storage policy.
4. Add the filtered import order to the loader.
5. Update loader validation and catalog counts.
6. Add focused TypeScript tests.
7. Start the services and load one known replay.
8. Run all TypeScript, web, and analysis tests.
9. Measure and report permanent and temporary storage.

## 18. Definition of Done

This work is complete when:

- The Java parser has no changes.
- The clean warehouse contains only new filtered loads.
- Voice and selected non-player data do not enter DuckDB.
- Stored entity changes remain available as property updates.
- Entity update events do not exist in DuckDB.
- Only creation and completion checkpoints exist in DuckDB.
- Only BLOBs for retained rows exist in DuckDB.
- Exported and stored counts have clear meanings.
- Existing first-analysis queries still work.
- A new report gives the size of one clean extraction.
- No index changes are included.
