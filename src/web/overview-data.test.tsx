import { describe, expect, it } from "vitest";
import { heroAsset, itemAsset } from "./dota-assets";
import {
  displayValue,
  formatInteger,
  gameModeLabel,
  formatMatchDate,
  formatMatchDuration,
  lobbyTypeLabel,
  teamName,
  overviewQueryKeys,
} from "./overview-data";

describe("match overview presentation", () => {
  it("uses explicit Unknown labels instead of inventing missing values", () => {
    expect(displayValue(null)).toBe("Unknown");
    expect(formatMatchDuration(null)).toBe("Unknown");
    expect(formatInteger(null)).toBe("Unknown");
    expect(lobbyTypeLabel(null)).toBe("Unknown");
  });

  it("formats match durations without losing hour information", () => {
    expect(formatMatchDuration(1_925)).toBe("32:05");
    expect(formatMatchDuration(3_725)).toBe("1:02:05");
  });

  it("can label an absolute replay time in UTC", () => {
    const formatted = formatMatchDate("2026-08-24T14:05:00Z", "UTC");
    expect(formatted).toContain("Aug 24, 2026");
    expect(formatted).toContain("2:05 PM");
    expect(formatted).toContain("UTC");
  });

  it("names known lobby types and preserves an unknown numeric value", () => {
    expect(lobbyTypeLabel(2)).toBe("Tournament");
    expect(lobbyTypeLabel(null, "DOTA_LOBBY_TYPE_TOURNAMENT")).toBe("Tournament");
    expect(lobbyTypeLabel(99)).toBe("Unknown (99)");
    expect(gameModeLabel("DOTA_GAMEMODE_ALL_DRAFT")).toBe("All Draft");
  });

  it("uses configured team names with stable side fallbacks", () => {
    expect(teamName(2, "Team Spirit")).toBe("Team Spirit");
    expect(teamName(3, null)).toBe("Dire");
  });
});

describe("rolling GPM query keys", () => {
  it("change with the match, window, and output step", () => {
    expect(overviewQueryKeys.gpm("42", 60, 1)).toEqual(["match-rolling-gpm", "42", 60, 1]);
    expect(overviewQueryKeys.gpm("42", 10, 1)).not.toEqual(overviewQueryKeys.gpm("42", 60, 1));
    expect(overviewQueryKeys.gpm("42", 60, 5)).not.toEqual(overviewQueryKeys.gpm("42", 60, 1));
    expect(overviewQueryKeys.gpm("43", 60, 1)).not.toEqual(overviewQueryKeys.gpm("42", 60, 1));
  });
});

describe("Dota image metadata", () => {
  it("maps known heroes and items to Valve Steam CDN paths", () => {
    expect(heroAsset(2)).toEqual({
      name: "Axe",
      imageUrl: "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/axe.png",
    });
    expect(itemAsset(116)).toEqual({
      name: "Black King Bar",
      imageUrl: "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/black_king_bar.png",
    });
  });

  it("keeps fallback text for newly introduced IDs", () => {
    expect(heroAsset(9_999)).toEqual({ name: "Hero #9999", imageUrl: null });
    expect(itemAsset(9_999)).toEqual({ name: "Item #9999", imageUrl: null });
  });
});
