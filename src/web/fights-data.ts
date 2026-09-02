import { queryOptions } from "@tanstack/react-query";
import type { FightDetail, FightListRecord, MatchFightDetail, MatchFights } from "../server/fights.js";
import type { MatchLens } from "./match-lens.js";
import { getMatchFightDetailFn, getMatchFightsFn } from "./functions.js";

export type { FightDetail, FightListRecord };

const fightQueryKeys = {
  list: (matchId: string) => ["match-fights", matchId] as const,
  detail: (matchId: string, fightId: string) => ["match-fights", matchId, fightId] as const,
};

export const fightListQuery = (matchId: string) => queryOptions({
  queryKey: fightQueryKeys.list(matchId),
  queryFn: (): Promise<MatchFights> => getMatchFightsFn({ data: { matchId } }),
});

export const fightDetailQuery = (matchId: string, fightId: string) => queryOptions({
  queryKey: fightQueryKeys.detail(matchId, fightId),
  queryFn: (): Promise<MatchFightDetail> => getMatchFightDetailFn({ data: { matchId, fightId } }),
});

export function fightsInLens(fights: FightListRecord[], lens: MatchLens): FightListRecord[] {
  return fights
    .filter((fight) => fight.anchorTimesSeconds.some(
      (time) => time >= lens.startSeconds && time <= lens.endSeconds,
    ))
    .filter((fight) => {
      const scope = lens.scope;
      if (scope.kind === "all") return true;
      if (scope.kind === "team") {
        return fight.participants.some((participant) => participant.teamId === scope.teamId);
      }
      return fight.participants.some((participant) => (
        participant.playerSlot === scope.playerSlot
        && participant.kills + participant.deaths + participant.assists > 0
      ));
    })
    .toSorted((left, right) => (
      left.firstAnchorTimeSeconds - right.firstAnchorTimeSeconds
      || compareUnsignedStrings(left.fightId, right.fightId)
    ));
}

function compareUnsignedStrings(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left.localeCompare(right);
}
