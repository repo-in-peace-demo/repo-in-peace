import { addFrame, emptyWindow, type FrameWindow } from '../model/frame-stats';

/**
 * Development builds only: what the performance probe inside the canvas (`scene/PerfProbe.tsx`) measured, for the overlay outside
 * it (`ui/PerfStats.tsx`) to read. Only modules loaded behind `import.meta.env.DEV` import it.
 */
export const perf: { window: FrameWindow; calls: number; triangles: number } = { window: emptyWindow(), calls: 0, triangles: 0 };

export function recordFrame(ms: number, calls: number, triangles: number): void {
  perf.window = addFrame(perf.window, ms);
  perf.calls = calls;
  perf.triangles = triangles;
}
