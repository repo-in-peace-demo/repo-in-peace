/** The search box's placeholder: the full one where it fits, else the short one (panel rules, after the 900 px screenshot). */
export const FULL_PLACEHOLDER = 'Search graves (/)';
export const SHORT_PLACEHOLDER = 'Search (/)';

export const placeholderFor = (textWidth: number, availableWidth: number): string => (textWidth <= availableWidth ? FULL_PLACEHOLDER : SHORT_PLACEHOLDER);
