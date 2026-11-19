import { setReducedMotion } from './animation-clock';

/** Follows the system setting `prefers-reduced-motion` and tells the animation clock, now and whenever it changes. Returns the function that stops. */
export function watchReducedMotion(): () => void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  setReducedMotion(query.matches);
  const onChange = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
    setReducedMotion(false);
  };
}
