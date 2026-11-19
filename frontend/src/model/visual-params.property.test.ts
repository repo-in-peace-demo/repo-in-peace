import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@shared/graveyard-schema';
import {
  ageFromThousandths,
  decayStateFor,
  fileCaseArb,
  filePathArb,
  makeFileCase,
  thresholdsArb,
} from '../../test/arbitraries';
import { MAX_LEAN_DEG } from './layout-constants';
import { FLOOR_SHADE_MIN, MOSS_HEAVY, MOSS_STALE_MIN, MOSS_STALE_SPAN } from './visual-constants';
import { leanDegrees, mossAmount, plotFloorShade, stoneVisual, type StoneVisual } from './visual-params';

/**
 * Properties of the visual parameters: requirements P5 (moss and lean), P8 (each effect has one source),
 * P9 (moss ranges) and P17 (the floor tint). Files are built with a state and a score that agree with their age and
 * thresholds, as the analyser writes them, and the thresholds are random valid ones.
 */

const STATES = ['fresh', 'stale', 'ancient'] as const;
const thousandths = fc.integer({ min: 0, max: 1500 });
const TWO_PI = 2 * Math.PI;

/** The parts of a stone's look that come from data, apart from the variety the hash adds. */
const dataEffects = (v: StoneVisual) => ({
  mossAmount: v.mossAmount,
  leanDegrees: v.leanDegrees,
  cracked: v.cracked,
  glow: v.glow,
  candle: v.candle,
});

describe('P5: moss never decreases as the decay score rises, and only ancient stones lean', () => {
  it('moss does not decrease when the score rises, for files in the same state with the same unused flag', () => {
    fc.assert(
      fc.property(thresholdsArb, thousandths, thousandths, fc.boolean(), (t, a, b, unused) => {
        const first = makeFileCase({ age: ageFromThousandths(a, t), unused, hot: false, thresholds: t });
        const second = makeFileCase({ age: ageFromThousandths(b, t), unused, hot: false, thresholds: t });
        if (first.file.decayState !== second.file.decayState) return true;
        if (!(first.file.decayScore < second.file.decayScore)) return true;
        return stoneVisual(first.file, first.meta).mossAmount <= stoneVisual(second.file, second.meta).mossAmount;
      }),
      { numRuns: 500 },
    );
  });

  it('a fresh or stale stone is exactly upright, and an ancient one leans, never more than the largest lean', () => {
    fc.assert(
      fc.property(fileCaseArb, ({ file, meta }) => {
        const { leanDegrees: lean } = stoneVisual(file, meta);
        return file.decayState === 'ancient' ? lean > 0 && lean <= MAX_LEAN_DEG : lean === 0;
      }),
    );
  });

  it('the lean of an ancient stone does not decrease as it ages', () => {
    fc.assert(
      fc.property(thresholdsArb, thousandths, thousandths, (t, a, b) => {
        const [younger, older] = a <= b ? [a, b] : [b, a];
        const ageA = ageFromThousandths(younger, t);
        const ageB = ageFromThousandths(older, t);
        return leanDegrees(ageA, 'ancient', t) <= leanDegrees(ageB, 'ancient', t);
      }),
    );
  });

  it('the lean never exceeds the largest lean, for any age and state', () => {
    fc.assert(
      fc.property(
        thresholdsArb,
        fc.integer({ min: -10, max: 100_000 }),
        fc.constantFrom(...STATES),
        (t, age, state) => leanDegrees(age, state, t) <= MAX_LEAN_DEG,
      ),
    );
  });
});

describe('P9: moss ranges', () => {
  it('is 0 for fresh, and positive for stale and ancient', () => {
    fc.assert(
      fc.property(fileCaseArb, ({ file, meta }) => {
        const moss = stoneVisual(file, meta).mossAmount;
        return file.decayState === 'fresh' ? moss === 0 : moss > 0;
      }),
    );
  });

  it('stays below the heavy level for stale and reaches it for ancient, within 0 to 1 always', () => {
    fc.assert(
      fc.property(fileCaseArb, ({ file, meta }) => {
        const moss = stoneVisual(file, meta).mossAmount;
        if (moss < 0 || moss > 1) return false;
        if (file.decayState === 'stale') return moss >= MOSS_STALE_MIN && moss < MOSS_HEAVY;
        if (file.decayState === 'ancient') return moss >= MOSS_HEAVY;
        return true;
      }),
    );
  });

  it('stays strictly below the top of the stale range for every stale day, not only the clamped one', () => {
    fc.assert(
      fc.property(thresholdsArb, fc.nat(100_000), (t, n) => {
        const age = t.staleAfterDays + (n % (t.ancientAfterDays - t.staleAfterDays + 1)); // a stale day: from stale-after to ancient-after
        const moss = mossAmount(age, 'stale', t);
        return moss >= MOSS_STALE_MIN && moss < MOSS_STALE_MIN + MOSS_STALE_SPAN;
      }),
    );
  });

  it('does not decrease as the age grows within a state, for any age and any thresholds', () => {
    fc.assert(
      fc.property(
        thresholdsArb,
        fc.constantFrom(...STATES),
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 5000 }),
        (t, state, a, b) => {
          const [younger, older] = a <= b ? [a, b] : [b, a];
          return mossAmount(younger, state, t) <= mossAmount(older, state, t);
        },
      ),
    );
  });

  it('does not decrease as a file ages through all three states', () => {
    fc.assert(
      fc.property(thresholdsArb, thousandths, thousandths, (t, a, b) => {
        const [younger, older] = a <= b ? [a, b] : [b, a];
        const ageA = ageFromThousandths(younger, t);
        const ageB = ageFromThousandths(older, t);
        return mossAmount(ageA, decayStateFor(ageA, t), t) <= mossAmount(ageB, decayStateFor(ageB, t), t);
      }),
    );
  });

  it('is full from the decay cap on', () => {
    fc.assert(
      fc.property(thresholdsArb, fc.nat(10_000), (t, extra) => Math.abs(mossAmount(t.decayCapDays + extra, 'ancient', t) - 1) < 1e-12),
    );
  });

  it('is exactly the least stale moss on the first stale day, and just above the heavy level on the first ancient day', () => {
    fc.assert(
      fc.property(thresholdsArb, (t) => {
        const first = mossAmount(t.staleAfterDays, 'stale', t);
        const firstAncient = mossAmount(t.ancientAfterDays + 1, 'ancient', t);
        return Math.abs(first - MOSS_STALE_MIN) < 1e-12 && firstAncient > MOSS_HEAVY && firstAncient < 1 + 1e-12;
      }),
    );
  });
});

describe('P8: each effect has one source', () => {
  /** `case` with the given fields of the file changed. */
  const withFile = (c: { file: FileEntry }, changes: Partial<FileEntry>): FileEntry => ({ ...c.file, ...changes });

  it('flipping `unused` changes the cracks and the glow, and nothing else', () => {
    fc.assert(
      fc.property(fileCaseArb, (c) => {
        const before = stoneVisual(c.file, c.meta);
        const after = stoneVisual(withFile(c, { unused: !c.file.unused }), c.meta);
        const { cracked: _c1, glow: _g1, ...restBefore } = before;
        const { cracked: _c2, glow: _g2, ...restAfter } = after;
        return after.cracked !== before.cracked && after.glow !== before.glow && JSON.stringify(restAfter) === JSON.stringify(restBefore);
      }),
    );
  });

  it('flipping `hot` changes the candle, and nothing else', () => {
    fc.assert(
      fc.property(fileCaseArb, (c) => {
        const before = stoneVisual(c.file, c.meta);
        const after = stoneVisual(withFile(c, { hot: !c.file.hot }), c.meta);
        const { candle: _a, ...restBefore } = before;
        const { candle: _b, ...restAfter } = after;
        return after.candle !== before.candle && JSON.stringify(restAfter) === JSON.stringify(restBefore);
      }),
    );
  });

  it('ignores the decay score: any score gives the same look, so "unused" cannot show up as moss', () => {
    fc.assert(
      fc.property(fileCaseArb, fc.double({ min: 0, max: 1, noNaN: true }), (c, score) => {
        return JSON.stringify(stoneVisual(withFile(c, { decayScore: score }), c.meta)) === JSON.stringify(stoneVisual(c.file, c.meta));
      }),
    );
  });

  it('ignores size, recent commits, folder, author and eulogy', () => {
    fc.assert(
      fc.property(fileCaseArb, fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 500 }), fc.string({ maxLength: 12 }), (c, loc, commits, text) => {
        const other = withFile(c, { linesOfCode: loc, recentCommits: commits, folder: text, lastCommitAuthor: text, eulogy: text });
        return JSON.stringify(stoneVisual(other, c.meta)) === JSON.stringify(stoneVisual(c.file, c.meta));
      }),
    );
  });

  it('changing the age within a state changes only moss and lean; the cracks, glow, candle and hash variety stay', () => {
    fc.assert(
      fc.property(thresholdsArb, thousandths, thousandths, fc.boolean(), fc.boolean(), filePathArb, (t, a, b, unused, hot, path) => {
        const first = makeFileCase({ path, age: ageFromThousandths(a, t), unused, hot, thresholds: t });
        const second = makeFileCase({ path, age: ageFromThousandths(b, t), unused, hot, thresholds: t });
        if (first.file.decayState !== second.file.decayState) return true;
        const v1 = stoneVisual(first.file, first.meta);
        const v2 = stoneVisual(second.file, second.meta);
        return (
          v1.cracked === v2.cracked &&
          v1.glow === v2.glow &&
          v1.candle === v2.candle &&
          v1.leanDirection === v2.leanDirection &&
          v1.flickerPhase === v2.flickerPhase
        );
      }),
    );
  });

  it('changing only the path changes only the variety that comes from the hash: the data effects stay', () => {
    fc.assert(
      fc.property(fileCaseArb, filePathArb, (c, path) => {
        const moved = stoneVisual(withFile(c, { path }), c.meta);
        return JSON.stringify(dataEffects(moved)) === JSON.stringify(dataEffects(stoneVisual(c.file, c.meta)));
      }),
    );
  });

  it('gives the same look every time, and a lean direction and flicker phase in [0, 2π)', () => {
    fc.assert(
      fc.property(fileCaseArb, (c) => {
        const v = stoneVisual(c.file, c.meta);
        return (
          JSON.stringify(v) === JSON.stringify(stoneVisual(c.file, c.meta)) &&
          v.leanDirection >= 0 &&
          v.leanDirection < TWO_PI &&
          v.flickerPhase >= 0 &&
          v.flickerPhase < TWO_PI
        );
      }),
    );
  });

  it('shows the cracks of an unused stone and no others, whatever the state', () => {
    fc.assert(
      fc.property(fileCaseArb, ({ file, meta }) => {
        const v = stoneVisual(file, meta);
        return v.cracked === file.unused && (v.glow > 0) === file.unused;
      }),
    );
  });
});

describe('P17: the floor tint', () => {
  const depth = fc.integer({ min: 0, max: 400 });

  it('is the lightest at the root, and never lighter at a greater depth', () => {
    fc.assert(
      fc.property(depth, depth, (a, b) => {
        const [shallower, deeper] = a <= b ? [a, b] : [b, a];
        return plotFloorShade(shallower) >= plotFloorShade(deeper) && plotFloorShade(0) >= plotFloorShade(shallower);
      }),
    );
  });

  it('stays within the subtle range, from the minimum to 1', () => {
    fc.assert(
      fc.property(depth, (d) => {
        const shade = plotFloorShade(d);
        return shade >= FLOOR_SHADE_MIN - 1e-12 && shade <= 1 && Number.isFinite(shade);
      }),
    );
  });

  it('is 1 at the root and stops getting darker from the depth limit on', () => {
    expect(plotFloorShade(0)).toBe(1);
    fc.assert(fc.property(fc.integer({ min: 6, max: 1000 }), (d) => plotFloorShade(d) === plotFloorShade(6)));
  });
});
