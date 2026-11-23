import { useLayoutEffect, type RefObject } from 'react';

/**
 * Marks a panel that scrolls inside with `data-more="true"` while there is more below what shows (panel rules: a fade at its bottom
 * edge then says "scroll for more"; index.css `.scroll-fade`). Watches the scroll, the panel's size and its content.
 */
export const hasMoreBelow = (scrollHeight: number, scrollTop: number, clientHeight: number): boolean => scrollHeight - scrollTop - clientHeight > 1;

export function useScrollFade(ref: RefObject<HTMLElement | null>, active = true): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const update = (): void => {
      el.dataset['more'] = String(hasMoreBelow(el.scrollHeight, el.scrollTop, el.clientHeight));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    for (const child of Array.from(el.children)) resize.observe(child);
    const content = new MutationObserver(update);
    content.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', update);
      resize.disconnect();
      content.disconnect();
    };
  }, [ref, active]);
}
