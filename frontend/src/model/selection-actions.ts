/**
 * What a click on the canvas and the Escape key do to the selection. Pure, so a test can show that an empty-ground
 * click and Escape are the same thing: both clear the selection, and neither asks the camera to move.
 */

export type SelectionAction = { type: 'select'; kind: 'file' | 'ghost'; path: string } | { type: 'clear' };

export interface Hit {
  kind: 'file' | 'ghost';
  path: string;
}

/** A click on a stone or ghost selects it; a click on anything else (empty ground) clears the selection. */
export function clickAction(hit: Hit | undefined): SelectionAction {
  return hit === undefined ? { type: 'clear' } : { type: 'select', kind: hit.kind, path: hit.path };
}

/** Escape clears the selection, exactly as a click on empty ground does. */
export function escapeAction(): SelectionAction {
  return clickAction(undefined);
}
