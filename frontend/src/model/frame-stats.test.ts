import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FRAME_WINDOW, addFrame, emptyWindow, framesPerSecond, percentile, type FrameWindow } from './frame-stats';

const fill = (times: readonly number[], size?: number): FrameWindow => times.reduce((w, t) => addFrame(w, t, size), emptyWindow());

describe('frame statistics', () => {
  it('gives 0 for an empty window', () => {
    expect(percentile(emptyWindow(), 95)).toBe(0);
    expect(framesPerSecond(emptyWindow())).toBe(0);
  });

  it('keeps the newest FRAME_WINDOW times, oldest first', () => {
    const w = fill(Array.from({ length: FRAME_WINDOW + 20 }, (_, i) => i));
    expect(w.times).toHaveLength(FRAME_WINDOW);
    expect(w.times[0]).toBe(20);
    expect(w.times[FRAME_WINDOW - 1]).toBe(FRAME_WINDOW + 19);
  });

  it('works out a steady 60 frames a second and its percentile', () => {
    const w = fill(Array.from({ length: 120 }, () => 1000 / 60));
    expect(framesPerSecond(w)).toBeCloseTo(60, 9);
    expect(percentile(w, 95)).toBeCloseTo(1000 / 60, 9);
  });

  it('takes the 95th percentile by nearest rank: one slow frame in twenty does not set it, two do', () => {
    expect(percentile(fill([...Array(19).fill(10), 50]), 95)).toBe(10);
    expect(percentile(fill([...Array(18).fill(10), 50, 50]), 95)).toBe(50);
  });

  it('ignores times that are not finite and non-negative', () => {
    expect(fill([10, Number.NaN, -1, Number.POSITIVE_INFINITY, 20]).times).toEqual([10, 20]);
  });

  const times = fc.array(fc.double({ min: 0, max: 200, noNaN: true }), { maxLength: 400 });

  it('for any frames: at most the window size, the percentile is one of the times, between the least and the most, and never falls as p rises', () => {
    fc.assert(
      fc.property(times, fc.integer({ min: 1, max: 50 }), fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), (ts, size, p, q) => {
        const w = fill(ts, size);
        if (w.times.length > size || w.times.length !== Math.min(ts.length, size)) return false;
        if (w.times.length === 0) return percentile(w, p) === 0;
        const v = percentile(w, p);
        const [lo, hi] = [Math.min(p, q), Math.max(p, q)];
        return w.times.includes(v) && v >= Math.min(...w.times) && v <= Math.max(...w.times) && percentile(w, lo) <= percentile(w, hi);
      }),
    );
  });
});
