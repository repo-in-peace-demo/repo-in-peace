import { afterEach, describe, expect, it } from 'vitest';
// Without requestAnimationFrame (Node) a panel settles as soon as it opens.
import { isPanelOpen, rectsOverlap, registerPanel, resetPanels, setDetailCloser, setPanelOpen } from './panels-store';

const box = (left: number, top: number, w: number, h: number) => ({ getBoundingClientRect: () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) }) as unknown as Element;
const stops: Array<() => void> = [];
afterEach(() => {
  resetPanels();
  for (const s of stops.splice(0)) s();
});

describe('the panel rule', () => {
  it('starts with every panel collapsed', () => {
    for (const id of ['stats', 'legend', 'list', 'controls', 'detail'] as const) expect(isPanelOpen(id)).toBe(false);
  });

  it('opening a panel closes an open panel it overlaps, and leaves one it doesn\'t', () => {
    stops.push(registerPanel('stats', () => box(0, 0, 300, 400)));
    stops.push(registerPanel('list', () => box(0, 300, 300, 300)));
    stops.push(registerPanel('legend', () => box(900, 0, 300, 400)));
    setPanelOpen('stats', true);
    setPanelOpen('legend', true);
    setPanelOpen('list', true);
    expect([isPanelOpen('stats'), isPanelOpen('list'), isPanelOpen('legend')]).toEqual([false, true, true]);
    setPanelOpen('stats', true);
    expect([isPanelOpen('stats'), isPanelOpen('list')]).toEqual([true, false]);
  });

  it('closes the detail panel through its closer, and never reopens what was closed', () => {
    let closed = 0;
    setDetailCloser(() => closed++);
    stops.push(registerPanel('detail', () => box(900, 60, 340, 500)));
    stops.push(registerPanel('legend', () => box(900, 0, 300, 400)));
    setPanelOpen('detail', true);
    setPanelOpen('legend', true);
    expect(closed).toBe(1);
    setPanelOpen('legend', false);
    setPanelOpen('detail', true);
    expect(isPanelOpen('legend')).toBe(false);
  });

  it('counts edges that only touch as not overlapping', () => {
    expect(rectsOverlap({ left: 0, right: 10, top: 0, bottom: 10 }, { left: 10, right: 20, top: 0, bottom: 10 })).toBe(false);
  });
});
