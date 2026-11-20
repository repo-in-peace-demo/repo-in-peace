import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PANELS_OPEN_FROM_WIDTH, panelsStartOpen } from './panel-layout';

describe('panelsStartOpen', () => {
  it('starts the panels collapsed on a window narrower than 1600 px (a 1280 or 1440 px laptop), open on a wider one', () => {
    expect(PANELS_OPEN_FROM_WIDTH).toBe(1600);
    expect(panelsStartOpen(1280)).toBe(false);
    expect(panelsStartOpen(1440)).toBe(false);
    expect(panelsStartOpen(1599)).toBe(false);
    expect(panelsStartOpen(1600)).toBe(true);
    expect(panelsStartOpen(1920)).toBe(true);
  });

  it('only opens them as the window gets wider: never open on a narrower window and collapsed on a wider one', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 8000 }), fc.integer({ min: 0, max: 8000 }), (a, b) => !(a < b && panelsStartOpen(a) && !panelsStartOpen(b))));
  });
});
