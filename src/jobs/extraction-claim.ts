import { lstat, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { parseMatchId } from "../lib/match-id.js";

const claimIdPattern = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|cli-[1-9][0-9]*)$/;
const extractionIdPattern = /^[a-f0-9]{64}$/;

export type ClaimExtractionOptions = {
  matchId: bigint;
  claimId: string;
  extractionId: string;
  inboxRoot: string;
  claimedRoot: string;
};

export type ClaimedExtraction = {
  matchId: bigint;
  claimId: string;
  extractionId: string;
  directory: string;
};

export async function claimExtraction(options: ClaimExtractionOptions): Promise<ClaimedExtraction> {
  validateIdentifiers(options);

  const matchId = options.matchId.toString();
  const sourceParent = path.join(options.inboxRoot, matchId);
  const source = path.join(sourceParent, options.extractionId);
  const destinationParent = path.join(options.claimedRoot, options.claimId);
  const destination = path.join(destinationParent, options.extractionId);
  const [sourceType, destinationType] = await Promise.all([
    pathType(source),
    pathType(destination),
  ]);

  if (sourceType === "symlink") throw new Error(`Parser output is a symbolic link: ${source}`);
  if (sourceType === "other") throw new Error(`Parser output is not a directory: ${source}`);
  if (destinationType === "symlink") throw new Error(`Claimed extraction is a symbolic link: ${destination}`);
  if (destinationType === "other") throw new Error(`Claimed extraction is not a directory: ${destination}`);
  if (sourceType === "directory" && destinationType === "directory") {
    throw new Error(`Extraction exists in both inbox and claimed storage: ${options.extractionId}`);
  }
  if (sourceType === "missing" && destinationType === "missing") {
    throw new Error(`Extraction does not exist in inbox or claimed storage: ${options.extractionId}`);
  }

  if (sourceType === "directory") await requireDirectory(sourceParent, "Parser output parent");
  if (destinationType === "directory") await requireDirectory(destinationParent, "Claimed extraction parent");

  if (destinationType === "missing") {
    await mkdir(options.claimedRoot, { recursive: true });
    await requireDirectory(options.claimedRoot, "Claimed extraction root");
    try {
      await mkdir(destinationParent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await requireDirectory(destinationParent, "Claimed extraction parent");
    await rename(source, destination);
  }

  return {
    matchId: options.matchId,
    claimId: options.claimId,
    extractionId: options.extractionId,
    directory: destination,
  };
}

function validateIdentifiers(options: ClaimExtractionOptions): void {
  if (typeof options.matchId !== "bigint") throw new Error("Invalid match ID");
  parseMatchId(options.matchId.toString());
  if (!claimIdPattern.test(options.claimId)) throw new Error("Invalid claim ID");
  if (!extractionIdPattern.test(options.extractionId)) throw new Error("Invalid extraction ID");
}

type PathType = "missing" | "directory" | "symlink" | "other";

async function pathType(file: string): Promise<PathType> {
  try {
    const details = await lstat(file);
    if (details.isSymbolicLink()) return "symlink";
    if (details.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function requireDirectory(directory: string, label: string): Promise<void> {
  const type = await pathType(directory);
  if (type === "symlink") throw new Error(`${label} is a symbolic link: ${directory}`);
  if (type !== "directory") throw new Error(`${label} is not a directory: ${directory}`);
}
