import { STONE_D, STONE_W } from './layout-constants';
import { FENCE_INSET } from './fences';
import { SINK_S, marksExtent } from './pr-scene';
import type { Rect } from './rect';
import type { SceneModel } from './scene-model';

/**
 * The gravedigger who performs a Bury (an embellishment of the bury-and-resurrect spec). Pure: the timeline of one Bury and the
 * figure's pose at any moment, and where he stands. Decoration, tied to a real request: he fades in when Bury is confirmed, digs
 * while the request runs, then pats the mound and plants the stake after the stone sinks (success), or leans on his shovel and
 * shakes his head (failure), and fades out. Never under reduced motion; never for Resurrect.
 */

// ---- The timeline ----

export const ENTER_S = 0.5;
/** One dig: thrust, lift, toss. */
export const DIG_CYCLE_S = 0.9;
/** He digs at least this many times, so a request that returns at once still reads. */
export const MIN_DIG_CYCLES = 1;
/** Success: he watches the stone sink (as long as the sink), pats the mound twice, plants the stake. */
export const WATCH_S = SINK_S;
export const PAT_S = 0.8;
export const STAKE_S = 0.5;
/** When the stake rises, from the start of the sink: while he pushes it in. */
export const STAKE_RISE_AT_S = WATCH_S + PAT_S + 0.1;
export const STAKE_RISE_S = 0.3;
/** Failure: he leans on the shovel and shakes his head. */
export const SHRUG_S = 1.6;
export const EXIT_S = 1.0;

export type DiggerPhase = 'enter' | 'dig' | 'watch' | 'pat' | 'stake' | 'shrug' | 'exit' | 'gone';
export type DiggerOutcome = { kind: 'success' | 'failure'; at: number };

export interface DiggerJob {
  path: string;
  /** `performance.now()` when the request started (Bury confirmed), in ms. */
  start: number;
  spot: DiggerSpot;
  /** When the request ended, and how. Absent while it runs. */
  outcome?: DiggerOutcome;
}

export interface PhaseSpan {
  phase: Exclude<DiggerPhase, 'gone'>;
  /** In ms. `to` is Infinity for the dig while the request runs. */
  from: number;
  to: number;
}

/**
 * The phases of a job, in order. The dig ends at the end of the dig cycle in progress when the request ends (so the shovel never
 * jumps), and not before `MIN_DIG_CYCLES` cycles. Nothing waits on anything but the request and the moves themselves.
 */
export function phasesOf(job: Pick<DiggerJob, 'start' | 'outcome'>): PhaseSpan[] {
  const digFrom = job.start + ENTER_S * 1000;
  const spans: PhaseSpan[] = [{ phase: 'enter', from: job.start, to: digFrom }];
  if (job.outcome === undefined) {
    spans.push({ phase: 'dig', from: digFrom, to: Infinity });
    return spans;
  }
  const digEnd = digEndOf(job.start, job.outcome.at);
  spans.push({ phase: 'dig', from: digFrom, to: digEnd });
  const after: Array<[PhaseSpan['phase'], number]> =
    job.outcome.kind === 'success'
      ? [
          ['watch', WATCH_S],
          ['pat', PAT_S],
          ['stake', STAKE_S],
          ['exit', EXIT_S],
        ]
      : [
          ['shrug', SHRUG_S],
          ['exit', EXIT_S],
        ];
  let at = digEnd;
  for (const [phase, seconds] of after) {
    spans.push({ phase, from: at, to: at + seconds * 1000 });
    at += seconds * 1000;
  }
  return spans;
}

/** The end of the dig: the end of the cycle in progress at `outcomeAt`, at least `MIN_DIG_CYCLES` cycles in. In ms. */
export function digEndOf(start: number, outcomeAt: number): number {
  const digFrom = start + ENTER_S * 1000;
  const cycle = DIG_CYCLE_S * 1000;
  const cycles = Math.max(MIN_DIG_CYCLES, Math.ceil((outcomeAt - digFrom) / cycle - 1e-9));
  return digFrom + cycles * cycle;
}

/** When the stone starts to sink for a successful job with a gravedigger: when he stops digging. */
export const sinkAtOf = (job: Pick<DiggerJob, 'start' | 'outcome'>): number | undefined =>
  job.outcome?.kind === 'success' ? digEndOf(job.start, job.outcome.at) : undefined;

/** The moment everything is over, in ms; Infinity while the request runs. */
export function endOf(job: Pick<DiggerJob, 'start' | 'outcome'>): number {
  return phasesOf(job).at(-1)!.to;
}

// ---- The pose ----

export interface ClodPose {
  /** In the figure's own frame: +z toward the grave, +x to his left, y up. */
  x: number;
  y: number;
  z: number;
}

export interface DiggerPose {
  phase: DiggerPhase;
  /** 0 to 1. */
  opacity: number;
  /** Forward bend of the body from the hips, radians. */
  lean: number;
  /** The arms and shovel about the shoulders, radians: 0 holding it across the body, positive pushing the blade down and forward. */
  arm: number;
  /** The arms and shovel turned to the side (the toss), radians. */
  swing: number;
  /** The head turned (the shake), radians. */
  head: number;
  /** The dirt in the air, during a toss. */
  clods: ClodPose[];
}

export const CLOD_COUNT = 4;

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const smooth = (t: number): number => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const IDLE = { lean: 0.05, arm: 0, swing: 0, head: 0 };

/** One dig, `u` from 0 to 1: thrust the blade down (to 0.35), lift (to 0.65), toss to the side (to 1). */
function digPose(u: number): Omit<DiggerPose, 'phase' | 'opacity'> {
  if (u < 0.35) {
    const t = smooth(u / 0.35);
    return { lean: mix(0.1, 0.35, t), arm: mix(-0.15, 0.75, t), swing: 0, head: 0, clods: [] };
  }
  if (u < 0.65) {
    const t = smooth((u - 0.35) / 0.3);
    return { lean: mix(0.35, 0.12, t), arm: mix(0.75, -0.35, t), swing: 0, head: 0, clods: [] };
  }
  const t = (u - 0.65) / 0.35;
  const swing = 0.7 * Math.sin(Math.PI * t);
  // The dirt leaves the blade a little into the toss and lands before the next thrust, in a low arc out to his left.
  const flight = clamp01((t - 0.25) / 0.75);
  const clods: ClodPose[] =
    flight > 0 && flight < 1
      ? Array.from({ length: CLOD_COUNT }, (_, i) => {
          const spread = (i - (CLOD_COUNT - 1) / 2) * 0.09;
          return { x: 0.25 + flight * (0.75 + i * 0.08), y: 0.9 + 0.55 * Math.sin(Math.PI * flight) - flight * 0.85, z: 0.45 + spread - flight * 0.15 };
        })
      : [];
  return { lean: mix(0.12, 0.1, t), arm: mix(-0.35, -0.15, smooth(t)), swing, head: 0, clods };
}

export function diggerPose(job: Pick<DiggerJob, 'start' | 'outcome'>, now: number): DiggerPose {
  const span = phasesOf(job).find((s) => now < s.to);
  if (span === undefined || now < job.start) return { phase: 'gone', opacity: 0, ...IDLE, clods: [] };
  const t = (now - span.from) / (span.to - span.from);
  switch (span.phase) {
    case 'enter':
      return { phase: 'enter', opacity: smooth(t), ...IDLE, clods: [] };
    case 'dig': {
      const u = ((now - span.from) / (DIG_CYCLE_S * 1000)) % 1;
      return { phase: 'dig', opacity: 1, ...digPose(u) };
    }
    case 'watch':
      return { phase: 'watch', opacity: 1, lean: 0.08, arm: mix(-0.15, 0, smooth(t * 3)), swing: 0, head: 0, clods: [] };
    case 'pat': {
      // Two pats: the blade down on the mound and up again, twice.
      const beat = Math.sin(Math.PI * ((t * 2) % 1));
      return { phase: 'pat', opacity: 1, lean: 0.15 + 0.15 * beat, arm: 0.1 + 0.55 * beat, swing: 0, head: 0, clods: [] };
    }
    case 'stake': {
      const push = Math.sin(Math.PI * t);
      return { phase: 'stake', opacity: 1, lean: 0.2 + 0.2 * push, arm: 0.2 + 0.25 * push, swing: 0, head: 0, clods: [] };
    }
    case 'shrug': {
      // Plants the blade and leans on the shovel, upright, and shakes his head twice in the middle of it.
      const shake = t > 0.2 && t < 0.85 ? 0.35 * Math.sin(2 * Math.PI * 2 * ((t - 0.2) / 0.65)) : 0;
      return { phase: 'shrug', opacity: 1, lean: mix(0.1, -0.04, smooth(t * 4)), arm: mix(0, 0.7, smooth(t * 4)), swing: 0, head: shake, clods: [] };
    }
    case 'exit':
      return { phase: 'exit', opacity: 1 - smooth(t), ...IDLE, clods: [] };
  }
}

// ---- Where he stands ----

/** He stands on a square this far from his centre on each side (body and cloak); his shovel reaches over the grave's edge. */
export const FOOT_HALF = 0.3;
/** He may stand in the grave's cell or in the aisle next to it: the cell grown by this much on each side. */
export const AISLE = 0.75;
/** His height: about a tall stone. */
export const DIGGER_H = 1.9;

export interface DiggerSpot {
  x: number;
  z: number;
  /** Turned about y so that he faces the grave: his +z points at it. */
  yaw: number;
}

export const footprintOf = (spot: { x: number; z: number }): Rect => ({ x: spot.x - FOOT_HALF, z: spot.z - FOOT_HALF, w: 2 * FOOT_HALF, d: 2 * FOOT_HALF });

/** The fence lines of every plot, as thin rectangles (the gate gap counted as fence, to be safe). */
function fenceBands(model: Pick<SceneModel, 'layout'>): Rect[] {
  const band = 0.1;
  const out: Rect[] = [];
  for (const { rect } of model.layout.plots) {
    const left = rect.x + FENCE_INSET;
    const right = rect.x + rect.w - FENCE_INSET;
    const back = rect.z + FENCE_INSET;
    const front = rect.z + rect.d - FENCE_INSET;
    out.push({ x: left, z: back - band, w: right - left, d: 2 * band });
    out.push({ x: left, z: front - band, w: right - left, d: 2 * band });
    out.push({ x: left - band, z: back, w: 2 * band, d: front - back });
    out.push({ x: right - band, z: back, w: 2 * band, d: front - back });
  }
  return out;
}

/** Everything he must not stand on, for a Bury of the stone at `index`: other graves' cells, fences, plaques, and his own grave. */
export function obstaclesFor(model: Pick<SceneModel, 'layout' | 'stones' | 'ghosts'>, index: number): Rect[] {
  const stone = model.stones[index]!;
  const { x, z, height } = stone.layout;
  const out: Rect[] = [];
  model.stones.forEach((s, i) => {
    if (i !== index) out.push(s.layout.cell);
  });
  for (const g of model.ghosts) out.push(g.layout.cell);
  for (const plot of model.layout.plots) out.push(plot.sign.footprint);
  out.push(...fenceBands(model));
  // His own grave: the mound and stake to come, and the stone with the ground under its top if it leans.
  const marks = marksExtent('buried');
  out.push({ x: x + marks.minX, z: z + marks.minZ, w: marks.maxX - marks.minX, d: marks.maxZ - marks.minZ });
  const reach = height * Math.sin((stone.visual.leanDegrees * Math.PI) / 180);
  const dx = reach * Math.cos(stone.visual.leanDirection);
  const dz = reach * Math.sin(stone.visual.leanDirection);
  const base = { x0: x - STONE_W / 2 - 0.05, x1: x + STONE_W / 2 + 0.05, z0: z - STONE_D / 2 - 0.05, z1: z + STONE_D / 2 + 0.05 };
  out.push({
    x: Math.min(base.x0, base.x0 + dx),
    z: Math.min(base.z0, base.z0 + dz),
    w: base.x1 - base.x0 + Math.abs(dx),
    d: base.z1 - base.z0 + Math.abs(dz),
  });
  return out;
}

/** The ground he may stand on for this stone: its cell and the aisle round it. */
export function allowedAreaFor(model: Pick<SceneModel, 'stones'>, index: number): Rect {
  const { cell } = model.stones[index]!.layout;
  return { x: cell.x - AISLE, z: cell.z - AISLE, w: cell.w + 2 * AISLE, d: cell.d + 2 * AISLE };
}

const overlapsRect = (a: Rect, b: Rect): boolean => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.z < b.z + b.d - 1e-9 && b.z < a.z + a.d - 1e-9;
const inside = (outer: Rect, inner: Rect): boolean => inner.x >= outer.x - 1e-9 && inner.z >= outer.z - 1e-9 && inner.x + inner.w <= outer.x + outer.w + 1e-9 && inner.z + inner.d <= outer.z + outer.d + 1e-9;

/** Places beside the grave he may stand, relative to the stone's centre: either side, behind, in front, and the corners between. */
const SIDE = STONE_W / 2 + 0.05 + 0.35; // clear of the stone, with the shovel's reach to its edge
const END = 0.8 + 0.05 + FOOT_HALF; // clear of the mound and the stake
const OFFSETS: ReadonlyArray<{ dx: number; dz: number }> = [
  { dx: SIDE, dz: 0 },
  { dx: -SIDE, dz: 0 },
  { dx: SIDE, dz: -0.45 },
  { dx: -SIDE, dz: -0.45 },
  { dx: SIDE, dz: 0.45 },
  { dx: -SIDE, dz: 0.45 },
  { dx: 0, dz: -END },
  { dx: 0.55, dz: -END },
  { dx: -0.55, dz: -END },
  { dx: 0, dz: END },
];
/** He never stands nearer the camera than this, as a share of the way to the camera (0 is beside the grave, seen from the camera). */
export const MOST_TOWARD_CAMERA = -0.25;
/**
 * The best place is a little behind the grave and to one side, seen from the camera: straight behind it the stone hides him (found in
 * the first screenshot), and in front he would hide the stone.
 */
export const BEST_BEHIND = 0.4;

/**
 * Where he stands to bury the stone at `index`, seen from a camera at `camera` (on the ground): the free place beside the grave
 * nearest `BEST_BEHIND` behind it, so he neither hides the stone or its plaque nor is hidden by it. Null when there is none: then
 * there is no gravedigger, and the Bury shows as without him.
 */
export function diggerSpot(model: Pick<SceneModel, 'layout' | 'stones' | 'ghosts'>, index: number, camera: { x: number; z: number }): DiggerSpot | null {
  const { x, z } = model.stones[index]!.layout;
  const obstacles = obstaclesFor(model, index);
  const allowed = allowedAreaFor(model, index);
  const toward = { x: x - camera.x, z: z - camera.z };
  const length = Math.hypot(toward.x, toward.z) || 1;
  let best: { spot: DiggerSpot; score: number; miss: number } | null = null;
  for (const { dx, dz } of OFFSETS) {
    const spot = { x: x + dx, z: z + dz };
    const foot = footprintOf(spot);
    if (!inside(allowed, foot) || obstacles.some((o) => overlapsRect(foot, o))) continue;
    // How far behind the grave this place is, from the camera: 1 straight behind it, -1 straight in front.
    const score = (dx * toward.x + dz * toward.z) / (Math.hypot(dx, dz) * length);
    if (score < MOST_TOWARD_CAMERA) continue;
    const miss = Math.abs(score - BEST_BEHIND);
    if (best === null || miss < best.miss - 1e-9 || (Math.abs(miss - best.miss) <= 1e-9 && score > best.score)) best = { spot: { ...spot, yaw: Math.atan2(-dx, -dz) }, score, miss };
  }
  return best?.spot ?? null;
}
