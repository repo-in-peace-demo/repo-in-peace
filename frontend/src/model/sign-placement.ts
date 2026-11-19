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
