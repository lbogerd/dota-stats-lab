export const selectionGroups = ["priority", "control", "fill"] as const;

export type SelectionGroup = typeof selectionGroups[number];

export type MatchCandidate = {
  matchId: string;
  startTime: number;
  windowStart: string;
  duration?: number;
  lobbyType: number;
  gameMode?: number;
  avgRankTier?: number;
  numRankTier?: number;
  cluster?: number;
  source: string;
};

export type MatchSelection = MatchCandidate & {
  selectionGroup: SelectionGroup;
  selectionHash: string;
  samplingVersion: string;
};

export type WindowSummary = {
  windowStart: string;
  candidateCount: number;
  knownRankCount: number;
  selectedCount: number;
  target: number;
  underTarget: boolean;
};

