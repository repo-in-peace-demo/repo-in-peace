import fc from 'fast-check';
import { describe, it } from 'vitest';
import { wideThresholdsArb } from '../../test/arbitraries';
import { ageDays, decayScore, decayState, isHot } from './decay';
import { DEFAULT_THRESHOLDS } from './thresholds';

const age = fc.integer({ min: 0, max: 20_000 });

describe('P1: decay score never decreases as time since the last commit grows, for any valid thresholds', () => {
  it('holds in whole days, with or without Knip flagging the file', () => {
    fc.assert(
      fc.property(wideThresholdsArb, fc.boolean(), age, age, (t, unused, a, b) => {
        const [younger, older] = a <= b ? [a, b] : [b, a];
        return decayScore(younger, unused, t) <= decayScore(older, unused, t);
      }),
    );
  });

  it('holds from real timestamps: an earlier last commit never scores lower', () => {
    const msYear = 366 * 86_400_000;
    fc.assert(
      fc.property(
        wideThresholdsArb,
        fc.boolean(),
        fc.integer({ min: 1_500_000_000_000, max: 2_000_000_000_000 }), // snapshot
        fc.integer({ min: -msYear, max: 5 * msYear }), // last commit A, ms before the snapshot
        fc.integer({ min: -msYear, max: 5 * msYear }), // last commit B, ms before the snapshot
        (t, unused, snapshot, sinceA, sinceB) => {
          const [shorter, longer] = sinceA <= sinceB ? [sinceA, sinceB] : [sinceB, sinceA];
          const scoreShorter = decayScore(ageDays(snapshot - shorter, snapshot), unused, t);
          const scoreLonger = decayScore(ageDays(snapshot - longer, snapshot), unused, t);
          return scoreShorter <= scoreLonger;
        },
      ),
    );
  });

  it('rises every day until the cap, so moss keeps growing, when the cap is at most 2000 days', () => {
    const smallCap = wideThresholdsArb.filter((t) => t.decayCapDays <= 2000);
    fc.assert(
      fc.property(smallCap, fc.boolean(), fc.nat(1999), (t, unused, raw) => {
        const a = raw % t.decayCapDays; // 0 .. cap - 1
        return decayScore(a, unused, t) < decayScore(a + 1, unused, t);
      }),
    );
  });

  it('stops rising at the cap, which is twice ancientAfterDays', () => {
    fc.assert(
      fc.property(wideThresholdsArb, fc.boolean(), fc.nat(5000), (t, unused, extra) => {
        return decayScore(t.decayCapDays, unused, t) === decayScore(t.decayCapDays + extra, unused, t);
      }),
    );
  });
});

describe('decay score range and unused weighting, for any valid thresholds', () => {
  it('is always from 0 to 1 and has at most 4 decimals', () => {
    fc.assert(
      fc.property(wideThresholdsArb, fc.boolean(), age, (t, unused, a) => {
        const s = decayScore(a, unused, t);
        return s >= 0 && s <= 1 && Math.round(s * 10_000) / 10_000 === s;
      }),
    );
  });

  it('never lowers the score when a file is unused', () => {
    fc.assert(fc.property(wideThresholdsArb, age, (t, a) => decayScore(a, true, t) >= decayScore(a, false, t)));
  });

  it('puts every unused file above every used file', () => {
    fc.assert(fc.property(wideThresholdsArb, age, age, (t, a, b) => decayScore(a, true, t) > decayScore(b, false, t)));
  });
});

describe('P7: decay state agrees with the thresholds', () => {
  it('is fresh below staleAfterDays, stale up to and including ancientAfterDays, ancient above', () => {
    fc.assert(
      fc.property(wideThresholdsArb, age, (t, a) => {
        const state = decayState(a, t);
        return (
          (state === 'fresh') === (a < t.staleAfterDays) &&
          (state === 'stale') === (a >= t.staleAfterDays && a <= t.ancientAfterDays) &&
          (state === 'ancient') === (a > t.ancientAfterDays)
        );
      }),
    );
  });

  it('changes exactly at the two edges: one day before staleAfterDays, and at ancientAfterDays', () => {
    fc.assert(
      fc.property(wideThresholdsArb, (t) => {
        return (
          decayState(t.staleAfterDays - 1, t) === 'fresh' &&
          decayState(t.staleAfterDays, t) === 'stale' &&
          decayState(t.ancientAfterDays, t) === 'stale' &&
          decayState(t.ancientAfterDays + 1, t) === 'ancient'
        );
      }),
    );
  });

  it('only moves forward from fresh to stale to ancient as age grows', () => {
    const rank = { fresh: 0, stale: 1, ancient: 2 } as const;
    fc.assert(
      fc.property(wideThresholdsArb, age, age, (t, a, b) => {
        const [younger, older] = a <= b ? [a, b] : [b, a];
        return rank[decayState(younger, t)] <= rank[decayState(older, t)];
      }),
    );
  });

  it('is hot exactly when commits reach hotCommits', () => {
    fc.assert(
      fc.property(wideThresholdsArb, fc.integer({ min: 0, max: 1000 }), (t, n) => isHot(n, t) === n >= t.hotCommits),
    );
  });
});

/**
 * A frozen copy of the decay rules as they were before thresholds were configurable,
 * with the numbers written out. It must never be edited to follow the code: its job is to
 * show that the defaults still give the old answers.
 */
const legacy = {
  state: (a: number) => (a < 90 ? 'fresh' : a <= 360 ? 'stale' : 'ancient'),
  score: (a: number, unused: boolean) =>
    Math.round((0.4 * (Math.min(Math.max(a, 0), 720) / 720) + (unused ? 0.6 : 0)) * 10_000) / 10_000,
  hot: (n: number) => n >= 5,
};

describe('P6 (formulas): with the default thresholds the decay functions give the old answers', () => {
  it('matches the frozen formulas for any age, unused flag and commit count', () => {
    fc.assert(
      fc.property(age, fc.boolean(), fc.integer({ min: 0, max: 200 }), (a, unused, commits) => {
        return (
          decayState(a, DEFAULT_THRESHOLDS) === legacy.state(a) &&
          decayScore(a, unused, DEFAULT_THRESHOLDS) === legacy.score(a, unused) &&
          isHot(commits, DEFAULT_THRESHOLDS) === legacy.hot(commits)
        );
      }),
      { numRuns: 2000 },
    );
  });

  it('matches at every age from -5 to 1500, both unused flags', () => {
    for (let a = -5; a <= 1500; a++) {
      for (const unused of [false, true]) {
        if (decayScore(a, unused, DEFAULT_THRESHOLDS) !== legacy.score(a, unused)) throw new Error(`score differs at ${a}`);
      }
      if (a >= 0 && decayState(a, DEFAULT_THRESHOLDS) !== legacy.state(a)) throw new Error(`state differs at ${a}`);
    }
  });
});
