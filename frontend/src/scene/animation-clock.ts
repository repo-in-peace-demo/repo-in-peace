/**
 * The time that the animated parts of the scene (candle flames, the selected stone's pulse, and later the ghosts, clouds,
 * mist and bats) read, instead of reading the clock directly. One place, so that the animation can be held still: the
 * browser tests freeze it to compare two pictures exactly, and `prefers-reduced-motion` will freeze it (task 24b).
 */

let frozenAt: number | null = null;
let latest = 0;

/** The time to animate with, in seconds: the clock's own, or the moment it was frozen. Call it once a frame with the clock's time. */
export function animationTime(elapsedSeconds: number): number {
  latest = elapsedSeconds;
  return frozenAt ?? elapsedSeconds;
}

/** Holds the animation where it is now. */
export function freezeAnimation(): void {
  frozenAt = latest;
}

/** Holds the animation at this moment, whatever the clock says: for a test that needs the picture at a chosen time. */
export function freezeAnimationAt(seconds: number): void {
  frozenAt = seconds;
}

/** Lets the animation run again, from the clock's own time. */
export function resumeAnimation(): void {
  frozenAt = null;
}

export const isAnimationFrozen = (): boolean => frozenAt !== null;
