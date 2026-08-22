import { createFileRoute } from "@tanstack/react-router";
import { ensureIngestionCoordinator } from "../server/ingestion-runtime.js";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () => {
        ensureIngestionCoordinator();
        return Response.json({ status: "ok" }, {
          headers: {
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
