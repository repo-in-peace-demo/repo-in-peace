import type { DecayState } from '../../../shared/graveyard-schema';

/**
 * Decay rules. Everything here is relative to the snapshot commit date,
 * never the current clock, so the same snapshot always scores the same.
 *
 * Months are fixed day counts: 3 months = 90 days, 12 months = 360 days.
 */

export const MS_PER_DAY = 86_400_000;

/** Fresh: ageDays < 90. */
export const FRESH_MAX_DAYS = 90;
/** Ancient: ageDays > 360. Stale is 90 to 360 inclusive. */
export const ANCIENT_MIN_DAYS = 360;

/** The age part of the score stops growing at this age. */
export const AGE_CAP_DAYS = 720;
/** A used file scores from 0 to AGE_WEIGHT. */
export const AGE_WEIGHT = 0.4;
/**
 * Added when Knip flags the file unused. AGE_WEIGHT + UNUSED_WEIGHT = 1, and
 * UNUSED_WEIGHT > AGE_WEIGHT, so a brand-new unused file outranks the oldest used one.
 */
export const UNUSED_WEIGHT = 0.6;

/** Hot: this many commits or more in the window before the snapshot. */
export const HOT_WINDOW_DAYS = 30;
export const HOT_COMMIT_THRESHOLD = 5;

/** Whole days from the last commit to the snapshot. A commit dated after the snapshot counts as 0. */
export function ageDays(lastCommitMs: number, snapshotMs: number): number {
  return Math.max(0, Math.floor((snapshotMs - lastCommitMs) / MS_PER_DAY));
}

export function decayState(age: number): DecayState {
  if (age < FRESH_MAX_DAYS) return 'fresh';
  if (age <= ANCIENT_MIN_DAYS) return 'stale';
  return 'ancient';
}

/**
 * 0 to 1, rounded to 4 decimals. Non-decreasing in age, and never lower for an unused file.
 * Across the stale range the score rises every day, which the frontend draws as more moss.
 */
export function decayScore(age: number, unused: boolean): number {
  const cappedAge = Math.min(Math.max(age, 0), AGE_CAP_DAYS);
  const raw = AGE_WEIGHT * (cappedAge / AGE_CAP_DAYS) + (unused ? UNUSED_WEIGHT : 0);
  return Math.round(raw * 10_000) / 10_000;
}

export function isHot(commitsInWindow: number): boolean {
  return commitsInWindow >= HOT_COMMIT_THRESHOLD;
}
