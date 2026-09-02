import {
  FIGHT_DETECTION_THRESHOLDS,
  type FightPoint,
} from "./fight-detector.js";

export const DOTA_MAP_WORLD_BOUNDS: FightMapBounds = {
  minimumX: -8_288,
  maximumX: 8_288,
  minimumY: -8_288,
  maximumY: 8_288,
};

export interface FightMapBounds {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
}

export interface FightMapView {
  center: FightPoint;
  bounds: FightMapBounds;
}

/**
 * Builds a remote-resistant view around the densest local cluster of combat points.
 * Invalid points are discarded. The input order is used as the final deterministic tie-break.
 */
export function deriveFightMapView(
  points: readonly FightPoint[],
  worldBounds: FightMapBounds = DOTA_MAP_WORLD_BOUNDS,
): FightMapView | null {
  assertValidBounds(worldBounds);
  const validPoints = points.filter(isFinitePoint).map((point) => ({ ...point }));
  if (validPoints.length === 0) return null;

  const seed = densestClusterSeed(validPoints);
  const radiusSquared = FIGHT_DETECTION_THRESHOLDS.localMapRadiusWorldUnits ** 2;
  const localPoints = validPoints.filter((point) => squaredDistance(point, seed) <= radiusSquared);
  const center = {
    x: median(localPoints.map((point) => point.x)),
    y: median(localPoints.map((point) => point.y)),
  };
  const bounds = fitViewBounds(localPoints, center, worldBounds);
  return { center, bounds };
}

export function pointInBounds(point: FightPoint, bounds: FightMapBounds): boolean {
  return point.x >= bounds.minimumX && point.x <= bounds.maximumX
    && point.y >= bounds.minimumY && point.y <= bounds.maximumY;
}

function densestClusterSeed(points: readonly FightPoint[]): FightPoint {
  let best = points[0];
  if (best === undefined) throw new RangeError("A combat cluster needs at least one point.");
  let bestCount = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  const radiusSquared = FIGHT_DETECTION_THRESHOLDS.localMapRadiusWorldUnits ** 2;
  for (const candidate of points) {
    const localDistances = points.flatMap((point) => {
      const distance = squaredDistance(candidate, point);
      return distance <= radiusSquared ? [distance] : [];
    });
    const count = localDistances.length;
    const distance = localDistances.reduce((sum, value) => sum + value, 0);
    if (count > bestCount || (count === bestCount && distance < bestDistance)) {
      best = candidate;
      bestCount = count;
      bestDistance = distance;
    }
  }
  return best;
}

function fitViewBounds(
  points: readonly FightPoint[],
  center: FightPoint,
  worldBounds: FightMapBounds,
): FightMapBounds {
  const minimumX = Math.min(...points.map((point) => point.x));
  const maximumX = Math.max(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  const maximumY = Math.max(...points.map((point) => point.y));
  const worldWidth = worldBounds.maximumX - worldBounds.minimumX;
  const worldHeight = worldBounds.maximumY - worldBounds.minimumY;
  const width = Math.min(
    worldWidth,
    FIGHT_DETECTION_THRESHOLDS.maximumMapWidthWorldUnits,
    Math.max(
      FIGHT_DETECTION_THRESHOLDS.minimumMapWidthWorldUnits,
      maximumX - minimumX + FIGHT_DETECTION_THRESHOLDS.mapPaddingWorldUnits * 2,
    ),
  );
  const height = Math.min(
    worldHeight,
    FIGHT_DETECTION_THRESHOLDS.maximumMapHeightWorldUnits,
    Math.max(
      FIGHT_DETECTION_THRESHOLDS.minimumMapHeightWorldUnits,
      maximumY - minimumY + FIGHT_DETECTION_THRESHOLDS.mapPaddingWorldUnits * 2,
    ),
  );
  const viewMinimumX = fittedAxisStart(
    center.x,
    width,
    minimumX,
    maximumX,
    worldBounds.minimumX,
    worldBounds.maximumX,
  );
  const viewMinimumY = fittedAxisStart(
    center.y,
    height,
    minimumY,
    maximumY,
    worldBounds.minimumY,
    worldBounds.maximumY,
  );
  return {
    minimumX: viewMinimumX,
    maximumX: viewMinimumX + width,
    minimumY: viewMinimumY,
    maximumY: viewMinimumY + height,
  };
}

function fittedAxisStart(
  center: number,
  size: number,
  contentMinimum: number,
  contentMaximum: number,
  worldMinimum: number,
  worldMaximum: number,
): number {
  const centeredStart = center - size / 2;
  const padding = FIGHT_DETECTION_THRESHOLDS.mapPaddingWorldUnits;
  const lowestStartThatFits = contentMaximum + padding - size;
  const highestStartThatFits = contentMinimum - padding;
  const contentFittedStart = lowestStartThatFits <= highestStartThatFits
    ? clamp(centeredStart, lowestStartThatFits, highestStartThatFits)
    : centeredStart;
  return clamp(contentFittedStart, worldMinimum, worldMaximum - size);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle];
  if (right === undefined) throw new RangeError("A median needs at least one value.");
  if (sorted.length % 2 === 1) return right;
  const left = sorted[middle - 1];
  return left === undefined ? right : (left + right) / 2;
}

function assertValidBounds(bounds: FightMapBounds): void {
  if (![bounds.minimumX, bounds.maximumX, bounds.minimumY, bounds.maximumY]
    .every(Number.isFinite)
    || bounds.minimumX >= bounds.maximumX
    || bounds.minimumY >= bounds.maximumY) {
    throw new RangeError("Fight map world bounds must be finite and increasing.");
  }
}

function isFinitePoint(point: FightPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function squaredDistance(left: FightPoint, right: FightPoint): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
