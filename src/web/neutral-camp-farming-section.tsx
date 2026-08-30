import { useQuery } from "@tanstack/react-query";
import type { NeutralCampFarmingAction } from "../server/neutral-camp-farming.js";
import type { MatchOverviewPlayer } from "../server/overview.js";
import { heroAsset } from "./dota-assets.js";
import { matchNeutralCampFarmingQuery } from "./overview-data.js";

export function NeutralCampFarmingSection({ matchId, players }: {
  matchId: string;
  players: MatchOverviewPlayer[];
}) {
  const query = useQuery(matchNeutralCampFarmingQuery(matchId));
  const playersBySlot = new Map(players.map((player) => [player.playerSlot, player]));

  return <section
    className="card mt-6 min-w-0 overflow-hidden p-5 sm:p-6"
    aria-labelledby="neutral-camp-farming-title"
  >
    <div>
      <p className="eyebrow">Derived replay action</p>
      <h2 id="neutral-camp-farming-title" className="mt-1 text-lg font-semibold">
        Neutral camp farming
      </h2>
      <p className="mt-1 text-sm text-[#526158]">
        Direct hero damage grouped into player sessions at replay-local camps.
      </p>
    </div>

    {query.isPending && <ActionStatus>Loading neutral camp farming actions…</ActionStatus>}
    {query.isError && <div
      className="mt-5 rounded-xl border border-[#e1b8ad] bg-[#fff0ec] p-5 text-sm text-[#74362d]"
      role="alert"
    >
      <p className="font-semibold">Neutral camp farming actions could not be loaded.</p>
      <p className="mt-1">
        {query.error instanceof Error ? query.error.message : "An unknown error occurred."}
      </p>
      <button
        type="button"
        onClick={() => void query.refetch()}
        className="mt-3 min-h-10 rounded-lg bg-[#74362d] px-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#74362d]"
      >
        Try again
      </button>
    </div>}
    {query.isSuccess && !query.data.available && <ActionStatus
      warning
      testId="neutral-camp-farming-unavailable"
    >
      Neutral camp farming is unavailable for this extraction. Re-extract the replay with the
      current parser to enable it.
    </ActionStatus>}
    {query.isSuccess && query.data.available && query.data.actions.length === 0 && <ActionStatus
      testId="neutral-camp-farming-empty"
    >
      This extraction has no neutral camp farming actions.
    </ActionStatus>}
    {query.isSuccess && query.data.available && query.data.actions.length > 0 && <div
      className="mt-5"
      data-testid="neutral-camp-farming-ready"
    >
      <p className="mb-3 text-xs text-[#526158]">
        {query.data.actions.length.toLocaleString("en")} farming {query.data.actions.length === 1 ? "action" : "actions"}
      </p>
      <div
        className="overflow-x-auto rounded-xl border border-[#d8ddd5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#315f4a]"
        tabIndex={0}
        aria-label="Neutral camp farming actions, scroll horizontally for all values"
      >
        <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
          <caption className="sr-only">Neutral camp farming actions</caption>
          <thead className="bg-[#eef0e9] text-xs font-bold uppercase tracking-[0.07em] text-[#405047]">
            <tr>
              <th scope="col" className="px-4 py-3">Player</th>
              <th scope="col" className="px-4 py-3">Start time</th>
              <th scope="col" className="px-4 py-3">End time</th>
              <th scope="col" className="px-4 py-3">Duration</th>
              <th scope="col" className="px-4 py-3">Camp number</th>
              <th scope="col" className="px-4 py-3">Camp type value</th>
              <th scope="col" className="px-4 py-3">Result</th>
              <th scope="col" className="px-4 py-3">Damage</th>
              <th scope="col" className="px-4 py-3">Creep count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#dde1d9]">
            {query.data.actions.map((action) => <ActionRow
              key={action.actionIndex}
              action={action}
              player={playersBySlot.get(action.playerSlot)}
            />)}
          </tbody>
        </table>
      </div>
    </div>}
  </section>;
}

function ActionRow({ action, player }: {
  action: NeutralCampFarmingAction;
  player: MatchOverviewPlayer | undefined;
}) {
  return <tr className="hover:bg-white">
    <th scope="row" className="px-4 py-3 font-normal">
      <span className="block font-semibold text-[#263a30]">{playerName(player, action.playerSlot)}</span>
      <span className="mt-0.5 block text-xs text-[#526158]">
        {player === undefined ? `Player slot ${action.playerSlot}` : heroAsset(player.heroId).name}
      </span>
    </th>
    <ActionCell value={formatActionTime(action.startGameTimeMilliseconds)} />
    <ActionCell value={formatActionTime(action.endGameTimeMilliseconds)} />
    <ActionCell value={formatActionDuration(
      action.endGameTimeMilliseconds - action.startGameTimeMilliseconds,
    )} />
    <ActionCell value={String(action.campId)} />
    <ActionCell value={String(action.campType)} />
    <td className="whitespace-nowrap px-4 py-3">
      <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
        action.result === "cleared"
          ? "bg-[#e4eadf] text-[#315f4a]"
          : "bg-[#eef0e9] text-[#526158]"
      }`}>
        {action.result === "cleared" ? "Cleared" : "Not cleared"}
      </span>
    </td>
    <ActionCell value={action.totalDamage.toLocaleString("en")} />
    <ActionCell value={`${action.deadInitialCreepCount} / ${action.initialCreepCount}`} />
  </tr>;
}

function ActionCell({ value }: { value: string }) {
  return <td className="whitespace-nowrap px-4 py-3 font-mono text-[#405047]">{value}</td>;
}

function ActionStatus({ warning = false, testId, children }: {
  warning?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return <div
    className={`mt-5 rounded-xl border p-5 text-sm leading-6 ${
      warning
        ? "border-[#e1c784] bg-[#fff8e4] text-[#614d1c]"
        : "border-[#d8ddd5] bg-[#eef0e9] text-[#405047]"
    }`}
    data-testid={testId}
    role="status"
  >
    {children}
  </div>;
}

function playerName(player: MatchOverviewPlayer | undefined, playerSlot: number): string {
  if (player === undefined) return `Unknown player ${playerSlot}`;
  const anonymousIndex = (player.teamSlot ?? player.playerSlot) + 1;
  return player.playerName?.trim() || `Anonymous player ${anonymousIndex}`;
}

export function formatActionTime(milliseconds: number): string {
  const sign = milliseconds < 0 ? "-" : "";
  const absolute = Math.abs(milliseconds);
  const minutes = Math.floor(absolute / 60_000);
  const seconds = Math.floor(absolute / 1_000) % 60;
  const remainder = absolute % 1_000;
  return `${sign}${minutes}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

export function formatActionDuration(milliseconds: number): string {
  return formatActionTime(Math.max(0, milliseconds));
}
