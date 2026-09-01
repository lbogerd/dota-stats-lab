import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, MapPin, Swords } from "lucide-react";
import type { MatchOverviewPlayer } from "../server/overview.js";
import { heroAsset } from "./dota-assets.js";
import { FightPlaybackMap } from "./fight-playback-map.js";
import { fightDetailQuery } from "./fights-data.js";
import type { FightDetail as FightDetailRecord } from "./fights-data.js";
import {
  FightError,
  FightState,
  fightTypeLabel,
  formatDuration,
  formatFightTime,
  formatLocation,
  formatMetric,
  formatSignedMetric,
  HeroChip,
} from "./fights-list.js";
import { teamName } from "./overview-data.js";

export function FightDetail({ matchId, fightId, players, radiantTeamName, direTeamName }: {
  matchId: string;
  fightId: string;
  players: MatchOverviewPlayer[];
  radiantTeamName: string | null;
  direTeamName: string | null;
}) {
  const query = useQuery(fightDetailQuery(matchId, fightId));
  const names = {
    2: teamName(2, radiantTeamName),
    3: teamName(3, direTeamName),
  } as const;

  return <section className="min-w-0">
    <Link
      to="/matches/$matchId/fights"
      params={{ matchId }}
      search={(previous) => previous}
      className="mb-4 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-[#405047]"
    >
      <ArrowLeft size={16} aria-hidden="true" /> Back to filtered fights
    </Link>
    {query.isPending && <FightState>Loading engagement detail…</FightState>}
    {query.isError && <FightError error={query.error} retry={() => void query.refetch()} />}
    {query.isSuccess && query.data.fight === null && <FightState testId="fight-not-found">
      <strong className="block text-[#263a30]">Engagement not found.</strong>
      <span className="mt-1 block">It is not part of this match’s latest successful extraction.</span>
    </FightState>}
    {query.isSuccess && query.data.fight !== null && <FightDetailContent
      fight={query.data.fight}
      players={players}
      teamNames={names}
    />}
  </section>;
}

function FightDetailContent({ fight, players, teamNames }: {
  fight: FightDetailRecord;
  players: MatchOverviewPlayer[];
  teamNames: Record<2 | 3, string>;
}) {
  const playersBySlot = new Map(players.map((player) => [player.playerSlot, player]));
  const radiant = fight.teams.find((team) => team.teamId === 2);
  const dire = fight.teams.find((team) => team.teamId === 3);

  return <div className="space-y-5" data-testid="fight-detail">
    <header className="card p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.09em] text-[#315f4a]">Estimated engagement</p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            <Swords size={21} aria-hidden="true" /> {fightTypeLabel(fight.type)} at {formatFightTime(fight.firstAnchorTimeSeconds)}
          </h2>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-[#526158]">
            <MapPin size={14} aria-hidden="true" /> {formatLocation(fight.location)} · {formatDuration(fight.durationSeconds)}
          </p>
        </div>
        <span className="rounded-lg bg-[#eef0e9] px-2.5 py-1 font-mono text-xs font-semibold text-[#526158]">
          {fight.detectionVersion}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {([2, 3] as const).map((teamId) => {
          const result = teamId === 2 ? radiant : dire;
          return <div key={teamId} className="rounded-xl border border-[#d8ddd5] bg-white p-4">
            <p className="text-sm font-semibold text-[#526158]">{teamNames[teamId]}</p>
            <p className="mt-1 font-mono text-xl font-semibold">{result?.kills ?? 0} kills · {result?.deaths ?? 0} deaths</p>
          </div>;
        })}
      </div>
      <p className="mt-4 text-sm leading-6 text-[#526158]">
        This detector estimates death-based engagements from replay combat data; it can omit or group combat imperfectly.
      </p>
    </header>

    {!fight.availability.combat && <FightState warning testId="fight-combat-unavailable">
      Some combat result data is unavailable for this extraction. Available death and outcome data is still shown below.
    </FightState>}

    {fight.positionState === "available" && fight.mapBounds !== null && <FightPlaybackMap fight={fight} mapBounds={fight.mapBounds} />}
    {fight.positionState === "available" && fight.mapBounds === null && <PositionState testId="fight-positions-empty">
      The position interval has no local map area, so an engagement map cannot be shown.
    </PositionState>}
    {fight.positionState === "unavailable" && <PositionState testId="fight-positions-unavailable">
      Position data is unavailable. Re-extract this replay with the current parser to enable the engagement map.
    </PositionState>}
    {fight.positionState === "empty" && <PositionState testId="fight-positions-empty">
      The position interval is empty. No recorded hero positions are available during this engagement.
    </PositionState>}

    <TeamResults fight={fight} teamNames={teamNames} />
    <ParticipantResults fight={fight} playersBySlot={playersBySlot} teamNames={teamNames} />
    <Deaths fight={fight} playersBySlot={playersBySlot} />
    <Objectives fight={fight} teamNames={teamNames} />
  </div>;
}

function PositionState({ testId, children }: { testId: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[#e1c784] bg-[#fff8e4] p-5" data-testid={testId} aria-labelledby={`${testId}-title`}>
    <p className="eyebrow">Engagement playback</p>
    <h3 id={`${testId}-title`} className="mt-1 text-lg font-semibold">Map unavailable</h3>
    <p className="mt-2 text-sm leading-6 text-[#614d1c]">{children}</p>
  </section>;
}

function TeamResults({ fight, teamNames }: {
  fight: FightDetailRecord;
  teamNames: Record<2 | 3, string>;
}) {
  return <DetailSection eyebrow="Result summary" title="Team totals">
    <div className="grid gap-4 md:grid-cols-2">
      {fight.teams.map((team) => <article key={team.teamId} className="rounded-xl border border-[#d8ddd5] bg-white p-4">
        <h4 className="font-semibold">{teamNames[team.teamId]}</h4>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <Metric label="Kills / deaths" value={`${team.kills} / ${team.deaths}`} />
          <Metric label="Hero damage" value={formatMetric(team.heroDamage)} />
          <Metric label="Hero healing" value={formatMetric(team.heroHealing)} />
          <Metric label="Earned gold" value={formatSignedMetric(team.earnedGoldChange)} />
          <Metric label="Experience" value={formatSignedMetric(team.experienceChange)} />
          <Metric label="Net worth estimate" value={formatSignedMetric(team.netWorthChange)} />
        </dl>
      </article>)}
    </div>
    <div className="mt-4 rounded-xl bg-[#eef0e9] p-4 text-sm">
      <p className="font-semibold">Radiant win-probability change</p>
      <p className="mt-1 font-mono">{formatProbability(fight.radiantWinProbabilityChange)}</p>
      <p className="mt-1 text-xs text-[#526158]">Source: {fight.winProbabilitySource === null ? "Unavailable" : sourceLabel(fight.winProbabilitySource)}</p>
    </div>
  </DetailSection>;
}

function ParticipantResults({ fight, playersBySlot, teamNames }: {
  fight: FightDetailRecord;
  playersBySlot: Map<number, MatchOverviewPlayer>;
  teamNames: Record<2 | 3, string>;
}) {
  return <DetailSection eyebrow="Active participants" title="Participant results">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {fight.playerResults.map((result) => {
        const rosterPlayer = playersBySlot.get(result.playerSlot);
        const asset = heroAsset(result.heroId);
        return <article key={result.playerSlot} className="min-w-0 rounded-xl border border-[#d8ddd5] bg-white p-4">
          <div className="flex min-w-0 items-center gap-3">
            <HeroChip
              heroId={result.heroId}
              label={rosterPlayer?.playerName || asset.name}
              teamId={result.teamId}
            />
            <span className="text-xs font-semibold text-[#526158]">{teamNames[result.teamId]}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Metric label="Damage dealt" value={formatMetric(result.damageDealt)} />
            <Metric label="Damage taken" value={formatMetric(result.damageTaken)} />
            <Metric label="Healing" value={formatMetric(result.healing)} />
            <Metric label="Earned gold" value={formatSignedMetric(result.earnedGoldChange)} />
            <Metric label="Experience" value={formatSignedMetric(result.experienceChange)} />
          </dl>
        </article>;
      })}
    </div>
  </DetailSection>;
}

function Deaths({ fight, playersBySlot }: {
  fight: FightDetailRecord;
  playersBySlot: Map<number, MatchOverviewPlayer>;
}) {
  const playerLabel = (slot: number | null) => {
    if (slot === null) return "Unknown hero";
    const player = playersBySlot.get(slot);
    return player?.playerName?.trim() || heroAsset(player?.heroId ?? null).name;
  };
  return <DetailSection eyebrow="Anchor deaths" title="Deaths">
    <ol className="grid gap-3 md:grid-cols-2">
      {fight.anchorDeaths.map((death) => <li key={death.sequence} className="rounded-xl border border-[#d8ddd5] bg-white p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono font-semibold">{formatFightTime(death.gameTimeSeconds)}</span>
          <span className="text-xs text-[#526158]">Sequence {death.sequence}</span>
        </div>
        <p className="mt-3"><strong>{playerLabel(death.killerSlot)}</strong> killed <strong>{playerLabel(death.victimSlot)}</strong></p>
        <p className="mt-1 text-xs leading-5 text-[#526158]">
          Assists: {death.assistSlots.length === 0 ? "None" : death.assistSlots.map(playerLabel).join(", ")}
        </p>
      </li>)}
    </ol>
  </DetailSection>;
}

function Objectives({ fight, teamNames }: {
  fight: FightDetailRecord;
  teamNames: Record<2 | 3, string>;
}) {
  return <DetailSection eyebrow="Outcome interval" title="Objectives">
    {fight.objectives.length === 0
      ? <p className="rounded-xl bg-[#eef0e9] p-4 text-sm text-[#526158]">No tower, barracks, Roshan, or Tormentor objective was recorded.</p>
      : <ol className="grid gap-3 md:grid-cols-2">
        {fight.objectives.map((objective) => <li key={objective.sequence} className="rounded-xl border border-[#d8ddd5] bg-white p-4 text-sm">
          <p className="font-semibold">{objective.label}</p>
          <p className="mt-1 text-xs text-[#526158]">
            {formatFightTime(objective.gameTimeSeconds)} · {objective.teamId === null ? "Team unavailable" : teamNames[objective.teamId]}
          </p>
        </li>)}
      </ol>}
  </DetailSection>;
}

function DetailSection({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  const id = `fight-${title.toLowerCase().replaceAll(" ", "-")}`;
  return <section className="card min-w-0 p-5 sm:p-6" aria-labelledby={id}>
    <p className="eyebrow">{eyebrow}</p>
    <h3 id={id} className="mt-1 mb-4 text-lg font-semibold">{title}</h3>
    {children}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0">
    <dt className="text-xs font-semibold text-[#526158]">{label}</dt>
    <dd className="mt-1 break-words font-mono text-xs font-semibold">{value}</dd>
  </div>;
}

function formatProbability(value: number | null): string {
  if (value === null) return "Unavailable";
  const points = Math.abs(value) <= 1 ? value * 100 : value;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} percentage points`;
}

function sourceLabel(source: NonNullable<FightDetailRecord["winProbabilitySource"]>): string {
  return source === "graph_history" ? "Replay graph history" : "Spectator updates";
}
