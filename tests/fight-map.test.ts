import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveFightMapView,
  DOTA_MAP_WORLD_BOUNDS,
  pointInBounds,
} from "../src/server/fight-map.js";

test("the default world bounds match the calibrated Dota map asset", () => {
  assert.deepEqual(DOTA_MAP_WORLD_BOUNDS, {
    minimumX: -8_288,
    maximumX: 8_288,
    minimumY: -8_288,
    maximumY: 8_288,
  });
});

test("a remote point does not pull the robust center away from the main combat", () => {
  const view = deriveFightMapView([
    { x: -100, y: 0 },
    { x: 0, y: 100 },
    { x: 100, y: -100 },
    { x: 8_000, y: 8_000 },
  ]);
  assert.deepEqual(view?.center, { x: 0, y: 0 });
  assert.equal(view?.bounds.minimumX, -1_200);
  assert.equal(view?.bounds.maximumX, 1_200);
});

test("a small combat uses the minimum view width and height", () => {
  const view = deriveFightMapView([{ x: 0, y: 0 }, { x: 100, y: 100 }]);
  assert.equal((view?.bounds.maximumX ?? 0) - (view?.bounds.minimumX ?? 0), 2_400);
  assert.equal((view?.bounds.maximumY ?? 0) - (view?.bounds.minimumY ?? 0), 2_400);
});

test("a larger local combat receives 800 units of padding", () => {
  const view = deriveFightMapView([{ x: -1_000, y: -500 }, { x: 2_000, y: 1_000 }]);
  assert.equal(view?.bounds.minimumX, -1_800);
  assert.equal(view?.bounds.maximumX, 2_800);
  assert.equal(view?.bounds.minimumY, -1_300);
  assert.equal(view?.bounds.maximumY, 1_800);
});

test("view dimensions use their maximums for a very spread local cluster", () => {
  const view = deriveFightMapView([
    { x: -3_000, y: 0 },
    { x: 0, y: 0 },
    { x: 3_000, y: 0 },
  ]);
  assert.equal((view?.bounds.maximumX ?? 0) - (view?.bounds.minimumX ?? 0), 6_500);
});

test("a view is shifted inside the full world map bounds", () => {
  const view = deriveFightMapView([{ x: 8_200, y: 8_200 }]);
  assert.equal(view?.bounds.maximumX, 8_288);
  assert.equal(view?.bounds.maximumY, 8_288);
  assert.equal(view?.bounds.minimumX, 5_888);
  assert.equal(view?.bounds.minimumY, 5_888);
});

test("invalid points are omitted and no valid points means no view", () => {
  assert.equal(deriveFightMapView([{ x: Number.NaN, y: 0 }]), null);
});

test("bounds inclusion is exact at every edge", () => {
  const bounds = { minimumX: -10, maximumX: 10, minimumY: -20, maximumY: 20 };
  assert.equal(pointInBounds({ x: -10, y: 20 }, bounds), true);
  assert.equal(pointInBounds({ x: 10.001, y: 0 }, bounds), false);
});

test("invalid world bounds are rejected", () => {
  assert.throws(() => deriveFightMapView([{ x: 0, y: 0 }], {
    minimumX: 1, maximumX: 1, minimumY: -1, maximumY: 1,
  }), /finite and increasing/);
});
