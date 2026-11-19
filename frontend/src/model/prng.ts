/**
 * A seeded random number generator, for the synthetic graveyard and the test generators only.
 * The layout and the visual parameters never use it: their variety comes from `hash01`.
 */

/** Mulberry32: small, fast, and the same sequence for the same seed on every machine. Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A whole number from `min` to `max`, both included. */
export function intBetween(next: () => number, min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1));
}

/** One item of a non-empty list. */
export function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(next() * items.length))]!;
}
