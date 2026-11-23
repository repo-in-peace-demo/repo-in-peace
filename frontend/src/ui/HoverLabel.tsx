import { useLayoutEffect, useRef, useState } from 'react';
import { hoverLabel, hoverSummary, importersPart } from '../model/hover-label';
import type { SceneModel } from '../model/scene-model';
import { getPointer, subscribePointer, useHover } from '../store/hover-store';
import { graveKey, usePrSession } from '../store/pr-store';

/** How far the label sits from the pointer, in pixels. */
const OFFSET_X = 14;
const OFFSET_Y = 18;

let measuring: CanvasRenderingContext2D | null | undefined;
/** The width of `text` in `font`, in CSS pixels; Infinity when there is no canvas to measure with (then nothing optional is added). */
function textWidth(text: string, font: string): number {
  if (measuring === undefined) measuring = document.createElement('canvas').getContext('2d');
  if (!measuring) return Infinity;
  measuring.font = font;
  return measuring.measureText(text).width;
}

/**
 * The name of the stone or ghost under the pointer, with its folder path dimmed and "ghost" in front of a deleted
 * file, and one summary line (state, when it last changed, lines and flags; or a ghost's deletion and type) on a single line. It follows the pointer by moving its own element, not by rendering again. Everything is a text node, so a
 * file named `<script>` is shown as text.
 */
export function HoverLabel({ model }: { model: SceneModel }) {
  const target = useHover();
  const { prs } = usePrSession();
  const ref = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  // Whether the line with "imported by N" fits on one line in the label, measured in its own font against its widest (importers spec).
  const [withImporters, setWithImporters] = useState(false);

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

  const base = target === null ? null : hoverSummary(model, target);
  const importers = target === null ? null : importersPart(model, target);
  const pull = target === null ? undefined : prs.get(graveKey(target.kind, target.path));
  const line = (parts: Array<string | null>): string | null => (base === null ? null : [base, ...parts].filter((p): p is string => p !== null).join(' · '));
  const prPart = pull === undefined ? null : `PR #${pull.number} open`;
  const plain = line([prPart]);
  const longer = importers === null ? null : line([importers, prPart]);

  useLayoutEffect(() => {
    const label = ref.current;
    const summaryEl = summaryRef.current;
    if (longer === null || !label || !summaryEl) {
      setWithImporters(false);
      return;
    }
    const box = getComputedStyle(label);
    const widest = Math.min(parseFloat(box.maxWidth), window.innerWidth);
    const room = widest - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight) - parseFloat(box.borderLeftWidth) - parseFloat(box.borderRightWidth);
    setWithImporters(textWidth(longer, getComputedStyle(summaryEl).font) <= room);
  }, [longer]);

  if (target === null) return null;
  const label = hoverLabel(target);
  const summary = withImporters && longer !== null ? longer : plain;
  return (
    <div ref={ref} className="hover-label" role="status">
      <div className="hover-name">
        {label.ghost && <span className="hover-ghost">ghost </span>}
        {label.name}
      </div>
      <div className="hover-folder">{label.folder}</div>
      {summary !== null && (
        <div ref={summaryRef} className="hover-summary">
          {summary}
        </div>
      )}
    </div>
  );
}
