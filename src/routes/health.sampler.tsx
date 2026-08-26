import { createFileRoute } from "@tanstack/react-router";
import { getSamplerStatus } from "../server/sampler-monitoring.js";

export const Route = createFileRoute("/health/sampler")({
  server: {
    handlers: {
      GET: async () => {
        const status = await getSamplerStatus();
        const unavailable = status.status === "critical" || status.status === "unavailable";
        return Response.json(status, {
          status: unavailable ? 503 : 200,
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
