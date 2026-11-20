import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nudgeNeeded, panelSide, type ScreenBox } from './panel-placement';

const W = 1280;

describe('P9: the panel side', () => {
  it('is always the half of the window away from the item', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: W }), fc.integer({ min: 320, max: 3840 }), (x, width) => {
        const side = panelSide(Math.min(x, width), width);
        return side === (Math.min(x, width) > width / 2 ? 'left' : 'right');
      }),
    );
    expect(panelSide(200, W)).toBe('right');
    expect(panelSide(1000, W)).toBe('left');
  });
});

describe('the nudge', () => {
  const box = fc
    .record({ x: fc.integer({ min: -200, max: 1400 }), y: fc.integer({ min: -200, max: 900 }), w: fc.integer({ min: 2, max: 400 }), h: fc.integer({ min: 2, max: 400 }) })
    .map(({ x, y, w, h }): ScreenBox => ({ x0: x, x1: x + w, y0: y, y1: y + h }));
  const shift = (b: ScreenBox, dx: number): ScreenBox => ({ ...b, x0: b.x0 + dx, x1: b.x1 + dx });
  const apart = (a: ScreenBox, b: ScreenBox, m: number): boolean => a.x1 + m <= b.x0 + 1e-9 || b.x1 + m <= a.x0 + 1e-9 || a.y1 <= b.y0 || b.y1 <= a.y0;

  it('is 0 exactly when the item is already clear of the panel by the margin, and moving by it makes it clear', () => {
    fc.assert(
      fc.property(box, box, fc.integer({ min: 0, max: 60 }), (item, panel, margin) => {
        const dx = nudgeNeeded(item, panel, margin);
        if (apart(item, panel, margin)) return dx === 0;
        return dx !== 0 && apart(shift(item, dx), panel, margin);
      }),
    );
  });

  it('moves the item away from the panel: left of a panel on the right, right of one on the left', () => {
    const panelRight: ScreenBox = { x0: 940, x1: 1280, y0: 80, y1: 640 };
    expect(nudgeNeeded({ x0: 920, x1: 960, y0: 300, y1: 360 }, panelRight)).toBe(940 - 24 - 960);
    const panelLeft: ScreenBox = { x0: 0, x1: 340, y0: 80, y1: 640 };
    expect(nudgeNeeded({ x0: 320, x1: 360, y0: 300, y1: 360 }, panelLeft)).toBe(340 + 24 - 320);
  });
});
