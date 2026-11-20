import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NO_DEV_FEATURES, SYNTHETIC_MAX_FILES, devFeatures } from './dev-features';

describe('devFeatures', () => {
  it('turns everything off when the build is not a development build, whatever the address asks for', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (junk) => {
        for (const search of [junk, '?stats', '?synthetic=2000', `?stats&synthetic=5&${junk}`]) {
          if (JSON.stringify(devFeatures(false, search)) !== JSON.stringify(NO_DEV_FEATURES)) return false;
        }
        return true;
      }),
    );
  });

  it('in development: the handles always, the overlay with ?stats, a made-up graveyard with ?synthetic=<n> (and the overlay with it)', () => {
    expect(devFeatures(true, '')).toEqual({ api: true, perf: false, made: null });
    expect(devFeatures(true, '?stats')).toEqual({ api: true, perf: true, made: null });
    expect(devFeatures(true, '?synthetic=2000')).toEqual({ api: true, perf: true, made: 2000 });
    expect(devFeatures(true, '?graveyard=demo.oikosledger&synthetic=10')).toEqual({ api: true, perf: true, made: 10 });
  });

  it('ignores a synthetic count that is not a whole number of at least 1, and caps a large one', () => {
    for (const bad of ['', 'x', '-5', '0', '2.5', '1e3']) expect(devFeatures(true, `?synthetic=${bad}`).made).toBeNull();
    expect(devFeatures(true, '?synthetic=999999').made).toBe(SYNTHETIC_MAX_FILES);
  });
});
