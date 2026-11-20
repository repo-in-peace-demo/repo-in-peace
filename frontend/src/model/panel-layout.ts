/**
 * Whether the stats panel and the legend start open. On a window narrower than PANELS_OPEN_FROM_WIDTH they start collapsed (to
 * their title line), so the opening shot is not covered: they would hide the moon, the forest and the framing trees at the top
 * corners. They open with a click either way. Pure.
 */
export const PANELS_OPEN_FROM_WIDTH = 1600;

export const panelsStartOpen = (windowWidth: number): boolean => windowWidth >= PANELS_OPEN_FROM_WIDTH;

/** The window's width now, or the wide default where there is no window (tests, server). */
export const currentWindowWidth = (): number => (typeof window === 'undefined' ? PANELS_OPEN_FROM_WIDTH : window.innerWidth);
