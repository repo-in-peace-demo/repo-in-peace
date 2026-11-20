import { DEFAULT_FOV_Y } from './camera-pose';
import { DEFAULT_ASPECT, ESTABLISHING_ELEVATION_DEG, HORIZON_FROM_TOP, SHOT_MIN_ASPECT, openingShot, safeEstablishingShot } from './framing';
import { hash01 } from './hash';
import type { Rect } from './rect';
import { MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, MOON_GLOW_ANGULAR_RADIUS_DEG } from './atmosphere';
import { vec3, type Vec3 } from './vec3';

/**
 * What stands around the graveyard, on flat ground: a far forest in a ring that reaches into the lower sky, a nearer layer of dark
 * trees behind the back fence that fills the band between the fence and the far forest, bare twisted trees framing the left and
 * right of the view, and a pale haze at the far forest's foot. No hills: the ground beyond the fence is flat. Pure: the geometry is
 * worked out here, the scene only draws it (`scene/Horizon.tsx`).
 *
 * How it is composed: everything is placed for the eye of the establishing shot at the default window shape (the "design eye"),
 * so the same data file always gives the same trees (it never depends on the window). `ridgeHeight` is a line of the composition,
 * `RIDGE_BELOW_HORIZON` of the frame below the horizon in that shot, which the sizes of the trees are measured against; nothing
 * stands on it. The treetops are given as angles above the design eye's level,
 * so the forest rises a few degrees into the sky whatever the size of the graveyard, and dips into a clearing under the moon, wide
 * enough that no tree reaches the moon's disc or halo. Nothing here reads a file's facts, only the graveyard's bounds.
 */

/** The composition's ridge line, as a share of the frame's height below the horizon, in the establishing shot. */
export const RIDGE_BELOW_HORIZON = 0.08;

/** The trees stand at least this share of the graveyard's radius (plus a unit) outside its fence, so they never touch it. */
const HILL_GAP_SHARE = 0.04;

/** The far forest's ring is at least this far from the middle: a little beyond the design eye, so the camera starts inside it. */
const RIDGE_BEYOND_EYE = 1.15;

/** The far forest: rows of trees on its ring, each a little further back and a little higher than the one in front. */
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
/** The far forest is a straight line across the opening view, this many degrees to each side of straight ahead (any window up to 2.4 wide). */
const FAR_LINE_HALF_ANGLE_DEG = 62;

export const FOREST_ROW_HAZE: readonly number[] = [0.3, 0.38, 0.46]; // the far forest is the haziest thing on the ground

/**
 * The bare, twisted trees that frame the left and right edges of the opening view: at these angles from the design eye
 * (negative to the left), a little in front of the forest, reaching well above it into the sky.
 */
export const FRAMING_TREE_AZIMUTHS_DEG: readonly number[] = [-41, -35, 29, 34, 40]; // 29: in view beside the legend panel on a wide screen
const FRAMING_TREE_TOP_DEG = 6.6; // from 6.2 when the ring moved out for narrow windows, so they still rise clear of the pines beside them

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
  /** How far beyond the fence the nearest trees may stand. */
  gap: number;
  /** The far forest's ring, from the middle, and the composition's ridge line straight behind the middle (see the top of the file). */
  ridgeRadius: number;
  ridgeHeight: number;
  /** The eye the land is composed for: the establishing shot's camera at the default window shape. */
  eye: Vec3;
  /** The design eye's forward direction on the ground (length 1): toward the middle. */
  ahead: { x: number; z: number };
  /** The slope of the ridge line: `eye.y + depth × ridgeSlope`, level on the screen (see `levelHeightAt`). */
  ridgeSlope: number;
}

/**
 * A height that is level on the screen of the design eye: `eye.y + depth × tan(angle)` at this point of the ground, where depth is
 * how far the point is ahead of the eye along `ahead`. A plane through the eye that holds the screen's horizontal axis is exactly
 * this, and it projects to a straight, level line (the same height from the distance would be a circle, which dips at the sides).
 */
export function levelHeightAt(plan: HorizonPlan, x: number, z: number, tanAngle: number): number {
  const depth = (x - plan.eye.x) * plan.ahead.x + (z - plan.eye.z) * plan.ahead.z;
  return plan.eye.y + depth * tanAngle;
}

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
  // The ring is beyond the furthest camera of the first frame, Reset view and the opening move, for any window shape the scene is
  // composed for: the establishing shot at the narrowest shape (SHOT_MIN_ASPECT), which a wide graveyard such as oikos_ledger pulls
  // far back for, and the opening move's low start, which is never nearer than MIN_SHOT_DISTANCE (further out than the ring of a
  // tiny graveyard). The look is still composed from the design eye (the default shape): the ridge and the treetops are set by
  // angles seen from it, so moving the ring out keeps them in place on the screen.
  const alongOf = (p: Vec3): number => Math.hypot(p.x - centre.x, p.z - centre.z);
  const furthestAlong = Math.max(
    eyeAlong,
    ...[DEFAULT_ASPECT, SHOT_MIN_ASPECT].flatMap((aspect) => [safeEstablishingShot(bounds, DEFAULT_FOV_Y, aspect).pose.position, openingShot(bounds, DEFAULT_FOV_Y, aspect).pose.position]).map(alongOf),
  );
  const ridgeRadius = Math.max(furthestAlong * RIDGE_BEYOND_EYE, (radius + gap) * 1.3);

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

/** The height of the ground at a point: flat, 0 everywhere. (There are no hills; the trees stand on the ground.) */
export function landHeightAt(_plan: HorizonPlan, _x: number, _z: number): number {
  return 0;
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
  /** How hazy it is, 0 to 1; FOREST_ROW_HAZE of its row when not given. */
  haze?: number;
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
    const radius = plan.ridgeRadius * (0.93 + 0.02 * hash01(key, 'r')); // in front of the far forest (1.02) and its haze (0.995)
    const { x, z } = onRingAt(plan, radius, azimuth);
    const base = vec3(x, landHeightAt(plan, x, z) - typical * 0.05, z);
    const top = levelHeightAt(plan, x, z, Math.tan((FRAMING_TREE_TOP_DEG - 0.8 * hash01(key, 'h')) * RAD));
    const height = top - base.y;
    const angle = Math.atan2(z - plan.centre.z, x - plan.centre.x);
    return { base, height, width: height * 0.6, across: { x: -Math.sin(angle), z: Math.cos(angle) }, bare: true, row: 0, moonward: moonwardOf(azimuth), haze: 0.06, key };
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
    // Where the opening view looks (within FAR_LINE_HALF_ANGLE_DEG of straight ahead) the row is a straight line across the view,
    // so its foot is level on the screen; elsewhere, out of that view, it closes the ring around the graveyard.
    const lineZ = plan.centre.z - radius;
    const lineDepth = plan.eye.z - lineZ;
    const reach = lineDepth * Math.tan(FAR_LINE_HALF_ANGLE_DEG * RAD);
    const lineCount = Math.max(12, Math.round((2 * reach) / spacing));
    const ringCount = Math.max(24, Math.round((Math.PI * 2 * radius) / spacing));
    const slots: Array<{ key: string; x: number; z: number }> = [];
    for (let i = 0; i < lineCount; i++) {
      const key = `forest/${rowIndex}/line/${i}`;
      slots.push({ key, x: plan.eye.x - reach + ((i + 0.5 + (hash01(key, 'slot') - 0.5) * 0.6) * 2 * reach) / lineCount, z: lineZ + (hash01(key, 'z') - 0.5) * spacing });
    }
    for (let i = 0; i < ringCount; i++) {
      const key = `forest/${rowIndex}/${i}`;
      const a = ((i + (hash01(key, 'slot') - 0.5) * 0.6) / ringCount) * Math.PI * 2;
      const x = plan.centre.x + Math.cos(a) * radius;
      const z = plan.centre.z + Math.sin(a) * radius;
      if (Math.abs(azimuthFromEye(plan, vec3(x, 0, z))) < FAR_LINE_HALF_ANGLE_DEG && z < plan.eye.z) continue; // the line has it
      slots.push({ key, x, z });
    }
    slots.forEach(({ key, x, z }, i) => {
      const angle = Math.atan2(z - plan.centre.z, x - plan.centre.x);
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
      if (height < typical * 0.25) return; // the clearing: no tree, or only stumps, so leave it out
      // A gap: the front two rows thin out where the slow swell is low, so the forest has breaks.
      if (!bareSlot && rowIndex < 2 && swell(angle, 'gaps') < GAP_BELOW && hash01(key, 'gap') < 0.8) return;
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
    });
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
      haze.push(tree.haze ?? FOREST_ROW_HAZE[tree.row] ?? 0);
    }
  }
  return { positions: Float32Array.from(out), up: Float32Array.from(up), moonward: Float32Array.from(moonward), haze: Float32Array.from(haze) };
}

// ---- The haze at the far forest's foot ----

/**
 * A pale band of haze that stands just in front of the far forest's first row, across the opening view, from the ground to partway
 * up the trees, densest a little above the ground, and fading out at both ends. It stays below the design eye's level, so it is below the horizon and never
 * in front of the moon.
 */
export interface HazeBand {
  radius: number;
  /** The heights where the haze is densest and where it ends, above the ground. */
  peak: number;
  top: number;
}

export function hazeBand(plan: HorizonPlan): HazeBand {
  const typical = Math.max(1, plan.eye.y - plan.ridgeHeight);
  return { radius: plan.ridgeRadius * 0.995, peak: typical * 0.35, top: Math.min(typical * 1.2, plan.eye.y - typical * 0.05) };
}

/**
 * The haze band as a strip of three rows of points (ground, peak, top) along a straight line just in front of the far forest's
 * first row, across the opening view (so its foot is level on the screen), fading out at its two ends; with how dense the haze is
 * at each point.
 */
export function hazeRingMesh(plan: HorizonPlan, segments = 128): { positions: Float32Array; density: Float32Array; indices: Uint32Array } {
  const band = hazeBand(plan);
  const heights = [0, band.peak, band.top];
  const densities = [0, 1, 0];
  const z = plan.centre.z - band.radius;
  const reach = (plan.eye.z - z) * Math.tan(FAR_LINE_HALF_ANGLE_DEG * RAD);
  const side = segments + 1;
  const positions = new Float32Array(side * 3 * 3);
  const density = new Float32Array(side * 3);
  for (let i = 0; i < side; i++) {
    const u = i / segments;
    const ends = Math.min(1, Math.min(u, 1 - u) / 0.12);
    for (let row = 0; row < 3; row++) {
      const k = row * side + i;
      positions[k * 3] = plan.eye.x - reach + 2 * reach * u;
      positions[k * 3 + 1] = heights[row]!;
      positions[k * 3 + 2] = z;
      density[k] = densities[row]! * ends;
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * side + i;
      indices.push(a, a + 1, a + side, a + 1, a + side + 1, a + side);
    }
  }
  return { positions, density, indices: Uint32Array.from(indices) };
}

// ---- The nearer layer of trees behind the back fence ----

/**
 * A nearer layer of dark trees on the ground behind the back fence, in NEAR_ROWS straight rows from just behind the fence to just in
 * front of the far forest, across the whole width of the opening view. Their tops step up row by row, from NEAR_TOP_FROM_DEG to
 * NEAR_TOP_TO_DEG below the design eye's level (level on the screen), so in the opening view they fill the band between the back
 * fence and the far forest, and every one of them is below the horizon (never near the moon). Mostly pines, with now and then a bare,
 * twisted tree; lighter and hazier than the dark foreground, less hazy than the far forest.
 */
export const NEAR_ROWS = 5;
export const NEAR_TOP_FROM_DEG = -8.5;
export const NEAR_TOP_TO_DEG = -2.2;
/** How hazy the nearest and the farthest rows are. */
export const NEAR_HAZE_FROM = 0.1;
export const NEAR_HAZE_TO = 0.24;
/** About one tree in NEAR_BARE_EVERY is bare and twisted. */
const NEAR_BARE_EVERY = 11;
/** The rows reach this far to each side, seen from the design eye: past the edges of any laptop's opening view. */
const NEAR_HALF_ANGLE_DEG = 58;

/** Where the nearer layer is: its first row's line (z) just behind the back fence, and its last just in front of the far forest. */
export function nearBand(plan: HorizonPlan): { firstZ: number; lastZ: number } {
  const fence = plan.centre.z - plan.halfD;
  const firstZ = fence - plan.gap - 1;
  // In front of the far forest, whatever the size: for a tiny graveyard the band is short, never past the forest.
  const lastZ = Math.max(Math.min(firstZ - 2, plan.centre.z - plan.ridgeRadius * 0.9), plan.centre.z - plan.ridgeRadius * 0.95);
  return { firstZ, lastZ };
}

/** Every tree of the nearer layer, the same for the same bounds. */
export function nearTrees(plan: HorizonPlan): Tree[] {
  const { firstZ, lastZ } = nearBand(plan);
  const typical = Math.max(1, plan.eye.y - plan.ridgeHeight);
  const trees: Tree[] = [];
  for (let row = 0; row < NEAR_ROWS; row++) {
    const t = row / (NEAR_ROWS - 1);
    const z0 = firstZ + (lastZ - firstZ) * t;
    const depth = plan.eye.z - z0;
    const topDeg = NEAR_TOP_FROM_DEG + (NEAR_TOP_TO_DEG - NEAR_TOP_FROM_DEG) * t;
    const rowTop = plan.eye.y + depth * Math.tan(topDeg * RAD);
    const reach = depth * Math.tan(NEAR_HALF_ANGLE_DEG * RAD);
    const spacing = Math.max(0.6, rowTop * 0.16);
    const count = Math.max(8, Math.ceil((2 * reach) / spacing));
    for (let i = 0; i < count; i++) {
      const key = `near/${row}/${i}`;
      const x = plan.eye.x - reach + ((i + 0.5 + (hash01(key, 'x') - 0.5) * 0.7) * 2 * reach) / count;
      const z = Math.min(firstZ, z0 - (hash01(key, 'z') - 0.5) * (Math.abs(lastZ - firstZ) / NEAR_ROWS) * 0.8); // never nearer the fence than the first row
      const bare = hash01(key, 'bare') < 1 / NEAR_BARE_EVERY;
      const jitter = (hash01(key, 'h') * 2 - 1) * 1.1 + (hash01(key, 'spire') < 0.08 ? 1.2 : 0);
      // Level on the screen, and never above NEAR_TOP_TO_DEG + a little: below the horizon.
      const deg = Math.min(NEAR_TOP_TO_DEG + 0.8, topDeg + jitter + (bare ? 0.8 : 0));
      const base = vec3(x, -typical * 0.02, z);
      const top = levelHeightAt(plan, x, z, Math.tan(deg * RAD));
      const height = top - base.y;
      if (height < 0.5) continue;
      trees.push({
        base,
        height,
        width: bare ? height * 0.7 : height * (0.3 + 0.12 * hash01(key, 'w')),
        across: { x: 1, z: 0 }, // the rows face the graveyard
        bare,
        row: 0,
        moonward: moonwardOf(azimuthFromEye(plan, base)),
        haze: NEAR_HAZE_FROM + (NEAR_HAZE_TO - NEAR_HAZE_FROM) * t,
        key,
      });
    }
  }
  return trees;
}
