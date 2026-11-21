import { flyToPose, type CameraPose, type FlyTarget } from '../model/camera-pose';
import type { ScreenBox } from '../model/panel-placement';
import { clearSelection } from '../store/selection-store';

/**
 * `flyTo`, the way later specs (the list view, search) move the camera to a file or ghost, and `resetView`, which
 * flies back to the starting overview.
 *
 * The scene registers itself here when it is on the screen, saying which paths it can fly to and how to start a
 * flight. Before that, after it goes away, and for a path that is not a file or a ghost, `flyTo` does nothing and
 * says so by returning `false`.
 */

export interface SceneRegistration {
  /** Every stone and ghost of the scene by path. */
  targets: ReadonlyMap<string, FlyTarget>;
  /** The starting overview that `resetView` flies back to. */
  start: CameraPose;
  /** Starts a smooth flight of the camera to this pose. */
  fly: (to: CameraPose) => void;
  /** The box on the page (pixels) that the stone or ghost with this path covers now, or null when it is unknown or behind the camera. */
  screenBoxOf: (path: string) => ScreenBox | null;
  /** True while a flight is moving the camera. */
  isFlying: () => boolean;
  /** Moves the picture sideways by this many pixels (positive to the right) with a short flight, measured at this item's depth. */
  nudge: (pixels: number, path: string) => void;
}

let registered: SceneRegistration | null = null;

/**
 * Makes `registration` the scene that `flyTo` talks to. Returns the function that removes it. A scene that is
 * replaced by a newer one cannot remove the newer one when it goes away late.
 */
export function registerScene(registration: SceneRegistration): () => void {
  registered = registration;
  return () => {
    if (registered === registration) registered = null;
  };
}

/**
 * Flies the camera smoothly to the stone or ghost with this path.
 * @returns `true` when a flight was started, `false` when the path is neither a file nor a ghost of the scene, or no scene is on the screen
 */
export function flyTo(path: string): boolean {
  if (registered === null) return false;
  const pose = flyToPose(registered.targets, path);
  if (pose === undefined) return false;
  registered.fly(pose);
  return true;
}

/**
 * Flies the camera back to the starting overview, with the same smooth movement as `flyTo`, and clears the
 * selection.
 * @returns `true` when the flight was started, `false` when no scene is on the screen (the selection is left alone)
 */
export function resetView(): boolean {
  if (registered === null) return false;
  clearSelection();
  registered.fly(registered.start);
  return true;
}

/** The page box of a stone or ghost now (see `SceneRegistration.screenBoxOf`), or null with no scene. */
export const screenBoxOf = (path: string): ScreenBox | null => registered?.screenBoxOf(path) ?? null;

/** Whether the camera is flying now. */
export const isFlying = (): boolean => registered?.isFlying() ?? false;

/** Moves the picture sideways so the detail panel does not cover the selected item (interface spec, Req 4.8). */
export function nudge(pixels: number, path: string): void {
  if (pixels !== 0) registered?.nudge(pixels, path);
}
