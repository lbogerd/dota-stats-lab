import { createFileRoute } from "@tanstack/react-router";
import { MatchScoreboard } from "../web/match-scoreboard";
import { useMatchLens } from "../web/match-lens";

export const Route = createFileRoute("/matches/$matchId/")({
  component: MatchOverviewPage,
});

function MatchOverviewPage() {
  const { match, lens } = useMatchLens();
  return <MatchScoreboard match={match} lens={lens} />;
}
