import type { DuckDBConnection } from "@duckdb/node-api";
import type { SamplingMetadata } from "../jobs/job-files.js";

export async function upsertMatchSelection(
  connection: DuckDBConnection,
  matchId: bigint,
  extractionId: string,
  sampling: SamplingMetadata,
): Promise<void> {
  await connection.run(
    `INSERT INTO catalog.match_selections
      (match_id, window_start, selection_group, avg_rank_tier, source, sampling_version, extraction_id)
     VALUES ($matchId, $windowStart::TIMESTAMPTZ, $group, $rankTier, $source, $version, $extractionId)
     ON CONFLICT (match_id, sampling_version) DO UPDATE SET
       window_start = excluded.window_start,
       selection_group = excluded.selection_group,
       avg_rank_tier = excluded.avg_rank_tier,
       source = excluded.source,
       extraction_id = excluded.extraction_id,
       recorded_at = now()`,
    {
      matchId,
      windowStart: sampling.windowStart,
      group: sampling.selectionGroup,
      rankTier: sampling.avgRankTier ?? null,
      source: sampling.source,
      version: sampling.samplingVersion,
      extractionId,
    },
  );
}
