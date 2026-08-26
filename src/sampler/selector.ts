import { createHash } from "node:crypto";
import type { MatchCandidate, MatchSelection } from "./types.js";

export type SelectionOptions = {
  target: number;
  priority: number;
  control: number;
  samplingVersion: string;
  windowStart: string;
};

export function selectMatches(candidates: readonly MatchCandidate[], options: SelectionOptions): MatchSelection[] {
  validateOptions(options);
  const unique = new Map<string, MatchCandidate>();
  for (const candidate of candidates) {
    if (candidate.windowStart !== options.windowStart) continue;
    unique.set(candidate.matchId, candidate);
  }
  const remaining = new Map(unique);
  const selected: MatchSelection[] = [];

  const ranked = [...remaining.values()]
    .filter((candidate) => candidate.avgRankTier !== undefined)
    .sort((left, right) => (right.avgRankTier! - left.avgRankTier!)
      || stableHash("priority", options, left.matchId).localeCompare(stableHash("priority", options, right.matchId)));
  take(ranked, options.priority, "priority", remaining, selected, options);

  const control = [...remaining.values()]
    .sort((left, right) => stableHash("control", options, left.matchId).localeCompare(stableHash("control", options, right.matchId)));
  take(control, options.control, "control", remaining, selected, options);

  const fill = [...remaining.values()]
    .sort((left, right) => stableHash("fill", options, left.matchId).localeCompare(stableHash("fill", options, right.matchId)));
  take(fill, options.target - selected.length, "fill", remaining, selected, options);
  return selected;
}

function take(
  source: readonly MatchCandidate[],
  count: number,
  selectionGroup: MatchSelection["selectionGroup"],
  remaining: Map<string, MatchCandidate>,
  selected: MatchSelection[],
  options: SelectionOptions,
): void {
  for (const candidate of source) {
    if (count <= 0 || selected.length >= options.target) break;
    if (!remaining.delete(candidate.matchId)) continue;
    selected.push({
      ...candidate,
      selectionGroup,
      selectionHash: stableHash(selectionGroup, options, candidate.matchId),
      samplingVersion: options.samplingVersion,
    });
    count -= 1;
  }
}

function stableHash(namespace: string, options: SelectionOptions, matchId: string): string {
  return createHash("sha256")
    .update(`${options.samplingVersion}\0${namespace}\0${options.windowStart}\0${matchId}`)
    .digest("hex");
}

function validateOptions(options: SelectionOptions): void {
  for (const [name, value] of Object.entries({ target: options.target, priority: options.priority, control: options.control })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  }
  if (options.priority + options.control > options.target) throw new Error("priority plus control cannot exceed target");
  if (!Number.isFinite(Date.parse(options.windowStart))) throw new Error("windowStart must be an ISO timestamp");
  if (options.samplingVersion.length === 0) throw new Error("samplingVersion cannot be empty");
}

