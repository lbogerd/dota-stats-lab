import { describe, expect, it } from "vitest";
import type { FightListRecord } from "../server/fights.js";
import type { MatchLens } from "./match-lens.js";
import { fightsInLens } from "./fights-data.js";

const baseFight = {
  detectionVersion: "death-anchored-fights-v1",
  anchorTimesSeconds: [50],
  combatStartSeconds: 40,
  combatEndSeconds: 55,
  durationSeconds: 15,
  outcomeEndSeconds: 85,
  location: { x: 0, y: 0 },
  teams: [],
  radiantWinProbabilityChange: null,
  winProbabilitySource: null,
  objectives: [],
  availability: {},
} as unknown as FightListRecord;

describe("fightsInLens", () => {
  it("sorts engagements chronologically", () => {
    const result = fightsInLens([
      fight("30", 80, [{ playerSlot: 0, teamId: 2, kills: 1, deaths: 0, assists: 0 }]),
      fight("10", 20, [{ playerSlot: 128, teamId: 3, kills: 0, deaths: 1, assists: 0 }]),
      fight("20", 50, [{ playerSlot: 1, teamId: 2, kills: 0, deaths: 0, assists: 1 }]),
    ], lens({ kind: "all" }, 0, 100));

    expect(result.map((item) => item.fightId)).toEqual(["10", "20", "30"]);
  });

  it("includes a player only for a kill, assist, or death role", () => {
    const active = fight("10", 20, [
      { playerSlot: 0, teamId: 2, kills: 0, deaths: 0, assists: 1 },
      { playerSlot: 1, teamId: 2, kills: 0, deaths: 0, assists: 0 },
    ]);

    expect(fightsInLens([active], lens({ kind: "player", playerSlot: 0, teamId: 2 }, 0, 100))).toHaveLength(1);
    expect(fightsInLens([active], lens({ kind: "player", playerSlot: 1, teamId: 2 }, 0, 100))).toHaveLength(0);
  });

  it("includes a team role and uses any anchor death for the time lens", () => {
    const record = {
      ...fight("10", 20, [{ playerSlot: 128, teamId: 3, kills: 1, deaths: 0, assists: 0 }]),
      anchorTimesSeconds: [20, 36],
    };

    expect(fightsInLens([record], lens({ kind: "team", teamId: 3 }, 35, 35))).toHaveLength(0);
    expect(fightsInLens([record], lens({ kind: "team", teamId: 3 }, 36, 36))).toHaveLength(1);
    expect(fightsInLens([record], lens({ kind: "team", teamId: 2 }, 0, 100))).toHaveLength(0);
  });
});

function fight(
  fightId: string,
  firstAnchorTimeSeconds: number,
  participants: Array<Pick<FightListRecord["participants"][number], "playerSlot" | "teamId" | "kills" | "deaths" | "assists">>,
): FightListRecord {
  return {
    ...baseFight,
    fightId,
    firstAnchorTimeSeconds,
    anchorTimesSeconds: [firstAnchorTimeSeconds],
    participants: participants.map((participant) => ({ ...participant, heroId: null })),
  };
}

function lens(scope: MatchLens["scope"], startSeconds: number, endSeconds: number): MatchLens {
  return { scope, startSeconds, endSeconds, durationSeconds: 100 };
}
