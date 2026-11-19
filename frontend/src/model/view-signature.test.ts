import { describe, expect, it } from 'vitest';
import { sameView, type ViewSignature } from './view-signature';

const view: ViewSignature = { px: 1, py: 2, pz: 3, fx: 0, fy: -0.5, fz: -1, fovY: 50, aspect: 16 / 9, width: 1280, height: 720 };

describe('sameView', () => {
  it('is false before any view has been worked out', () => {
    expect(sameView(null, view)).toBe(false);
  });

  it('is true for the same view, also as a different object', () => {
    expect(sameView(view, view)).toBe(true);
    expect(sameView({ ...view }, view)).toBe(true);
  });

  it.each(Object.keys(view) as Array<keyof ViewSignature>)('is false when %s has changed, by any amount', (key) => {
    expect(sameView(view, { ...view, [key]: view[key] + 1e-9 })).toBe(false);
    expect(sameView(view, { ...view, [key]: view[key] + 100 })).toBe(false);
  });
});
