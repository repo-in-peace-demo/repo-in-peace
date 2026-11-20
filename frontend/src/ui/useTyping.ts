import { useEffect, useState } from 'react';
import { typedText } from '../model/boot-script';
import { prefersReducedMotion } from '../scene/reduced-motion';

/**
 * The typed text of the boot and digging screens, moving on each frame until it is complete. `skipped` (or reduced motion) shows
 * it all at once. Restarts when the lines change.
 */
export function useTyping(lines: readonly string[], skipped: boolean): { lines: string[]; done: boolean } {
  const [elapsed, setElapsed] = useState(() => (prefersReducedMotion() ? Number.POSITIVE_INFINITY : 0));
  const key = lines.join('\n');

  useEffect(() => {
    if (prefersReducedMotion()) {
      setElapsed(Number.POSITIVE_INFINITY);
      return;
    }
    setElapsed(0);
    const start = performance.now();
    let frame = 0;
    const tick = (): void => {
      const t = performance.now() - start;
      setElapsed(t);
      if (!typedText(lines, t).done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Keyed on the text: it restarts when the words change, not when the array is a new object with the same words.
  }, [key]);

  return typedText(lines, skipped ? Number.POSITIVE_INFINITY : elapsed);
}
