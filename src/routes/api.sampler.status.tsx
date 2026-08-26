import { createFileRoute } from "@tanstack/react-router";
import { getSamplerStatus } from "../server/sampler-monitoring.js";

export const Route = createFileRoute("/api/sampler/status")({
  server: {
    handlers: {
      GET: async () => Response.json(await getSamplerStatus(), {
        headers: { "cache-control": "no-store" },
      }),
    },
  },
});
