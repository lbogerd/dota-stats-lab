import { rm } from "node:fs/promises";
import path from "node:path";
import { paths, replayDir } from "../config.js";

/** Remove only the cache directory for the supplied, validated match ID. */
export async function deleteReplayAfterSuccess(matchId: bigint): Promise<void> {
  const root = path.resolve(paths.replayRoot);
  const directory = path.resolve(replayDir(matchId));
  if (path.dirname(directory) !== root || path.basename(directory) !== matchId.toString()) {
    throw new Error("Refusing to delete an invalid replay directory");
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
}
