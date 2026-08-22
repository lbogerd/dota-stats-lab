import { readdir } from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { validateManifest, type Manifest } from "../load/manifest.js";

export async function validateParserOutput(matchId: bigint, expectedExtractionId?: string): Promise<Manifest> {
  const matchDirectory = path.join(paths.stagingRoot, matchId.toString());
  const entries = await readdir(matchDirectory, { withFileTypes: true });
  const extractionIds = entries
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
    .map((entry) => entry.name);
  if (expectedExtractionId !== undefined && !extractionIds.includes(expectedExtractionId)) {
    throw new Error(`Parser did not publish expected extraction ${expectedExtractionId}`);
  }
  if (extractionIds.length !== 1) {
    throw new Error(`Expected exactly one parser output for match ${matchId}, found ${extractionIds.length}`);
  }
  const extractionId = extractionIds[0]!;
  const manifest = await validateManifest(path.join(matchDirectory, extractionId), matchId);
  if (manifest.extractionId !== extractionId) throw new Error("Parser output directory does not match manifest extraction ID");
  return manifest;
}
