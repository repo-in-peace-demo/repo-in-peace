import type { DecayState, Thresholds } from '../../../shared/graveyard-schema';

/**
 * Decay rules. Everything here is relative to the snapshot commit date,
 * never the current clock, so the same snapshot always scores the same.
 *
 * The day counts and the hot rule come from the thresholds in force (core/thresholds.ts).
 * They are a required argument with no default, so a caller that forgets them
 * gets a type error instead of silently using the defaults.
 */

export const MS_PER_DAY = 86_400_000;

/** A used file scores from 0 to AGE_WEIGHT. Fixed. */
export const AGE_WEIGHT = 0.4;
/**
 * Added when Knip flags the file unused. AGE_WEIGHT + UNUSED_WEIGHT = 1, and
 * UNUSED_WEIGHT > AGE_WEIGHT, so a brand-new unused file outranks the oldest used one,
 * whatever the thresholds. Fixed.
 */
export const UNUSED_WEIGHT = 0.6;

/** Whole days from the last commit to the snapshot. A commit dated after the snapshot counts as 0. */
export function ageDays(lastCommitMs: number, snapshotMs: number): number {
  return Math.max(0, Math.floor((snapshotMs - lastCommitMs) / MS_PER_DAY));
}

/** Fresh below `staleAfterDays`; stale from there up to and including `ancientAfterDays`; ancient above it. */
export function decayState(age: number, t: Thresholds): DecayState {
  if (age < t.staleAfterDays) return 'fresh';
  if (age <= t.ancientAfterDays) return 'stale';
  return 'ancient';
}

/**
 * 0 to 1, rounded to 4 decimals. Non-decreasing in age, and never lower for an unused file.
 * The age part grows until `decayCapDays`. Across the stale range the score rises with age,
 * which the frontend draws as more moss.
 */
export function decayScore(age: number, unused: boolean, t: Thresholds): number {
  const cappedAge = Math.min(Math.max(age, 0), t.decayCapDays);
  const raw = AGE_WEIGHT * (cappedAge / t.decayCapDays) + (unused ? UNUSED_WEIGHT : 0);
  return Math.round(raw * 10_000) / 10_000;
}

/** Hot: `hotCommits` or more commits in the hot window. */
export function isHot(commitsInWindow: number, t: Thresholds): boolean {
  return commitsInWindow >= t.hotCommits;
}
