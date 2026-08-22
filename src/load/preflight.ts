import { stat } from "node:fs/promises";
import { paths } from "../config.js";
import { openWarehouse } from "../db/database.js";
import { withWarehouseLock } from "../db/lock.js";

const parser = { name: "clarity", version: "4.0.1", exporterVersion: "0.1.2" } as const;
const config = {
  maxInputBytes: 2_147_483_648,
  maxOutputBytes: 12_884_901_888,
  maxRecords: 50_000_000,
  timeoutSeconds: 1_800,
  checkpointIntervalSeconds: 30,
} as const;

export async function extractionAlreadyLoaded(matchId: bigint, replaySha256: string | undefined): Promise<boolean> {
  if (replaySha256 === undefined || !/^[a-f0-9]{64}$/.test(replaySha256)) {
    throw new Error("REPLAY_SHA256 must be a lowercase SHA-256 digest");
  }
  try { await stat(paths.warehousePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  return withWarehouseLock(paths.warehousePath, async () => {
    const database = await openWarehouse(true);
    try {
      const result = await database.connection.runAndReadAll(
        `SELECT count(*)::INTEGER AS n FROM catalog.extractions
         WHERE match_id = $matchId AND replay_sha256 = $sha AND status = 'succeeded'
           AND parser_name = $parserName AND parser_version = $parserVersion
           AND exporter_version = $exporterVersion
           AND (extraction_config->>'maxInputBytes') = $maxInput
           AND (extraction_config->>'maxOutputBytes') = $maxOutput
           AND (extraction_config->>'maxRecords') = $maxRecords
           AND (extraction_config->>'timeoutSeconds') = $timeout
           AND (extraction_config->>'checkpointIntervalSeconds') = $interval`,
        {
          matchId, sha: replaySha256, parserName: parser.name, parserVersion: parser.version,
          exporterVersion: parser.exporterVersion, maxInput: String(config.maxInputBytes),
          maxOutput: String(config.maxOutputBytes), maxRecords: String(config.maxRecords),
          timeout: String(config.timeoutSeconds), interval: String(config.checkpointIntervalSeconds),
        },
      );
      return (result.getRowObjects()[0] as { n: number } | undefined)?.n === 1;
    } catch (error) {
      if (error instanceof Error && /catalog\.extractions.*does not exist/i.test(error.message)) return false;
      throw error;
    } finally { database.close(); }
  });
}
