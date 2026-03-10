/** Sprite drawing primitives. */
import { Canvas } from './types.js';
import { Rng } from './rng.js';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clampChannel(v: number): number {
  return clamp(v, 0, 255);
}

/** Ellipse alpha profile shared by stamp and batch. */
function ellipseAlpha(
  dist: number,
  innerFraction: number,
  outerFraction: number,
  effectiveFalloff: number,
  edgeLimit: number,
  opacity: number,
): number {
  if (dist <= innerFraction) {
    return opacity;
  }
  if (dist > edgeLimit) {
    return 0;
  }
  const fr = Math.max((dist - innerFraction) / outerFraction, 0);
  const alpha = clamp(1 - Math.pow(fr, effectiveFalloff), 0, 1);
  return alpha * opacity;
}

/** Alpha-over composite one pixel. */
function compositeOver(
  data: Uint8ClampedArray,
  i: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
): void {
  // Fast path: empty destination (common when painting onto fresh canvas).
  if (data[i + 3] === 0) {
    data[i]     = clamp(sr + 0.5, 0, 255);
    data[i + 1] = clamp(sg + 0.5, 0, 255);
    data[i + 2] = clamp(sb + 0.5, 0, 255);
    data[i + 3] = clamp(sa * 255 + 0.5, 0, 255);
    return;
  }

  const da = data[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;

  const invSrc = 1 - sa;
  const invOut = 1 / outA;
  data[i]     = clamp((sr * sa + data[i]     * da * invSrc) * invOut + 0.5, 0, 255);
  data[i + 1] = clamp((sg * sa + data[i + 1] * da * invSrc) * invOut + 0.5, 0, 255);
  data[i + 2] = clamp((sb * sa + data[i + 2] * da * invSrc) * invOut + 0.5, 0, 255);
  data[i + 3] = clamp(outA * 255 + 0.5, 0, 255);
}

/**
 * Compute rim mask: pixels with alpha > 128 that have a cardinal neighbor
 * at alpha == 0 (or canvas border).
 */
function computeRimMask(canvas: Canvas): Uint8Array {
  const { width: w, height: h, data } = canvas;
  const rim = new Uint8Array(h * w);

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = (row * w + col) * 4;
      if (data[i + 3] <= 128) continue;

      const hasTransparent =
        (row === 0     || data[((row - 1) * w + col) * 4 + 3] === 0) ||
        (row === h - 1 || data[((row + 1) * w + col) * 4 + 3] === 0) ||
        (col === 0     || data[(row * w + col - 1) * 4 + 3] === 0) ||
        (col === w - 1 || data[(row * w + col + 1) * 4 + 3] === 0);

      if (hasTransparent) {
        rim[row * w + col] = 1;
      }
    }
  }

  return rim;
}

/** Derived ellipse profile parameters from raw hardness/falloff/alpha. */
interface EllipseProfile {
  innerFraction: number;
  outerFraction: number;
  effectiveFalloff: number;
  opacity: number;
}

function computeEllipseProfile(alpha: number, falloff: number, hardness: number): EllipseProfile {
  const hc = clamp(hardness, 0, 1);
  const innerFraction = 0.3 + 0.55 * hc;
  return {
    innerFraction,
    outerFraction: Math.max(1e-6, 1 - innerFraction),
    effectiveFalloff: falloff + 2.5 * hc,
    opacity: alpha / 255,
  };
}

/** Clamped bounding box for an ellipse on a canvas. */
function ellipseBounds(
  cx: number, cy: number, rx: number, ry: number, w: number, h: number,
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const rxCeil = Math.ceil(rx) + 1;
  const ryCeil = Math.ceil(ry) + 1;
  return {
    xMin: clamp(Math.floor(cx - rxCeil), 0, w - 1),
    xMax: clamp(Math.floor(cx + rxCeil), 0, w - 1),
    yMin: clamp(Math.floor(cy - ryCeil), 0, h - 1),
    yMax: clamp(Math.floor(cy + ryCeil), 0, h - 1),
  };
}

// ----------------------------------------------------------------
// Ellipse stamping
// ----------------------------------------------------------------

export interface EllipseSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * Stamp a single ellipse with alpha-over blending.
 * Alpha is 0-255. Falloff and hardness control the edge profile.
 */
export function stampEllipse(
  canvas: Canvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
  falloff: number,
  hardness: number,
): void {
  if (rx <= 0 || ry <= 0) return;

  const { innerFraction, outerFraction, effectiveFalloff: ef, opacity } =
    computeEllipseProfile(alpha, falloff, hardness);
  const edgeLimit = 1.0 + 0.5 / Math.max(rx, ry);
  const { xMin, xMax, yMin, yMax } = ellipseBounds(cx, cy, rx, ry, canvas.width, canvas.height);

  const data = canvas.data;
  const w = canvas.width;

  for (let row = yMin; row <= yMax; row++) {
    for (let col = xMin; col <= xMax; col++) {
      const ddx = (col - cx) / rx;
      const ddy = (row - cy) / ry;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);

      const sa = ellipseAlpha(dist, innerFraction, outerFraction, ef, edgeLimit, opacity);
      if (sa <= 0) continue;

      compositeOver(data, (row * w + col) * 4, r, g, b, sa);
    }
  }
}

/**
 * Batch stamp ellipses with screen-blend alpha accumulation.
 * Order-independent compositing: each ellipse contributes
 * remaining[px] *= (1 - alpha_i). Final alpha = 1 - remaining.
 */
export function batchStampEllipses(
  canvas: Canvas,
  ellipses: EllipseSpec[],
  r: number,
  g: number,
  b: number,
  alpha: number,
  falloff: number,
  hardness: number,
): void {
  if (ellipses.length === 0) return;

  const { innerFraction, outerFraction, effectiveFalloff: ef, opacity } =
    computeEllipseProfile(alpha, falloff, hardness);

  // Pre-compute per-ellipse bounds and union bounding box.
  const w = canvas.width;
  const h = canvas.height;
  let uY0 = h, uY1 = -1, uX0 = w, uX1 = -1;

  const valid: {
    e: EllipseSpec;
    xMin: number; xMax: number; yMin: number; yMax: number;
    edgeLimit: number;
  }[] = [];

  for (const e of ellipses) {
    if (e.rx <= 0 || e.ry <= 0) continue;
    const bounds = ellipseBounds(e.cx, e.cy, e.rx, e.ry, w, h);
    valid.push({ e, ...bounds, edgeLimit: 1.0 + 0.5 / Math.max(e.rx, e.ry) });
    if (bounds.yMin < uY0) uY0 = bounds.yMin;
    if (bounds.yMax > uY1) uY1 = bounds.yMax;
    if (bounds.xMin < uX0) uX0 = bounds.xMin;
    if (bounds.xMax > uX1) uX1 = bounds.xMax;
  }

  if (uY0 > uY1 || uX0 > uX1) return;

  const nCols = uX1 - uX0 + 1;
  const nRows = uY1 - uY0 + 1;
  const remaining = new Float32Array(nRows * nCols);
  remaining.fill(1.0);

  // Accumulate: remaining *= (1 - alpha_i * opacity) per ellipse.
  for (const { e, xMin, xMax, yMin, yMax, edgeLimit } of valid) {
    for (let row = yMin; row <= yMax; row++) {
      for (let col = xMin; col <= xMax; col++) {
        const ddx = (col - e.cx) / e.rx;
        const ddy = (row - e.cy) / e.ry;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);

        const a = ellipseAlpha(dist, innerFraction, outerFraction, ef, edgeLimit, 1.0);
        if (a <= 0) continue;

        const idx = (row - uY0) * nCols + (col - uX0);
        remaining[idx] *= (1 - a * opacity);
      }
    }
  }

  // Composite accumulated alpha (fused inversion: sa = 1 - remaining).
  const data = canvas.data;
  for (let row = uY0; row <= uY1; row++) {
    for (let col = uX0; col <= uX1; col++) {
      const sa = 1 - remaining[(row - uY0) * nCols + (col - uX0)];
      if (sa <= 0) continue;

      compositeOver(data, (row * w + col) * 4, r, g, b, sa);
    }
  }
}

// ----------------------------------------------------------------
// Rim operations
// ----------------------------------------------------------------

/**
 * Darken rim pixels by subtracting (dr, dg, db), clamped to 0.
 * Rim = alpha > 128 with a cardinal neighbor at alpha == 0.
 */
export function darkenRim(
  canvas: Canvas,
  dr: number,
  dg: number,
  db: number,
): void {
  const rim = computeRimMask(canvas);
  const { width: w, height: h, data } = canvas;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!rim[row * w + col]) continue;
      const i = (row * w + col) * 4;
      data[i]     = clamp(data[i]     - dr, 0, 255);
      data[i + 1] = clamp(data[i + 1] - dg, 0, 255);
      data[i + 2] = clamp(data[i + 2] - db, 0, 255);
    }
  }
}

// ----------------------------------------------------------------
// Nibbling
// ----------------------------------------------------------------

/**
 * Canopy nibbling: remove random rim pixels, then carve inward.
 * Phase 1: remove rim pixels with probability nibbleProb.
 * Phase 2: from each removed pixel, step toward center and clear
 *          interior pixels with probability interiorProb.
 */
export function nibbleCanopy(
  canvas: Canvas,
  rng: Rng,
  cx: number,
  cy: number,
  radius: number,
  nibbleProb: number,
  interiorProb: number,
): void {
  const rim = computeRimMask(canvas);
  const { width: w, height: h, data } = canvas;

  // Restrict to canopy region (elliptical envelope).
  const safeRadius = Math.max(radius, 1e-6);
  let hasRim = false;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!rim[row * w + col]) continue;
      const dx = (col - cx) / safeRadius;
      const dy = (row - cy) / (safeRadius * 0.9);
      if (dx * dx + dy * dy > 1.6) {
        rim[row * w + col] = 0;
      } else {
        hasRim = true;
      }
    }
  }

  if (!hasRim) return;

  const np = clamp(nibbleProb, 0, 1);
  const ip = clamp(interiorProb, 0, 1);

  // Phase 1: erase random rim pixels.
  let anyNibbled = false;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!rim[row * w + col]) continue;
      if (rng.nextFloat() < np) {
        data[(row * w + col) * 4 + 3] = 0;
        rim[row * w + col] = 2;  // Mark for interior pass.
        anyNibbled = true;
      }
    }
  }

  // Phase 2: from nibbled pixels, step toward center and clear interior.
  if (anyNibbled && ip > 0) {
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (rim[row * w + col] !== 2) continue;
        if (rng.nextFloat() >= ip) continue;

        // Step toward center.
        let stepX = 0, stepY = 0;
        const fdx = cx - col;
        const fdy = cy - row;
        if (fdx > 0) stepX = 1;
        else if (fdx < 0) stepX = -1;
        if (fdy > 0) stepY = 1;
        else if (fdy < 0) stepY = -1;

        const innerX = clamp(col + stepX, 0, w - 1);
        const innerY = clamp(row + stepY, 0, h - 1);

        if (data[(innerY * w + innerX) * 4 + 3] > 128) {
          data[(innerY * w + innerX) * 4 + 3] = 0;
        }
      }
    }
  }
}

/**
 * Boulder nibbling: remove random edge pixels from the upper half only.
 * Bottom edge stays solid (ground contact).
 */
export function nibbleBoulder(
  canvas: Canvas,
  rng: Rng,
  nibbleProb: number,
): void {
  const rim = computeRimMask(canvas);
  const { width: w, height: h, data } = canvas;

  // Find opaque region vertical extent.
  let firstOpaqueRow = h, lastOpaqueRow = -1;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (data[(row * w + col) * 4 + 3] > 0) {
        if (row < firstOpaqueRow) firstOpaqueRow = row;
        if (row > lastOpaqueRow) lastOpaqueRow = row;
      }
    }
  }

  if (firstOpaqueRow > lastOpaqueRow) return;
  const midpoint = (firstOpaqueRow + lastOpaqueRow) >> 1;

  // Only nibble upper half: zero out rim below midpoint.
  for (let row = midpoint; row < h; row++) {
    for (let col = 0; col < w; col++) {
      rim[row * w + col] = 0;
    }
  }

  const np = clamp(nibbleProb, 0, 1);

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!rim[row * w + col]) continue;
      if (rng.nextFloat() < np) {
        data[(row * w + col) * 4 + 3] = 0;
      }
    }
  }
}

// ----------------------------------------------------------------
// Line and triangle
// ----------------------------------------------------------------

/**
 * Bresenham thick line. For each point on the line, stamps a filled
 * square of the given thickness centered on the point.
 */
export function drawLine(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  a: number,
  thickness: number,
): void {
  const { width: w, height: h, data } = canvas;
  const half = Math.floor(thickness / 2);

  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  let cx = x0, cy = y0;
  for (;;) {
    // Stamp a square centered on (cx, cy).
    const py0 = Math.max(0, cy - half);
    const py1 = Math.min(h - 1, cy - half + thickness - 1);
    const px0 = Math.max(0, cx - half);
    const px1 = Math.min(w - 1, cx - half + thickness - 1);

    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const i = (py * w + px) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
      }
    }

    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
  }
}

/**
 * Scanline triangle fill.
 */
export function fillTriangle(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const { width: w, height: h, data } = canvas;

  // Sort vertices by y (ascending).
  let vx0 = x0, vy0 = y0, vx1 = x1, vy1 = y1, vx2 = x2, vy2 = y2;
  if (vy0 > vy1) { [vx0, vx1] = [vx1, vx0]; [vy0, vy1] = [vy1, vy0]; }
  if (vy0 > vy2) { [vx0, vx2] = [vx2, vx0]; [vy0, vy2] = [vy2, vy0]; }
  if (vy1 > vy2) { [vx1, vx2] = [vx2, vx1]; [vy1, vy2] = [vy2, vy1]; }

  const scanline = (yStart: number, yEnd: number,
                     xa: number, ya: number, xb: number, yb: number,
                     xc: number, yc: number, xd: number, yd: number) => {
    for (let y = yStart; y <= yEnd; y++) {
      if (y < 0 || y >= h) continue;

      const dyAB = yb - ya;
      const dyCD = yd - yc;
      const tAB = dyAB === 0 ? 0 : (y - ya) / dyAB;
      const tCD = dyCD === 0 ? 0 : (y - yc) / dyCD;
      let left  = xa + tAB * (xb - xa);
      let right = xc + tCD * (xd - xc);

      if (left > right) { const tmp = left; left = right; right = tmp; }

      const xStart = Math.max(0, Math.ceil(left));
      const xEnd   = Math.min(w - 1, Math.floor(right));

      for (let x = xStart; x <= xEnd; x++) {
        const i = (y * w + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
      }
    }
  };

  // Upper half: vy0 to vy1.
  if (vy1 > vy0) {
    scanline(Math.ceil(vy0), Math.floor(vy1),
             vx0, vy0, vx1, vy1,
             vx0, vy0, vx2, vy2);
  }

  // Lower half: vy1 to vy2.
  if (vy2 > vy1) {
    scanline(Math.ceil(vy1), Math.floor(vy2),
             vx1, vy1, vx2, vy2,
             vx0, vy0, vx2, vy2);
  }
}
