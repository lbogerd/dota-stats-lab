import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { samplerStatusQuery } from "../web/sampler-data.js";
import { SamplerStatusView } from "../web/sampler-status-view.js";

export const Route = createFileRoute("/operations/sampler")({
  loader: ({ context }) => context.queryClient.ensureQueryData(samplerStatusQuery()),
  component: SamplerOperationsPage,
});

function SamplerOperationsPage() {
  const { data } = useSuspenseQuery(samplerStatusQuery());
  return <SamplerStatusView status={data} />;
}
