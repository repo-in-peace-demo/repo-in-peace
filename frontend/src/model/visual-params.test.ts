import { describe, expect, it } from 'vitest';
import type { FileEntry, Ghost, RepoMeta, Thresholds } from '@shared/graveyard-schema';
import { SYNTHETIC_THRESHOLDS } from './synthetic';
import { DEFAULT_THRESHOLDS, makeFileCase } from '../../test/arbitraries';
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
import { ghostVisual, leanDegrees, mossAmount, plotFloorShade, stoneVisual } from './visual-params';

// The oikos_ledger thresholds: stale from 21 days, ancient after 45, decay cap 90.
const T = SYNTHETIC_THRESHOLDS;
const TWO_PI = 2 * Math.PI;

describe('the visual constants', () => {
  it('keep every stale moss amount below the heavy level, and the heavy level below full', () => {
    expect(MOSS_STALE_MIN).toBeGreaterThan(0);
    expect(MOSS_STALE_MIN + MOSS_STALE_SPAN).toBeLessThan(MOSS_HEAVY);
    expect(MOSS_HEAVY).toBeLessThan(1);
  });

  it('keep the lean positive and below the largest lean the layout reserved room for', () => {
    expect(LEAN_MIN_DEG).toBeGreaterThan(0);
    expect(LEAN_MIN_DEG).toBeLessThan(MAX_LEAN_DEG);
  });

  it('keep the glow faint but visible, the ghost see-through, and the floor tint subtle', () => {
    expect(GLOW).toBeGreaterThan(0);
    expect(GLOW).toBeLessThanOrEqual(1);
    expect(GHOST_OPACITY).toBeGreaterThan(0);
    expect(GHOST_OPACITY).toBeLessThan(1);
    expect(GHOST_FLOAT_AMPLITUDE).toBeGreaterThan(0);
    expect(GHOST_FLOAT_SPEED).toBeGreaterThan(0);
    expect(FLOOR_SHADE_MIN).toBeGreaterThanOrEqual(0.5); // no darker than half
    expect(FLOOR_SHADE_MIN).toBeLessThan(1);
    expect(FLOOR_SHADE_DEPTH_LIMIT).toBeGreaterThan(0);
  });
});

describe('moss amount and lean at the edges, with thresholds 21 / 45 / cap 90', () => {
  it('is clean and upright for a fresh stone, however the age is', () => {
    expect([0, 10, 20].map((age) => mossAmount(age, 'fresh', T))).toEqual([0, 0, 0]);
    expect([0, 10, 20].map((age) => leanDegrees(age, 'fresh', T))).toEqual([0, 0, 0]);
  });

  it('begins at the first stale day with the least moss and no lean', () => {
    expect(mossAmount(21, 'stale', T)).toBeCloseTo(MOSS_STALE_MIN, 12);
    expect(leanDegrees(21, 'stale', T)).toBe(0);
  });

  it('grows through the stale days, and the last stale day (45) is still below the heavy level', () => {
    const amounts = [21, 30, 40, 44, 45].map((age) => mossAmount(age, 'stale', T));
    for (let i = 1; i < amounts.length; i++) expect(amounts[i]!).toBeGreaterThan(amounts[i - 1]!);
    expect(amounts[amounts.length - 1]!).toBeLessThan(MOSS_STALE_MIN + MOSS_STALE_SPAN);
    expect(mossAmount(44, 'stale', T)).toBeCloseTo(MOSS_STALE_MIN + MOSS_STALE_SPAN * (23 / 25), 12);
    expect(mossAmount(45, 'stale', T)).toBeCloseTo(MOSS_STALE_MIN + MOSS_STALE_SPAN * (24 / 25), 12);
    expect(leanDegrees(45, 'stale', T)).toBe(0);
  });

  it('is heavily overgrown and leaning from the first ancient day (46), more as it ages, and full at the cap', () => {
    expect(mossAmount(46, 'ancient', T)).toBeCloseTo(MOSS_HEAVY + (1 - MOSS_HEAVY) * (1 / 45), 12);
    expect(leanDegrees(46, 'ancient', T)).toBeCloseTo(LEAN_MIN_DEG + (MAX_LEAN_DEG - LEAN_MIN_DEG) * (1 / 45), 12);
    expect(mossAmount(46, 'ancient', T)).toBeGreaterThanOrEqual(MOSS_HEAVY);
    expect(mossAmount(90, 'ancient', T)).toBe(1);
    expect(leanDegrees(90, 'ancient', T)).toBe(MAX_LEAN_DEG);
  });

  it('stays at full moss and the largest lean beyond the decay cap', () => {
    for (const age of [91, 200, 5000]) {
      expect(mossAmount(age, 'ancient', T)).toBe(1);
      expect(leanDegrees(age, 'ancient', T)).toBe(MAX_LEAN_DEG);
    }
  });

  it('follows the state when the age disagrees with it', () => {
    expect(mossAmount(100, 'fresh', T)).toBe(0); // old, but the file says fresh
    expect(leanDegrees(100, 'fresh', T)).toBe(0);
    expect(mossAmount(100, 'stale', T)).toBeCloseTo(MOSS_STALE_MIN + MOSS_STALE_SPAN, 12); // as mossy as a stale stone gets
    expect(leanDegrees(100, 'stale', T)).toBe(0);
    expect(mossAmount(30, 'ancient', T)).toBe(MOSS_HEAVY); // young, but the file says ancient
    expect(leanDegrees(30, 'ancient', T)).toBe(LEAN_MIN_DEG);
    expect(mossAmount(5, 'stale', T)).toBe(MOSS_STALE_MIN);
  });

  it('works with the default thresholds too: 90 / 360 / cap 720', () => {
    expect(mossAmount(89, 'fresh', DEFAULT_THRESHOLDS)).toBe(0);
    expect(mossAmount(90, 'stale', DEFAULT_THRESHOLDS)).toBeCloseTo(MOSS_STALE_MIN, 12);
    expect(mossAmount(361, 'ancient', DEFAULT_THRESHOLDS)).toBeGreaterThan(MOSS_HEAVY);
    expect(mossAmount(720, 'ancient', DEFAULT_THRESHOLDS)).toBe(1);
  });

  it('does not divide by zero when the thresholds are not valid', () => {
    const broken: Thresholds = { staleAfterDays: 5, ancientAfterDays: 5, decayCapDays: 5, hotCommits: 1, hotWindowDays: 1 };
    expect(Number.isFinite(mossAmount(7, 'ancient', broken))).toBe(true);
    expect(Number.isFinite(leanDegrees(7, 'ancient', broken))).toBe(true);
    expect(Number.isFinite(mossAmount(7, 'stale', broken))).toBe(true);
  });
});

describe('stoneVisual', () => {
  const meta: RepoMeta = makeFileCase({ age: 0, unused: false, hot: false, thresholds: T }).meta;
  const fileOf = (over: Partial<FileEntry>): FileEntry => ({ ...makeFileCase({ age: 3, unused: false, hot: false, thresholds: T }).file, ...over });

  it('shows a fresh unused stone, as in app/components/voice/index.ts of the oikos file, clean and upright but cracked and glowing', () => {
    // 19 days old under thresholds 21 / 45: fresh. Knip reports it unused.
    const { file, meta: m } = makeFileCase({ path: 'app/components/voice/index.ts', age: 19, unused: true, hot: false, thresholds: T });
    expect(file.decayState).toBe('fresh');
    const visual = stoneVisual(file, m);
    expect(visual.mossAmount).toBe(0);
    expect(visual.leanDegrees).toBe(0);
    expect(visual.cracked).toBe(true);
    expect(visual.glow).toBe(GLOW);
    expect(visual.candle).toBe(false);
  });

  it('shows a stale used stone with moss, upright, uncracked, without a candle', () => {
    const { file, meta: m } = makeFileCase({ age: 30, unused: false, hot: false, thresholds: T });
    const visual = stoneVisual(file, m);
    expect(visual.mossAmount).toBeGreaterThan(0);
    expect(visual.leanDegrees).toBe(0);
    expect(visual.cracked).toBe(false);
    expect(visual.glow).toBe(0);
    expect(visual.candle).toBe(false);
  });

  it('shows an ancient, unused, hot stone with every effect at once', () => {
    const { file, meta: m } = makeFileCase({ age: 80, unused: true, hot: true, thresholds: T });
    const visual = stoneVisual(file, m);
    expect(visual.mossAmount).toBeGreaterThan(MOSS_HEAVY);
    expect(visual.leanDegrees).toBeGreaterThan(LEAN_MIN_DEG);
    expect(visual.cracked).toBe(true);
    expect(visual.glow).toBe(GLOW);
    expect(visual.candle).toBe(true);
  });

  it('takes the candle from the hot flag alone', () => {
    expect(stoneVisual(fileOf({ hot: true }), meta).candle).toBe(true);
    expect(stoneVisual(fileOf({ hot: false, recentCommits: 99 }), meta).candle).toBe(false);
  });

  it('gives every unused stone the same glow', () => {
    const glows = [0, 10, 50, 500].map((age) => stoneVisual(makeFileCase({ age, unused: true, hot: false, thresholds: T }).file, meta).glow);
    expect(new Set(glows)).toEqual(new Set([GLOW]));
  });

  it('gives a lean direction and a flicker phase from 0 up to 2π, the same every time, and different for different paths', () => {
    const a = stoneVisual(fileOf({ path: 'src/a.ts' }), meta);
    const again = stoneVisual(fileOf({ path: 'src/a.ts' }), meta);
    const b = stoneVisual(fileOf({ path: 'src/b.ts' }), meta);
    expect(again).toEqual(a);
    for (const v of [a, b]) {
      expect(v.leanDirection).toBeGreaterThanOrEqual(0);
      expect(v.leanDirection).toBeLessThan(TWO_PI);
      expect(v.flickerPhase).toBeGreaterThanOrEqual(0);
      expect(v.flickerPhase).toBeLessThan(TWO_PI);
    }
    expect(b.leanDirection).not.toBe(a.leanDirection);
    expect(a.flickerPhase).not.toBe(a.leanDirection); // the two properties use different salts
  });

  it('measures age from the snapshot date in the data file, not from today', () => {
    const old: RepoMeta = { ...meta, snapshotDate: '2001-01-31T00:00:00.000Z' };
    const file = fileOf({ lastCommitDate: '2001-01-01T00:00:00.000Z', decayState: 'stale' }); // 30 days before that snapshot
    expect(stoneVisual(file, old).mossAmount).toBeCloseTo(MOSS_STALE_MIN + MOSS_STALE_SPAN * (9 / 25), 12);
  });
});

describe('ghostVisual', () => {
  const ghost = (path: string): Ghost => ({
    path,
    deletedInSha: 'd'.repeat(40),
    deletedDate: '2026-07-01T00:00:00.000Z',
    deletedBy: 'Bob',
    lastExistingSha: 'e'.repeat(40),
  });

  it('is see-through and floats, with the constants', () => {
    const v = ghostVisual(ghost('src/gone.ts'));
    expect(v.opacity).toBe(GHOST_OPACITY);
    expect(v.floatAmplitude).toBe(GHOST_FLOAT_AMPLITUDE);
    expect(v.floatSpeed).toBe(GHOST_FLOAT_SPEED);
  });

  it('has no moss, lean, cracks or candle: only the four ghost properties', () => {
    expect(Object.keys(ghostVisual(ghost('a.ts'))).sort()).toEqual(['floatAmplitude', 'floatSpeed', 'opacity', 'phase']);
  });

  it('starts each ghost at its own point of the bob, the same every time', () => {
    const a = ghostVisual(ghost('src/a.ts'));
    expect(ghostVisual(ghost('src/a.ts'))).toEqual(a);
    expect(ghostVisual(ghost('src/b.ts')).phase).not.toBe(a.phase);
    expect(a.phase).toBeGreaterThanOrEqual(0);
    expect(a.phase).toBeLessThan(TWO_PI);
  });
});

describe('plotFloorShade', () => {
  it('is 1 at the root', () => {
    expect(plotFloorShade(0)).toBe(1);
  });

  it('gets darker with each level, evenly, down to the minimum at the depth limit', () => {
    expect(plotFloorShade(FLOOR_SHADE_DEPTH_LIMIT)).toBeCloseTo(FLOOR_SHADE_MIN, 12);
    expect(plotFloorShade(FLOOR_SHADE_DEPTH_LIMIT / 2)).toBeCloseTo((1 + FLOOR_SHADE_MIN) / 2, 12);
    for (let depth = 1; depth <= FLOOR_SHADE_DEPTH_LIMIT; depth++) {
      expect(plotFloorShade(depth)).toBeLessThan(plotFloorShade(depth - 1));
    }
  });

  it('gets no darker beyond the depth limit', () => {
    expect(plotFloorShade(FLOOR_SHADE_DEPTH_LIMIT + 1)).toBe(plotFloorShade(FLOOR_SHADE_DEPTH_LIMIT));
    expect(plotFloorShade(300)).toBe(plotFloorShade(FLOOR_SHADE_DEPTH_LIMIT));
  });

  it('treats a negative depth as the root', () => {
    expect(plotFloorShade(-3)).toBe(1);
  });
});
