import { describe, expect, it } from 'vitest';
import { MS_PER_DAY, ageDays, decayScore, decayState, isHot } from './decay';
import { DEFAULT_THRESHOLDS, thresholdsFrom } from './thresholds';

const D = DEFAULT_THRESHOLDS;

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

describe('default thresholds', () => {
  it('are the values the analyser used before they were configurable', () => {
    expect(D).toEqual({ staleAfterDays: 90, ancientAfterDays: 360, decayCapDays: 720, hotCommits: 5, hotWindowDays: 30 });
  });
});

describe('decayState boundaries with the defaults', () => {
  it.each([
    [0, 'fresh'],
    [89, 'fresh'],
    [90, 'stale'],
    [360, 'stale'],
    [361, 'ancient'],
    [5000, 'ancient'],
  ] as const)('age %i is %s', (age, state) => {
    expect(decayState(age, D)).toBe(state);
  });
});

describe('decayState boundaries with other thresholds', () => {
  const t = thresholdsFrom({ staleAfterDays: 7, ancientAfterDays: 30, hotCommits: 3, hotWindowDays: 14 });

  it.each([
    [0, 'fresh'],
    [6, 'fresh'],
    [7, 'stale'],
    [30, 'stale'],
    [31, 'ancient'],
  ] as const)('age %i is %s', (age, state) => {
    expect(decayState(age, t)).toBe(state);
  });

  it('works when the stale range is a single day', () => {
    const narrow = thresholdsFrom({ staleAfterDays: 10, ancientAfterDays: 11, hotCommits: 5, hotWindowDays: 30 });
    expect([9, 10, 11, 12].map((age) => decayState(age, narrow))).toEqual(['fresh', 'stale', 'stale', 'ancient']);
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
  ] as const)('with the defaults, age %i, unused %s scores %d', (age, unused, score) => {
    expect(decayScore(age, unused, D)).toBe(score);
  });

  it('ranks a brand-new unused file above the oldest used file', () => {
    expect(decayScore(0, true, D)).toBeGreaterThan(decayScore(D.decayCapDays, false, D));
  });

  it('treats a negative age as 0', () => {
    expect(decayScore(-5, false, D)).toBe(0);
  });

  it('grows until the cap, which is twice ancientAfterDays, and then stops', () => {
    const t = thresholdsFrom({ staleAfterDays: 10, ancientAfterDays: 50, hotCommits: 5, hotWindowDays: 30 }); // cap 100
    expect(t.decayCapDays).toBe(100);
    expect(decayScore(50, false, t)).toBe(0.2);
    expect(decayScore(100, false, t)).toBe(0.4);
    expect(decayScore(101, false, t)).toBe(0.4);
    expect(decayScore(100, true, t)).toBe(1);
  });

  it('scores the same age lower when the cap is further away', () => {
    const near = thresholdsFrom({ staleAfterDays: 10, ancientAfterDays: 50, hotCommits: 5, hotWindowDays: 30 });
    const far = thresholdsFrom({ staleAfterDays: 10, ancientAfterDays: 500, hotCommits: 5, hotWindowDays: 30 });
    expect(decayScore(60, false, near)).toBeGreaterThan(decayScore(60, false, far));
  });
});

describe('isHot', () => {
  it.each([
    [0, false],
    [4, false],
    [5, true],
    [40, true],
  ] as const)('with the defaults, %i commits is hot: %s', (commits, hot) => {
    expect(isHot(commits, D)).toBe(hot);
  });

  it('uses the configured number of commits', () => {
    const t = thresholdsFrom({ staleAfterDays: 90, ancientAfterDays: 360, hotCommits: 2, hotWindowDays: 7 });
    expect([1, 2, 3].map((n) => isHot(n, t))).toEqual([false, true, true]);
  });
});
