/** Shared composition utilities for sprite generators. */
import { batchStampEllipses, clamp, clampChannel, type EllipseSpec } from './primitives.js';
import { Rng } from './rng.js';
import { Canvas, type Color, type Palette3, type RGBA } from './types.js';

export type Point = { x: number; y: number };

// ----------------------------------------------------------------
// Random selection
// ----------------------------------------------------------------

/** Pick N unique indices from [0, length) via partial Fisher-Yates shuffle. */
export function sampleUniqueIndices(rng: Rng, length: number, count: number): number[] {
  if (length <= 0 || count <= 0) return [];
  const capped = Math.min(length, count);
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = 0; i < capped; i++) {
    const j = rng.nextInt(i, length - 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, capped);
}

// ----------------------------------------------------------------
// Color utilities
// ----------------------------------------------------------------

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.nextInt(0, items.length - 1)];
}

export function jitterColor(
  rng: Rng,
  base: Color,
  delta: number,
  min: Color = [0, 0, 0],
  max: Color = [255, 255, 255],
): Color {
  return [
    clamp(base[0] + rng.nextInt(-delta, delta), min[0], max[0]),
    clamp(base[1] + rng.nextInt(-delta, delta), min[1], max[1]),
    clamp(base[2] + rng.nextInt(-delta, delta), min[2], max[2]),
  ];
}

export function shiftColor(base: Color, dr: number, dg: number, db: number): Color {
  return [
    clampChannel(base[0] + dr),
    clampChannel(base[1] + dg),
    clampChannel(base[2] + db),
  ];
}

export function asRgba(color: Color, alpha: number): RGBA {
  return [color[0], color[1], color[2], alpha];
}

export function lightenRgba(rgba: RGBA, amount: number): RGBA {
  return [
    clampChannel(rgba[0] + amount),
    clampChannel(rgba[1] + amount),
    clampChannel(rgba[2] + amount),
    rgba[3],
  ];
}

// ----------------------------------------------------------------
// Lobe distribution
// ----------------------------------------------------------------

/**
 * Distribute lobe centers in a ring around (cx, cy).
 *
 * verticalBias: [belowScale, aboveScale] compresses vertical
 * distance for lobes below/above center (canvas Y-down).
 */
export function distributeLobes(
  rng: Rng,
  cx: number,
  cy: number,
  count: number,
  radius: number,
  distRange: [number, number],
  angleJitter = 0.4,
  verticalBias: [number, number] = [0.9, 0.7],
): Point[] {
  const angleStep = (Math.PI * 2) / count;
  const angleOffset = rng.nextRange(-Math.PI, Math.PI);
  const points: Point[] = [];

  for (let i = 0; i < count; i++) {
    const angle = angleOffset + angleStep * i + rng.nextRange(-angleJitter, angleJitter);
    const dist = radius * rng.nextRange(distRange[0], distRange[1]);
    const sinAngle = Math.sin(angle);
    const vScale = sinAngle > 0 ? verticalBias[0] : verticalBias[1];
    points.push({
      x: cx + Math.cos(angle) * dist,
      y: cy + sinAngle * dist * vScale,
    });
  }

  return points;
}

// ----------------------------------------------------------------
// Three-tone shading
// ----------------------------------------------------------------

/**
 * Stamp shadow / body / highlight ellipse layers using a Palette3.
 * Default parameters are tuned for stone surfaces.
 */
export function stampThreeTone(
  canvas: Canvas,
  pal: Palette3,
  shadowEllipses: EllipseSpec[],
  bodyEllipses: EllipseSpec[],
  highlightEllipses: EllipseSpec[],
  falloff: [number, number, number] = [2.2, 2.0, 1.9],
  hardness: [number, number, number] = [0.88, 0.86, 0.80],
  alpha: [number, number, number] = [220, 250, 210],
): void {
  const layers = [shadowEllipses, bodyEllipses, highlightEllipses];
  for (let i = 0; i < 3; i++) {
    const c = pal[i];
    batchStampEllipses(canvas, layers[i], c[0], c[1], c[2], alpha[i], falloff[i], hardness[i]);
  }
}
