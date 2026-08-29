import { useMemo } from "react";
import {
  StackedDamageIntervalChart,
  type StackedDamageChartInterval,
} from "./stacked-damage-interval-chart";

/** The subset of a damage-done interval that the chart needs. */
export interface DamageDoneByTargetChartInterval {
  startSeconds: number;
  endSeconds: number;
  totalDamage: number;
  targets: readonly {
    rawName: string;
    label: string;
    teamId: number | null;
    damage: number;
  }[];
}

interface TargetTotal {
  id: string;
  label: string;
  teamId: number | null;
  damage: number;
}

const MAX_NAMED_SERIES = 7;

export function DamageDoneByTargetChart({ intervals, selectedStartSeconds, onSelectInterval }: {
  intervals: readonly DamageDoneByTargetChartInterval[];
  selectedStartSeconds?: number;
  onSelectInterval?: (startSeconds: number) => void;
}) {
  const chartIntervals = useMemo<readonly StackedDamageChartInterval[]>(() => {
    const labels = visibleTargetLabels(intervals);
    return intervals.map((interval) => ({
      startSeconds: interval.startSeconds,
      endSeconds: interval.endSeconds,
      totalDamage: interval.totalDamage,
      groups: interval.targets.map((target) => {
        const id = targetId(target.rawName, target.teamId);
        return {
          id,
          label: labels.get(id) ?? target.label,
          damage: target.damage,
        };
      }),
    }));
  }, [intervals]);

  return <StackedDamageIntervalChart
    intervals={chartIntervals}
    selectedStartSeconds={selectedStartSeconds}
    onSelectInterval={onSelectInterval}
    ariaLabel="Damage done by target, interactive stacked bar chart"
    descriptionLead="Stacked combat-log damage done by target"
    legendAriaLabel="Damage target series"
    className="dota-damage-done-by-target-chart"
    markId="damage-done-by-target"
  />;
}

function visibleTargetLabels(intervals: readonly DamageDoneByTargetChartInterval[]): ReadonlyMap<string, string> {
  const totals = new Map<string, TargetTotal>();
  for (const interval of intervals) {
    for (const target of interval.targets) {
      const id = targetId(target.rawName, target.teamId);
      const current = totals.get(id);
      totals.set(id, {
        id,
        label: current?.label ?? target.label,
        teamId: target.teamId,
        damage: (current?.damage ?? 0) + target.damage,
      });
    }
  }

  const visible = [...totals.values()]
    .sort((left, right) => right.damage - left.damage
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id))
    .slice(0, MAX_NAMED_SERIES);
  const labelCounts = new Map<string, number>();
  for (const target of visible) {
    labelCounts.set(target.label, (labelCounts.get(target.label) ?? 0) + 1);
  }

  return new Map(visible.map((target) => [
    target.id,
    labelCounts.get(target.label) === 1
      ? target.label
      : `${target.label} (${teamLabel(target.teamId)})`,
  ]));
}

function targetId(rawName: string, teamId: number | null): string {
  return JSON.stringify([rawName, teamId]);
}

function teamLabel(teamId: number | null): string {
  if (teamId === 2) return "Radiant";
  if (teamId === 3) return "Dire";
  return teamId === null ? "unknown team" : `team ${teamId}`;
}
