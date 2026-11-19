import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DECAY_CAP_FACTOR, DEFAULT_THRESHOLDS, parseThresholdFlags, thresholdsFrom } from './thresholds';

const messageOf = (raw: Parameters<typeof parseThresholdFlags>[0]): string => {
  const result = parseThresholdFlags(raw);
  if (result.ok) throw new Error('expected the flags to be rejected');
  return result.message;
};

describe('thresholdsFrom', () => {
  it('sets the decay cap to twice ancientAfterDays', () => {
    expect(thresholdsFrom({ staleAfterDays: 10, ancientAfterDays: 40, hotCommits: 2, hotWindowDays: 7 })).toEqual({
      staleAfterDays: 10,
      ancientAfterDays: 40,
      decayCapDays: 80,
      hotCommits: 2,
      hotWindowDays: 7,
    });
    expect(DECAY_CAP_FACTOR).toBe(2);
  });

  it('reproduces the defaults from the default values', () => {
    expect(thresholdsFrom({ staleAfterDays: 90, ancientAfterDays: 360, hotCommits: 5, hotWindowDays: 30 })).toEqual(
      DEFAULT_THRESHOLDS,
    );
  });
});

describe('parseThresholdFlags', () => {
  it('gives the defaults when no flag is given', () => {
    expect(parseThresholdFlags({})).toEqual({ ok: true, thresholds: DEFAULT_THRESHOLDS });
  });

  it('reads every flag', () => {
    expect(parseThresholdFlags({ staleAfter: '30', ancientAfter: '200', hotCommits: '3', hotWindow: '14' })).toEqual({
      ok: true,
      thresholds: { staleAfterDays: 30, ancientAfterDays: 200, decayCapDays: 400, hotCommits: 3, hotWindowDays: 14 },
    });
  });

  it('keeps the default for a flag that is not given', () => {
    expect(parseThresholdFlags({ hotCommits: '10' })).toEqual({
      ok: true,
      thresholds: { ...DEFAULT_THRESHOLDS, hotCommits: 10 },
    });
    expect(parseThresholdFlags({ staleAfter: '60' })).toMatchObject({ ok: true, thresholds: { staleAfterDays: 60, ancientAfterDays: 360 } });
  });

  it('moves the decay cap with --ancient-after', () => {
    expect(parseThresholdFlags({ ancientAfter: '500' })).toMatchObject({ ok: true, thresholds: { decayCapDays: 1000 } });
  });

  it.each([
    ['--stale-after', { staleAfter: 'abc' }, 'abc'],
    ['--ancient-after', { ancientAfter: '1.5' }, '1.5'],
    ['--hot-commits', { hotCommits: '0' }, '0'],
    ['--hot-window', { hotWindow: '-7' }, '-7'],
    ['--stale-after', { staleAfter: '' }, ''],
    ['--stale-after', { staleAfter: ' 90' }, ' 90'],
    ['--stale-after', { staleAfter: '90 ' }, '90 '],
    ['--stale-after', { staleAfter: '1e3' }, '1e3'],
    ['--stale-after', { staleAfter: '0x10' }, '0x10'],
    ['--stale-after', { staleAfter: '+5' }, '+5'],
    ['--stale-after', { staleAfter: '007' }, '007'],
    ['--ancient-after', { ancientAfter: '99999999999999999999' }, '99999999999999999999'],
  ] as const)('rejects %s given as a value that is not a positive whole number', (flag, raw, value) => {
    const message = messageOf(raw);
    expect(message).toContain(flag);
    expect(message).toContain('must be a positive whole number');
    expect(message).toContain(`(got "${value}")`);
  });

  it('says what a valid value looks like, with the unit', () => {
    expect(messageOf({ staleAfter: 'x' })).toContain('of days, like 90');
    expect(messageOf({ ancientAfter: 'x' })).toContain('of days, like 360');
    expect(messageOf({ hotCommits: 'x' })).toContain('of commits, like 5');
    expect(messageOf({ hotWindow: 'x' })).toContain('of days, like 30');
  });

  it('rejects --ancient-after equal to --stale-after', () => {
    expect(messageOf({ staleAfter: '100', ancientAfter: '100' })).toBe(
      '--ancient-after (100) must be greater than --stale-after (100).',
    );
  });

  it('rejects --ancient-after below --stale-after', () => {
    expect(messageOf({ staleAfter: '200', ancientAfter: '100' })).toBe(
      '--ancient-after (100) must be greater than --stale-after (200).',
    );
  });

  it('counts the default for an omitted --stale-after, and says so', () => {
    expect(messageOf({ ancientAfter: '50' })).toBe('--ancient-after (50) must be greater than --stale-after (90, the default).');
  });

  it('counts the default for an omitted --ancient-after, and says so', () => {
    expect(messageOf({ staleAfter: '400' })).toBe('--stale-after (400) must be less than --ancient-after (360, the default).');
  });

  it('accepts a stale range of one day', () => {
    expect(parseThresholdFlags({ staleAfter: '10', ancientAfter: '11' }).ok).toBe(true);
  });

  it('reports a bad value before the comparison between the two', () => {
    expect(messageOf({ staleAfter: 'abc', ancientAfter: '5' })).toContain('--stale-after must be a positive whole number');
  });

  it('reports bad values in flag order', () => {
    expect(messageOf({ hotWindow: 'x', hotCommits: 'y' })).toContain('--hot-commits');
  });

  it('does not require the hot flags to relate to the age flags', () => {
    expect(parseThresholdFlags({ hotCommits: '1000', hotWindow: '1', staleAfter: '1', ancientAfter: '2' }).ok).toBe(true);
  });
});

describe('parseThresholdFlags properties', () => {
  const count = fc.integer({ min: 1, max: 100_000 });

  it('accepts exactly the valid combinations, and then the thresholds follow the flags', () => {
    fc.assert(
      fc.property(
        fc.option(count, { nil: undefined }),
        fc.option(count, { nil: undefined }),
        fc.option(count, { nil: undefined }),
        fc.option(count, { nil: undefined }),
        (stale, ancient, hotCommits, hotWindow) => {
          const result = parseThresholdFlags({
            staleAfter: stale?.toString(),
            ancientAfter: ancient?.toString(),
            hotCommits: hotCommits?.toString(),
            hotWindow: hotWindow?.toString(),
          });
          const effectiveStale = stale ?? 90;
          const effectiveAncient = ancient ?? 360;
          if (effectiveAncient <= effectiveStale) return !result.ok;
          return (
            result.ok &&
            result.thresholds.staleAfterDays === effectiveStale &&
            result.thresholds.ancientAfterDays === effectiveAncient &&
            result.thresholds.decayCapDays === 2 * effectiveAncient &&
            result.thresholds.hotCommits === (hotCommits ?? 5) &&
            result.thresholds.hotWindowDays === (hotWindow ?? 30)
          );
        },
      ),
    );
  });

  it('never accepts a value that is not a positive whole number', () => {
    const notACount = fc
      .oneof(fc.string(), fc.integer({ max: 0 }).map(String), fc.double({ noInteger: true, noNaN: true }).map(String))
      .filter((text) => !/^[1-9]\d*$/.test(text));
    fc.assert(
      fc.property(notACount, fc.constantFrom('staleAfter', 'ancientAfter', 'hotCommits', 'hotWindow'), (text, field) => {
        return !parseThresholdFlags({ [field]: text }).ok;
      }),
    );
  });

  it('only ever produces thresholds that satisfy the schema rules', () => {
    fc.assert(
      fc.property(count, count, count, count, (stale, ancient, hotCommits, hotWindow) => {
        const result = parseThresholdFlags({
          staleAfter: String(stale),
          ancientAfter: String(ancient),
          hotCommits: String(hotCommits),
          hotWindow: String(hotWindow),
        });
        if (!result.ok) return ancient <= stale;
        const t = result.thresholds;
        return t.ancientAfterDays > t.staleAfterDays && t.decayCapDays === 2 * t.ancientAfterDays && t.staleAfterDays >= 1;
      }),
    );
  });
});
