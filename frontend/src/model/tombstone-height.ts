import { LOC_AT_MAX_HEIGHT, MAX_STONE_H, MIN_STONE_H } from './layout-constants';

/**
 * A stone's height from its file's lines of code, on a logarithmic scale and clamped between
 * a minimum and a maximum: 0 or 1 lines give the minimum, LOC_AT_MAX_HEIGHT lines or more give the maximum.
 * A logarithm keeps a 6,000-line file from dwarfing a 60-line one, which would hide most of the graveyard.
 * It never decreases as the line count grows.
 */
export function stoneHeight(linesOfCode: number): number {
  const fraction = Math.log(Math.max(linesOfCode, 1)) / Math.log(LOC_AT_MAX_HEIGHT);
  const clamped = Math.min(1, Math.max(0, fraction));
  return MIN_STONE_H + (MAX_STONE_H - MIN_STONE_H) * clamped;
}
