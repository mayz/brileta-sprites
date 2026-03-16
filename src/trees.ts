import {
  batchStampEllipses,
  clamp,
  clampChannel,
  darkenRim,
  drawLine,
  fillTriangle,
  nibbleCanopy,
  stampEllipse,
  type EllipseSpec,
} from './primitives.js';
import { Rng } from './rng.js';
import { Canvas, type Color, type RGBA } from './types.js';

export enum TreeArchetype {
  DECIDUOUS = 'deciduous',
  CONIFER = 'conifer',
  DEAD = 'dead',
  SAPLING = 'sapling',
}

type Point = { x: number; y: number };

interface TreeResult {
  canvas: Canvas;
  archetype: TreeArchetype;
}

const TRUNK_PALETTES: Color[] = [
  [90, 58, 32],
  [100, 50, 25],
  [85, 70, 55],
  [60, 40, 20],
];

const DECIDUOUS_CANOPY_BASES: Color[] = [
  [65, 145, 50],
  [55, 135, 45],
  [75, 150, 40],
  [50, 140, 55],
  [80, 150, 30],
  [90, 145, 25],
  [35, 130, 60],
  [40, 135, 55],
  [55, 120, 35],
  [110, 130, 35],
  [95, 140, 30],
];

const CONIFER_BASES: Color[] = [
  [30, 90, 30],
  [25, 85, 35],
  [35, 95, 25],
  [20, 82, 40],
  [40, 98, 22],
];

const DEAD_BASES: Color[] = [
  [80, 70, 55],
  [75, 65, 50],
  [90, 80, 65],
];

const MOSS_RGBA: RGBA = [50, 70, 40, 180];


function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.nextInt(0, items.length - 1)];
}

function jitterColor(
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

function shiftColor(base: Color, dr: number, dg: number, db: number): Color {
  return [
    clampChannel(base[0] + dr),
    clampChannel(base[1] + dg),
    clampChannel(base[2] + db),
  ];
}

function asRgba(color: Color, alpha: number): RGBA {
  return [color[0], color[1], color[2], alpha];
}

function lightenRgba(rgba: RGBA, amount: number): RGBA {
  return [
    clampChannel(rgba[0] + amount),
    clampChannel(rgba[1] + amount),
    clampChannel(rgba[2] + amount),
    rgba[3],
  ];
}

function drawSegment(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: RGBA,
  thickness = 1,
): void {
  drawLine(
    canvas,
    Math.round(x0),
    Math.round(y0),
    Math.round(x1),
    Math.round(y1),
    rgba[0],
    rgba[1],
    rgba[2],
    rgba[3],
    Math.max(1, Math.round(thickness)),
  );
}

function fillHorizontal(
  canvas: Canvas,
  y: number,
  x0: number,
  x1: number,
  rgba: RGBA,
): void {
  if (y < 0 || y >= canvas.height) return;
  const left = clamp(Math.min(x0, x1), 0, canvas.width - 1);
  const right = clamp(Math.max(x0, x1), 0, canvas.width - 1);
  for (let x = left; x <= right; x++) {
    canvas.setPixel(x, y, rgba[0], rgba[1], rgba[2], rgba[3]);
  }
}

function drawTaperedTrunk(
  canvas: Canvas,
  cx: number,
  bottomY: number,
  topY: number,
  widthBottom: number,
  widthTop: number,
  rgba: RGBA,
  rootFlare: number,
): void {
  const y0 = Math.max(0, Math.min(Math.round(topY), Math.round(bottomY)));
  const y1 = Math.min(canvas.height - 1, Math.max(Math.round(topY), Math.round(bottomY)));
  const span = Math.max(1, y1 - y0);

  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / span;
    const width = widthTop + (widthBottom - widthTop) * t;
    const half = Math.max(0.5, width * 0.5);
    fillHorizontal(canvas, y, Math.round(cx - half), Math.round(cx + half), rgba);
  }

  const flare = Math.max(1, rootFlare);
  for (let i = 0; i < flare; i++) {
    const flareWidth = widthBottom + flare - i;
    const half = flareWidth * 0.5;
    fillHorizontal(
      canvas,
      Math.min(canvas.height - 1, y1 - i),
      Math.round(cx - half),
      Math.round(cx + half),
      rgba,
    );
  }
}

function sampleUniqueIndices(rng: Rng, length: number, count: number): number[] {
  if (length <= 0 || count <= 0) return [];
  const capped = Math.min(length, count);
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = 0; i < capped; i++) {
    const j = rng.nextInt(i, length - 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, capped);
}

function archetypeFromSeed(seed: number): TreeArchetype {
  const h = (Math.trunc(seed) >>> 0);
  const bucket = h % 20;
  if (bucket >= 18) return TreeArchetype.SAPLING;
  if (bucket >= 15) return TreeArchetype.DEAD;
  return ((h >>> 8) & 1) === 0 ? TreeArchetype.DECIDUOUS : TreeArchetype.CONIFER;
}

function resolveCanvasSize(rng: Rng, archetype: TreeArchetype, baseSize: number): number {
  const size = archetype === TreeArchetype.SAPLING
    ? baseSize - rng.nextInt(2, 5)
    : baseSize + rng.nextInt(-3, 3);
  return clamp(size, 10, 26);
}

function finishTree(
  canvas: Canvas,
  rng: Rng,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  nibbleCanopy(canvas, rng, centerX, centerY, radius, 0.25, 0.1);
  darkenRim(canvas, 30, 30, 20);
}

interface BranchContext {
  canvas: Canvas;
  tips: Point[];
  junctions: Point[];
  rng: Rng;
  spreadBase: number;
  shrink: number;
  asymmetry: number;
}

function branch(
  ctx: BranchContext,
  x: number,
  y: number,
  angle: number,
  length: number,
  thickness: number,
  depth: number,
  rgba: RGBA,
): void {
  if (depth <= 0 || length < 1.5) {
    ctx.tips.push({ x, y });
    return;
  }

  const x2 = x + length * Math.sin(angle);
  const y2 = y - length * Math.cos(angle);
  drawSegment(ctx.canvas, x, y, x2, y2, rgba, thickness);
  ctx.junctions.push({ x: x2, y: y2 });

  const spread = ctx.spreadBase + ctx.rng.nextRange(-0.15, 0.15);
  const leftSpread = spread + ctx.asymmetry * ctx.rng.nextRange(-0.2, 0.2);
  const rightSpread = spread + ctx.asymmetry * ctx.rng.nextRange(-0.2, 0.2);
  const childLength = length * (ctx.shrink + ctx.rng.nextRange(-0.1, 0.1));
  const childThickness = Math.max(1, thickness - 1);
  const lighter = lightenRgba(rgba, 8);

  branch(ctx, x2, y2, angle - leftSpread, childLength, childThickness, depth - 1, lighter);
  branch(ctx, x2, y2, angle + rightSpread, childLength, childThickness, depth - 1, lighter);
}

function generateDeciduous(canvas: Canvas, size: number, rng: Rng): void {
  const trunkBase = jitterColor(rng, pick(rng, TRUNK_PALETTES), 10, [40, 25, 10], [120, 95, 75]);
  const canopyBase = jitterColor(
    rng,
    pick(rng, DECIDUOUS_CANOPY_BASES),
    20,
    [15, 90, 10],
    [140, 185, 85],
  );
  const shadow = asRgba(shiftColor(canopyBase, -55, -50, -30), 230);
  const mid = asRgba(canopyBase, 220);
  const highlight = asRgba(shiftColor(canopyBase, 55, 45, 20), 200);
  const trunk = asRgba(trunkBase, 255);

  let crownRxScale = 1.0;
  let crownRyScale = 1.0;
  let canopyCenterXOffset = 0.0;
  const crownRoll = rng.nextInt(0, 99);
  if (crownRoll >= 35 && crownRoll <= 54) {
    crownRxScale = 0.75;
    crownRyScale = 1.25;
  } else if (crownRoll >= 55 && crownRoll <= 84) {
    crownRxScale = 1.3;
    crownRyScale = 0.8;
  } else if (crownRoll >= 85) {
    canopyCenterXOffset = rng.nextRange(-size * 0.18, size * 0.18);
  }

  const lean = rng.nextRange(-1.5, 1.5);
  const cx = size / 2 + lean * 0.3;
  const trunkBottom = size - 1;
  const trunkHeight = Math.round(size * rng.nextRange(0.35, 0.45));
  const trunkTop = trunkBottom - trunkHeight;
  const trunkWidthBottom = Math.max(2, size * 0.15 + rng.nextRange(-0.3, 0.3));
  const trunkWidthTop = Math.max(1, trunkWidthBottom * 0.5);

  drawTaperedTrunk(
    canvas,
    cx,
    trunkBottom,
    trunkTop,
    trunkWidthBottom,
    trunkWidthTop,
    trunk,
    rng.nextInt(1, 2),
  );

  const tips: Point[] = [];
  const junctions: Point[] = [];
  const branchX = cx + lean * 0.5;
  const branchY = trunkTop;
  const branchCtx: BranchContext = {
    canvas, tips, junctions, rng, spreadBase: 0.6, shrink: 0.65, asymmetry: 0,
  };
  branch(branchCtx, branchX, branchY, lean * 0.08, size * 0.15, 1, 2, trunk);

  const canopyCx = branchX + canopyCenterXOffset;
  let canopyCy = tips.length > 0
    ? tips.reduce((sum, tip) => sum + tip.y, 0) / tips.length
    : branchY - size * 0.1;

  const baseRadius = size * rng.nextRange(0.2, 0.28);
  const minCanopyCy = trunkTop - baseRadius * 0.55;
  canopyCy = Math.max(canopyCy, minCanopyCy);

  const nLobes = rng.nextInt(3, 6);
  const baseAngleStep = (Math.PI * 2) / nLobes;
  const lobeAngleOffset = rng.nextRange(-Math.PI, Math.PI);
  const lobeCenters: Point[] = [];

  for (let i = 0; i < nLobes; i++) {
    const angle = lobeAngleOffset + baseAngleStep * i + rng.nextRange(-0.4, 0.4);
    const dist = baseRadius * rng.nextRange(0.45, 0.65);
    const sinAngle = Math.sin(angle);
    const verticalScale = sinAngle > 0 ? 0.9 : 0.7;
    lobeCenters.push({
      x: canopyCx + Math.cos(angle) * dist,
      y: canopyCy + sinAngle * dist * verticalScale,
    });
  }

  const centralFills: EllipseSpec[] = [];
  const shadows: EllipseSpec[] = [];
  const mids: EllipseSpec[] = [];
  const highlights: EllipseSpec[] = [];

  for (let i = 0, n = rng.nextInt(1, 3); i < n; i++) {
    const radius = baseRadius * rng.nextRange(0.55, 0.7);
    centralFills.push({
      cx: canopyCx + rng.nextRange(-0.5, 0.5),
      cy: canopyCy + rng.nextRange(-0.5, 0.3),
      rx: radius * crownRxScale,
      ry: radius * crownRyScale,
    });
  }

  for (const lobe of lobeCenters) {
    for (let i = 0, n = rng.nextInt(1, 3); i < n; i++) {
      const radius = baseRadius * rng.nextRange(0.62, 0.76);
      shadows.push({
        cx: lobe.x + rng.nextRange(-size * 0.05, size * 0.05),
        cy: lobe.y + rng.nextRange(-size * 0.07, size * 0.04),
        rx: radius * crownRxScale,
        ry: radius * crownRyScale,
      });
    }
    for (let i = 0, n = rng.nextInt(1, 3); i < n; i++) {
      const radius = baseRadius * rng.nextRange(0.58, 0.72);
      mids.push({
        cx: lobe.x + rng.nextRange(-size * 0.04, size * 0.04),
        cy: lobe.y + rng.nextRange(-size * 0.05, size * 0.03),
        rx: radius * crownRxScale,
        ry: radius * crownRyScale,
      });
    }
    for (let i = 0, n = rng.nextInt(1, 3); i < n; i++) {
      const radius = baseRadius * rng.nextRange(0.45, 0.6);
      highlights.push({
        cx: lobe.x + rng.nextRange(-size * 0.03, size * 0.03),
        cy: lobe.y - size * 0.05 + rng.nextRange(-size * 0.03, size * 0.02),
        rx: radius * crownRxScale,
        ry: radius * crownRyScale,
      });
    }
  }

  for (const tipIndex of sampleUniqueIndices(rng, tips.length, rng.nextInt(1, 3))) {
    const tip = tips[tipIndex];
    const radius = baseRadius * rng.nextRange(0.5, 0.68);
    shadows.push({
      cx: tip.x + canopyCenterXOffset + rng.nextRange(-0.5, 0.5),
      cy: tip.y - 1 + rng.nextRange(-0.5, 0.3),
      rx: radius * crownRxScale,
      ry: radius * crownRyScale,
    });
  }

  for (const tipIndex of sampleUniqueIndices(rng, tips.length, rng.nextInt(1, 3))) {
    const tip = tips[tipIndex];
    const radius = baseRadius * rng.nextRange(0.46, 0.62);
    mids.push({
      cx: tip.x + canopyCenterXOffset + rng.nextRange(-0.6, 0.6),
      cy: tip.y - 1.1 + rng.nextRange(-0.6, 0.2),
      rx: radius * crownRxScale,
      ry: radius * crownRyScale,
    });
  }

  for (const tipIndex of sampleUniqueIndices(rng, tips.length, rng.nextInt(1, 3))) {
    const tip = tips[tipIndex];
    const radius = baseRadius * rng.nextRange(0.38, 0.5);
    highlights.push({
      cx: tip.x + canopyCenterXOffset + rng.nextRange(-0.5, 0.5),
      cy: tip.y - 1.3 + rng.nextRange(-0.4, 0.2),
      rx: radius * crownRxScale,
      ry: radius * crownRyScale,
    });
  }

  batchStampEllipses(canvas, centralFills, shadow[0], shadow[1], shadow[2], shadow[3], 1.6, 0.7);
  batchStampEllipses(canvas, shadows, shadow[0], shadow[1], shadow[2], shadow[3], 1.8, 0.8);
  batchStampEllipses(canvas, mids, mid[0], mid[1], mid[2], mid[3], 1.5, 0.7);
  batchStampEllipses(
    canvas,
    highlights,
    highlight[0],
    highlight[1],
    highlight[2],
    highlight[3],
    1.3,
    0.6,
  );

  const branchTip = asRgba(shiftColor([shadow[0], shadow[1], shadow[2]], -10, -10, -5), 200);
  const extensionCount = Math.min(lobeCenters.length, rng.nextInt(2, 5));
  for (const index of sampleUniqueIndices(rng, lobeCenters.length, extensionCount)) {
    const lobe = lobeCenters[index];
    const dx = lobe.x - canopyCx;
    const dy = lobe.y - canopyCy;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-5) continue;

    const ux = dx / length;
    const uy = dy / length;
    const startDist = baseRadius * rng.nextRange(0.7, 0.95);
    const sx = canopyCx + ux * startDist;
    const sy = canopyCy + uy * startDist;
    const extensionLength = rng.nextRange(2.0, 3.2);
    drawSegment(
      canvas,
      sx,
      sy,
      sx + ux * extensionLength,
      sy + uy * extensionLength,
      branchTip,
      1,
    );
  }

  finishTree(canvas, rng, canopyCx, canopyCy, baseRadius * 2);
}

function generateConifer(canvas: Canvas, size: number, rng: Rng): void {
  const trunkBase = jitterColor(rng, pick(rng, TRUNK_PALETTES), 10, [40, 25, 10], [120, 95, 75]);
  const canopyBase = jitterColor(rng, pick(rng, CONIFER_BASES), 15, [10, 55, 10], [60, 130, 60]);
  const trunk = asRgba(trunkBase, 255);

  const lean = rng.nextRange(-1.5, 1.5);
  const cx = size / 2 + lean * 0.3;
  const trunkBottom = size - 1;

  // Pre-compute canopy tier geometry so we know where the top of the canopy
  // lands before drawing the trunk (prevents trunk poking above canopy).
  const tierCount = rng.nextInt(3, 6);
  const maxWidth = size * rng.nextRange(0.35, 0.55);
  const tierHeightBase = size * 0.35;
  const canopyBaseY = trunkBottom - Math.round(size * 0.2);
  let currentBottom = canopyBaseY;
  let topMost = currentBottom;

  interface TierInfo {
    cx: number;
    top: number;
    bottom: number;
    halfWidth: number;
    color: RGBA;
  }
  const tiers: TierInfo[] = [];

  for (let i = 0; i < tierCount; i++) {
    const t = tierCount === 1 ? 0 : i / (tierCount - 1);
    const tierWidth = maxWidth * (1 - t * 0.65) * rng.nextRange(0.9, 1.1);
    const tierHeight = Math.max(3, Math.round(tierHeightBase * (1 - t * 0.2)));
    const tierCx = cx + rng.nextRange(-0.7, 0.7) + lean * t * 0.4;
    const shade = Math.round(t * 35);
    const tierColor = asRgba(shiftColor(canopyBase, shade, shade, shade), 240);
    const tierTop = currentBottom - tierHeight;

    tiers.push({
      cx: tierCx,
      top: tierTop,
      bottom: currentBottom,
      halfWidth: tierWidth * 0.5,
      color: tierColor,
    });

    topMost = Math.min(topMost, tierTop);
    currentBottom = tierTop + Math.max(1, Math.round(tierHeight * 0.35));
  }

  // Stop the trunk at the canopy base so no trunk pixels leak through
  // narrow triangle apexes between or above tiers.
  const trunkTop = canopyBaseY;
  drawTaperedTrunk(
    canvas,
    cx,
    trunkBottom,
    trunkTop,
    Math.max(1.5, size * 0.1),
    1,
    trunk,
    rng.nextInt(1, 2),
  );

  // Draw canopy tiers over the trunk.
  for (const tier of tiers) {
    fillTriangle(
      canvas,
      tier.cx,
      tier.top,
      tier.cx - tier.halfWidth,
      tier.bottom,
      tier.cx + tier.halfWidth,
      tier.bottom,
      tier.color[0],
      tier.color[1],
      tier.color[2],
      tier.color[3],
    );
  }

  const canopyCenterY = (topMost + canopyBaseY) * 0.5;
  const canopyRadius = Math.max(maxWidth * 0.9, (trunkBottom - topMost) * 0.75);
  finishTree(canvas, rng, cx, canopyCenterY, canopyRadius);
}

function generateDead(canvas: Canvas, size: number, rng: Rng): void {
  const deadBase = jitterColor(rng, pick(rng, DEAD_BASES), 8, [55, 45, 35], [105, 95, 80]);
  const trunk = asRgba(deadBase, 255);

  const lean = rng.nextRange(-1.5, 1.5);
  const cx = size / 2 + lean * 0.3;
  const trunkBottom = size - 1;
  const trunkHeight = Math.round(size * rng.nextRange(0.45, 0.55));
  const trunkTop = trunkBottom - trunkHeight;

  drawTaperedTrunk(
    canvas,
    cx,
    trunkBottom,
    trunkTop,
    Math.max(3, size * 0.18),
    Math.max(1.5, size * 0.08),
    trunk,
    rng.nextInt(1, 2),
  );

  const tips: Point[] = [];
  const junctions: Point[] = [];
  const branchCtx: BranchContext = {
    canvas, tips, junctions, rng, spreadBase: 0.7, shrink: 0.65, asymmetry: 0.4,
  };
  branch(branchCtx, cx + lean * 0.5, trunkTop, lean * 0.06, size * 0.28, 3, 4, trunk);

  const mossCount = rng.nextInt(0, 5);
  for (const index of sampleUniqueIndices(rng, junctions.length, mossCount)) {
    const point = junctions[index];
    const radius = rng.nextRange(0.8, 1.4);
    stampEllipse(
      canvas,
      point.x,
      point.y,
      radius,
      radius,
      MOSS_RGBA[0],
      MOSS_RGBA[1],
      MOSS_RGBA[2],
      MOSS_RGBA[3],
      1.4,
      0.5,
    );
  }

  finishTree(canvas, rng, cx, trunkTop + size * 0.18, size * 0.55);
}

function generateSapling(canvas: Canvas, size: number, rng: Rng): void {
  const trunkBase = jitterColor(rng, pick(rng, TRUNK_PALETTES), 8, [45, 30, 15], [115, 90, 70]);
  const canopyBase = jitterColor(
    rng,
    pick(rng, DECIDUOUS_CANOPY_BASES),
    12,
    [40, 110, 20],
    [110, 170, 65],
  );
  const shadow = asRgba(shiftColor(canopyBase, -40, -35, -20), 210);
  const mid = asRgba(canopyBase, 200);
  const highlight = asRgba(shiftColor(canopyBase, 40, 30, 15), 190);
  const trunk = asRgba(trunkBase, 255);

  const lean = rng.nextRange(-1.5, 1.5);
  const cx = size / 2 + lean * 0.3;
  const trunkBottom = size - 1;
  const trunkTop = Math.round(size * 0.4);

  drawTaperedTrunk(canvas, cx, trunkBottom, trunkTop, 1.5, 1, trunk, rng.nextInt(1, 2));

  const canopyCx = cx + lean * 0.3;
  const canopyCy = trunkTop - size * 0.08;
  const baseRadius = size * rng.nextRange(0.16, 0.22);
  const lobeCount = rng.nextInt(2, 4);
  const baseAngleStep = (Math.PI * 2) / lobeCount;
  const lobeAngleOffset = rng.nextRange(-Math.PI, Math.PI);
  const lobeCenters: Point[] = [];

  for (let i = 0; i < lobeCount; i++) {
    const angle = lobeAngleOffset + baseAngleStep * i + rng.nextRange(-0.4, 0.4);
    const dist = baseRadius * rng.nextRange(0.4, 0.6);
    const sinAngle = Math.sin(angle);
    const verticalScale = sinAngle > 0 ? 0.9 : 0.7;
    lobeCenters.push({
      x: canopyCx + Math.cos(angle) * dist,
      y: canopyCy + sinAngle * dist * verticalScale,
    });
  }

  const centralFills: EllipseSpec[] = [{
    cx: canopyCx,
    cy: canopyCy,
    rx: baseRadius * rng.nextRange(0.45, 0.55),
    ry: baseRadius * rng.nextRange(0.45, 0.55),
  }];
  const shadows: EllipseSpec[] = [];
  const mids: EllipseSpec[] = [];
  const highlights: EllipseSpec[] = [];

  for (const lobe of lobeCenters) {
    for (let i = 0, n = rng.nextInt(1, 2); i < n; i++) {
      const radius = baseRadius * rng.nextRange(0.5, 0.68);
      shadows.push({
        cx: lobe.x + rng.nextRange(-size * 0.05, size * 0.05),
        cy: lobe.y + rng.nextRange(-size * 0.06, size * 0.04),
        rx: radius,
        ry: radius,
      });
    }
    for (let i = 0, n = rng.nextInt(1, 2); i < n; i++) {
      const radius = baseRadius * rng.nextRange(0.44, 0.6);
      mids.push({
        cx: lobe.x + rng.nextRange(-size * 0.04, size * 0.04),
        cy: lobe.y + rng.nextRange(-size * 0.05, size * 0.03),
        rx: radius,
        ry: radius,
      });
    }
    for (let i = 0, n = rng.nextInt(1, 2); i < n; i++) {
      const radius = baseRadius * rng.nextRange(0.32, 0.48);
      highlights.push({
        cx: lobe.x + rng.nextRange(-size * 0.03, size * 0.03),
        cy: lobe.y - size * 0.05 + rng.nextRange(-size * 0.03, size * 0.02),
        rx: radius,
        ry: radius,
      });
    }
  }

  batchStampEllipses(canvas, centralFills, shadow[0], shadow[1], shadow[2], shadow[3], 1.4, 0.5);
  batchStampEllipses(canvas, shadows, shadow[0], shadow[1], shadow[2], shadow[3], 1.5, 0.5);
  batchStampEllipses(canvas, mids, mid[0], mid[1], mid[2], mid[3], 1.3, 0.5);
  batchStampEllipses(
    canvas,
    highlights,
    highlight[0],
    highlight[1],
    highlight[2],
    highlight[3],
    1.2,
    0.4,
  );

  finishTree(canvas, rng, canopyCx, canopyCy, baseRadius * 1.9);
}

export function generateTree(seed: number, size = 20, archetype?: TreeArchetype): TreeResult {
  archetype = archetype ?? archetypeFromSeed(seed);
  const rng = new Rng(seed);
  const canvasSize = resolveCanvasSize(rng, archetype, size);
  const canvas = new Canvas(canvasSize, canvasSize);

  if (archetype === TreeArchetype.DECIDUOUS) {
    generateDeciduous(canvas, canvasSize, rng);
  } else if (archetype === TreeArchetype.CONIFER) {
    generateConifer(canvas, canvasSize, rng);
  } else if (archetype === TreeArchetype.DEAD) {
    generateDead(canvas, canvasSize, rng);
  } else {
    generateSapling(canvas, canvasSize, rng);
  }

  return { canvas, archetype };
}
