/**
 * Where the detail panel goes so it does not cover the selected grave (interface spec, Req 4.8). Pure, in screen pixels.
 */

export type Side = 'left' | 'right';

export interface ScreenBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The panel's side: the right, unless the item is on the right half of the window. */
export const panelSide = (itemX: number, windowWidth: number): Side => (itemX > windowWidth / 2 ? 'left' : 'right');

/**
 * How many pixels to move the picture sideways (positive to the right) so the item is at least `margin` clear of the panel, or 0
 * when it already is. Boxes that do not share any height never need a nudge. The item is moved away from the panel's side.
 */
export function nudgeNeeded(item: ScreenBox, panel: ScreenBox, margin = 24): number {
  const apartSideways = item.x1 + margin <= panel.x0 || panel.x1 + margin <= item.x0;
  const apartUpDown = item.y1 <= panel.y0 || panel.y1 <= item.y0;
  if (apartSideways || apartUpDown) return 0;
  const panelOnTheRight = (panel.x0 + panel.x1) / 2 >= (item.x0 + item.x1) / 2;
  return panelOnTheRight ? panel.x0 - margin - item.x1 : panel.x1 + margin - item.x0;
}
