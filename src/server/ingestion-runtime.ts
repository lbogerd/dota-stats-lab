import { IngestionCoordinator } from "../jobs/coordinator.js";

const coordinator = new IngestionCoordinator();

export function ensureIngestionCoordinator(): IngestionCoordinator {
  if (isIngestionEnabled()) coordinator.start();
  return coordinator;
}

export function enqueueIngestion(matchId: bigint) {
  if (!isIngestionEnabled()) {
    throw new Error("Ingestion is currently disabled");
  }
  return ensureIngestionCoordinator().enqueue(matchId);
}

export function isIngestionEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.INGESTION_ENABLED?.trim().toLowerCase() !== "false";
}
