import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, Throttle, type ThrottleRule } from './limits';

/** The rule written out: a request is accepted when, for every rule, fewer than `limit` accepted requests are in its window. */
function model(rules: readonly ThrottleRule[], accepted: readonly number[], t: number): boolean {
  return rules.every((r) => accepted.filter((a) => t - a < r.windowMs).length < r.limit);
}

const rulesArb = fc.uniqueArray(fc.record({ limit: fc.integer({ min: 1, max: 5 }), windowMs: fc.integer({ min: 1000, max: 120_000 }) }), { minLength: 1, maxLength: 3, selector: (r) => r.windowMs });
const gapsArb = fc.array(fc.integer({ min: 0, max: 30_000 }), { minLength: 1, maxLength: 60 });

describe('P6 (pure part): the throttle', () => {
  it('refuses exactly the requests over a rule, and counts only accepted ones', () => {
    fc.assert(
      fc.property(rulesArb, gapsArb, (rules, gaps) => {
        let now = 0;
        const throttle = new Throttle(rules, () => now);
        const accepted: number[] = [];
        for (const gap of gaps) {
          now += gap;
          const expected = model(rules, accepted, now);
          const r = throttle.take('client');
          expect(r.ok).toBe(expected);
          if (r.ok) accepted.push(now);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('gives a Retry-After at which the request fits, and not a moment before', () => {
    fc.assert(
      fc.property(rulesArb, gapsArb, (rules, gaps) => {
        let now = 0;
        const throttle = new Throttle(rules, () => now);
        const accepted: number[] = [];
        for (const gap of gaps) {
          now += gap;
          const r = throttle.take('client');
          if (r.ok) {
            accepted.push(now);
            continue;
          }
          expect(model(rules, accepted, now + r.retryAfterMs)).toBe(true);
          expect(model(rules, accepted, now + r.retryAfterMs - 1)).toBe(false);
          expect(r.retryAfterSeconds).toBe(Math.ceil(r.retryAfterMs / 1000));
          expect(r.retryAfterSeconds).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('keeps clients apart', () => {
    let now = 0;
    const throttle = new Throttle(DEFAULT_RULES, () => now);
    for (let i = 0; i < 3; i++) expect(throttle.take('a').ok).toBe(true);
    expect(throttle.take('a').ok).toBe(false);
    expect(throttle.take('b').ok).toBe(true);
  });

  it('allows 3 a minute and 20 an hour by default', () => {
    let now = 0;
    const throttle = new Throttle(DEFAULT_RULES, () => now);
    const results: boolean[] = [];
    for (let i = 0; i < 30; i++) {
      results.push(throttle.take('a').ok);
      now += 21_000; // under 3 a minute
    }
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    const blocked = throttle.take('a');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it('forgets old requests and keeps at most the given number of clients, dropping the least recent', () => {
    let now = 0;
    const throttle = new Throttle([{ limit: 1, windowMs: 1000 }], () => now, 3);
    for (const k of ['a', 'b', 'c', 'd']) throttle.take(k);
    expect(throttle.size).toBe(3);
    expect(throttle.take('a').ok).toBe(true); // 'a' was dropped, so it starts again
    now += 1000;
    expect(throttle.take('b').ok).toBe(true);
  });
});
