import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DOT_STEP_MS, progressAnnouncement, progressDots, progressWords } from './pr-progress';

describe('the progress message', () => {
  it('cycles the dots . → .. → … and back, one step every 400 ms', () => {
    expect([0, 400, 800, 1200, 1600].map((t) => progressDots(t, false))).toEqual(['.', '..', '…', '.', '..']);
    fc.assert(fc.property(fc.nat(10_000_000), (t) => progressDots(t, false) === progressDots(t + 3 * DOT_STEP_MS, false)));
  });

  it('shows a fixed "…" under reduced motion', () => {
    fc.assert(fc.property(fc.nat(100_000), (t) => progressDots(t, true) === '…'));
  });

  it('says "Still working" from 10 seconds on, and tells a screen reader only at the start and at that change', () => {
    expect(progressWords(9_999)).toBe('Opening pull request');
    expect(progressWords(10_000)).toBe('Still working');
    const said = new Set(Array.from({ length: 300 }, (_, i) => progressAnnouncement(i * 100, 'o/r')));
    expect([...said]).toEqual(['Opening a pull request on o/r.', 'Still working on the pull request on o/r.']);
  });
});
