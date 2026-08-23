import { mkdir } from "node:fs/promises";
import { paths } from "../config.js";

export async function initializeStagingLayout(): Promise<void> {
  await Promise.all([
    mkdir(paths.stagingInboxRoot, { recursive: true }),
    mkdir(paths.stagingClaimedRoot, { recursive: true }),
    mkdir(paths.jobsRoot, { recursive: true }),
  ]);
}
