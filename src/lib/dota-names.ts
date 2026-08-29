import { getHeroCombatLogName, getHeroDisplayData } from "./dota-heroes.js";

const HERO_LABELS = new Map<string, string>();
for (let heroId = 1; heroId <= 255; heroId++) {
  const combatLogName = getHeroCombatLogName(heroId);
  const display = getHeroDisplayData(heroId);
  if (combatLogName !== null && display !== null) HERO_LABELS.set(combatLogName, display.name);
}

export function formatDotaName(rawName: string): string {
  const heroLabel = HERO_LABELS.get(rawName);
  if (heroLabel !== undefined) return heroLabel;
  const withoutPrefix = rawName.replace(/^(?:npc_dota_hero_|npc_dota_|dota_|item_)/, "");
  return withoutPrefix
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ") || rawName;
}
