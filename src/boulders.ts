/** Procedural boulder sprite generation. */
import {
  batchStampEllipses,
  clamp,
  clampChannel,
  darkenRim,
  drawLine,
  nibbleBoulder,
  stampEllipse,
  type EllipseSpec,
} from './primitives.js';
import { Rng } from './rng.js';
import { Canvas, type Color, type Palette3, type RGBA } from './types.js';

// ----------------------------------------------------------------
// Archetype
// ----------------------------------------------------------------

export enum BoulderArchetype {
  ROUNDED = 'rounded',
  TALL = 'tall',
  FLAT = 'flat',
  BLOCKY = 'blocky',
}

/** Pick archetype from raw seed hash. 35% rounded, 20% tall, 25% flat, 20% blocky. */
function archetypeFromSeed(seed: number): BoulderArchetype {
  const r = (seed >>> 0) % 20;
  if (r < 7) return BoulderArchetype.ROUNDED;
  if (r < 11) return BoulderArchetype.TALL;
  if (r < 16) return BoulderArchetype.FLAT;
  return BoulderArchetype.BLOCKY;
}

// ----------------------------------------------------------------
// Color palettes
// ----------------------------------------------------------------

const BOULDER_BASE_PALETTES: Color[] = [
  // Warm stone
  [152, 132, 112],
  [140, 120, 100],
  [130, 114, 94],
  // Cool stone
  [120, 128, 140],
  [110, 120, 134],
  [128, 130, 138],
  // Neutral grays
  [136, 137, 141],
  [124, 126, 130],
  [114, 116, 120],
  // Dark earthy tones
  [108, 114, 104],
  [122, 116, 108],
];

function pickStoneColors(rng: Rng): Palette3 {
  const base = BOULDER_BASE_PALETTES[rng.nextInt(0, BOULDER_BASE_PALETTES.length - 1)];
  const baseRgb = [base[0], base[1], base[2]];

  const brightnessOffset = rng.nextInt(-18, 18);
  const tempOffset = rng.nextInt(-8, 8);

  baseRgb[0] = clamp(baseRgb[0] + brightnessOffset - tempOffset, 70, 190);
  baseRgb[1] = clamp(baseRgb[1] + brightnessOffset, 70, 190);
  baseRgb[2] = clamp(baseRgb[2] + brightnessOffset + tempOffset, 70, 195);

  const shadow: Color = [
    clampChannel(baseRgb[0] - 36),
    clampChannel(baseRgb[1] - 36),
    clampChannel(baseRgb[2] - 34),
  ];
  const body: Color = [baseRgb[0], baseRgb[1], baseRgb[2]];
  const highlight: Color = [
    clampChannel(baseRgb[0] + 36),
    clampChannel(baseRgb[1] + 36),
    clampChannel(baseRgb[2] + 38),
  ];

  return [shadow, body, highlight];
}

// ----------------------------------------------------------------
// Surface details
// ----------------------------------------------------------------

const LICHEN_PALETTE: RGBA[] = [
  [55, 72, 42, 140],
  [62, 78, 48, 130],
  [48, 65, 38, 120],
  [70, 80, 50, 110],
];

function addSurfaceCracks(
  canvas: Canvas,
  rng: Rng,
  cx: number,
  cy: number,
  baseRx: number,
  baseRy: number,
  shadowRgb: Color,
): void {
  if (rng.nextFloat() > 0.60) return;

  const crackR = clampChannel(shadowRgb[0] - 20);
  const crackG = clampChannel(shadowRgb[1] - 20);
  const crackB = clampChannel(shadowRgb[2] - 18);
  const crackA = 190;

  const nCracks = rng.nextInt(1, 3);
  for (let i = 0; i < nCracks; i++) {
    const angle = rng.nextRange(-Math.PI, Math.PI * 0.3);
    const startR = rng.nextRange(0.55, 0.85);
    const sx = cx + Math.cos(angle) * baseRx * startR;
    const sy = cy + Math.sin(angle) * baseRy * startR;

    const crackAngle = angle + Math.PI + rng.nextRange(-0.6, 0.6);
    const crackLen = rng.nextRange(1.5, 3.5);
    const ex = sx + Math.cos(crackAngle) * crackLen;
    const ey = sy + Math.sin(crackAngle) * crackLen;

    drawLine(
      canvas,
      Math.round(sx), Math.round(sy),
      Math.round(ex), Math.round(ey),
      crackR, crackG, crackB, crackA, 1,
    );
  }
}

function addLichenSpots(
  canvas: Canvas,
  rng: Rng,
  cx: number,
  cy: number,
  baseRx: number,
  baseRy: number,
): void {
  if (rng.nextFloat() > 0.50) return;

  const nSpots = rng.nextInt(2, 4);
  for (let i = 0; i < nSpots; i++) {
    const spotAngle = rng.nextRange(-Math.PI * 0.8, Math.PI * 0.4);
    const spotDist = rng.nextRange(0.25, 0.70);
    const mx = cx + Math.cos(spotAngle) * baseRx * spotDist;
    const my = cy + Math.sin(spotAngle) * baseRy * spotDist;

    const spotRadius = rng.nextRange(0.7, 1.5);
    const lichen = LICHEN_PALETTE[rng.nextInt(0, LICHEN_PALETTE.length - 1)];
    stampEllipse(
      canvas, mx, my, spotRadius, spotRadius,
      lichen[0], lichen[1], lichen[2], lichen[3],
      1.4, 0.15,
    );
  }
}

function addSurfaceDetail(
  canvas: Canvas,
  rng: Rng,
  cx: number,
  cy: number,
  baseRx: number,
  baseRy: number,
  shadowRgb: Color,
): void {
  addSurfaceCracks(canvas, rng, cx, cy, baseRx, baseRy, shadowRgb);
  addLichenSpots(canvas, rng, cx, cy, baseRx, baseRy);
}

// ----------------------------------------------------------------
// Three-tone stone layer stamping
// ----------------------------------------------------------------

function stampStoneLayers(
  canvas: Canvas,
  pal: Palette3,
  shadowEllipses: EllipseSpec[],
  bodyEllipses: EllipseSpec[],
  highlightEllipses: EllipseSpec[],
  falloff: [number, number, number] = [2.2, 2.0, 1.9],
  hardness: [number, number, number] = [0.88, 0.86, 0.80],
): void {
  const passes: [EllipseSpec[], number, number, number, number][] = [
    [shadowEllipses, 0, 220, falloff[0], hardness[0]],
    [bodyEllipses, 1, 250, falloff[1], hardness[1]],
    [highlightEllipses, 2, 210, falloff[2], hardness[2]],
  ];

  for (const [ellipses, tone, alpha, fo, hard] of passes) {
    const c = pal[tone];
    batchStampEllipses(canvas, ellipses, c[0], c[1], c[2], alpha, fo, hard);
  }
}

// ----------------------------------------------------------------
// Archetype generators
// ----------------------------------------------------------------

function generateRounded(canvas: Canvas, size: number, rng: Rng): void {
  const pal = pickStoneColors(rng);

  const cx = size * 0.5 + rng.nextRange(-0.3, 0.3);
  const cy = size * 0.72 + rng.nextRange(-0.08, 0.14);
  const baseRx = size * rng.nextRange(0.28, 0.34);
  const baseRy = size * rng.nextRange(0.20, 0.26);
  const lobeCount = rng.nextInt(2, 3);

  const bodyEllipses: EllipseSpec[] = [];
  const shadowEllipses: EllipseSpec[] = [];
  const highlightEllipses: EllipseSpec[] = [];

  // Core shape: main body + narrower crown.
  bodyEllipses.push({ cx, cy, rx: baseRx, ry: baseRy });
  bodyEllipses.push({
    cx: cx + rng.nextRange(-0.5, 0.5),
    cy: cy - size * 0.08,
    rx: baseRx * 0.72,
    ry: baseRy * 0.56,
  });
  shadowEllipses.push({
    cx, cy: cy + size * 0.04,
    rx: baseRx * 1.06, ry: baseRy * 1.10,
  });
  highlightEllipses.push({
    cx: cx - size * 0.05, cy: cy - size * 0.10,
    rx: baseRx * 0.52, ry: baseRy * 0.24,
  });

  // Asymmetric side lobes extending sideways and downward.
  const angleStep = 2.0 * Math.PI / lobeCount;
  const offset = rng.nextRange(0.0, Math.PI);
  for (let i = 0; i < lobeCount; i++) {
    const angle = offset + i * angleStep + rng.nextRange(-0.45, 0.45);
    const radialX = baseRx * rng.nextRange(0.20, 0.42);
    const radialY = baseRy * rng.nextRange(0.10, 0.30);
    const ox = Math.cos(angle) * radialX;
    const oy = Math.max(0.0, Math.sin(angle) * radialY);

    const rx = baseRx * rng.nextRange(0.70, 1.0);
    const ry = baseRy * rng.nextRange(0.48, 0.68);

    bodyEllipses.push({ cx: cx + ox, cy: cy + oy, rx, ry });
    shadowEllipses.push({
      cx: cx + ox * 0.76, cy: cy + oy * 0.68 + size * 0.03,
      rx: rx * 1.06, ry: ry * 1.08,
    });
    highlightEllipses.push({
      cx: cx + ox * 0.36 - size * 0.03, cy: cy + oy * 0.30 - size * 0.07,
      rx: rx * 0.30, ry: ry * 0.20,
    });
  }

  stampStoneLayers(canvas, pal, shadowEllipses, bodyEllipses, highlightEllipses);
  addSurfaceDetail(canvas, rng, cx, cy, baseRx, baseRy, pal[0]);
  nibbleBoulder(canvas, rng, 0.10);
  darkenRim(canvas, 18, 18, 15);
}

function generateTall(canvas: Canvas, size: number, rng: Rng): void {
  const pal = pickStoneColors(rng);

  const cx = size * 0.5 + rng.nextRange(-0.3, 0.3);
  const cy = size * 0.70 + rng.nextRange(-0.06, 0.10);
  const baseRx = size * rng.nextRange(0.22, 0.28);
  const baseRy = size * rng.nextRange(0.26, 0.34);
  const lobeCount = rng.nextInt(1, 2);

  const bodyEllipses: EllipseSpec[] = [];
  const shadowEllipses: EllipseSpec[] = [];
  const highlightEllipses: EllipseSpec[] = [];

  // Wide base, main body, narrower crown.
  bodyEllipses.push({
    cx, cy: cy + size * 0.08,
    rx: baseRx * 1.30, ry: baseRy * 0.58,
  });
  bodyEllipses.push({ cx, cy, rx: baseRx, ry: baseRy });
  bodyEllipses.push({
    cx: cx + rng.nextRange(-0.5, 0.5),
    cy: cy - size * 0.12,
    rx: baseRx * 0.65, ry: baseRy * 0.48,
  });
  shadowEllipses.push({
    cx, cy: cy + size * 0.09,
    rx: baseRx * 1.36, ry: baseRy * 0.65,
  });
  highlightEllipses.push({
    cx: cx - size * 0.04, cy: cy - size * 0.14,
    rx: baseRx * 0.56, ry: baseRy * 0.22,
  });

  // Side bulges.
  const angleStep = 2.0 * Math.PI / Math.max(1, lobeCount);
  const offset = rng.nextRange(0.0, Math.PI);
  for (let i = 0; i < lobeCount; i++) {
    const angle = offset + i * angleStep + rng.nextRange(-0.4, 0.4);
    const radialX = baseRx * rng.nextRange(0.28, 0.52);
    const radialY = baseRy * rng.nextRange(0.10, 0.26);
    const ox = Math.cos(angle) * radialX;
    const oy = Math.max(0.0, Math.sin(angle) * radialY);

    const rx = baseRx * rng.nextRange(0.62, 0.90);
    const ry = baseRy * rng.nextRange(0.42, 0.62);

    bodyEllipses.push({ cx: cx + ox, cy: cy + oy, rx, ry });
    shadowEllipses.push({
      cx: cx + ox * 0.72, cy: cy + oy * 0.68 + size * 0.03,
      rx: rx * 1.06, ry: ry * 1.06,
    });
    highlightEllipses.push({
      cx: cx + ox * 0.34 - size * 0.02, cy: cy + oy * 0.28 - size * 0.08,
      rx: rx * 0.32, ry: ry * 0.20,
    });
  }

  stampStoneLayers(canvas, pal, shadowEllipses, bodyEllipses, highlightEllipses);
  addSurfaceDetail(canvas, rng, cx, cy, baseRx, baseRy, pal[0]);
  nibbleBoulder(canvas, rng, 0.10);
  darkenRim(canvas, 18, 18, 15);
}

function generateFlat(canvas: Canvas, size: number, rng: Rng): void {
  const pal = pickStoneColors(rng);

  const cx = size * 0.5 + rng.nextRange(-0.4, 0.4);
  const cy = size * 0.78 + rng.nextRange(-0.06, 0.08);
  const baseRx = size * rng.nextRange(0.36, 0.44);
  const baseRy = size * rng.nextRange(0.13, 0.18);
  const lobeCount = rng.nextInt(1, 2);

  const bodyEllipses: EllipseSpec[] = [];
  const shadowEllipses: EllipseSpec[] = [];
  const highlightEllipses: EllipseSpec[] = [];

  // Wide slab body with slight raised ridge.
  bodyEllipses.push({ cx, cy, rx: baseRx, ry: baseRy });
  bodyEllipses.push({
    cx: cx + rng.nextRange(-0.5, 0.5),
    cy: cy - size * 0.04,
    rx: baseRx * 0.80, ry: baseRy * 0.55,
  });
  shadowEllipses.push({
    cx, cy: cy + size * 0.03,
    rx: baseRx * 1.06, ry: baseRy * 1.14,
  });
  highlightEllipses.push({
    cx: cx - size * 0.04, cy: cy - size * 0.05,
    rx: baseRx * 0.58, ry: baseRy * 0.28,
  });

  // Lobes biased toward horizontal extension.
  const horizontalAngles = [0.0, Math.PI];
  const baseAngle = horizontalAngles[rng.nextInt(0, 1)] + rng.nextRange(-0.4, 0.4);
  const angleStep = 2.0 * Math.PI / Math.max(1, lobeCount);
  for (let i = 0; i < lobeCount; i++) {
    const angle = baseAngle + i * angleStep + rng.nextRange(-0.35, 0.35);
    const radialX = baseRx * rng.nextRange(0.18, 0.38);
    const radialY = baseRy * rng.nextRange(0.08, 0.22);
    const ox = Math.cos(angle) * radialX;
    const oy = Math.max(0.0, Math.sin(angle) * radialY);

    const rx = baseRx * rng.nextRange(0.65, 0.92);
    const ry = baseRy * rng.nextRange(0.44, 0.64);

    bodyEllipses.push({ cx: cx + ox, cy: cy + oy, rx, ry });
    shadowEllipses.push({
      cx: cx + ox * 0.78, cy: cy + oy * 0.68 + size * 0.02,
      rx: rx * 1.04, ry: ry * 1.08,
    });
    highlightEllipses.push({
      cx: cx + ox * 0.38 - size * 0.03, cy: cy + oy * 0.28 - size * 0.04,
      rx: rx * 0.34, ry: ry * 0.22,
    });
  }

  stampStoneLayers(canvas, pal, shadowEllipses, bodyEllipses, highlightEllipses);
  addSurfaceDetail(canvas, rng, cx, cy, baseRx, baseRy, pal[0]);
  nibbleBoulder(canvas, rng, 0.08);
  darkenRim(canvas, 18, 18, 15);
}

function generateBlocky(canvas: Canvas, size: number, rng: Rng): void {
  const pal = pickStoneColors(rng);

  const cx = size * 0.5 + rng.nextRange(-0.6, 0.6);
  const cy = size * 0.72 + rng.nextRange(-0.08, 0.12);
  const baseRx = size * rng.nextRange(0.26, 0.32);
  const baseRy = size * rng.nextRange(0.22, 0.28);
  const lobeCount = rng.nextInt(2, 3);

  const bodyEllipses: EllipseSpec[] = [];
  const shadowEllipses: EllipseSpec[] = [];
  const highlightEllipses: EllipseSpec[] = [];

  // Chunky core shape.
  bodyEllipses.push({ cx, cy, rx: baseRx, ry: baseRy });
  bodyEllipses.push({
    cx: cx - size * 0.03, cy: cy - size * 0.07,
    rx: baseRx * 0.74, ry: baseRy * 0.62,
  });
  shadowEllipses.push({
    cx, cy: cy + size * 0.04,
    rx: baseRx * 1.10, ry: baseRy * 1.10,
  });
  highlightEllipses.push({
    cx: cx - size * 0.06, cy: cy - size * 0.10,
    rx: baseRx * 0.44, ry: baseRy * 0.22,
  });

  // Lobes clustered within ~120-degree arc for asymmetric mass.
  const clusterAngle = rng.nextRange(0.0, 2.0 * Math.PI);
  for (let i = 0; i < lobeCount; i++) {
    const angle = clusterAngle + rng.nextRange(-1.05, 1.05);
    const radialX = baseRx * rng.nextRange(0.26, 0.50);
    const radialY = baseRy * rng.nextRange(0.16, 0.38);
    const ox = Math.cos(angle) * radialX;
    const oy = Math.max(0.0, Math.sin(angle) * radialY);

    const rx = baseRx * rng.nextRange(0.68, 1.02);
    const ry = baseRy * rng.nextRange(0.48, 0.70);

    bodyEllipses.push({ cx: cx + ox, cy: cy + oy, rx, ry });
    shadowEllipses.push({
      cx: cx + ox * 0.74, cy: cy + oy * 0.66 + size * 0.03,
      rx: rx * 1.08, ry: ry * 1.10,
    });
    highlightEllipses.push({
      cx: cx + ox * 0.36 - size * 0.03, cy: cy + oy * 0.30 - size * 0.07,
      rx: rx * 0.32, ry: ry * 0.22,
    });
  }

  stampStoneLayers(
    canvas, pal, shadowEllipses, bodyEllipses, highlightEllipses,
    [2.4, 2.2, 2.0],
    [0.92, 0.90, 0.84],
  );
  addSurfaceDetail(canvas, rng, cx, cy, baseRx, baseRy, pal[0]);
  nibbleBoulder(canvas, rng, 0.14);
  darkenRim(canvas, 18, 18, 15);
}

// ----------------------------------------------------------------
// Vertical repositioning
// ----------------------------------------------------------------

/** Shift content down so the last opaque row (alpha > 128) sits at canvas bottom. */
function shiftToBottom(canvas: Canvas, size: number): void {
  const { width: w, data } = canvas;
  let lastOpaqueRow = -1;

  for (let row = size - 1; row >= 0; row--) {
    for (let col = 0; col < w; col++) {
      if (data[(row * w + col) * 4 + 3] > 128) {
        lastOpaqueRow = row;
        break;
      }
    }
    if (lastOpaqueRow >= 0) break;
  }

  if (lastOpaqueRow < 0) return;

  const gap = size - 1 - lastOpaqueRow;
  if (gap <= 0) return;

  // Shift rows down by gap. Work bottom-up to avoid overwriting.
  for (let row = size - 1; row >= gap; row--) {
    const srcStart = (row - gap) * w * 4;
    const dstStart = row * w * 4;
    data.copyWithin(dstStart, srcStart, srcStart + w * 4);
  }
  // Clear the top rows.
  data.fill(0, 0, gap * w * 4);
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

export function generateBoulder(
  seed: number,
  size = 16,
): { canvas: Canvas; archetype: BoulderArchetype } {
  const archetype = archetypeFromSeed(seed);
  const rng = new Rng(seed);

  const actualSize = clamp(size + rng.nextInt(-2, 2), 12, 22);
  const canvas = new Canvas(actualSize, actualSize);

  if (archetype === BoulderArchetype.ROUNDED) {
    generateRounded(canvas, actualSize, rng);
  } else if (archetype === BoulderArchetype.TALL) {
    generateTall(canvas, actualSize, rng);
  } else if (archetype === BoulderArchetype.FLAT) {
    generateFlat(canvas, actualSize, rng);
  } else {
    generateBlocky(canvas, actualSize, rng);
  }

  shiftToBottom(canvas, actualSize);

  return { canvas, archetype };
}
