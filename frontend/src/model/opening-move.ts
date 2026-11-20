import { easeInOutCubic } from './camera-pose';
import { OPENING_DURATION_MS, blendShots, type Shot } from './framing';

/**
 * The opening move on first load: from the low opening shot up into the establishing shot over OPENING_DURATION_MS, eased at both
 * ends, with nobody touching anything. Pure: the time comes from outside (`scene/CameraRig.tsx`).
 *
 * Any input ends it and hands over control where the camera is. The camera is then let into its limits (the opening shot is below the
 * 20 degree tilt limit, the one exception the move has) and the lens shift goes to the establishing shot's over HANDOVER_MS, so the
 * picture does not jump.
 */

/** How long the hand-over after an interrupted move takes, in milliseconds. */
export const HANDOVER_MS = 300;

/** Where the move is `elapsedMs` after it started: the shot, and whether it has arrived. At 0 the opening shot; from the duration on, exactly the establishing shot. */
export function openingAt(from: Shot, to: Shot, elapsedMs: number, durationMs: number = OPENING_DURATION_MS): { shot: Shot; done: boolean } {
  if (!(elapsedMs < durationMs)) return { shot: to, done: true };
  const t = Math.max(0, elapsedMs) / durationMs;
  return { shot: blendShots(from, to, easeInOutCubic(t)), done: false };
}

/** How far through the hand-over it is, 0 to 1, `elapsedMs` after the input that ended the move: smooth at both ends. */
export function handoverShare(elapsedMs: number, durationMs: number = HANDOVER_MS): number {
  if (!(elapsedMs > 0)) return 0;
  if (elapsedMs >= durationMs) return 1;
  const t = elapsedMs / durationMs;
  return t * t * (3 - 2 * t);
}

/** Whether the move plays: not under reduced motion (the scene opens on the establishing shot), and not when it is turned off for a test. */
export const playsOpening = (reducedMotion: boolean, turnedOff: boolean): boolean => !reducedMotion && !turnedOff;
