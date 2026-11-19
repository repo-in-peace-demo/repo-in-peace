import { flyToPose, type CameraPose, type FlyTarget } from '../model/camera-pose';

/**
 * `flyTo`, the way later specs (the list view, search) move the camera to a file or ghost.
 *
 * The scene registers itself here when it is on the screen, saying which paths it can fly to and how to start a
 * flight. Before that, after it goes away, and for a path that is not a file or a ghost, `flyTo` does nothing and
 * says so by returning `false`.
 */

export interface SceneRegistration {
  /** Every stone and ghost of the scene by path. */
  targets: ReadonlyMap<string, FlyTarget>;
  /** Starts a smooth flight of the camera to this pose. */
  fly: (to: CameraPose) => void;
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
