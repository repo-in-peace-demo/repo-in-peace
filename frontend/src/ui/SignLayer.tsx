import type { RefObject } from 'react';
import { SIGN_MAX_VISIBLE } from '../model/signs';

/**
 * The folder signs' text: a fixed pool of elements over the canvas, created once and never added to or removed.
 * `scene/SignDriver.tsx` writes their text, place and opacity, and only when the camera has moved. They are all
 * hidden until it does. They are text, the browser's monospace font, and let every click through.
 */
export function SignLayer({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={containerRef} className="signs" aria-hidden="true">
      {Array.from({ length: SIGN_MAX_VISIBLE }, (_, i) => (
        <div key={i} className="sign" />
      ))}
    </div>
  );
}
