import { describe, expect, it } from "vitest";
import { itemAsset } from "./dota-assets";

const ITEM_CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items";

describe("generated Dota item assets", () => {
  it.each([
    [11, "Quelling Blade", "quelling_blade"],
    [22, "Blade of Alacrity", "blade_of_alacrity"],
    [1584, "Alert", "enhancement_alert"],
    [1638, "Dormant Curio", "dormant_curio"],
    [4204, "Healing Lotus", "famango"],
  ])("maps item ID %i to its local catalog record", (id, name, imageSlug) => {
    expect(itemAsset(id)).toEqual({
      name,
      imageUrl: `${ITEM_CDN}/${imageSlug}.png`,
    });
  });

  it("keeps the text fallback for an unknown ID", () => {
    expect(itemAsset(9_999)).toEqual({ name: "Item #9999", imageUrl: null });
    expect(itemAsset(null)).toEqual({ name: "Unknown item", imageUrl: null });
  });
});
