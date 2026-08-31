import { useEffect, useState } from "react";
import type { MatchOverviewPlayer } from "../server/overview.js";
import { DamageBySourcePanel } from "./damage-by-source-section.js";
import { DamageDoneByTargetPanel } from "./damage-done-by-target-section.js";
import { heroAsset } from "./dota-assets.js";
import type { MatchLens } from "./match-lens.js";
import { playersInLens } from "./match-lens.js";

type CombatMode = "taken" | "dealt";

export function CombatAnalysis({ matchId, players, lens }: {
  matchId: string;
  players: MatchOverviewPlayer[];
  lens: MatchLens;
}) {
  const availablePlayers = playersInLens(players, lens);
  const forcedPlayerSlot = lens.scope.kind === "player" ? lens.scope.playerSlot : null;
  const [mode, setMode] = useState<CombatMode>("taken");
  const [selectedPlayerSlot, setSelectedPlayerSlot] = useState<number | null>(
    forcedPlayerSlot ?? availablePlayers[0]?.playerSlot ?? null,
  );

  useEffect(() => {
    if (forcedPlayerSlot !== null) {
      setSelectedPlayerSlot(forcedPlayerSlot);
      return;
    }
    if (!availablePlayers.some((player) => player.playerSlot === selectedPlayerSlot)) {
      setSelectedPlayerSlot(availablePlayers[0]?.playerSlot ?? null);
    }
  }, [availablePlayers, forcedPlayerSlot, selectedPlayerSlot]);

  return <section className="card min-w-0 overflow-hidden p-5 sm:p-6" aria-labelledby="combat-analysis-title">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="eyebrow">Combat timeline</p>
        <h2 id="combat-analysis-title" className="mt-1 text-lg font-semibold">Hero damage</h2>
        <p className="mt-1 text-sm text-[#526158]">Inspect exact combat-log events within the selected match lens.</p>
      </div>
      {availablePlayers.length > 0 && <label className="block shrink-0 text-sm font-semibold text-[#405047]">
        Hero
        <select
          aria-label="Combat hero"
          value={selectedPlayerSlot ?? ""}
          disabled={forcedPlayerSlot !== null}
          onChange={(event) => setSelectedPlayerSlot(Number(event.target.value))}
          className="mt-1 h-11 w-full rounded-xl border border-[#cdd3ca] bg-white px-3 text-[#263a30] disabled:bg-[#eef0e9] lg:w-auto"
        >
          {availablePlayers.map((player) => <option key={player.playerSlot} value={player.playerSlot}>{playerOptionLabel(player)}</option>)}
        </select>
      </label>}
    </div>

    <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Combat damage direction">
      <ModeButton active={mode === "taken"} onClick={() => setMode("taken")}>Damage taken</ModeButton>
      <ModeButton active={mode === "dealt"} onClick={() => setMode("dealt")}>Damage dealt</ModeButton>
    </div>

    {selectedPlayerSlot === null && <div className="mt-5 rounded-xl border border-[#e1c784] bg-[#fff8e4] p-5 text-sm leading-6 text-[#614d1c]" role="status">
      No roster player is available inside the selected scope.
    </div>}
    {selectedPlayerSlot !== null && mode === "taken" && <DamageBySourcePanel
      key={`taken-${selectedPlayerSlot}`}
      matchId={matchId}
      selectedPlayerSlot={selectedPlayerSlot}
      lens={lens}
    />}
    {selectedPlayerSlot !== null && mode === "dealt" && <DamageDoneByTargetPanel
      key={`dealt-${selectedPlayerSlot}`}
      matchId={matchId}
      selectedPlayerSlot={selectedPlayerSlot}
      lens={lens}
    />}
  </section>;
}

function ModeButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={`min-h-10 rounded-xl px-3.5 py-2 text-sm font-semibold ${active ? "bg-[#315f4a] text-white" : "bg-[#eef0e9] text-[#405047]"}`}
  >{children}</button>;
}

function playerOptionLabel(player: MatchOverviewPlayer): string {
  const anonymousIndex = (player.teamSlot ?? player.playerSlot) + 1;
  const playerName = player.playerName?.trim() || `Anonymous player ${anonymousIndex}`;
  return `${playerName} · ${heroAsset(player.heroId).name} · ${player.team}`;
}
