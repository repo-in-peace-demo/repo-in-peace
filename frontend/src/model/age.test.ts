import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MS_PER_DAY, ageDays } from './age';

const iso = (ms: number): string => new Date(ms).toISOString();
const SNAPSHOT = '2026-03-01T12:00:00.000Z';
const snapshotMs = Date.parse(SNAPSHOT);

describe('ageDays', () => {
  it('counts whole days, rounding down', () => {
    expect(ageDays(iso(snapshotMs - 23 * 3_600_000), SNAPSHOT)).toBe(0);
    expect(ageDays(iso(snapshotMs - MS_PER_DAY), SNAPSHOT)).toBe(1);
    expect(ageDays(iso(snapshotMs - (2 * MS_PER_DAY - 1)), SNAPSHOT)).toBe(1);
    expect(ageDays(iso(snapshotMs - 2 * MS_PER_DAY), SNAPSHOT)).toBe(2);
  });

  it('is 0 for a commit at the snapshot', () => {
    expect(ageDays(SNAPSHOT, SNAPSHOT)).toBe(0);
  });

  it('is 0 for a commit dated after the snapshot', () => {
    expect(ageDays(iso(snapshotMs + 5 * MS_PER_DAY), SNAPSHOT)).toBe(0);
  });

  it('matches the oikos_ledger example: 2026-07-29 to 2026-08-18 is 19 days', () => {
    expect(ageDays('2026-07-29T22:52:51.000Z', '2026-08-18T00:38:17.000Z')).toBe(19);
  });

  it('is measured between the two dates given, never from today', () => {
    expect(ageDays('2001-01-01T00:00:00.000Z', '2001-01-11T00:00:00.000Z')).toBe(10);
  });
});

describe('ageDays properties', () => {
  const ms = fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 });

  it('is a whole number, never negative, and equals the rounded-down difference when the commit is not later', () => {
    fc.assert(
      fc.property(ms, ms, (last, snap) => {
        const age = ageDays(iso(last), iso(snap));
        const expected = last >= snap ? 0 : Math.floor((snap - last) / MS_PER_DAY);
        return Number.isInteger(age) && age >= 0 && age === expected;
      }),
    );
  });

  it('never decreases as the last commit gets earlier', () => {
    fc.assert(
      fc.property(ms, ms, ms, (snap, a, b) => {
        const [earlier, later] = a <= b ? [a, b] : [b, a];
        return ageDays(iso(earlier), iso(snap)) >= ageDays(iso(later), iso(snap));
      }),
    );
  });
});
