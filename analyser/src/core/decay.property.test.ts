import fc from 'fast-check';
import { describe, it } from 'vitest';
import {
  AGE_CAP_DAYS,
  ANCIENT_MIN_DAYS,
  FRESH_MAX_DAYS,
  HOT_COMMIT_THRESHOLD,
  ageDays,
  decayScore,
  decayState,
  isHot,
} from './decay';

const age = fc.integer({ min: 0, max: 5000 });

describe('P1: decay score never decreases as time since the last commit grows', () => {
  it('holds in whole days, with or without Knip flagging the file', () => {
    fc.assert(
      fc.property(fc.boolean(), age, age, (unused, a, b) => {
        const [younger, older] = a <= b ? [a, b] : [b, a];
        return decayScore(younger, unused) <= decayScore(older, unused);
      }),
    );
  });

  it('holds from real timestamps: an earlier last commit never scores lower', () => {
    const msYear = 366 * 86_400_000;
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 1_500_000_000_000, max: 2_000_000_000_000 }), // snapshot
        fc.integer({ min: -msYear, max: 5 * msYear }), // last commit A, ms before the snapshot
        fc.integer({ min: -msYear, max: 5 * msYear }), // last commit B, ms before the snapshot
        (unused, snapshot, sinceA, sinceB) => {
          const [shorter, longer] = sinceA <= sinceB ? [sinceA, sinceB] : [sinceB, sinceA];
          const scoreShorter = decayScore(ageDays(snapshot - shorter, snapshot), unused);
          const scoreLonger = decayScore(ageDays(snapshot - longer, snapshot), unused);
          return scoreShorter <= scoreLonger;
        },
      ),
    );
  });

  it('rises every day until the age cap, so moss keeps growing through the stale range', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.integer({ min: 0, max: AGE_CAP_DAYS - 1 }), (unused, a) => {
        return decayScore(a, unused) < decayScore(a + 1, unused);
      }),
    );
  });
});

describe('decay score range and unused weighting', () => {
  it('is always from 0 to 1 and has at most 4 decimals', () => {
    fc.assert(
      fc.property(fc.boolean(), age, (unused, a) => {
        const s = decayScore(a, unused);
        return s >= 0 && s <= 1 && Math.round(s * 10_000) / 10_000 === s;
      }),
    );
  });

  it('never lowers the score when a file is unused', () => {
    fc.assert(fc.property(age, (a) => decayScore(a, true) >= decayScore(a, false)));
  });

  it('puts every unused file above every used file', () => {
    fc.assert(fc.property(age, age, (a, b) => decayScore(a, true) > decayScore(b, false)));
  });
});

describe('decay state and hot flag', () => {
  it('matches the thresholds for any age', () => {
    fc.assert(
      fc.property(age, (a) => {
        const expected = a < FRESH_MAX_DAYS ? 'fresh' : a <= ANCIENT_MIN_DAYS ? 'stale' : 'ancient';
        return decayState(a) === expected;
      }),
    );
  });

  it('only moves forward from fresh to stale to ancient as age grows', () => {
    const rank = { fresh: 0, stale: 1, ancient: 2 } as const;
    fc.assert(
      fc.property(age, age, (a, b) => {
        const [younger, older] = a <= b ? [a, b] : [b, a];
        return rank[decayState(younger)] <= rank[decayState(older)];
      }),
    );
  });

  it('is hot exactly when commits reach the threshold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (n) => isHot(n) === n >= HOT_COMMIT_THRESHOLD),
    );
  });
});
