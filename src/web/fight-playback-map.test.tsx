import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FightDetail } from "../server/fights.js";
import { FightPlaybackMap, projectToBounds } from "./fight-playback-map.js";

describe("FightPlaybackMap", () => {
  afterEach(() => vi.useRealTimers());

  it("steps exactly 100 ms and shows local, remote, and death markers", () => {
    const fight = detail();
    render(<FightPlaybackMap fight={fight} mapBounds={requiredBounds(fight)} />);

    expect(screen.getByRole("status").textContent).toBe("0:10.0");
    expect(screen.getByTestId("local-hero-0")).toBeTruthy();
    expect(screen.getByTestId("remote-hero-128")).toBeTruthy();
    expect(screen.queryByTestId("death-marker-0")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next 100 ms" }));
    expect(screen.getByRole("status").textContent).toBe("0:10.1");
    expect(screen.queryByTestId("local-hero-0")).toBeNull();
    expect(screen.getByTestId("death-marker-0")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous 100 ms" }));
    expect(screen.getByRole("status").textContent).toBe("0:10.0");
  });

  it("plays, pauses, scrubs, and offers every playback speed", () => {
    vi.useFakeTimers();
    const fight = detail();
    render(<FightPlaybackMap fight={fight} mapBounds={requiredBounds(fight)} />);
    const speed = screen.getByLabelText("Playback speed") as HTMLSelectElement;
    expect(Array.from(speed.options).map((option) => option.textContent)).toEqual(["0.5x", "1x", "2x", "4x"]);

    fireEvent.change(speed, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Play engagement" }));
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole("status").textContent).toBe("0:10.1");
    fireEvent.click(screen.getByRole("button", { name: "Pause engagement" }));
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("status").textContent).toBe("0:10.1");

    const scrubber = screen.getByRole("slider", { name: "Engagement timeline" }) as HTMLInputElement;
    expect(scrubber.min).toBe("10000");
    expect(scrubber.max).toBe("10300");
    expect(scrubber.step).toBe("100");
    fireEvent.change(scrubber, { target: { value: "10300" } });
    expect(screen.getByRole("status").textContent).toBe("0:10.3");
  });

  it("projects remote markers to the nearest map edge", () => {
    expect(projectToBounds(
      { x: 5_000, y: 1_000 },
      { minimumX: -1_000, maximumX: 1_000, minimumY: -1_000, maximumY: 1_000 },
    )).toEqual({ x: 1_000, y: 200 });
    expect(projectToBounds(
      { x: -5_000, y: 0 },
      { minimumX: -1_000, maximumX: 1_000, minimumY: -1_000, maximumY: 1_000 },
    )).toEqual({ x: -1_000, y: 0 });
    expect(projectToBounds(
      { x: 5_000, y: 5_000 },
      { minimumX: -1_000, maximumX: 1_000, minimumY: -1_000, maximumY: 1_000 },
    )).toEqual({ x: 1_000, y: 1_000 });
  });
});

function detail(): FightDetail {
  return {
    fightId: "10",
    combatStartSeconds: 10,
    combatEndSeconds: 10.3,
    mapBounds: { minimumX: -1_200, maximumX: 1_200, minimumY: -1_200, maximumY: 1_200 },
    frames: [
      { gameTimeMilliseconds: 10_000, positions: [position(0, 2, 2, 0, 0), position(128, 3, 3, 8_000, 0)] },
      { gameTimeMilliseconds: 10_100, positions: [position(128, 3, 3, 8_000, 0)] },
      { gameTimeMilliseconds: 10_200, positions: [position(128, 3, 3, 8_000, 0)] },
      { gameTimeMilliseconds: 10_300, positions: [position(128, 3, 3, 8_000, 0)] },
    ],
    deathMarkers: [{ playerSlot: 0, gameTimeMilliseconds: 10_100, worldX: 10, worldY: 0 }],
  } as FightDetail;
}

function position(playerSlot: number, teamId: 2 | 3, heroId: number, worldX: number, worldY: number) {
  return { playerSlot, teamId, heroId, worldX, worldY };
}

function requiredBounds(fight: FightDetail): NonNullable<FightDetail["mapBounds"]> {
  if (fight.mapBounds === null) throw new Error("Test fight map bounds are required");
  return fight.mapBounds;
}
