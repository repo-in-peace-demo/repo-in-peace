import { describe, expect, it } from 'vitest';
import { hasMoreBelow } from './useScrollFade';

describe('hasMoreBelow', () => {
  it('is true while content is hidden below, false at the bottom and when it all fits', () => {
    expect(hasMoreBelow(1000, 0, 400)).toBe(true);
    expect(hasMoreBelow(1000, 600, 400)).toBe(false);
    expect(hasMoreBelow(1000, 599.5, 400)).toBe(false); // fractional scroll positions at the bottom
    expect(hasMoreBelow(300, 0, 400)).toBe(false);
  });
});

import { FULL_PLACEHOLDER, SHORT_PLACEHOLDER, placeholderFor } from './search-placeholder';
describe('placeholderFor', () => {
  it('uses the full placeholder only where it fits', () => {
    expect(placeholderFor(130, 140)).toBe(FULL_PLACEHOLDER);
    expect(placeholderFor(130, 130)).toBe(FULL_PLACEHOLDER);
    expect(placeholderFor(130, 129)).toBe(SHORT_PLACEHOLDER);
  });
});
