export const MS_PER_DAY = 86_400_000;

/**
 * Whole days from a file's last commit to the snapshot, never negative. This is the analyser's
 * age: it is measured from the snapshot date in the data file, never from today, so the same
 * data file always looks the same. A commit dated after the snapshot counts as 0.
 *
 * Both arguments are ISO 8601 dates from a data file that has passed validation.
 */
export function ageDays(lastCommitDate: string, snapshotDate: string): number {
  return Math.max(0, Math.floor((Date.parse(snapshotDate) - Date.parse(lastCommitDate)) / MS_PER_DAY));
}
