import { getHeroDisplayData } from "../lib/dota-heroes.js";
import itemCatalog from "./dota-items.generated.json";

export interface DotaAsset {
  name: string;
  imageUrl: string | null;
}

// Valve's public Steam CDN uses these stable dota_react asset paths. The ID
// maps are intentionally local so rendering an ingested match never depends on
// a second metadata request. Unknown IDs keep a text fallback instead of
// producing a broken image URL.
const CDN_ROOT = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react";

const ITEMS = new Map(itemCatalog.items.map((item) => [item.id, item]));

export function heroAsset(heroId: number | null): DotaAsset {
  const hero = getHeroDisplayData(heroId);
  if (hero === null) {
    return { name: heroId === null ? "Unknown hero" : `Hero #${heroId}`, imageUrl: null };
  }
  return { name: hero.name, imageUrl: `${CDN_ROOT}/heroes/${hero.slug}.png` };
}

export function itemAsset(itemId: number | null): DotaAsset {
  const item = itemId === null ? undefined : ITEMS.get(itemId);
  if (item === undefined) {
    return { name: itemId === null ? "Unknown item" : `Item #${itemId}`, imageUrl: null };
  }
  return { name: item.name, imageUrl: `${CDN_ROOT}/items/${item.imageSlug}.png` };
}
