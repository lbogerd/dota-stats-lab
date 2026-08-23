import { readdir } from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { readManifest, type Manifest } from "../load/manifest.js";
import type { ClaimedExtraction } from "./extraction-claim.js";

export async function findPublishedExtractionId(
  matchId: bigint,
  inboxRoot = paths.stagingInboxRoot,
): Promise<string> {
  const matchDirectory = path.join(inboxRoot, matchId.toString());
  const entries = await readdir(matchDirectory, { withFileTypes: true });
  const extractionIds = entries
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
    .map((entry) => entry.name);
  if (extractionIds.length !== 1) {
    throw new Error(`Expected exactly one parser output for match ${matchId}, found ${extractionIds.length}`);
  }
  return extractionIds[0]!;
}

export async function inspectClaimedExtraction(claimed: ClaimedExtraction): Promise<Manifest> {
  const manifest = await readManifest(claimed.directory, claimed.matchId);
  if (manifest.extractionId !== claimed.extractionId) {
    throw new Error("Parser output directory does not match manifest extraction ID");
  }
  return manifest;
}
