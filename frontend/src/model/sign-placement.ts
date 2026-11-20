import { SIGN_MAX_VISIBLE, type VisibleSign } from './signs';

/**
 * From the signs that should show to the page elements that show them. Pure: the scene projects each sign's anchor
 * to the screen and says where it landed; this gives each sign that landed a slot of the fixed pool of elements.
 */

export interface SignPlacement {
  /** Which element of the pool shows this sign: 0, 1, 2, ... with no gaps. */
  slot: number;
  label: string;
  /** Pixels from the left and the top of the scene. */
  x: number;
  y: number;
  /** 0 to 1. */
  opacity: number;
}

/**
 * Gives the visible signs their slots, in order (nearest first, as `visibleSigns` returns them). A sign that cannot
 * be projected (`project` returns `null`: it is behind the camera) is skipped and leaves no gap. At most `poolSize`
 * placements are made, so the number of elements never grows.
 */
export function placeSigns(
  visible: readonly VisibleSign[],
  project: (path: string) => { x: number; y: number } | null,
  poolSize: number = SIGN_MAX_VISIBLE,
): SignPlacement[] {
  const placements: SignPlacement[] = [];
  for (const sign of visible) {
    if (placements.length >= poolSize) break;
    const at = project(sign.path);
    if (at === null) continue;
    placements.push({ slot: placements.length, label: sign.label, x: at.x, y: at.y, opacity: sign.opacity });
  }
  return placements;
}

// ---- Only the nearest of signs that overlap ----

/**
 * The size of a sign's text on screen, in pixels, as `index.css` sets it (`.sign`: 0.78rem monospace, 0.03em of letter spacing, 0.45rem of padding
 * either side, at most 16rem wide). The font is monospace, so the width follows from the number of characters without measuring the page.
 */
export const SIGN_CHAR_PX = 8;
export const SIGN_PADDING_X_PX = 15;
export const SIGN_MAX_WIDTH_PX = 256;
export const SIGN_HEIGHT_PX = 20;
/** Signs this close (in pixels) count as touching. */
export const SIGN_TOUCH_GAP_PX = 4;

/** The box of a sign's text on screen: its anchor is the middle of the bottom edge (`translate(-50%, -100%)`). */
export function signBox(label: string, x: number, y: number): { x0: number; x1: number; y0: number; y1: number } {
  const width = Math.min(SIGN_MAX_WIDTH_PX, Array.from(label).length * SIGN_CHAR_PX + SIGN_PADDING_X_PX);
  return { x0: x - width / 2, x1: x + width / 2, y0: y - SIGN_HEIGHT_PX, y1: y };
}

/**
 * Like `placeSigns`, and when the texts of two signs would overlap on screen only the nearer one is placed: the signs come nearest first, so
 * a sign is dropped when its box touches the box of a sign already placed. The nearest sign that can be projected is always placed.
 */
export function placeSignsClear(
  visible: readonly VisibleSign[],
  project: (path: string) => { x: number; y: number } | null,
  poolSize: number = SIGN_MAX_VISIBLE,
): SignPlacement[] {
  const placements: SignPlacement[] = [];
  const boxes: Array<ReturnType<typeof signBox>> = [];
  for (const sign of visible) {
    if (placements.length >= poolSize) break;
    const at = project(sign.path);
    if (at === null) continue;
    const box = signBox(sign.label, at.x, at.y);
    const touches = boxes.some(
      (o) => box.x0 < o.x1 + SIGN_TOUCH_GAP_PX && box.x1 > o.x0 - SIGN_TOUCH_GAP_PX && box.y0 < o.y1 + SIGN_TOUCH_GAP_PX && box.y1 > o.y0 - SIGN_TOUCH_GAP_PX,
    );
    if (touches) continue;
    boxes.push(box);
    placements.push({ slot: placements.length, label: sign.label, x: at.x, y: at.y, opacity: sign.opacity });
  }
  return placements;
}
