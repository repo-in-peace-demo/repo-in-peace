import { useEffect, useState } from 'react';
import { perf } from '../dev/perf-store';
import { FRAME_WINDOW, framesPerSecond, percentile } from '../model/frame-stats';

/**
 * Development builds only: frames per second and the 95th-percentile frame time over the last FRAME_WINDOW frames, and the draw
 * calls and triangles of the last frame. Shown with `?stats` or `?synthetic=<n>` (`model/dev-features.ts`); refreshed twice a second.
 */
export default function PerfStats() {
  const [shown, setShown] = useState({ fps: 0, p95: 0, frames: 0, calls: 0, triangles: 0 });
  useEffect(() => {
    const id = window.setInterval(() => {
      setShown({ fps: framesPerSecond(perf.window), p95: percentile(perf.window, 95), frames: perf.window.times.length, calls: perf.calls, triangles: perf.triangles });
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="perf" data-testid="perf" aria-label="Performance (development only)">
      <div>{shown.fps.toFixed(0)} fps</div>
      <div>
        p95 {shown.p95.toFixed(1)} ms <span className="perf-dim">({shown.frames}/{FRAME_WINDOW} frames)</span>
      </div>
      <div>{shown.calls} draw calls</div>
      <div>{shown.triangles.toLocaleString('en')} triangles</div>
    </div>
  );
}
