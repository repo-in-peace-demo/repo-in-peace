/**
 * Telling a click from a drag. Pure: the picker feeds it the pointer events of the canvas, and it says whether a
 * press and release was a click (so it may select) or a drag (orbit or pan, which must not change the selection),
 * and whether a drag is going on (so the hover label is hidden while it does).
 */

/** A press and release moved less than this many pixels apart is a click. */
export const CLICK_MAX_DISTANCE_PX = 5;

/** A press held for this many milliseconds or more is not a click. */
export const CLICK_MAX_DURATION_MS = 500;

/** The primary button, the only one that selects. The other buttons pan and zoom. */
export const PRIMARY_BUTTON = 0;

export interface PointerSample {
  pointerId: number;
  button: number;
  /** Pixels on the page. */
  x: number;
  y: number;
  /** Milliseconds, from any clock that does not go back. */
  time: number;
}

export interface Gesture {
  start: PointerSample;
  /** The pointer has been further than CLICK_MAX_DISTANCE_PX from where it went down. Once true it stays true, even if the pointer comes back. */
  dragging: boolean;
}

/** `null`: no button is down. */
export type GestureState = Gesture | null;

const distanceBetween = (a: PointerSample, b: PointerSample): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A button goes down. A second button or finger while one is already down is ignored. */
export function pointerDown(state: GestureState, sample: PointerSample): GestureState {
  return state ?? { start: sample, dragging: false };
}

/** The pointer moves. The distance is measured from where it went down, so a slow creep far enough is a drag too. */
export function pointerMove(state: GestureState, sample: PointerSample): GestureState {
  if (state === null || state.dragging || sample.pointerId !== state.start.pointerId) return state;
  return distanceBetween(state.start, sample) >= CLICK_MAX_DISTANCE_PX ? { ...state, dragging: true } : state;
}

/**
 * The button goes up. `click` is true only for the primary button, released near where it went down, soon enough,
 * and without the pointer having been dragged away and back. An event from another pointer changes nothing.
 */
export function pointerUp(state: GestureState, sample: PointerSample): { state: GestureState; click: boolean } {
  if (state === null || sample.pointerId !== state.start.pointerId) return { state, click: false };
  const elapsed = sample.time - state.start.time;
  const click =
    state.start.button === PRIMARY_BUTTON &&
    !state.dragging &&
    distanceBetween(state.start, sample) < CLICK_MAX_DISTANCE_PX &&
    elapsed >= 0 &&
    elapsed < CLICK_MAX_DURATION_MS;
  return { state: null, click };
}

/** The browser took the pointer away (a cancelled touch, a lost capture). Nothing was clicked. */
export function pointerCancel(): GestureState {
  return null;
}

/** True while a button is down and the pointer has moved far enough to be a drag (an orbit or a pan). */
export const isDragging = (state: GestureState): boolean => state !== null && state.dragging;
