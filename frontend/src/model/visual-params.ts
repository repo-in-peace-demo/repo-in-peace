import type { DecayState, FileEntry, Ghost, RepoMeta, Thresholds } from '@shared/graveyard-schema';
import { ageDays } from './age';
import { hash01 } from './hash';
import { MAX_LEAN_DEG } from './layout-constants';
import {
  FLOOR_SHADE_DEPTH_LIMIT,
  FLOOR_SHADE_MIN,
  GHOST_FLOAT_AMPLITUDE,
  GHOST_FLOAT_SPEED,
  GHOST_OPACITY,
  GLOW,
  LEAN_MIN_DEG,
  MOSS_HEAVY,
  MOSS_STALE_MIN,
  MOSS_STALE_SPAN,
} from './visual-constants';

/**
 * How each stone and ghost looks, as plain numbers. Pure.
 *
 * Every effect has exactly one source, and no function here can read anything else:
 *   moss and lean   the file's age and its decay state, with the thresholds
 *   cracks and glow `unused`
 *   candle          `hot`
 *   ground tint     the nesting depth of the folder
 * The decay score is never read: it adds a bonus for unused files, so reading moss from it would make
 * "unused" show up as moss.
 */

const TWO_PI = 2 * Math.PI;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Moss from 0 (clean) to 1, from the file's age, by its state:
 *   fresh    0
 *   stale    0.10 up to just under 0.65, rising from `staleAfterDays` to `ancientAfterDays`
 *   ancient  0.70 (heavy) up to 1 at `decayCapDays`, and 1 after that
 * The amount follows the state, so a file whose state and age disagree still shows its state's range.
 * It never decreases as the age grows.
 */
export function mossAmount(age: number, state: DecayState, t: Thresholds): number {
  switch (state) {
    case 'fresh':
      return 0;
    case 'stale': {
      // The "+ 1" keeps the last stale day (age = ancientAfterDays) below the end of the stale range.
      const progress = clamp01((age - t.staleAfterDays) / (t.ancientAfterDays - t.staleAfterDays + 1));
      return MOSS_STALE_MIN + MOSS_STALE_SPAN * progress;
    }
    case 'ancient': {
      const progress = clamp01((age - t.ancientAfterDays) / Math.max(1, t.decayCapDays - t.ancientAfterDays));
      return MOSS_HEAVY + (1 - MOSS_HEAVY) * progress;
    }
  }
}

/**
 * The lean in degrees: 0 for fresh and stale stones, which stand upright, and for an ancient stone from
 * LEAN_MIN_DEG on its first ancient day up to MAX_LEAN_DEG at `decayCapDays`. Never more than MAX_LEAN_DEG,
 * the number the layout reserved room for.
 */
export function leanDegrees(age: number, state: DecayState, t: Thresholds): number {
  if (state !== 'ancient') return 0;
  const progress = clamp01((age - t.ancientAfterDays) / Math.max(1, t.decayCapDays - t.ancientAfterDays));
  return LEAN_MIN_DEG + (MAX_LEAN_DEG - LEAN_MIN_DEG) * progress;
}

export interface StoneVisual {
  /** 0 clean to 1 fully overgrown. */
  mossAmount: number;
  /** 0 for upright stones. */
  leanDegrees: number;
  /** Which way an ancient stone leans, in radians from 0 to 2π, from a hash of its path. */
  leanDirection: number;
  /** Cracked: the file is unused. */
  cracked: boolean;
  /** The strength of the red glow in the cracks: GLOW for an unused stone, else 0. */
  glow: number;
  /** A lit candle at the base: the file is hot. */
  candle: boolean;
  /** Where in its flicker the candle starts, in radians, from a hash of the path. */
  flickerPhase: number;
}

/** The look of one stone. Reads the file's age (from its dates), `decayState`, `unused` and `hot`, and its path for variety only. */
export function stoneVisual(file: FileEntry, meta: RepoMeta): StoneVisual {
  const age = ageDays(file.lastCommitDate, meta.snapshotDate);
  return {
    mossAmount: mossAmount(age, file.decayState, meta.thresholds),
    leanDegrees: leanDegrees(age, file.decayState, meta.thresholds),
    leanDirection: hash01(file.path, 'lean-direction') * TWO_PI,
    cracked: file.unused,
    glow: file.unused ? GLOW : 0,
    candle: file.hot,
    flickerPhase: hash01(file.path, 'flicker') * TWO_PI,
  };
}

export interface GhostVisual {
  /** 0 invisible, 1 solid. */
  opacity: number;
  /** How far it bobs, in world units. */
  floatAmplitude: number;
  /** Radians a second. */
  floatSpeed: number;
  /** Where in its bob it starts, in radians, from a hash of the path. */
  phase: number;
}

/** The look of one ghost. A ghost has no decay state, so no moss, lean, cracks or candle. */
export function ghostVisual(ghost: Ghost): GhostVisual {
  return {
    opacity: GHOST_OPACITY,
    floatAmplitude: GHOST_FLOAT_AMPLITUDE,
    floatSpeed: GHOST_FLOAT_SPEED,
    phase: hash01(ghost.path, 'float') * TWO_PI,
  };
}

/**
 * The brightness of a plot's floor, as a multiple of the root's: 1 at the root, getting a little darker with each
 * level of nesting down to FLOOR_SHADE_MIN at FLOOR_SHADE_DEPTH_LIMIT, and no darker after that.
 * It maps one fact, the nesting depth, and the legend says so.
 */
export function plotFloorShade(depth: number): number {
  const level = Math.min(Math.max(depth, 0), FLOOR_SHADE_DEPTH_LIMIT);
  return 1 - (1 - FLOOR_SHADE_MIN) * (level / FLOOR_SHADE_DEPTH_LIMIT);
}
