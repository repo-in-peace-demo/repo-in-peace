import { useLayoutEffect, useRef } from 'react';
import { hoverLabel, hoverSummary } from '../model/hover-label';
import type { SceneModel } from '../model/scene-model';
import { getPointer, subscribePointer, useHover } from '../store/hover-store';

/** How far the label sits from the pointer, in pixels. */
const OFFSET_X = 14;
const OFFSET_Y = 18;

/**
 * The name of the stone or ghost under the pointer, with its folder path dimmed and "ghost" in front of a deleted
 * file, and one summary line (state, last commit, lines and flags; or a ghost's deletion and type) on a single line. It follows the pointer by moving its own element, not by rendering again. Everything is a text node, so a
 * file named `<script>` is shown as text.
 */
export function HoverLabel({ model }: { model: SceneModel }) {
  const target = useHover();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const place = (): void => {
      const { x, y } = getPointer();
      const width = element.offsetWidth;
      // Keep it on the screen: to the left of the pointer near the right edge, above it near the bottom.
      const left = x + OFFSET_X + width > window.innerWidth ? Math.max(0, x - OFFSET_X - width) : x + OFFSET_X;
      const top = y + OFFSET_Y + element.offsetHeight > window.innerHeight ? Math.max(0, y - OFFSET_Y - element.offsetHeight) : y + OFFSET_Y;
      element.style.transform = `translate(${left}px, ${top}px)`;
    };
    place();
    return subscribePointer(place);
  }, [target]);

  if (target === null) return null;
  const label = hoverLabel(target);
  const summary = hoverSummary(model, target);
  return (
    <div ref={ref} className="hover-label" role="status">
      <div className="hover-name">
        {label.ghost && <span className="hover-ghost">ghost </span>}
        {label.name}
      </div>
      <div className="hover-folder">{label.folder}</div>
      {summary !== null && <div className="hover-summary">{summary}</div>}
    </div>
  );
}
