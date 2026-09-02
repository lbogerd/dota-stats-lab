import { createFileRoute } from "@tanstack/react-router";
import { FightDetail } from "../web/fight-detail.js";
import { useMatchLens } from "../web/match-lens.js";

export const Route = createFileRoute("/matches/$matchId/fights/$fightId")({
  component: MatchFightDetailPage,
});

function MatchFightDetailPage() {
  const { fightId } = Route.useParams();
  const { match } = useMatchLens();
  return <FightDetail
    matchId={match.matchId}
    fightId={fightId}
    players={match.players}
    radiantTeamName={match.summary.radiantTeamName}
    direTeamName={match.summary.direTeamName}
  />;
}
