import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scrollToShow, visibleRange } from './virtual-window';

describe('the rows in the page', () => {
  it('are inside the list, cover the viewport, and are never more than the view plus the overscan', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 200_000 }), fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 10, max: 60 }), fc.integer({ min: 0, max: 20 }), (count, scrollTop, viewport, rowHeight, overscan) => {
        const { first, last } = visibleRange(scrollTop, viewport, rowHeight, count, overscan);
        if (count === 0) return last < first;
        if (first < 0 || last > count - 1 || last < first) return false;
        const lastRowTop = (count - 1) * rowHeight;
        const top = Math.min(scrollTop, lastRowTop);
        // Every row that shows any pixel of the viewport is drawn.
        const firstNeeded = Math.floor(top / rowHeight);
        const lastNeeded = Math.min(count - 1, Math.ceil((top + viewport) / rowHeight) - 1);
        const covers = first <= firstNeeded && last >= Math.max(firstNeeded, lastNeeded);
        return covers && last - first + 1 <= viewport / rowHeight + 2 * overscan + 2;
      }),
    );
  });

  it('keeps under 60 rows in the page for 2,000 rows of 30 px in a 720 px window', () => {
    for (const top of [0, 12_345, 59_970]) {
      const { first, last } = visibleRange(top, 720, 30, 2000);
      expect(last - first + 1).toBeLessThan(60);
    }
  });
});

describe('scrolling a row into view', () => {
  it('shows the row afterwards, and leaves the scroll alone when it is already in view', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1999 }), fc.integer({ min: 0, max: 60_000 }), fc.integer({ min: 60, max: 1200 }), (index, scrollTop, viewport) => {
        const rowHeight = 30;
        const next = scrollToShow(index, scrollTop, viewport, rowHeight);
        const inView = (st: number) => index * rowHeight >= st && (index + 1) * rowHeight <= st + viewport;
        return inView(next) && (!inView(scrollTop) || next === scrollTop);
      }),
    );
  });
});
