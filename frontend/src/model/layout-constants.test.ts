import { describe, expect, it } from 'vitest';
import {
  CELL_D,
  CELL_GAP,
  CELL_PITCH_X,
  CELL_PITCH_Z,
  CELL_W,
  FENCE_BAND,
  ITEM_GAP,
  LEAN_REACH,
  LOC_AT_MAX_HEIGHT,
  MAX_LEAN_DEG,
  MAX_STONE_H,
  MIN_STONE_H,
  PACK_ASPECT,
  SIGN_D,
  SIGN_W,
  STONE_D,
  STONE_W,
} from './layout-constants';

/**
 * Relationships between the layout constants that must hold whatever values they are tuned to. The density
 * review (a later task) may change the numbers; these tests, and the layout properties, must still pass.
 */

describe('the layout constants', () => {
  it('are all positive, finite numbers', () => {
    const all = [
      MIN_STONE_H, MAX_STONE_H, LOC_AT_MAX_HEIGHT, STONE_W, STONE_D, MAX_LEAN_DEG, LEAN_REACH,
      CELL_W, CELL_D, CELL_GAP, CELL_PITCH_X, CELL_PITCH_Z, FENCE_BAND, ITEM_GAP, PACK_ASPECT, SIGN_W, SIGN_D,
    ];
    for (const value of all) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it('reserve room for the largest lean of the tallest stone: LEAN_REACH ≥ MAX_STONE_H × sin(MAX_LEAN_DEG)', () => {
    const reachOfTallestLeaningStone = MAX_STONE_H * Math.sin((MAX_LEAN_DEG * Math.PI) / 180);
    expect(LEAN_REACH).toBeGreaterThanOrEqual(reachOfTallestLeaningStone);
  });

  it('keep the lean small enough to read as a lean, not a fall', () => {
    expect(MAX_LEAN_DEG).toBeLessThanOrEqual(30);
  });

  it('make a cell the stone plus the reach on every side', () => {
    expect(CELL_W).toBeCloseTo(STONE_W + 2 * LEAN_REACH, 12);
    expect(CELL_D).toBeCloseTo(STONE_D + 2 * LEAN_REACH, 12);
  });

  it('put neighbouring cells a gap apart', () => {
    expect(CELL_PITCH_X).toBeCloseTo(CELL_W + CELL_GAP, 12);
    expect(CELL_PITCH_Z).toBeCloseTo(CELL_D + CELL_GAP, 12);
    expect(CELL_GAP).toBeGreaterThanOrEqual(0);
  });

  it('make the largest stone taller than the smallest, and the height scale usable', () => {
    expect(MAX_STONE_H).toBeGreaterThan(MIN_STONE_H);
    expect(LOC_AT_MAX_HEIGHT).toBeGreaterThan(1);
  });

  it('keep the plaque inside the fence band, and the smallest plot wide enough for it', () => {
    expect(SIGN_D).toBeLessThanOrEqual(FENCE_BAND);
    expect(SIGN_W).toBeLessThanOrEqual(2 * FENCE_BAND);
  });

  it('keep the packing at least as wide as a square, so rows can hold more than one item', () => {
    expect(PACK_ASPECT).toBeGreaterThanOrEqual(1);
  });
});
