/**
 * Frame timing for the development performance overlay (`ui/PerfStats.tsx`). Pure: a fixed window of the last frame times, and
 * what the overlay shows from it. The window keeps the newest `FRAME_WINDOW` times; the 95th percentile is the time that 95% of
 * those frames took no longer than (nearest rank).
 */

/** How many recent frames the numbers are taken over. */
export const FRAME_WINDOW = 300;

export interface FrameWindow {
  /** Milliseconds, oldest first, at most FRAME_WINDOW of them. */
  readonly times: readonly number[];
}

export const emptyWindow = (): FrameWindow => ({ times: [] });

/** The window with one more frame time; the oldest is dropped once it is full. A time that is not a finite, non-negative number is ignored. */
export function addFrame(window: FrameWindow, ms: number, size: number = FRAME_WINDOW): FrameWindow {
  if (!Number.isFinite(ms) || ms < 0) return window;
  const times = window.times.length >= size ? [...window.times.slice(window.times.length - size + 1), ms] : [...window.times, ms];
  return { times };
}

/** The p-th percentile (0 to 100) of the times by nearest rank, or 0 for an empty window. */
export function percentile(window: FrameWindow, p: number): number {
  const n = window.times.length;
  if (n === 0) return 0;
  const sorted = [...window.times].sort((a, b) => a - b);
  const rank = Math.min(n, Math.max(1, Math.ceil((Math.min(100, Math.max(0, p)) / 100) * n)));
  return sorted[rank - 1]!;
}

/** Frames per second over the window: the number of frames over their total time, or 0 when there is no time. */
export function framesPerSecond(window: FrameWindow): number {
  const total = window.times.reduce((sum, t) => sum + t, 0);
  return total > 0 ? (window.times.length * 1000) / total : 0;
}
