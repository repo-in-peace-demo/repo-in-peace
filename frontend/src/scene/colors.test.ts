import { describe, expect, it } from 'vitest';
import { EFFECT_COLORS, HOVER_COLOR, SELECTION_RING_COLOR } from './colors';

/** Hue in degrees (0 to 360) and saturation (0 to 1) of a `#rrggbb` colour. */
function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (raw * 60 + 360) % 360, saturation: max === 0 ? 0 : delta / max };
}

const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('the selection ring colour', () => {
  const ring = hueAndSaturation(SELECTION_RING_COLOR);

  it('is vividly coloured, not grey or white like a stone or a ghost', () => {
    expect(ring.saturation).toBeGreaterThan(0.5);
  });

  it.each(Object.entries(EFFECT_COLORS))('is at least 40 degrees of hue away from the %s colour (%s)', (_name, colour) => {
    const other = hueAndSaturation(colour);
    // A grey (stone) has no hue to clash with; the saturation check above separates the ring from it.
    if (other.saturation < 0.15) return;
    expect(hueGap(ring.hue, other.hue)).toBeGreaterThanOrEqual(40);
  });

  it('is not the hover colour either', () => {
    expect(SELECTION_RING_COLOR).not.toBe(HOVER_COLOR);
  });

  it('is told apart from the stone by more than a tint: the stone colour has no vivid hue', () => {
    expect(hueAndSaturation(EFFECT_COLORS.stone).saturation).toBeLessThan(0.15);
  });
});
