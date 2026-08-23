# Storage reduction report

This report compares one known replay on the unfiltered baseline and the filtered-storage revision. Both runs used the same replay checksum and parser configuration.

The report gives permanent DuckDB storage and temporary staging storage as separate values.

## Measurement method

The test used these steps for each revision:

1. Record the revision, replay details, parser version, exporter version, and parser configuration.
2. Stop all warehouse users.
3. Delete and recreate only the warehouse and staging volumes.
4. Keep the replay and saved-query volumes.
5. Build the revision.
6. Measure staging use every two seconds during one ingestion.
7. Confirm that the warehouse contains one successful extraction.
8. Run the integrity checks and checkpoint DuckDB.
9. Collect the file sizes, row counts, and block counts.

The storage-policy change modifies the baseline migration. It does not upgrade an initialized warehouse. Existing development installations need a clean warehouse before they use this revision.

## Metadata and sizes

| Measurement | Unfiltered baseline | Filtered revision |
| --- | ---: | ---: |
| Git revision | `d97eacf` | `f81011c` |
| Match ID | `8959222564` | `8959222564` |
| Replay SHA-256 | `d898e8348c318d7a0a70d297fb4b05b9405f4875e8a6724c5a544c96b9817928` | same |
| Replay size (bytes) | 149,365,498 | 149,365,498 |
| Exporter version | `0.1.3` | `0.1.3` |
| Checkpoint interval (seconds) | 30 | 30 |
| Temporary parser output (bytes) | 8,770,041,412 | 8,770,041,412 |
| Peak staging use (bytes) | 8,770,043,288 | 8,770,043,288 |
| Staging sampling interval | 2 seconds | 2 seconds |
| DuckDB file size after checkpoint (bytes) | 4,132,974,592 | 1,191,718,912 |
| `pragma_database_size()` database size | 3.8 GiB | 1.1 GiB |
| `pragma_database_size()` block size | 262,144 | 262,144 |
| `pragma_database_size()` total blocks | 15,766 | 4,546 |
| `pragma_database_size()` used blocks | 15,766 | 4,546 |
| `pragma_database_size()` free blocks | 0 | 0 |

The comparison uses this calculation:

```text
permanent bytes removed = baseline DuckDB bytes - filtered DuckDB bytes
permanent reduction (%) = permanent bytes removed / baseline DuckDB bytes * 100
```

The peak staging figures describe temporary capacity requirements and must not be included in the permanent-reduction percentage.

## Exported and stored row counts

`manifest.files.*.records` counts exported parser rows. `record_counts` counts rows retained in DuckDB. `output_size_bytes` is the sum of exported NDJSON file sizes, not the DuckDB file size.

The following query returns the catalog values without changing their meaning:

```sql
SELECT
    extraction_id,
    match_id,
    replay_sha256,
    parser_version,
    exporter_version,
    extraction_config,
    output_size_bytes,
    manifest,
    record_counts
FROM catalog.extractions
WHERE status = 'succeeded';
```

The following query checks `record_counts`. Replace `EXTRACTION_ID` with the measured extraction ID.

```sql
SELECT 'records' AS row_family, count(*) AS stored_rows
FROM raw.records WHERE extraction_id = 'EXTRACTION_ID'
UNION ALL
SELECT 'blobs', count(*)
FROM raw.record_blobs WHERE extraction_id = 'EXTRACTION_ID'
UNION ALL
SELECT 'entityInstances', count(*)
FROM raw.entity_instances WHERE extraction_id = 'EXTRACTION_ID'
UNION ALL
SELECT 'entityEvents', count(*)
FROM raw.entity_events WHERE extraction_id = 'EXTRACTION_ID'
UNION ALL
SELECT 'propertyUpdates', count(*)
FROM raw.entity_property_updates WHERE extraction_id = 'EXTRACTION_ID'
UNION ALL
SELECT 'checkpoints', count(*)
FROM raw.entity_checkpoints WHERE extraction_id = 'EXTRACTION_ID'
ORDER BY row_family;
```

| Row family | Baseline exported | Baseline stored | Filtered exported | Filtered stored |
| --- | ---: | ---: | ---: | ---: |
| records | 1,786,227 | 1,786,227 | 1,786,227 | 364,526 |
| blobs | 1,369,986 | 1,369,986 | 1,369,986 | 30,819 |
| entity instances | 13,806 | 13,806 | 13,806 | 13,577 |
| entity events | 6,354,475 | 6,354,475 | 6,354,475 | 25,350 |
| property updates | 13,988,148 | 13,988,148 | 13,988,148 | 13,321,504 |
| checkpoints | 152,896 | 152,896 | 152,896 | 15,381 |
| total | 23,665,538 | 23,665,538 | 23,665,538 | 13,771,157 |

## DuckDB size and raw-table blocks

The test flushed a stable on-disk state before it read the database file size:

```sql
CHECKPOINT;
SELECT * FROM pragma_database_size();
```

The test ran `pragma_storage_info` for every raw table. It counted only persistent block IDs. A `block_id` value of `-1` does not identify a persistent block. DuckDB can share a block between small tables. Thus, the sum of the table values does not give the database size.

```sql
SELECT 'raw.records' AS table_name,
       count(DISTINCT block_id) FILTER (WHERE persistent AND block_id >= 0) AS persistent_blocks
FROM pragma_storage_info('raw.records')
UNION ALL
SELECT 'raw.record_blobs',
       count(DISTINCT block_id) FILTER (WHERE persistent AND block_id >= 0)
FROM pragma_storage_info('raw.record_blobs')
UNION ALL
SELECT 'raw.entity_instances',
       count(DISTINCT block_id) FILTER (WHERE persistent AND block_id >= 0)
FROM pragma_storage_info('raw.entity_instances')
UNION ALL
SELECT 'raw.entity_events',
       count(DISTINCT block_id) FILTER (WHERE persistent AND block_id >= 0)
FROM pragma_storage_info('raw.entity_events')
UNION ALL
SELECT 'raw.entity_property_updates',
       count(DISTINCT block_id) FILTER (WHERE persistent AND block_id >= 0)
FROM pragma_storage_info('raw.entity_property_updates')
UNION ALL
SELECT 'raw.entity_checkpoints',
       count(DISTINCT block_id) FILTER (WHERE persistent AND block_id >= 0)
FROM pragma_storage_info('raw.entity_checkpoints')
ORDER BY table_name;
```

| Raw table | Baseline persistent blocks | Filtered persistent blocks |
| --- | ---: | ---: |
| `raw.records` | 1,060 | 287 |
| `raw.record_blobs` | 759 | 31 |
| `raw.entity_instances` | 2 | 2 |
| `raw.entity_events` | 1,173 | 2 |
| `raw.entity_property_updates` | 466 | 432 |
| `raw.entity_checkpoints` | 103 | 4 |

## Filtered-run integrity checks

Each query below returns an invalid-row count and must return zero for the filtered revision. The message and entity lists intentionally duplicate the storage policy so the measurement independently verifies the loaded boundary.

```sql
SELECT count(*) AS rejected_records
FROM raw.records
WHERE record_type IN (
    'CSVCMsg_VoiceData',
    'CSVCMsg_VoiceInit',
    'CUserMessageVoiceMask',
    'CUserMessageSendAudio',
    'CUserMsg_ParticleManager',
    'CMsgSosStartSoundEvent',
    'CMsgSosSetSoundEventParams',
    'CMsgSosStopSoundEvent',
    'CMsgSosStopSoundEventHash',
    'CDOTAUserMsg_TE_UnitAnimation',
    'CDOTAUserMsg_TE_UnitAnimationEnd',
    'CDOTAUserMsg_TE_DotaBloodImpact',
    'CDOTAUserMsg_TE_Projectile',
    'CDOTAUserMsg_TE_ProjectileLoc',
    'CMsgTEEffectDispatch',
    'CDOTAUserMsg_KillEffect',
    'CSVCMsg_HLTVStatus',
    'CSVCMsg_PacketEntities'
);

SELECT count(*) AS rejected_entities
FROM raw.entity_instances
WHERE class_name IN (
    'CParticleSystem',
    'CDOTA_DataSpectator',
    'CDOTASpectatorGraphManagerProxy',
    'CDOTACameraBounds'
);

SELECT count(*) AS update_events
FROM raw.entity_events
WHERE event_type = 'update';

SELECT count(*) AS interval_checkpoints
FROM raw.entity_checkpoints
WHERE checkpoint_kind = 'interval';

SELECT count(*) AS orphan_entity_events
FROM raw.entity_events AS child
LEFT JOIN raw.entity_instances AS owner
  USING (extraction_id, entity_instance_id)
WHERE owner.entity_instance_id IS NULL;

SELECT count(*) AS orphan_property_updates
FROM raw.entity_property_updates AS child
LEFT JOIN raw.entity_instances AS owner
  USING (extraction_id, entity_instance_id)
WHERE owner.entity_instance_id IS NULL;

SELECT count(*) AS orphan_checkpoints
FROM raw.entity_checkpoints AS child
LEFT JOIN raw.entity_instances AS owner
  USING (extraction_id, entity_instance_id)
WHERE owner.entity_instance_id IS NULL;

SELECT count(*) AS orphan_blobs
FROM raw.record_blobs AS blob
WHERE NOT EXISTS (
        SELECT 1 FROM raw.records AS owner
        WHERE owner.extraction_id = blob.extraction_id
          AND owner.sequence = blob.record_sequence
    )
  AND NOT EXISTS (
        SELECT 1 FROM raw.entity_property_updates AS owner
        WHERE owner.extraction_id = blob.extraction_id
          AND owner.sequence = blob.record_sequence
    )
  AND NOT EXISTS (
        SELECT 1 FROM raw.entity_checkpoints AS owner
        WHERE owner.extraction_id = blob.extraction_id
          AND owner.sequence = blob.record_sequence
    );

SELECT count(*) - count(DISTINCT (extraction_id, sequence)) AS duplicate_property_update_sequences
FROM raw.entity_property_updates;

WITH extraction_summary AS (
    SELECT
        count(*) AS total_extractions,
        count(*) FILTER (WHERE status = 'succeeded') AS successful_extractions
    FROM catalog.extractions
)
SELECT
    (total_extractions <> 1 OR successful_extractions <> 1)::INTEGER
        AS invalid_extraction_catalog
FROM extraction_summary;
```

Observed result: every rejection, orphan, interval/update-event, duplicate-sequence, and invalid-catalog count was zero.

Outside DuckDB, `sudo du -sb /var/lib/docker/volumes/dota-stats-staging/_data` returned `0` bytes after the successful load, so no completed extraction or ingestion-job file remained.

## Analysis regression results

| Check | Result |
| --- | --- |
| `analysis.match_summary()` returns the match | Passed: one row for match `8959222564` |
| `analysis.match_players()` returns ten players | Passed: ten rows, player indexes 0 through 9 |
| Combat-log gold events are present | Passed: 3,090 `DOTA_COMBATLOG_GOLD` rows |
| Player gold property updates are present | Passed: 128,505 gold-path updates on `CDOTA_DataRadiant` and `CDOTA_DataDire` |
| State reconstruction works before completion | Passed: 1,962 properties at game time 1,000, before completion at 2,213.93 |

## Conclusion

- Permanent DuckDB reduction: 2,941,255,680 bytes (71.17%)
- Stored row reduction: 9,894,381 rows (41.81%)
- Temporary parser-output size: 8,770,041,412 bytes (unchanged)
- Peak staging-volume use: 8,770,043,288 bytes with two-second sampling (unchanged)
- Index decision: deferred to a follow-up; no indexes changed in this work
