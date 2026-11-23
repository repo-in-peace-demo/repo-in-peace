/**
 * The words shown while a Bury or Resurrect request runs (bury-and-resurrect Req 9.2, revised): "Opening pull request" with dots that
 * cycle . → .. → …, then "Still working" after about 10 seconds; the page stops waiting after about 30. Pure.
 */
export const DOT_STEP_MS = 400;
export const STILL_WORKING_MS = 10_000;
export const GIVE_UP_MS = 30_000;

export const TIMED_OUT =
  "This is taking longer than it should, so the page stopped waiting. Try again: if the pull request was opened meanwhile, you'll get it.";

export interface PrTimeouts {
  stillWorkingMs: number;
  giveUpMs: number;
}
export const DEFAULT_TIMEOUTS: PrTimeouts = { stillWorkingMs: STILL_WORKING_MS, giveUpMs: GIVE_UP_MS };

/** The words, without the dots. */
export const progressWords = (elapsedMs: number, timeouts: PrTimeouts = DEFAULT_TIMEOUTS): string =>
  elapsedMs >= timeouts.stillWorkingMs ? 'Still working' : 'Opening pull request';

/** The dots: 1, 2, 3, 1, … every DOT_STEP_MS; a fixed "…" under reduced motion. */
export const progressDots = (elapsedMs: number, reducedMotion: boolean): string =>
  reducedMotion ? '…' : ['.', '..', '…'][Math.floor(Math.max(0, elapsedMs) / DOT_STEP_MS) % 3]!;

/** What a screen reader is told: once at the start and once at "Still working", never every dot. */
export const progressAnnouncement = (elapsedMs: number, repo: string, timeouts: PrTimeouts = DEFAULT_TIMEOUTS): string =>
  elapsedMs >= timeouts.stillWorkingMs ? `Still working on the pull request on ${repo}.` : `Opening a pull request on ${repo}.`;
