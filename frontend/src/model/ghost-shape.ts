import { GHOST_D, GHOST_HEIGHT, GHOST_W } from './visual-constants';

/**
 * The silhouette of a ghost, so it can never be mistaken for a gravestone: a rounded head and a body that tapers away
 * toward the bottom into a wisp, with no base. Turned on a lathe, so it is round and the same from every side. The points
 * are (radius, height above the lowest point), from the bottom to the top. The material fades the figure out toward the bottom
 * (`scene/ghost-material.ts`), so it has no solid foot either.
 */
export const GHOST_PROFILE: ReadonlyArray<readonly [radius: number, height: number]> = [
  [0.0, 0.0],
  [0.06, 0.08],
  [0.1, 0.22],
  [0.16, 0.42],
  [0.24, 0.66],
  [0.32, 0.92],
  [0.39, 1.14],
  [0.43, 1.3],
  [0.41, 1.44],
  [0.32, 1.55],
  [0.16, 1.6],
  [0.0, 1.62],
];

/** The widest the figure gets, which must fit inside the ground it is given. */
export const GHOST_MAX_RADIUS = Math.max(...GHOST_PROFILE.map(([radius]) => radius));

/** The height of the figure, which is what the camera aims at, what the picking box covers and what the ring sits under. */
export const GHOST_TOP = Math.max(...GHOST_PROFILE.map(([, height]) => height));

/** The wavy hem and sway the shader adds are at most this far sideways, so the figure still fits in its ground. */
export const GHOST_SWAY = 0.06;

/** True when the figure, with its sway, fits inside the ground it is given. */
export const ghostFits = (): boolean => GHOST_MAX_RADIUS + GHOST_SWAY <= Math.min(GHOST_W, GHOST_D) / 2 && GHOST_TOP <= GHOST_HEIGHT + 0.05;
