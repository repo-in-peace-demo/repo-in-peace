import type { Thresholds } from '../../../shared/graveyard-schema';

/**
 * Decay thresholds: what they default to, how they are built, and how the command-line
 * flags are checked. Pure. The defaults are the values the analyser used before they became
 * configurable, so running without flags gives the same decay states, scores and hot flags as before.
 */

/** The age part of the score stops growing at this multiple of `ancientAfterDays`. */
export const DECAY_CAP_FACTOR = 2;

export const DEFAULT_THRESHOLDS: Thresholds = {
  staleAfterDays: 90,
  ancientAfterDays: 360,
  decayCapDays: 720,
  hotCommits: 5,
  hotWindowDays: 30,
};

export interface ThresholdChoice {
  staleAfterDays: number;
  ancientAfterDays: number;
  hotCommits: number;
  hotWindowDays: number;
}

/** Builds the full set from the four chosen values. The caller has checked them; see parseThresholdFlags. */
export function thresholdsFrom(choice: ThresholdChoice): Thresholds {
  return {
    staleAfterDays: choice.staleAfterDays,
    ancientAfterDays: choice.ancientAfterDays,
    decayCapDays: DECAY_CAP_FACTOR * choice.ancientAfterDays,
    hotCommits: choice.hotCommits,
    hotWindowDays: choice.hotWindowDays,
  };
}

/** The four flag values as typed, each absent when the flag was not given. */
export interface RawThresholdFlags {
  staleAfter?: string;
  ancientAfter?: string;
  hotCommits?: string;
  hotWindow?: string;
}

export type ThresholdsResult = { ok: true; thresholds: Thresholds } | { ok: false; message: string };

const POSITIVE_WHOLE_NUMBER = /^[1-9]\d*$/;

/**
 * Applies the defaults to omitted flags and checks the rest. Stops at the first problem:
 * first each given value must be a positive whole number (checked in flag order), then
 * `--ancient-after` must be greater than `--stale-after`, counting a default for an omitted flag.
 */
export function parseThresholdFlags(raw: RawThresholdFlags): ThresholdsResult {
  const fields = [
    { flag: '--stale-after', unit: 'of days, like 90', text: raw.staleAfter, fallback: DEFAULT_THRESHOLDS.staleAfterDays },
    { flag: '--ancient-after', unit: 'of days, like 360', text: raw.ancientAfter, fallback: DEFAULT_THRESHOLDS.ancientAfterDays },
    { flag: '--hot-commits', unit: 'of commits, like 5', text: raw.hotCommits, fallback: DEFAULT_THRESHOLDS.hotCommits },
    { flag: '--hot-window', unit: 'of days, like 30', text: raw.hotWindow, fallback: DEFAULT_THRESHOLDS.hotWindowDays },
  ];

  const values: number[] = [];
  for (const field of fields) {
    if (field.text === undefined) {
      values.push(field.fallback);
      continue;
    }
    const value = Number(field.text);
    if (!POSITIVE_WHOLE_NUMBER.test(field.text) || !Number.isSafeInteger(DECAY_CAP_FACTOR * value)) {
      return {
        ok: false,
        message: `${field.flag} must be a positive whole number ${field.unit} (got "${field.text}").`,
      };
    }
    values.push(value);
  }

  const [staleAfterDays, ancientAfterDays, hotCommits, hotWindowDays] = values as [number, number, number, number];
  if (ancientAfterDays <= staleAfterDays) {
    const stale = `${staleAfterDays}${raw.staleAfter === undefined ? ', the default' : ''}`;
    const ancient = `${ancientAfterDays}${raw.ancientAfter === undefined ? ', the default' : ''}`;
    return {
      ok: false,
      message:
        raw.ancientAfter === undefined
          ? `--stale-after (${stale}) must be less than --ancient-after (${ancient}).`
          : `--ancient-after (${ancient}) must be greater than --stale-after (${stale}).`,
    };
  }

  return { ok: true, thresholds: thresholdsFrom({ staleAfterDays, ancientAfterDays, hotCommits, hotWindowDays }) };
}
