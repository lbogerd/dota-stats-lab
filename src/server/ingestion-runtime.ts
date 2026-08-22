import { IngestionCoordinator } from "../jobs/coordinator.js";

const coordinator = new IngestionCoordinator();

export function ensureIngestionCoordinator(): IngestionCoordinator {
  coordinator.start();
  return coordinator;
}
