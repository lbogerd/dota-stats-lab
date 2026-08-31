import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getSamplerStatus } from "../server/sampler-monitoring.js";

const getSamplerStatusFn = createServerFn({ method: "GET" })
  .handler(() => getSamplerStatus());

export const samplerStatusQuery = () => queryOptions({
  queryKey: ["sampler-status"] as const,
  queryFn: () => getSamplerStatusFn(),
  refetchInterval: 30_000,
  staleTime: 10_000,
});
