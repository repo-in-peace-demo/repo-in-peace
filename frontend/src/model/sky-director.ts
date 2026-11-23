import { MOON_ANGULAR_RADIUS_DEG, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG, MOON_GLOW_ANGULAR_RADIUS_DEG } from './atmosphere';
import { fnv1a32 } from './hash';
import { mulberry32 } from './prng';
import { CANOPY_TOP_DEG, PASS_S, SKY_TOP_DEG, skyDistanceDeg, type WitchState, arcAt, passOpacity, BOB_DEG, BOB_PERIOD_S } from './witch';

/**
 * The sky director (an ambient element, decoration and not data): one schedule for every sky event (the witch, bats, shooting
 * stars and distant lightning), so only one is ever in the sky, with a quiet gap of 9 to 14 s between one ending and the next
 * starting. Seeded, so the same in every run. The witch flies first, as the opening move settles; the next three are the others in
 * a seeded order; after that a seeded choice, with the witch at least WITCH_EVERY_MIN_S apart (and due by WITCH_DUE_S) and lightning
 * at least LIGHTNING_EVERY_MIN_S apart. Pure. Reduced motion: no event, ever.
 */

export type SkyKind = 'witch' | 'bats' | 'star' | 'lightning';
export interface SkyEvent {
  kind: SkyKind;
  /** Its number in the schedule, which seeds its details. */
  index: number;
  /** Seconds of animation time. */
  start: number;
  duration: number;
}

export const SKY_SEED = 'repo-in-peace/sky';
export const QUIET_MIN_S = 9;
export const QUIET_MAX_S = 14;
export const BATS_S = 5;
export const STAR_MIN_S = 0.6;
export const STAR_MAX_S = 1.0;
export const LIGHTNING_S = 1.2;
export const WITCH_EVERY_MIN_S = 45;
/** Once this long has passed since her last pass, the next event is the witch. */
export const WITCH_DUE_S = 50;
export const LIGHTNING_EVERY_MIN_S = 30;

const rngFor = (seed: string, index: number, what: string): (() => number) => mulberry32(fnv1a32(`${seed}:${index}:${what}`));
const between = (next: () => number, min: number, max: number): number => min + (max - min) * next();

function durationOf(kind: SkyKind, index: number, seed: string): number {
  if (kind === 'witch') return PASS_S;
  if (kind === 'bats') return BATS_S;
  if (kind === 'lightning') return LIGHTNING_S;
  return between(rngFor(seed, index, 'star-duration'), STAR_MIN_S, STAR_MAX_S);
}

const cache = new Map<string, SkyEvent[]>();

/** Every event that starts at or before `until`, from the first (the witch at `firstStart`), in order. */
export function skySchedule(firstStart: number, until: number, seed: string = SKY_SEED): SkyEvent[] {
  const key = `${seed}@${firstStart}`;
  let events = cache.get(key);
  if (events === undefined) {
    events = [{ kind: 'witch', index: 0, start: firstStart, duration: PASS_S }];
    cache.set(key, events);
  }
  const opening = (() => {
    const order: SkyKind[] = ['bats', 'star', 'lightning'];
    const next = rngFor(seed, 0, 'opening-order');
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return order;
  })();
  while (events[events.length - 1]!.start <= until) {
    const last = events[events.length - 1]!;
    const index = last.index + 1;
    const start = last.start + last.duration + between(rngFor(seed, index, 'gap'), QUIET_MIN_S, QUIET_MAX_S);
    const lastOf = (kind: SkyKind): number => {
      for (let i = events.length - 1; i >= 0; i--) if (events[i]!.kind === kind) return events[i]!.start;
      return -Infinity;
    };
    let kind: SkyKind;
    if (index <= opening.length) kind = opening[index - 1]!;
    else if (start - lastOf('witch') >= WITCH_DUE_S) kind = 'witch';
    else {
      const choices: Array<[SkyKind, number]> = [
        ['bats', 1],
        ['star', 1.5],
        ['lightning', 0.8],
        ['witch', 1],
      ];
      const allowed = choices.filter(
        ([k]) =>
          k !== last.kind &&
          (k !== 'witch' || start - lastOf('witch') >= WITCH_EVERY_MIN_S) &&
          (k !== 'lightning' || start - lastOf('lightning') >= LIGHTNING_EVERY_MIN_S),
      );
      const total = allowed.reduce((s, [, w]) => s + w, 0);
      let r = rngFor(seed, index, 'kind')() * total;
      kind = allowed[allowed.length - 1]![0];
      for (const [k, w] of allowed) {
        if (r < w) {
          kind = k;
          break;
        }
        r -= w;
      }
    }
    events.push({ kind, index, start, duration: durationOf(kind, index, seed) });
  }
  return events.filter((e) => e.start <= until);
}

/** The event in the sky at `seconds`, and how far into it; null between events, before the first, and always under reduced motion. */
export function skyEventAt(seconds: number, firstStart: number, reducedMotion: boolean, seed: string = SKY_SEED): (SkyEvent & { elapsed: number }) | null {
  if (reducedMotion || seconds < firstStart) return null;
  const events = skySchedule(firstStart, seconds, seed);
  const e = events[events.length - 1]!;
  const elapsed = seconds - e.start;
  return elapsed <= e.duration ? { ...e, elapsed } : null;
}

// ---- The witch, now scheduled by the director ----

/** The start times of the witch's passes up to `until`. */
export const passStarts = (firstStart: number, until: number, seed: string = SKY_SEED): number[] =>
  skySchedule(firstStart, until, seed)
    .filter((e) => e.kind === 'witch')
    .map((e) => e.start);

export function witchAt(seconds: number, firstStart: number, reducedMotion: boolean, seed: string = SKY_SEED): WitchState | null {
  const e = skyEventAt(seconds, firstStart, reducedMotion, seed);
  if (e === null || e.kind !== 'witch') return null;
  const u = e.elapsed / PASS_S;
  const at = arcAt(u);
  return { azimuthDeg: at.azimuthDeg, elevationDeg: at.elevationDeg + BOB_DEG * Math.sin((2 * Math.PI * e.elapsed) / BOB_PERIOD_S), progress: u, opacity: passOpacity(e.elapsed), elapsed: e.elapsed };
}

// ---- Shared geometry on the sky ----

export interface SkyPoint {
  azimuthDeg: number;
  elevationDeg: number;
}
const MOON: SkyPoint = { azimuthDeg: MOON_AZIMUTH_DEG, elevationDeg: MOON_ELEVATION_DEG };
const COS_EL = Math.cos((MOON_ELEVATION_DEG * Math.PI) / 180);
const flat = (p: SkyPoint): { x: number; y: number } => ({ x: p.azimuthDeg * COS_EL, y: p.elevationDeg });

/** The least angle from `p` to the segment from `a` to `b`, in degrees (flat: small angles). */
export function distanceToSegmentDeg(p: SkyPoint, a: SkyPoint, b: SkyPoint): number {
  const [P, A, B] = [flat(p), flat(a), flat(b)];
  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2));
  return Math.hypot(P.x - (A.x + abx * t), P.y - (A.y + aby * t));
}
const lerp = (a: SkyPoint, b: SkyPoint, t: number): SkyPoint => ({ azimuthDeg: a.azimuthDeg + (b.azimuthDeg - a.azimuthDeg) * t, elevationDeg: a.elevationDeg + (b.elevationDeg - a.elevationDeg) * t });
const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

// ---- Shooting stars ----

/** A shooting star keeps at least this far from the moon's middle: clear of its halo. */
export const STAR_MOON_CLEARANCE_DEG = MOON_GLOW_ANGULAR_RADIUS_DEG + 0.5;
/** It stays in the upper sky: above this, and below the top of the frame. */
// Revised after the first screenshot: the default view shows the sky from the treetops (about 6°) to about 12.5°, and a star at
// 10° to 12.4° was hidden under the search box at the top of the window.
export const STAR_LOWEST_DEG = 7.0;
export const STAR_HIGHEST_DEG = 9.6; // second screenshot: above about 9.6° it ran under the panels along the top
export const STAR_TAIL_DEG = 1.6;

export interface StarPath {
  from: SkyPoint;
  to: SkyPoint;
  duration: number;
}

/** The path of shooting star `index`: a short, slightly falling streak in the upper sky, never across the moon or its halo. */
export function starPath(index: number, seed: string = SKY_SEED): StarPath {
  const next = rngFor(seed, index, 'star');
  const duration = durationOf('star', index, seed);
  for (let tries = 0; tries < 60; tries++) {
    const from = { azimuthDeg: between(next, -36, 28), elevationDeg: between(next, 8.6, STAR_HIGHEST_DEG) };
    const length = between(next, 4, 6.5);
    const fall = (between(next, 8, 20) * Math.PI) / 180;
    const sign = next() < 0.5 ? -1 : 1;
    const to = { azimuthDeg: from.azimuthDeg + (sign * length * Math.cos(fall)) / COS_EL, elevationDeg: from.elevationDeg - length * Math.sin(fall) };
    if (to.elevationDeg < STAR_LOWEST_DEG || to.azimuthDeg < -40 || to.azimuthDeg > 30) continue;
    if (distanceToSegmentDeg(MOON, from, to) < STAR_MOON_CLEARANCE_DEG) continue;
    return { from, to, duration };
  }
  // A fixed path well to the right of the moon, should every try fail.
  return { from: { azimuthDeg: 6, elevationDeg: 9.4 }, to: { azimuthDeg: 12, elevationDeg: 8.0 }, duration };
}

/** The streak `elapsed` seconds in: its head, the end of its tail, and its brightness (in fast, out at the end). */
export function starAt(path: StarPath, elapsed: number): { head: SkyPoint; tail: SkyPoint; brightness: number } {
  const u = Math.min(1, Math.max(0, elapsed / path.duration));
  const travelled = 1 - (1 - u) * (1 - u) * 0.35 - 0.65 * (1 - u); // quick at first, easing a little
  const length = Math.hypot(flat(path.to).x - flat(path.from).x, flat(path.to).y - flat(path.from).y);
  const head = lerp(path.from, path.to, travelled);
  const tail = lerp(path.from, path.to, Math.max(0, travelled - STAR_TAIL_DEG / length));
  return { head, tail, brightness: Math.min(smooth(u / 0.12), smooth((1 - u) / 0.35)) };
}

// ---- Bats ----

export const BAT_MIN = 4;
export const BAT_MAX = 7;
/** A bat's half-width on the sky at the start; it shrinks to BAT_FAR_SHARE of it as it flies off beyond the moon. */
export const BAT_HALF_SIZE_DEG = 0.85; // from 0.5: specks in the first screenshot
export const BAT_FAR_SHARE = 0.25;
/** Each bat flies from about this far to the side of the moon, passes it, and goes on this far beyond it. */
export const BAT_FROM_DEG = 14;
export const BAT_BEYOND_DEG = 5;
/** Where a bat's path crosses the moon's azimuth: within this of its middle, across or beside the disc. */
export const BAT_PASS_DEG = 1.4;
export const BAT_LOWEST_DEG = 7.6;

export interface BatPath {
  from: SkyPoint;
  to: SkyPoint;
  /** Seconds after the flight's start that this bat sets off; it arrives at the flight's end. */
  delay: number;
  /** Wing beats a second, and where in its beat it starts. */
  flapHz: number;
  phase: number;
}

/** The bats of flight `index`: 4 to 7, from one side toward the moon, past it and away. */
export function batFlight(index: number, seed: string = SKY_SEED): BatPath[] {
  const next = rngFor(seed, index, 'bats');
  const count = BAT_MIN + Math.floor(next() * (BAT_MAX - BAT_MIN + 1));
  const side = next() < 0.5 ? -1 : 1; // -1: from the left
  const bats: BatPath[] = [];
  for (let i = 0; i < count; i++) {
    const across = MOON_ELEVATION_DEG + between(next, -0.7, BAT_PASS_DEG * 0.8); // never much below the disc: the treetops are there
    const fromEl = between(next, BAT_LOWEST_DEG + 0.2, MOON_ELEVATION_DEG - 0.2);
    const fromAz = MOON_AZIMUTH_DEG + side * (BAT_FROM_DEG + between(next, -1.5, 1.5)) / COS_EL;
    const slope = (across - fromEl) / (MOON_AZIMUTH_DEG - fromAz);
    const toAz = MOON_AZIMUTH_DEG - side * (BAT_BEYOND_DEG / COS_EL);
    bats.push({
      from: { azimuthDeg: fromAz, elevationDeg: fromEl },
      to: { azimuthDeg: toAz, elevationDeg: Math.max(BAT_LOWEST_DEG + 0.3, Math.min(SKY_TOP_DEG - 1, across + slope * (toAz - MOON_AZIMUTH_DEG))) },
      delay: between(next, 0, 0.9),
      flapHz: between(next, 6, 8.5),
      phase: next() * 2 * Math.PI,
    });
  }
  return bats;
}

/** Where a bat is `elapsed` seconds into the flight, its size, its wings (-1 down to 1 up) and opacity; null before it sets off. */
export function batAt(bat: BatPath, elapsed: number): { at: SkyPoint; halfSizeDeg: number; wings: number; opacity: number } | null {
  if (elapsed < bat.delay) return null;
  const u = Math.min(1, (elapsed - bat.delay) / (BATS_S - bat.delay));
  // Flying away from the viewer: it covers less sky as it goes, and gets smaller.
  const along = 1 - (1 - u) * (1 - u) * 0.3 - 0.7 * (1 - u);
  return {
    at: lerp(bat.from, bat.to, along),
    // Full size up to the moon (about two thirds of the way), then smaller and smaller beyond it (second screenshot: they had
    // already shrunk by the time they crossed it).
    halfSizeDeg: BAT_HALF_SIZE_DEG * (1 - (1 - BAT_FAR_SHARE) * smooth((u - 0.6) / 0.4)),
    wings: Math.sin(2 * Math.PI * bat.flapHz * elapsed + bat.phase),
    opacity: Math.min(smooth(u / 0.1), smooth((1 - u) / 0.3)),
  };
}

// ---- Distant lightning ----

/** At most this many flashes in one lightning event; each lasts FLASH_S, with at least FLASH_GAP_S of dark between two. */
export const MAX_FLASHES = 2;
export const FLASH_MIN_S = 0.08;
export const FLASH_MAX_S = 0.13;
export const FLASH_GAP_S = 0.3;
/** The glow behind the clouds: an ellipse low over the forest, this wide and tall (half-sizes), never lower than GLOW_LOWEST_DEG. */
export const GLOW_HALF_W_DEG = 6;
export const GLOW_HALF_H_DEG = 2.6;
// Revised after the first screenshot: centred at 6.8° it was mostly behind the trees, and could not be seen.
export const GLOW_CENTRE_DEG = 7.6;
export const GLOW_LOWEST_DEG = GLOW_CENTRE_DEG - GLOW_HALF_H_DEG;
/** How bright the glow is at its brightest, as added light on the sky (0 to 1); the fork, thin, a little brighter. */
export const GLOW_PEAK = 0.24;
export const FORK_PEAK = 0.45;
/** Lightning keeps this far from the moon (and so from the witch's and the bats' path). */
export const LIGHTNING_MOON_CLEARANCE_DEG = 14;

export interface Lightning {
  /** The middle of the glow. */
  at: SkyPoint;
  flashes: Array<{ start: number; duration: number }>;
  /** A thin forked streak, with the first flash, or none: its points from the top down. */
  fork: SkyPoint[] | null;
  /** The fork's one branch, from a point partway down it: its points. Empty without a fork. */
  branch: SkyPoint[];
}

export function lightningOf(index: number, seed: string = SKY_SEED): Lightning {
  const next = rngFor(seed, index, 'lightning');
  const at = { azimuthDeg: between(next, MOON_AZIMUTH_DEG + LIGHTNING_MOON_CLEARANCE_DEG / COS_EL, 20), elevationDeg: GLOW_CENTRE_DEG };
  const count = next() < 0.55 ? 2 : 1;
  const first = between(next, 0.08, 0.3);
  const flashes = [{ start: first, duration: between(next, FLASH_MIN_S, FLASH_MAX_S) }];
  if (count === 2) flashes.push({ start: first + flashes[0]!.duration + between(next, FLASH_GAP_S, FLASH_GAP_S + 0.25), duration: between(next, FLASH_MIN_S, FLASH_MAX_S) });
  let fork: SkyPoint[] | null = null;
  if (next() < 0.6) {
    fork = [];
    let az = at.azimuthDeg + between(next, -2, 2);
    for (let el = GLOW_CENTRE_DEG + 2.1; el > GLOW_LOWEST_DEG + 0.4; el -= between(next, 0.45, 0.8)) {
      fork.push({ azimuthDeg: az, elevationDeg: el });
      az += between(next, -0.45, 0.45);
    }
  }
  const branch: SkyPoint[] = [];
  if (fork !== null && fork.length >= 4) {
    const from = fork[1 + Math.floor(next() * (fork.length - 3))]!;
    const side = next() < 0.5 ? -1 : 1;
    branch.push(from);
    for (let k = 1; k <= 3; k++) branch.push({ azimuthDeg: from.azimuthDeg + side * k * between(next, 0.35, 0.6), elevationDeg: Math.max(GLOW_LOWEST_DEG + 0.5, from.elevationDeg - k * between(next, 0.3, 0.55)) });
  }
  return { at, flashes, fork, branch };
}

/** How bright the flicker is `elapsed` seconds in, 0 to 1: a quick rise and fall in each flash, dark between them. */
export function flashLevel(l: Lightning, elapsed: number): number {
  let level = 0;
  for (const f of l.flashes) {
    const u = (elapsed - f.start) / f.duration;
    if (u < 0 || u > 1) continue;
    level = Math.max(level, u < 0.25 ? u / 0.25 : Math.pow(1 - (u - 0.25) / 0.75, 1.5));
  }
  return level;
}

/** The light the glow adds at a point of the sky, at full flash (0 to GLOW_PEAK): an ellipse, and nothing below GLOW_LOWEST_DEG. */
export function glowAt(l: Lightning, p: SkyPoint): number {
  if (p.elevationDeg < GLOW_LOWEST_DEG) return 0;
  const dx = ((p.azimuthDeg - l.at.azimuthDeg) * COS_EL) / GLOW_HALF_W_DEG;
  const dy = (p.elevationDeg - l.at.elevationDeg) / GLOW_HALF_H_DEG;
  const r = Math.hypot(dx, dy);
  return r >= 1 ? 0 : GLOW_PEAK * (1 - r);
}

export { MOON_ANGULAR_RADIUS_DEG, CANOPY_TOP_DEG, skyDistanceDeg };
