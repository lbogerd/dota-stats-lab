import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FightDetail } from "./fights-data.js";
import { heroAsset } from "./dota-assets.js";
import { formatPlaybackTime } from "./fights-list.js";
import { DOTA_MAP_WORLD_BOUNDS } from "../server/fight-map.js";

const STEP_MILLISECONDS = 100;
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;

type Bounds = NonNullable<FightDetail["mapBounds"]>;
type Position = FightDetail["frames"][number]["positions"][number];

export function FightPlaybackMap({ fight, mapBounds }: { fight: FightDetail; mapBounds: Bounds }) {
  const startMilliseconds = Math.ceil(fight.combatStartSeconds * 10) * STEP_MILLISECONDS;
  const endMilliseconds = Math.max(
    startMilliseconds,
    Math.floor(fight.combatEndSeconds * 10) * STEP_MILLISECONDS,
  );
  const [currentMilliseconds, setCurrentMilliseconds] = useState(startMilliseconds);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(1);

  useEffect(() => {
    setCurrentMilliseconds(startMilliseconds);
    setPlaying(false);
  }, [fight.fightId, startMilliseconds]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCurrentMilliseconds((current) => {
        const next = Math.min(endMilliseconds, current + STEP_MILLISECONDS);
        if (next === endMilliseconds) setPlaying(false);
        return next;
      });
    }, STEP_MILLISECONDS / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, endMilliseconds]);

  const frames = useMemo(
    () => new Map(fight.frames.map((frame) => [frame.gameTimeMilliseconds, frame.positions])),
    [fight.frames],
  );
  const positions = frames.get(currentMilliseconds) ?? [];
  const visibleDeaths = fight.deathMarkers.filter((marker) => marker.gameTimeMilliseconds <= currentMilliseconds);

  const step = (direction: -1 | 1) => {
    setPlaying(false);
    setCurrentMilliseconds((current) => clamp(
      snapToStep(current + direction * STEP_MILLISECONDS),
      startMilliseconds,
      endMilliseconds,
    ));
  };

  return <section className="rounded-2xl border border-[#d8ddd5] bg-[#fbfaf5] p-4 sm:p-5" aria-labelledby="fight-playback-title">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <p className="eyebrow">Combat interval</p>
        <h3 id="fight-playback-title" className="mt-1 text-lg font-semibold">Engagement playback</h3>
      </div>
      <output className="rounded-lg bg-[#eef0e9] px-3 py-1.5 font-mono text-sm font-semibold" aria-live="polite" role="status">
        {formatPlaybackTime(currentMilliseconds)}
      </output>
    </div>

    <div className="mt-4 overflow-hidden rounded-xl bg-[#23352c]" data-testid="fight-map">
      <FightMap
        bounds={mapBounds}
        positions={positions}
        deathMarkers={visibleDeaths}
      />
    </div>

    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Engagement playback controls">
        <ControlButton label="Play engagement" disabled={playing || currentMilliseconds >= endMilliseconds} onClick={() => setPlaying(true)}>
          <Play size={16} aria-hidden="true" /> Play
        </ControlButton>
        <ControlButton label="Pause engagement" disabled={!playing} onClick={() => setPlaying(false)}>
          <Pause size={16} aria-hidden="true" /> Pause
        </ControlButton>
        <ControlButton label="Previous 100 ms" disabled={currentMilliseconds <= startMilliseconds} onClick={() => step(-1)}>
          <SkipBack size={16} aria-hidden="true" /> <span className="hidden sm:inline">Previous</span>
        </ControlButton>
        <ControlButton label="Next 100 ms" disabled={currentMilliseconds >= endMilliseconds} onClick={() => step(1)}>
          <SkipForward size={16} aria-hidden="true" /> <span className="hidden sm:inline">Next</span>
        </ControlButton>
        <label className="ml-auto flex min-h-11 items-center gap-2 text-sm font-semibold text-[#405047]">
          Playback speed
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value) as typeof speed)}
            className="h-11 rounded-xl border border-[#cdd3ca] bg-white px-3"
          >
            {PLAYBACK_SPEEDS.map((value) => <option key={value} value={value}>{value}x</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs font-semibold text-[#526158]" htmlFor="fight-playback-scrubber">
        Engagement timeline
      </label>
      <input
        id="fight-playback-scrubber"
        aria-label="Engagement timeline"
        type="range"
        min={startMilliseconds}
        max={endMilliseconds}
        step={STEP_MILLISECONDS}
        value={currentMilliseconds}
        onChange={(event) => {
          setPlaying(false);
          setCurrentMilliseconds(clamp(snapToStep(Number(event.target.value)), startMilliseconds, endMilliseconds));
        }}
        className="h-8 w-full cursor-pointer accent-[#315f4a]"
      />
      <div className="flex justify-between font-mono text-xs text-[#526158]" aria-hidden="true">
        <span>{formatPlaybackTime(startMilliseconds)}</span>
        <span>{formatPlaybackTime(endMilliseconds)}</span>
      </div>
      <p className="text-xs leading-5 text-[#526158]">
        Hero locations are recorded samples. Missing samples are left empty; positions are not interpolated.
      </p>
    </div>
  </section>;
}

function ControlButton({ label, children, ...props }: {
  label: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button
    type="button"
    aria-label={label}
    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#d8ddd5] bg-white px-3 text-sm font-semibold text-[#334039] disabled:cursor-not-allowed disabled:opacity-45"
    {...props}
  >{children}</button>;
}

function FightMap({ bounds, positions, deathMarkers }: {
  bounds: Bounds;
  positions: Position[];
  deathMarkers: FightDetail["deathMarkers"];
}) {
  const width = bounds.maximumX - bounds.minimumX;
  const height = bounds.maximumY - bounds.minimumY;
  const markerSize = Math.max(110, Math.min(240, Math.min(width, height) * 0.075));
  const viewY = -bounds.maximumY;
  const displayBounds = {
    minimumX: bounds.minimumX,
    maximumX: bounds.maximumX,
    minimumY: viewY,
    maximumY: -bounds.minimumY,
  };

  return <svg
    viewBox={`${bounds.minimumX} ${viewY} ${width} ${height}`}
    className="block aspect-square w-full"
    role="img"
    aria-label="Engagement map with local heroes, remote participants, and death markers"
    preserveAspectRatio="xMidYMid meet"
  >
    <image
      href="/assets/dota-map.webp"
      x={DOTA_MAP_WORLD_BOUNDS.minimumX}
      y={-DOTA_MAP_WORLD_BOUNDS.maximumY}
      width={DOTA_MAP_WORLD_BOUNDS.maximumX - DOTA_MAP_WORLD_BOUNDS.minimumX}
      height={DOTA_MAP_WORLD_BOUNDS.maximumY - DOTA_MAP_WORLD_BOUNDS.minimumY}
    />
    {positions.map((position) => {
      const point = { x: position.worldX, y: -position.worldY };
      const local = pointInBounds(point, displayBounds);
      const projected = local ? point : projectToBounds(point, displayBounds, markerSize * 0.8);
      const angle = Math.atan2(point.y - projected.y, point.x - projected.x) * 180 / Math.PI;
      return local
        ? <LocalHeroMarker key={position.playerSlot} position={position} x={point.x} y={point.y} size={markerSize} />
        : <RemoteHeroMarker key={position.playerSlot} position={position} x={projected.x} y={projected.y} size={markerSize} angle={angle} />;
    })}
    {deathMarkers.filter((marker) => pointInBounds(
      { x: marker.worldX, y: -marker.worldY },
      displayBounds,
    )).map((marker) => <DeathMarker
      key={`${marker.playerSlot}-${marker.gameTimeMilliseconds}`}
      x={marker.worldX}
      y={-marker.worldY}
      size={markerSize}
      playerSlot={marker.playerSlot}
    />)}
  </svg>;
}

function LocalHeroMarker({ position, x, y, size }: {
  position: Position;
  x: number;
  y: number;
  size: number;
}) {
  const asset = heroAsset(position.heroId);
  return <g
    transform={`translate(${x} ${y})`}
    role="img"
    aria-label={`${asset.name}, ${teamLabel(position.teamId)}, local position`}
    data-testid={`local-hero-${position.playerSlot}`}
  >
    <rect x={-size / 2} y={-size / 2} width={size} height={size} rx={size * 0.2} fill="#eef0e9" stroke={teamColor(position.teamId)} strokeWidth={size * 0.14} />
    {asset.imageUrl === null
      ? <text textAnchor="middle" dominantBaseline="central" fontSize={size * 0.52} fontWeight="700">?</text>
      : <image href={asset.imageUrl} x={-size * 0.43} y={-size * 0.43} width={size * 0.86} height={size * 0.86} preserveAspectRatio="xMidYMid slice" />}
    <TeamMark teamId={position.teamId} size={size} />
  </g>;
}

function RemoteHeroMarker({ position, x, y, size, angle }: {
  position: Position;
  x: number;
  y: number;
  size: number;
  angle: number;
}) {
  const asset = heroAsset(position.heroId);
  return <g
    transform={`translate(${x} ${y})`}
    role="img"
    aria-label={`${asset.name}, ${teamLabel(position.teamId)}, remote position`}
    data-testid={`remote-hero-${position.playerSlot}`}
  >
    <path d={`M ${size * 0.52} 0 L ${size * 0.2} ${-size * 0.2} L ${size * 0.2} ${size * 0.2} Z`} fill="#fbfaf5" stroke="#263a30" strokeWidth={size * 0.06} transform={`rotate(${angle})`} />
    <circle r={size * 0.48} fill="#eef0e9" stroke={teamColor(position.teamId)} strokeWidth={size * 0.13} />
    {asset.imageUrl === null
      ? <text textAnchor="middle" dominantBaseline="central" fontSize={size * 0.48} fontWeight="700">?</text>
      : <image href={asset.imageUrl} x={-size * 0.37} y={-size * 0.37} width={size * 0.74} height={size * 0.74} preserveAspectRatio="xMidYMid slice" />}
    <TeamMark teamId={position.teamId} size={size} />
  </g>;
}

function TeamMark({ teamId, size }: { teamId: 2 | 3; size: number }) {
  return <g aria-hidden="true">
    <circle cx={size * 0.38} cy={size * 0.38} r={size * 0.2} fill={teamColor(teamId)} stroke="#fbfaf5" strokeWidth={size * 0.04} />
    <text x={size * 0.38} y={size * 0.39} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={size * 0.22} fontWeight="800">
      {teamId === 2 ? "R" : "D"}
    </text>
  </g>;
}

function DeathMarker({ x, y, size, playerSlot }: { x: number; y: number; size: number; playerSlot: number }) {
  return <g transform={`translate(${x} ${y})`} role="img" aria-label={`Death marker for player slot ${playerSlot}`} data-testid={`death-marker-${playerSlot}`}>
    <circle r={size * 0.35} fill="#361f1d" fillOpacity="0.86" stroke="#fbfaf5" strokeWidth={size * 0.05} />
    <path d={`M ${-size * 0.17} ${-size * 0.17} L ${size * 0.17} ${size * 0.17} M ${size * 0.17} ${-size * 0.17} L ${-size * 0.17} ${size * 0.17}`} stroke="#fbfaf5" strokeWidth={size * 0.09} strokeLinecap="round" />
  </g>;
}

export function projectToBounds(
  point: { x: number; y: number },
  bounds: { minimumX: number; maximumX: number; minimumY: number; maximumY: number },
  inset = 0,
): { x: number; y: number } {
  const minimumX = Math.min(bounds.maximumX, bounds.minimumX + inset);
  const maximumX = Math.max(bounds.minimumX, bounds.maximumX - inset);
  const minimumY = Math.min(bounds.maximumY, bounds.minimumY + inset);
  const maximumY = Math.max(bounds.minimumY, bounds.maximumY - inset);
  const centerX = (minimumX + maximumX) / 2;
  const centerY = (minimumY + maximumY) / 2;
  const deltaX = point.x - centerX;
  const deltaY = point.y - centerY;
  if (deltaX === 0 && deltaY === 0) return { x: centerX, y: centerY };
  const xScale = deltaX === 0 ? Number.POSITIVE_INFINITY : (deltaX > 0 ? maximumX - centerX : minimumX - centerX) / deltaX;
  const yScale = deltaY === 0 ? Number.POSITIVE_INFINITY : (deltaY > 0 ? maximumY - centerY : minimumY - centerY) / deltaY;
  const scale = Math.min(Math.abs(xScale), Math.abs(yScale));
  return { x: centerX + deltaX * scale, y: centerY + deltaY * scale };
}

function pointInBounds(point: { x: number; y: number }, bounds: {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
}): boolean {
  return point.x >= bounds.minimumX && point.x <= bounds.maximumX
    && point.y >= bounds.minimumY && point.y <= bounds.maximumY;
}

function snapToStep(milliseconds: number): number {
  return Math.round(milliseconds / STEP_MILLISECONDS) * STEP_MILLISECONDS;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function teamLabel(teamId: 2 | 3): string {
  return teamId === 2 ? "Radiant" : "Dire";
}

function teamColor(teamId: 2 | 3): string {
  return teamId === 2 ? "#2f7b58" : "#b0473c";
}
