import { createFileRoute } from "@tanstack/react-router";
import { HeroHeatmapSection } from "../web/hero-heatmap-section";
import { useMatchLens } from "../web/match-lens";
import { NeutralCampFarmingSection } from "../web/neutral-camp-farming-section";

export const Route = createFileRoute("/matches/$matchId/map-farming")({
  component: MatchMapFarmingPage,
});

function MatchMapFarmingPage() {
  const { match, lens } = useMatchLens();
  return <div className="space-y-6">
    <HeroHeatmapSection
      matchId={match.matchId}
      durationSeconds={match.summary.durationSeconds}
      players={match.players}
      lens={lens}
    />
    <NeutralCampFarmingSection matchId={match.matchId} players={match.players} lens={lens} />
  </div>;
}
