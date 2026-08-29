import { useMemo } from "react";
import {
  StackedDamageIntervalChart,
  type StackedDamageChartInterval,
} from "./stacked-damage-interval-chart";

/** The subset of a server damage interval that the chart needs. */
export interface DamageBySourceChartInterval {
  startSeconds: number;
  endSeconds: number;
  totalDamage: number;
  sources: readonly {
    rawName: string;
    label: string;
    damage: number;
  }[];
}

export function DamageBySourceChart({ intervals, selectedStartSeconds, onSelectInterval }: {
  intervals: readonly DamageBySourceChartInterval[];
  selectedStartSeconds?: number;
  onSelectInterval?: (startSeconds: number) => void;
}) {
  const chartIntervals = useMemo<readonly StackedDamageChartInterval[]>(() => intervals.map((interval) => ({
    startSeconds: interval.startSeconds,
    endSeconds: interval.endSeconds,
    totalDamage: interval.totalDamage,
    groups: interval.sources.map((source) => ({
      id: source.rawName,
      label: source.label,
      damage: source.damage,
    })),
  })), [intervals]);

  return <StackedDamageIntervalChart
    intervals={chartIntervals}
    selectedStartSeconds={selectedStartSeconds}
    onSelectInterval={onSelectInterval}
    ariaLabel="Damage taken by source, interactive stacked bar chart"
    descriptionLead="Stacked combat-log damage"
    legendAriaLabel="Damage source series"
    className="dota-damage-by-source-chart"
    markId="damage-by-source"
  />;
}
