import { createFileRoute } from "@tanstack/react-router";
import { GpmSection } from "../web/gpm-section";
import { useMatchLens } from "../web/match-lens";
import { teamName } from "../web/overview-data";
import { WinProbabilitySection } from "../web/win-probability-section";

export const Route = createFileRoute("/matches/$matchId/timelines")({
  component: MatchTimelinesPage,
});

function MatchTimelinesPage() {
  const { match, lens } = useMatchLens();
  const { summary } = match;
  const radiantName = teamName(2, summary.radiantTeamName);
  const direName = teamName(3, summary.direTeamName);
  return <div className="space-y-6">
    <WinProbabilitySection matchId={match.matchId} radiantName={radiantName} direName={direName} lens={lens} />
    <GpmSection matchId={match.matchId} players={match.players} radiantName={radiantName} direName={direName} lens={lens} />
  </div>;
}
