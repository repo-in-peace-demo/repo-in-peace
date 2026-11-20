import { DEFAULT_FOV_Y } from './camera-pose';
import { DEFAULT_ASPECT, ESTABLISHING_ELEVATION_DEG, HORIZON_FROM_TOP, safeEstablishingShot } from './framing';
import { hash01 } from './hash';
import type { Rect } from './rect';
import { MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, MOON_GLOW_ANGULAR_RADIUS_DEG } from './atmosphere';
import { vec3, type Vec3 } from './vec3';

/**
 * The land around the graveyard: hills that rise behind the fence, a dense forest on their ridge that reaches into the lower sky,
 * and low, far hills beyond. Pure: the geometry is worked out here, the scene only draws it (`scene/Horizon.tsx`).
 *
 * Why it exists: with every plot in the frame, a flat graveyard seen from 22 degrees up leaves a wide empty band between its back
 * fence and the horizon. The hills fill that band with moonlit ground, so the land runs from the front of the frame up to the trees.
 *
 * How it is composed: everything is placed for the eye of the establishing shot at the default window shape (the "design eye"),
 * so the same data file always gives the same land (it never depends on the window). The ridge is placed so that it is
 * `RIDGE_BELOW_HORIZON` of the frame below the horizon in that shot. The treetops are given as angles above the design eye's level,
 * so the forest rises a few degrees into the sky whatever the size of the graveyard, and dips into a clearing under the moon, wide
 * enough that no tree reaches the moon's disc or halo. Nothing here reads a file's facts, only the graveyard's bounds.
 */

/** The ridge of the hills, as a share of the frame's height below the horizon, in the establishing shot. */
export const RIDGE_BELOW_HORIZON = 0.08;

/** The hills start this share of the graveyard's radius outside its fence, so the fence is never buried. */
const HILL_GAP_SHARE = 0.04;

/** The ridge is at least this far from the middle: a little beyond the design eye, so the camera starts inside the ring of hills. */
const RIDGE_BEYOND_EYE = 1.15;

/** The far hills rise from FAR_START to FAR_PEAK times the ridge's radius, and the land ends at LAND_END times it. */
const FAR_START = 1.55;
const FAR_PEAK = 2.4;
export const LAND_END = 3;

/** The forest: rows of trees on the ridge, each a little further back and a little higher than the one in front. */
export const FOREST_ROWS: ReadonlyArray<{ offset: number; lift: number }> = [
  { offset: 0.02, lift: 0 },
  { offset: 0.1, lift: 0.7 },
  { offset: 0.22, lift: 1.3 },
];

/** The treetops, in degrees above the design eye's level: a base and an uneven rise and fall around the ring. */
const CANOPY_BASE_DEG = 1.2;
const CANOPY_SWELL_DEG = 1.5;
const TREE_JITTER_DEG = 1.25;

/** Now and then a tall spire rises above its neighbours by this many degrees (1 tree in SPIRE_EVERY, on average). */
const SPIRE_DEG = 1.4;
const SPIRE_SHARE = 0.06;

/** Gaps: where a slow rise and fall around the ring is below GAP_BELOW, the front rows thin out, so the forest has breaks. */
const GAP_BELOW = -0.55;

/** How hazy each row of the forest is, front to back (scene/Horizon.tsx mixes it toward the haze). */
export const FOREST_ROW_HAZE: readonly number[] = [0, 0.14, 0.26];

/**
 * The bare, twisted trees that frame the left and right edges of the opening view: at these angles from the design eye
 * (negative to the left), a little in front of the forest, reaching well above it into the sky.
 */
export const FRAMING_TREE_AZIMUTHS_DEG: readonly number[] = [-41, -35, 34, 40];
const FRAMING_TREE_TOP_DEG = 6.2;

/** The clearing under the moon: its treetops are at most this many degrees above the design eye's level (below the horizon). */
const CLEARING_TOP_DEG = -1.5;
/** The clearing reaches this many degrees beyond the halo to each side, at full depth, then rises back over CLEARING_SHOULDER_DEG. */
const CLEARING_MARGIN_DEG = 2;
const CLEARING_SHOULDER_DEG = 4;

/** Every BARE_TREE_EVERY-th slot of the front row is a bare, twisted tree, taller than the forest, unless it is near the clearing. */
const BARE_TREE_EVERY = 23;
const BARE_TREE_HEIGHT = 1.3;
/** A bare tree is kept this many degrees (seen from the design eye) clear of the moon's halo. */
const BARE_TREE_CLEARANCE_DEG = 6;

const RAD = Math.PI / 180;
const smooth = (t: number): number => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

export interface HorizonPlan {
  /** The middle of the graveyard on the ground. */
  centre: Vec3;
  halfW: number;
  halfD: number;
  /** How far out the hills start rising, beyond the fence. */
  gap: number;
  /** The ridge of the hills: its distance from the middle, and its height straight behind the middle (its lowest). */
  ridgeRadius: number;
  ridgeHeight: number;
  /** The eye the land is composed for: the establishing shot's camera at the default window shape. */
  eye: Vec3;
  /** The design eye's forward direction on the ground (length 1): toward the middle. */
  ahead: { x: number; z: number };
  /**
   * The ridge is level on the screen: its height is `eye.y + depth × ridgeSlope`, where depth is how far a point is ahead of the
   * eye along `ahead`. A plane through the eye that holds the screen's horizontal axis is exactly this, and it projects to a
   * straight, level line. (Its height from the distance instead would be a circle around the eye, which dips at the sides: a bowl.)
   */
  ridgeSlope: number;
}

/** A height that is level on the screen of the design eye: `eye.y + depth × tan(angleDeg)` at this point of the ground. */
export function levelHeightAt(plan: HorizonPlan, x: number, z: number, tanAngle: number): number {
  const depth = (x - plan.eye.x) * plan.ahead.x + (z - plan.eye.z) * plan.ahead.z;
  return plan.eye.y + depth * tanAngle;
}

/** The ridge's height along this direction from the middle: level on the screen, and kept under the eye beside and behind it. */
export function ridgeHeightToward(plan: HorizonPlan, dx: number, dz: number): number {
  const x = plan.centre.x + dx * plan.ridgeRadius;
  const z = plan.centre.z + dz * plan.ridgeRadius;
  return Math.min(plan.eye.y * RIDGE_CAP_SHARE, Math.max(plan.ridgeHeight, levelHeightAt(plan, x, z, plan.ridgeSlope)));
}

/** The ridge beside and behind the design eye, which the opening view does not see, is kept under this share of its height. */
const RIDGE_CAP_SHARE = 0.85;

/** The plan of the land for a graveyard with these bounds. */
export function horizonPlan(bounds: Rect): HorizonPlan {
  const shot = safeEstablishingShot(bounds, DEFAULT_FOV_Y, DEFAULT_ASPECT);
  const centre = shot.pose.target;
  const eye = shot.pose.position;
  const halfW = bounds.w / 2;
  const halfD = bounds.d / 2;
  const radius = Math.hypot(halfW, halfD);
  const gap = HILL_GAP_SHARE * radius + 1;
  const eyeAlong = Math.hypot(eye.x - centre.x, eye.z - centre.z);
  const ridgeRadius = Math.max(eyeAlong * RIDGE_BEYOND_EYE, (radius + gap) * 1.3);

  // The ridge straight behind the middle, seen from the eye, is RIDGE_BELOW_HORIZON under the horizon in the frame. In the middle
  // column of the frame a point `beta` degrees above the view axis is at 0.5 + shift - tan(beta) / (2 tan(fov / 2)) from the top,
  // and the horizon at HORIZON_FROM_TOP; so the ridge is at an angle `alpha` above the eye's level.
  const tanHalf = Math.tan((DEFAULT_FOV_Y * RAD) / 2);
  const shift = shot.viewShift;
  const beta = Math.atan((0.5 + shift - (HORIZON_FROM_TOP + RIDGE_BELOW_HORIZON)) * 2 * tanHalf);
  const alpha = beta - ESTABLISHING_ELEVATION_DEG * RAD;
  const along = eyeAlong + ridgeRadius;
  const ridgeHeight = Math.max(0.5, eye.y + along * Math.tan(alpha));
  const ahead = eyeAlong > 1e-9 ? { x: (centre.x - eye.x) / eyeAlong, z: (centre.z - eye.z) / eyeAlong } : { x: 0, z: -1 };
  const ridgeSlope = (ridgeHeight - eye.y) / along;
  return { centre, halfW, halfD, gap, ridgeRadius, ridgeHeight, eye, ahead, ridgeSlope };
}

/** How far the fence is from the middle along this direction on the ground (dx, dz of length 1). */
function fenceAlong(plan: HorizonPlan, dx: number, dz: number): number {
  const ax = Math.abs(dx) < 1e-9 ? Infinity : plan.halfW / Math.abs(dx);
  const az = Math.abs(dz) < 1e-9 ? Infinity : plan.halfD / Math.abs(dz);
  return Math.min(ax, az);
}

/** A slow rise and fall around the ring, from -1 to 1, the same for every graveyard. */
function swell(angle: number, salt: string): number {
  let value = 0;
  let weight = 0;
  for (const [frequency, amplitude] of [
    [2, 1],
    [5, 0.6],
    [11, 0.35],
  ] as const) {
    value += amplitude * Math.sin(frequency * angle + hash01(salt, String(frequency)) * Math.PI * 2);
    weight += amplitude;
  }
  return value / weight;
}

/** The height of the far hills' tops along this direction: under the design eye, so they stay below the horizon. */
function farTop(plan: HorizonPlan, angle: number, ridge: number): number {
  const low = ridge;
  const high = plan.eye.y * 0.92;
  return low + Math.max(0, high - low) * (0.45 + 0.5 * swell(angle, 'far-hills'));
}

/** The height of the land at a point on the ground: 0 inside and near the graveyard, rising to the ridge, then the far hills. */
export function landHeightAt(plan: HorizonPlan, x: number, z: number): number {
  const ox = x - plan.centre.x;
  const oz = z - plan.centre.z;
  const r = Math.hypot(ox, oz);
  if (r < 1e-9) return 0;
  const dx = ox / r;
  const dz = oz / r;
  const start = fenceAlong(plan, dx, dz) + plan.gap;
  const R = plan.ridgeRadius;
  if (r <= start) return 0;
  const top = ridgeHeightToward(plan, dx, dz);
  const ridge = top * smooth((r - start) / Math.max(1e-6, R - start));
  if (r <= FAR_START * R) return ridge;
  const angle = Math.atan2(oz, ox);
  const far = farTop(plan, angle, top);
  return ridge + (far - ridge) * smooth((r - FAR_START * R) / ((FAR_PEAK - FAR_START) * R));
}

/**
 * The land as a mesh: a ring of the ground around the graveyard, from just inside where the hills start to LAND_END times the
 * ridge, with positions (x, y, z), triangles, and for each point how far up to its ridge it is (`rise`, 0 to 1, for the shading).
 * The rings follow the fence: along each direction from the middle the first two rings are on the flat ground just inside and at
 * where the hills start, so the foot of the slope follows the fence's straight lines exactly. (A grid of circles would cut it
 * into steps.) Every quad is kept; the flat part lies just above the ground plane, and is shaded like it.
 */
export function landMesh(plan: HorizonPlan, segments = 384, rings = 72): { positions: Float32Array; rise: Float32Array; indices: Uint32Array } {
  const R = plan.ridgeRadius;
  const outer = LAND_END * R;
  const positions = new Float32Array(segments * (rings + 1) * 3);
  const rise = new Float32Array(segments * (rings + 1));
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const start = fenceAlong(plan, dx, dz) + plan.gap;
    const ridgeAt = Math.max(start + 1, R);
    const ridgeTop = ridgeHeightToward(plan, dx, dz);
    for (let j = 0; j <= rings; j++) {
      // Ring 0 just inside the start, ring 1 at it, then up to the ridge with more rings where it bends (55% of them), then out.
      let r: number;
      if (j === 0) r = start - plan.gap * 0.5;
      else {
        const t = (j - 1) / (rings - 1);
        r = t < 0.55 ? start + (ridgeAt * 1.1 - start) * (t / 0.55) : ridgeAt * 1.1 + (outer - ridgeAt * 1.1) * ((t - 0.55) / 0.45);
      }
      const x = plan.centre.x + dx * r;
      const z = plan.centre.z + dz * r;
      const k = j * segments + i;
      const y = landHeightAt(plan, x, z);
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      rise[k] = Math.min(1, Math.max(0, y / Math.max(1e-6, ridgeTop)));
    }
  }
  const indices: number[] = [];
  const at = (i: number, j: number): number => j * segments + (i % segments);
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const quad = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
      // Wound counter-clockwise seen from above, so the face, and the normal three.js works out from it, looks up. (The ring's
      // angle grows from +x toward +z, so i -> i + 1 then outward is counter-clockwise seen from +y.)
      indices.push(quad[0]!, quad[1]!, quad[2]!, quad[1]!, quad[3]!, quad[2]!);
    }
  }
  return { positions, rise, indices: Uint32Array.from(indices) };
}

// ---- The forest ----

/** The moon's direction on the ground, as an angle seen from the eye, and the angles of a point from the design eye (degrees). */
const azimuthFromEye = (plan: HorizonPlan, p: Vec3): number => Math.atan2(p.x - plan.eye.x, -(p.z - plan.eye.z)) / RAD; // 0 along -z, negative to the left

/** How far, in degrees seen from the design eye, the halo of the moon reaches to each side of its middle. */
const haloHalfWidthDeg = (): number => MOON_GLOW_ANGULAR_RADIUS_DEG / Math.cos(MOON_ELEVATION_DEG * RAD);

/**
 * The highest a treetop may be, in degrees above the design eye's level, at this angle seen from the design eye: the clearing
 * under the moon, and no limit (Infinity) away from it.
 */
export function clearingCeilingDeg(azimuthDeg: number): number {
  const off = Math.abs(azimuthDeg - MOON_AZIMUTH_DEG);
  const flat = haloHalfWidthDeg() + CLEARING_MARGIN_DEG;
  if (off <= flat) return CLEARING_TOP_DEG;
  if (off >= flat + CLEARING_SHOULDER_DEG) return Infinity;
  const t = smooth((off - flat) / CLEARING_SHOULDER_DEG);
  return CLEARING_TOP_DEG + t * (CANOPY_BASE_DEG + CANOPY_SWELL_DEG + TREE_JITTER_DEG + 2 - CLEARING_TOP_DEG);
}

export interface Tree {
  /** Where it stands, on the land. */
  base: Vec3;
  /** Its height above `base`. */
  height: number;
  /** Its width at the bottom. */
  width: number;
  /** Along the ring at the tree, on the ground (length 1): the trees are flat shapes across this direction, facing the middle. */
  across: { x: number; z: number };
  bare: boolean;
  /** The row of the forest, 0 in front (the framing trees are in row 0 too). */
  row: number;
  /** How much it faces the moon, 0 to 1 (seen from the design eye): how bright the moonlit edge of its top is. */
  moonward: number;
  /** The seed of its shape. */
  key: string;
}

const moonwardOf = (azimuthDeg: number): number => Math.max(0, Math.cos((azimuthDeg - MOON_AZIMUTH_DEG) * RAD * 1.6));

/** The point of the ring of this radius that the design eye (inside the ring) sees at this azimuth. */
function onRingAt(plan: HorizonPlan, radius: number, azimuthDeg: number): { x: number; z: number } {
  const dx = Math.sin(azimuthDeg * RAD);
  const dz = -Math.cos(azimuthDeg * RAD);
  const ox = plan.eye.x - plan.centre.x;
  const oz = plan.eye.z - plan.centre.z;
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - radius * radius; // < 0: the eye is inside
  const t = -b + Math.sqrt(Math.max(0, b * b - c));
  return { x: plan.eye.x + dx * t, z: plan.eye.z + dz * t };
}

/** The bare trees that frame the opening view, one at each of FRAMING_TREE_AZIMUTHS_DEG. */
function framingTrees(plan: HorizonPlan, typical: number): Tree[] {
  return FRAMING_TREE_AZIMUTHS_DEG.map((azimuth, i) => {
    const key = `forest/framing/${i}`;
    const radius = plan.ridgeRadius * (1.0 + 0.01 * hash01(key, 'r')); // behind the haze ring, in front of the first row (1.02)
    const { x, z } = onRingAt(plan, radius, azimuth);
    const base = vec3(x, landHeightAt(plan, x, z) - typical * 0.05, z);
    const top = levelHeightAt(plan, x, z, Math.tan((FRAMING_TREE_TOP_DEG - 0.8 * hash01(key, 'h')) * RAD));
    const height = top - base.y;
    const angle = Math.atan2(z - plan.centre.z, x - plan.centre.x);
    return { base, height, width: height * 0.85, across: { x: -Math.sin(angle), z: Math.cos(angle) }, bare: true, row: 0, moonward: moonwardOf(azimuth), key };
  });
}

/** Every tree of the forest, the same for the same bounds. */
export function forestTrees(plan: HorizonPlan): Tree[] {
  const trees: Tree[] = [];
  const eyeLevel = plan.eye.y;
  const typical = Math.max(1, eyeLevel - plan.ridgeHeight); // about how tall a tree is: up from the ridge to the eye's level and a bit
  FOREST_ROWS.forEach((row, rowIndex) => {
    const radius = plan.ridgeRadius * (1 + row.offset);
    const spacing = typical * 0.18;
    const count = Math.max(24, Math.round((Math.PI * 2 * radius) / spacing));
    for (let i = 0; i < count; i++) {
      const key = `forest/${rowIndex}/${i}`;
      const angle = ((i + (hash01(key, 'slot') - 0.5) * 0.6) / count) * Math.PI * 2;
      const x = plan.centre.x + Math.cos(angle) * radius;
      const z = plan.centre.z + Math.sin(angle) * radius;
      const ground = landHeightAt(plan, x, z);
      const base = vec3(x, ground - typical * 0.05, z); // a little into the ground, so no light shows under it
      const azimuth = azimuthFromEye(plan, base);
      const bareSlot = rowIndex === 0 && i % BARE_TREE_EVERY === 7 && Math.abs(azimuth - MOON_AZIMUTH_DEG) > haloHalfWidthDeg() + BARE_TREE_CLEARANCE_DEG + CLEARING_SHOULDER_DEG;
      let topDeg = CANOPY_BASE_DEG + row.lift + CANOPY_SWELL_DEG * swell(angle, 'canopy') + TREE_JITTER_DEG * (hash01(key, 'height') * 2 - 1);
      if (hash01(key, 'spire') < SPIRE_SHARE) topDeg += SPIRE_DEG;
      topDeg = Math.min(topDeg, clearingCeilingDeg(azimuth));
      // Level on the screen, like the ridge: the same angle gives the same height in the frame across the whole forest.
      let top = levelHeightAt(plan, x, z, Math.tan(topDeg * RAD));
      if (bareSlot) top = base.y + (top - base.y) * BARE_TREE_HEIGHT;
      const height = top - base.y;
      if (height < typical * 0.25) continue; // the clearing: no tree, or only stumps, so leave it out
      // A gap: the front two rows thin out where the slow swell is low, so the forest has breaks.
      if (!bareSlot && rowIndex < 2 && swell(angle, 'gaps') < GAP_BELOW && hash01(key, 'gap') < 0.8) continue;
      trees.push({
        base,
        height,
        width: bareSlot ? height * 0.9 : height * (0.32 + 0.12 * hash01(key, 'width')),
        across: { x: -Math.sin(angle), z: Math.cos(angle) },
        bare: bareSlot,
        row: rowIndex,
        moonward: moonwardOf(azimuth),
        key,
      });
    }
  });
  for (const tree of framingTrees(plan, typical)) trees.push(tree);
  return trees;
}

/** A point of a tree's flat shape: `u` across (from -0.5 to 0.5 of its width) and `v` up (0 to 1 of its height). */
const shapePoint = (tree: Tree, u: number, v: number): Vec3 =>
  vec3(tree.base.x + tree.across.x * u * tree.width, tree.base.y + v * tree.height, tree.base.z + tree.across.z * u * tree.width);

/** A pine-like dark shape: three tiers, each a triangle, so the outline is ragged. */
function pineTriangles(tree: Tree, out: number[]): void {
  const lean = (hash01(tree.key, 'lean') - 0.5) * 0.08;
  const tiers: ReadonlyArray<[bottom: number, top: number, half: number]> = [
    [0, 0.62, 0.5],
    [0.3, 0.84, 0.36],
    [0.55, 1, 0.24],
  ];
  for (const [bottom, top, half] of tiers) {
    const a = shapePoint(tree, -half, bottom);
    const b = shapePoint(tree, half, bottom);
    const c = shapePoint(tree, lean, top);
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
}

/**
 * A bare, twisted tree: a trunk that splits into crooked branches, each a thin strip, three times over. The branches keep
 * inside the tree's width and height (they are scaled down if they would not).
 */
function bareTriangles(tree: Tree, out: number[]): void {
  type Segment = { u0: number; v0: number; u1: number; v1: number; w: number };
  const segments: Segment[] = [];
  const grow = (u: number, v: number, angle: number, length: number, width: number, depth: number, path: string): void => {
    // Three crooked pieces per branch.
    let cu = u;
    let cv = v;
    let a = angle;
    for (let k = 0; k < 3; k++) {
      a += (hash01(tree.key, `${path}/bend/${k}`) - 0.5) * 0.7;
      const nu = cu + Math.sin(a) * (length / 3);
      const nv = cv + Math.cos(a) * (length / 3);
      segments.push({ u0: cu, v0: cv, u1: nu, v1: nv, w: width * (1 - k * 0.15) });
      cu = nu;
      cv = nv;
    }
    if (depth === 0) return;
    const children = 2 + (hash01(tree.key, `${path}/n`) < 0.4 ? 1 : 0);
    for (let c = 0; c < children; c++) {
      const spread = (c / Math.max(1, children - 1) - 0.5) * 1.5 + (hash01(tree.key, `${path}/${c}/a`) - 0.5) * 0.4;
      grow(cu, cv, a + spread, length * (0.62 + 0.15 * hash01(tree.key, `${path}/${c}/l`)), width * 0.55, depth - 1, `${path}/${c}`);
    }
  };
  grow(0, 0, (hash01(tree.key, 'trunk') - 0.5) * 0.3, 0.42, 0.06, 3, 't');

  // Keep it inside its box: |u| <= 0.5 and 0 <= v <= 1.
  let maxU = 0;
  let maxV = 0;
  for (const s of segments) {
    maxU = Math.max(maxU, Math.abs(s.u0), Math.abs(s.u1));
    maxV = Math.max(maxV, s.v0, s.v1);
  }
  const ku = maxU > 0.5 ? 0.5 / maxU : 1;
  const kv = maxV > 1 ? 1 / maxV : 1;
  for (const s of segments) {
    const u0 = s.u0 * ku;
    const u1 = s.u1 * ku;
    const v0 = Math.max(0, s.v0 * kv);
    const v1 = Math.max(0, s.v1 * kv);
    // Across the piece, in the tree's plane: the width is in units of the tree's height, turned into a share of its width.
    const du = u1 - u0;
    const dv = (v1 - v0) * (tree.height / tree.width);
    const n = Math.hypot(du, dv) || 1;
    const half = (s.w * tree.height) / tree.width / 2;
    const pu = (-dv / n) * half;
    const pv = (du / n) * half * (tree.width / tree.height);
    const clampU = (q: number): number => Math.max(-0.5, Math.min(0.5, q));
    const clampV = (q: number): number => Math.max(0, Math.min(1, q));
    const a = shapePoint(tree, clampU(u0 - pu), clampV(v0 - pv));
    const b = shapePoint(tree, clampU(u0 + pu), clampV(v0 + pv));
    const c = shapePoint(tree, clampU(u1 + pu), clampV(v1 + pv));
    const d = shapePoint(tree, clampU(u1 - pu), clampV(v1 - pv));
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }
}

/** Every triangle of the forest, as x, y, z of three points each, one after another. Every point is inside its tree's box. */
export function forestTriangles(trees: readonly Tree[]): Float32Array {
  return forestMesh(trees).positions;
}

/**
 * The forest's triangles, and for each point: how far up its tree it is (0 at the foot, 1 at the top), how much its tree faces
 * the moon, and how hazy its row is. The shader lights the treetops' edge from these and hazes the back rows.
 */
export function forestMesh(trees: readonly Tree[]): { positions: Float32Array; up: Float32Array; moonward: Float32Array; haze: Float32Array } {
  const out: number[] = [];
  const up: number[] = [];
  const moonward: number[] = [];
  const haze: number[] = [];
  for (const tree of trees) {
    const start = out.length;
    if (tree.bare) bareTriangles(tree, out);
    else pineTriangles(tree, out);
    for (let k = start; k < out.length; k += 3) {
      up.push(Math.min(1, Math.max(0, (out[k + 1]! - tree.base.y) / tree.height)));
      moonward.push(tree.moonward);
      haze.push(FOREST_ROW_HAZE[tree.row] ?? 0);
    }
  }
  return { positions: Float32Array.from(out), up: Float32Array.from(up), moonward: Float32Array.from(moonward), haze: Float32Array.from(haze) };
}

// ---- The haze where the hills meet the forest ----

/**
 * A pale band of haze that stands just in front of the forest's first row, from the upper slope to partway up the trees, densest
 * a little above the ridge, at the foot of the trees, and fading in from nothing where it meets the land. It lifts the dark band between the forest and the graveyard. It stays below
 * the design eye's level, so it is below the horizon and never in front of the moon.
 */
export interface HazeBand {
  radius: number;
  /** Below, above and well above the ridge, along each direction: where the haze starts, is densest, and ends. */
  below: number;
  peakAbove: number;
  topAbove: number;
  /** The haze never reaches this high: under the design eye, so below the horizon and never in front of the moon. */
  ceiling: number;
}

export function hazeBand(plan: HorizonPlan): HazeBand {
  const typical = Math.max(1, plan.eye.y - plan.ridgeHeight);
  // Starting at the ground, with no haze there, so the land does not cut it off in a hard line.
  return { radius: plan.ridgeRadius * 0.995, below: typical * 0.02, peakAbove: typical * 0.2, topAbove: typical * 0.7, ceiling: plan.eye.y - typical * 0.05 };
}

/** The haze band as a ring of three rows of points (bottom, peak, top), following the ridge, with how dense the haze is at each (0, 1, 0). */
export function hazeRingMesh(plan: HorizonPlan, segments = 256): { positions: Float32Array; density: Float32Array; indices: Uint32Array } {
  const band = hazeBand(plan);
  const densities = [0, 1, 0];
  const positions = new Float32Array(segments * 3 * 3);
  const density = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const ridge = ridgeHeightToward(plan, dx, dz);
    const heights = [ridge - band.below, Math.min(ridge + band.peakAbove, band.ceiling - 0.01), Math.min(ridge + band.topAbove, band.ceiling)];
    for (let row = 0; row < 3; row++) {
      const k = row * segments + i;
      positions[k * 3] = plan.centre.x + dx * band.radius;
      positions[k * 3 + 1] = Math.max(heights[row]!, row > 0 ? heights[row - 1]! + 0.01 : -Infinity);
      positions[k * 3 + 2] = plan.centre.z + dz * band.radius;
      density[k] = densities[row]!;
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * segments + i;
      const b = row * segments + ((i + 1) % segments);
      indices.push(a, b, a + segments, b, b + segments, a + segments);
    }
  }
  return { positions, density, indices: Uint32Array.from(indices) };
}
