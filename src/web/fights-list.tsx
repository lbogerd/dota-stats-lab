import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, MapPin, Swords } from "lucide-react";
import type { MatchOverviewPlayer } from "../server/overview.js";
import { heroAsset } from "./dota-assets.js";
import { fightListQuery, fightsInLens } from "./fights-data.js";
import type { FightListRecord } from "./fights-data.js";
import type { MatchLens } from "./match-lens.js";
import { teamName } from "./overview-data.js";

export function FightsList({ matchId, players, lens, radiantTeamName, direTeamName }: {
  matchId: string;
  players: MatchOverviewPlayer[];
  lens: MatchLens;
  radiantTeamName: string | null;
  direTeamName: string | null;
}) {
  const query = useQuery(fightListQuery(matchId));
  const fights = query.data === undefined ? [] : fightsInLens(query.data.fights, lens);
  const playerNames = new Map(players.map((player) => [player.playerSlot, player.playerName]));
  const names = {
    2: teamName(2, radiantTeamName),
    3: teamName(3, direTeamName),
  } as const;

  return <section className="min-w-0" aria-labelledby="fights-title">
    <div className="card p-5 sm:p-6">
      <p className="eyebrow">Death-anchored analysis</p>
      <h2 id="fights-title" className="mt-1 text-xl font-semibold">Fights</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-[#526158]">
        Estimated engagements grouped from hero deaths and nearby combat. Version one omits fights without a hero death.
      </p>
    </div>

    {query.isPending && <FightState>Loading engagements…</FightState>}
    {query.isError && <FightError error={query.error} retry={() => void query.refetch()} />}
    {query.isSuccess && !query.data.available && <FightState warning testId="fights-unavailable">
      Combat data is unavailable for this extraction. Re-extract the replay with the current parser to find engagements.
    </FightState>}
    {query.isSuccess && query.data.available && fights.length === 0 && <FightState testId="fights-empty">
      <strong className="block text-[#263a30]">No death-based engagement is inside the selected lens.</strong>
      <span className="mt-1 block">Version one does not include fights without a hero death.</span>
    </FightState>}
    {query.isSuccess && query.data.available && fights.length > 0 && <div className="mt-5 space-y-4" data-testid="fights-ready">
      <p className="text-xs font-semibold text-[#526158]">
        {fights.length.toLocaleString("en")} {fights.length === 1 ? "engagement" : "engagements"} in lens
      </p>
      <ol className="space-y-4">
        {fights.map((fight) => <li key={fight.fightId}>
          <FightCard
            fight={fight}
            matchId={matchId}
            playerNames={playerNames}
            teamNames={names}
          />
        </li>)}
      </ol>
    </div>}
  </section>;
}

function FightCard({ fight, matchId, playerNames, teamNames }: {
  fight: FightListRecord;
  matchId: string;
  playerNames: Map<number, string | null>;
  teamNames: Record<2 | 3, string>;
}) {
  const radiant = fight.teams.find((team) => team.teamId === 2);
  const dire = fight.teams.find((team) => team.teamId === 3);
  const objective = fight.objectives[0];

  return <Link
    to="/matches/$matchId/fights/$fightId"
    params={{ matchId, fightId: fight.fightId }}
    search={(previous) => previous}
    className="card group block min-w-0 overflow-hidden p-5 transition hover:border-[#9eafa3] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#315f4a] sm:p-6"
    aria-label={`${fightTypeLabel(fight.type)} at ${formatFightTime(fight.firstAnchorTimeSeconds)}`}
  >
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.09em] text-[#315f4a]">{fightTypeLabel(fight.type)}</p>
        <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold">
          <Swords size={17} aria-hidden="true" /> {formatFightTime(fight.firstAnchorTimeSeconds)}
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-[#526158]">
          <MapPin size={14} aria-hidden="true" /> {formatLocation(fight.location)} · {formatDuration(fight.durationSeconds)}
        </p>
      </div>
      <span className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[#315f4a]">
        View engagement <ArrowRight size={16} aria-hidden="true" className="transition group-hover:translate-x-0.5" />
      </span>
    </div>

    <div className="mt-5 grid gap-3 lg:grid-cols-2">
      {([2, 3] as const).map((teamId) => {
        const result = teamId === 2 ? radiant : dire;
        const participants = fight.participants.filter((participant) => participant.teamId === teamId);
        return <section key={teamId} className="rounded-xl border border-[#d8ddd5] bg-white p-4" aria-label={`${teamNames[teamId]} result`}>
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold">{teamNames[teamId]}</h4>
            <span className="font-mono text-sm font-semibold">{result?.kills ?? 0} kills · {result?.deaths ?? 0} deaths</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2" aria-label={`${teamNames[teamId]} active participants`}>
            {participants.map((participant) => <HeroChip
              key={participant.playerSlot}
              heroId={participant.heroId}
              label={playerNames.get(participant.playerSlot) || undefined}
              teamId={teamId}
            />)}
          </div>
          <p className="mt-3 text-xs text-[#526158]">
            Hero damage: <strong>{formatMetric(result?.heroDamage)}</strong>
          </p>
        </section>;
      })}
    </div>

    <div className="mt-3 rounded-xl bg-[#eef0e9] p-4 text-sm">
      <p><strong>Objective:</strong> {objective?.label ?? "None recorded in the outcome interval"}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <SecondaryMetric label="Earned gold" radiant={radiant?.earnedGoldChange} dire={dire?.earnedGoldChange} />
        <SecondaryMetric label="Experience" radiant={radiant?.experienceChange} dire={dire?.experienceChange} />
        <SecondaryMetric label="Net worth estimate" radiant={radiant?.netWorthChange} dire={dire?.netWorthChange} />
        <SecondaryMetric
          label="Radiant win probability"
          value={fight.radiantWinProbabilityChange === null ? null : formatPercentagePoints(fight.radiantWinProbabilityChange)}
        />
      </dl>
    </div>
  </Link>;
}

export function HeroChip({ heroId, label, teamId }: {
  heroId: number | null;
  label?: string;
  teamId: 2 | 3;
}) {
  const asset = heroAsset(heroId);
  return <span className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg bg-[#eef0e9] pr-2.5 text-xs font-semibold">
    {asset.imageUrl === null
      ? <span className="grid h-9 w-9 place-items-center bg-[#d8ddd5]" aria-hidden="true">?</span>
      : <img src={asset.imageUrl} alt="" className="h-9 w-9 object-cover" />}
    <span className="truncate">{label?.trim() || asset.name}</span>
    <span className="sr-only">{teamId === 2 ? "Radiant" : "Dire"}</span>
  </span>;
}

function SecondaryMetric({ label, radiant, dire, value }: {
  label: string;
  radiant?: string | null;
  dire?: string | null;
  value?: string | null;
}) {
  return <div>
    <dt className="text-xs font-semibold text-[#526158]">{label}</dt>
    <dd className="mt-1 font-mono text-xs font-semibold">
      {value !== undefined ? value ?? "Unavailable" : `${formatSignedMetric(radiant)} / ${formatSignedMetric(dire)}`}
    </dd>
  </div>;
}

export function FightState({ warning = false, testId, children }: {
  warning?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return <div
    className={`card mt-5 p-5 text-sm leading-6 ${warning ? "border-[#e1c784] bg-[#fff8e4] text-[#614d1c]" : "text-[#526158]"}`}
    data-testid={testId}
    role="status"
  >{children}</div>;
}

export function FightError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="mt-5 rounded-2xl border border-[#e1b8ad] bg-[#fff0ec] p-5 text-sm text-[#74362d]" role="alert">
    <p className="font-semibold">Engagements could not be loaded.</p>
    <p className="mt-1">{error instanceof Error ? error.message : "An unknown server error occurred."}</p>
    <button type="button" onClick={retry} className="mt-3 min-h-10 rounded-lg bg-[#74362d] px-3 font-semibold text-white">Try again</button>
  </div>;
}

export function fightTypeLabel(type: FightListRecord["type"]): string {
  return type === "team_fight" ? "Team fight" : type === "pickoff" ? "Pickoff" : "Skirmish";
}

export function formatFightTime(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = Math.floor(absolute) % 60;
  return `${sign}${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatPlaybackTime(milliseconds: number): string {
  const sign = milliseconds < 0 ? "-" : "";
  const absolute = Math.abs(milliseconds);
  const minutes = Math.floor(absolute / 60_000);
  const seconds = Math.floor(absolute / 1_000) % 60;
  const tenth = Math.floor((absolute % 1_000) / 100);
  return `${sign}${minutes}:${String(seconds).padStart(2, "0")}.${tenth}`;
}

export function formatDuration(seconds: number): string {
  return seconds < 1 ? `${Math.round(seconds * 10) / 10}s` : `${Math.round(seconds)}s`;
}

export function formatLocation(location: FightListRecord["location"]): string {
  return location === null
    ? "Location unavailable"
    : `Map ${Math.round(location.x)}, ${Math.round(location.y)}`;
}

export function formatMetric(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric).toLocaleString("en") : "Unavailable";
}

export function formatSignedMetric(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const rounded = Math.round(numeric);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("en")}`;
}

function formatPercentagePoints(value: number): string {
  const points = Math.abs(value) <= 1 ? value * 100 : value;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} pp`;
}
