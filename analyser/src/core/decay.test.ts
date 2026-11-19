import { describe, expect, it } from 'vitest';
import {
  AGE_CAP_DAYS,
  MS_PER_DAY,
  ageDays,
  decayScore,
  decayState,
  isHot,
} from './decay';

describe('ageDays', () => {
  const snapshot = Date.parse('2026-03-01T12:00:00.000Z');

  it('counts whole days, rounding down', () => {
    expect(ageDays(snapshot - 23 * 3_600_000, snapshot)).toBe(0);
    expect(ageDays(snapshot - MS_PER_DAY, snapshot)).toBe(1);
    expect(ageDays(snapshot - (MS_PER_DAY * 2 - 1), snapshot)).toBe(1);
  });

  it('is 0 for a commit at the snapshot', () => {
    expect(ageDays(snapshot, snapshot)).toBe(0);
  });

  it('is 0 for a commit dated after the snapshot (clock skew)', () => {
    expect(ageDays(snapshot + 5 * MS_PER_DAY, snapshot)).toBe(0);
  });
});

describe('decayState boundaries', () => {
  it.each([
    [0, 'fresh'],
    [89, 'fresh'],
    [90, 'stale'],
    [360, 'stale'],
    [361, 'ancient'],
    [5000, 'ancient'],
  ] as const)('age %i is %s', (age, state) => {
    expect(decayState(age)).toBe(state);
  });
});

describe('decayScore values', () => {
  it.each([
    [0, false, 0],
    [360, false, 0.2],
    [720, false, 0.4],
    [5000, false, 0.4],
    [0, true, 0.6],
    [360, true, 0.8],
    [720, true, 1],
    [5000, true, 1],
  ] as const)('age %i, unused %s scores %d', (age, unused, score) => {
    expect(decayScore(age, unused)).toBe(score);
  });

  it('ranks a brand-new unused file above the oldest used file', () => {
    expect(decayScore(0, true)).toBeGreaterThan(decayScore(AGE_CAP_DAYS, false));
  });

  it('treats a negative age as 0', () => {
    expect(decayScore(-5, false)).toBe(0);
  });
});

describe('isHot', () => {
  it.each([
    [0, false],
    [4, false],
    [5, true],
    [40, true],
  ] as const)('%i commits in 30 days is hot: %s', (commits, hot) => {
    expect(isHot(commits)).toBe(hot);
  });
});
