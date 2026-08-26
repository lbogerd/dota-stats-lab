import { stat } from "node:fs/promises";
import { paths } from "../config.js";
import { migrate, openWarehouse } from "../db/database.js";
import { withWarehouseLock } from "../db/lock.js";
import { validateSamplingMetadata, type SamplingMetadata } from "../jobs/job-files.js";
import { upsertMatchSelection } from "./match-selection.js";
import { parserIdentity } from "./parser-identity.js";

const config = {
  maxInputBytes: 2_147_483_648,
  maxOutputBytes: 12_884_901_888,
  maxRecords: 50_000_000,
  timeoutSeconds: 1_800,
  checkpointIntervalSeconds: 30,
} as const;

export async function extractionAlreadyLoaded(
  matchId: bigint,
  replaySha256: string | undefined,
  sampling?: SamplingMetadata,
): Promise<boolean> {
  if (replaySha256 === undefined || !/^[a-f0-9]{64}$/.test(replaySha256)) {
    throw new Error("REPLAY_SHA256 must be a lowercase SHA-256 digest");
  }
  if (sampling !== undefined) validateSamplingMetadata(sampling);
  try { await stat(paths.warehousePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  return withWarehouseLock(paths.warehousePath, async () => {
    const database = await openWarehouse(sampling === undefined);
    try {
      if (sampling !== undefined) await migrate(database.connection);
      const result = await database.connection.runAndReadAll(
        `SELECT extraction_id FROM catalog.extractions
         WHERE match_id = $matchId AND replay_sha256 = $sha AND status = 'succeeded'
           AND parser_name = $parserName AND parser_version = $parserVersion
           AND exporter_version = $exporterVersion
           AND (extraction_config->>'maxInputBytes') = $maxInput
           AND (extraction_config->>'maxOutputBytes') = $maxOutput
           AND (extraction_config->>'maxRecords') = $maxRecords
           AND (extraction_config->>'timeoutSeconds') = $timeout
           AND (extraction_config->>'checkpointIntervalSeconds') = $interval
         ORDER BY completed_at DESC NULLS LAST LIMIT 1`,
        {
          matchId, sha: replaySha256, parserName: parserIdentity.name, parserVersion: parserIdentity.version,
          exporterVersion: parserIdentity.exporterVersion, maxInput: String(config.maxInputBytes),
          maxOutput: String(config.maxOutputBytes), maxRecords: String(config.maxRecords),
          timeout: String(config.timeoutSeconds), interval: String(config.checkpointIntervalSeconds),
        },
      );
      const extractionId = (result.getRowObjects()[0] as { extraction_id?: string } | undefined)?.extraction_id;
      if (extractionId === undefined) return false;
      if (sampling !== undefined) {
        await upsertMatchSelection(database.connection, matchId, extractionId, sampling);
      }
      return true;
    } catch (error) {
      if (error instanceof Error && /catalog\.extractions.*does not exist/i.test(error.message)) return false;
      throw error;
    } finally { database.close(); }
  });
}
