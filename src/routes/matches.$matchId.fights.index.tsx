import { createFileRoute } from "@tanstack/react-router";
import { FightsList } from "../web/fights-list.js";
import { useMatchLens } from "../web/match-lens.js";

export const Route = createFileRoute("/matches/$matchId/fights/")({
  component: MatchFightsPage,
});

function MatchFightsPage() {
  const { match, lens } = useMatchLens();
  return <FightsList
    matchId={match.matchId}
    players={match.players}
    lens={lens}
    radiantTeamName={match.summary.radiantTeamName}
    direTeamName={match.summary.direTeamName}
  />;
}
