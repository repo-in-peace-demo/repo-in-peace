import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CLICK_MAX_DISTANCE_PX,
  CLICK_MAX_DURATION_MS,
  isDragging,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
  type GestureState,
  type PointerSample,
} from './pointer-gesture';

const sample = (over: Partial<PointerSample> = {}): PointerSample => ({ pointerId: 1, button: 0, x: 100, y: 100, time: 1000, ...over });

describe('a click', () => {
  it('is a press and release in the same place, quickly, with the primary button', () => {
    const down = pointerDown(null, sample());
    expect(pointerUp(down, sample({ time: 1100 }))).toEqual({ state: null, click: true });
  });

  it('allows a small wobble of the pointer: just under 5 px is a click, 5 px is not', () => {
    const down = pointerDown(null, sample());
    expect(pointerUp(down, sample({ x: 103, y: 103, time: 1100 })).click).toBe(true);
    expect(pointerUp(down, sample({ x: 100 + CLICK_MAX_DISTANCE_PX, time: 1100 })).click).toBe(false);
  });

  it('must be quick: just under 500 ms is a click, 500 ms is not', () => {
    const down = pointerDown(null, sample());
    expect(pointerUp(down, sample({ time: 1000 + CLICK_MAX_DURATION_MS - 1 })).click).toBe(true);
    expect(pointerUp(down, sample({ time: 1000 + CLICK_MAX_DURATION_MS })).click).toBe(false);
  });

  it.each([1, 2])('is not made by button %i (those pan and zoom)', (button) => {
    const down = pointerDown(null, sample({ button }));
    expect(pointerUp(down, sample({ button, time: 1050 })).click).toBe(false);
  });

  it('is not a click when the pointer went far away and came back: that was a drag', () => {
    let state: GestureState = pointerDown(null, sample());
    state = pointerMove(state, sample({ x: 160 }));
    expect(isDragging(state)).toBe(true);
    state = pointerMove(state, sample({ x: 100 }));
    expect(isDragging(state)).toBe(true);
    expect(pointerUp(state, sample({ time: 1100 })).click).toBe(false);
  });

  it('is decided by distance and time alone when the pointer does not move in between, for any press and release', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -100, max: 1000 }),
        fc.integer({ min: 0, max: 2 }),
        (dx, dy, dt, button) => {
          const down = pointerDown(null, sample({ button }));
          const up = pointerUp(down, sample({ button, x: 100 + dx, y: 100 + dy, time: 1000 + dt }));
          const expected = button === 0 && Math.hypot(dx, dy) < CLICK_MAX_DISTANCE_PX && dt >= 0 && dt < CLICK_MAX_DURATION_MS;
          return up.click === expected && up.state === null;
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('a drag', () => {
  it('starts when the pointer is 5 px from where it went down, and not before', () => {
    const down = pointerDown(null, sample());
    expect(isDragging(down)).toBe(false);
    expect(isDragging(pointerMove(down, sample({ x: 104, y: 100 })))).toBe(false);
    expect(isDragging(pointerMove(down, sample({ x: 105, y: 100 })))).toBe(true);
  });

  it('is measured from where the button went down, so a slow creep far enough counts', () => {
    let state: GestureState = pointerDown(null, sample());
    for (let x = 101; x <= 110; x++) state = pointerMove(state, sample({ x }));
    expect(isDragging(state)).toBe(true);
  });

  it('is not going on when no button is down', () => {
    expect(isDragging(null)).toBe(false);
    expect(isDragging(pointerMove(null, sample({ x: 500 })))).toBe(false);
  });

  it('ends when the button goes up, and a new press starts afresh', () => {
    let state: GestureState = pointerDown(null, sample());
    state = pointerMove(state, sample({ x: 200 }));
    state = pointerUp(state, sample({ x: 200, time: 1100 })).state;
    expect(isDragging(state)).toBe(false);
    expect(pointerUp(pointerDown(state, sample({ x: 200 })), sample({ x: 200, time: 1100 })).click).toBe(true);
  });
});

describe('other pointers and cancelling', () => {
  it('ignores a second finger or button while one is down', () => {
    const first = pointerDown(null, sample());
    expect(pointerDown(first, sample({ pointerId: 2, x: 300 }))).toBe(first);
  });

  it('ignores moves and releases of another pointer', () => {
    const first = pointerDown(null, sample());
    expect(pointerMove(first, sample({ pointerId: 2, x: 900 }))).toBe(first);
    expect(pointerUp(first, sample({ pointerId: 2 }))).toEqual({ state: first, click: false });
  });

  it('ignores a release when nothing is down', () => {
    expect(pointerUp(null, sample())).toEqual({ state: null, click: false });
  });

  it('forgets the gesture when the browser cancels the pointer', () => {
    expect(pointerCancel()).toBeNull();
  });
});
