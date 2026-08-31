import { createFileRoute } from "@tanstack/react-router";
import { CombatAnalysis } from "../web/combat-analysis";
import { useMatchLens } from "../web/match-lens";

export const Route = createFileRoute("/matches/$matchId/combat")({
  component: MatchCombatPage,
});

function MatchCombatPage() {
  const { match, lens } = useMatchLens();
  return <CombatAnalysis matchId={match.matchId} players={match.players} lens={lens} />;
}
