import { MOON_ANGULAR_RADIUS_DEG, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG } from './atmosphere';
import { fnv1a32 } from './hash';
import { mulberry32 } from './prng';

/**
 * A witch on a broomstick crossing the moon now and then (an ambient sky element, like the clouds: decoration, not data). Pure: where
 * she is, in degrees on the sky, at a time in seconds. One pass glides left to right in a gentle arc that peaks across the moon's
 * disc, with a slight bob; the first starts as the opening move settles, then one every 45 to 60 seconds (seeded, so the same in every
 * run). The arc stays in the clearing above the forest under the moon and below the top of the establishing shot, so she is always
 * in the sky, never over the graveyard. Reduced motion: never shown.
 */
export const WITCH_SEED = 'repo-in-peace/witch';
export const PASS_S = 7;
export const GAP_MIN_S = 45;
export const GAP_MAX_S = 60;
/** From the moon's azimuth, how far each end of the pass is. */
export const PASS_HALF_SPAN_DEG = 8;
/** The arc: highest across the moon (a little above its middle), lower at both ends. */
export const ARC_TOP_ABOVE_MOON_DEG = 0.3;
export const ARC_DROP_DEG = 1.1;
export const BOB_DEG = 0.12;
export const BOB_PERIOD_S = 1.6;
/** Her half-width on the sky: a little wider than the moon (its radius is MOON_ANGULAR_RADIUS_DEG). */
export const WITCH_HALF_SIZE_DEG = 1.5;
/** After the opening move ends (or the scene opens without one), she starts this much later. */
export const START_DELAY_S = 0.6;

/** The highest any treetop reaches (the canopy's base, swell and jitter, and the 2° the clearing allows): she stays above it. */
export const CANOPY_TOP_DEG = 5.95;
/** The top edge of the establishing shot, about 13° up: she stays well below it. */
export const SKY_TOP_DEG = 12;

export interface WitchState {
  azimuthDeg: number;
  elevationDeg: number;
  /** 0 to 1 through the pass. */
  progress: number;
}

/** Where pass `u` (0 to 1) is, without the bob. */
export function arcAt(u: number): { azimuthDeg: number; elevationDeg: number } {
  const x = 2 * u - 1;
  return {
    azimuthDeg: MOON_AZIMUTH_DEG - PASS_HALF_SPAN_DEG + 2 * PASS_HALF_SPAN_DEG * u,
    elevationDeg: MOON_ELEVATION_DEG + ARC_TOP_ABOVE_MOON_DEG - ARC_DROP_DEG * x * x,
  };
}

/** The start times of the passes, in seconds, from `firstStart` on, up to `until`. */
export function passStarts(firstStart: number, until: number, seed: string = WITCH_SEED): number[] {
  const next = mulberry32(fnv1a32(seed));
  const starts: number[] = [];
  for (let s = firstStart; s <= until; s += PASS_S + GAP_MIN_S + (GAP_MAX_S - GAP_MIN_S) * next()) starts.push(s);
  return starts;
}

export function witchAt(seconds: number, firstStart: number, reducedMotion: boolean, seed: string = WITCH_SEED): WitchState | null {
  if (reducedMotion || seconds < firstStart) return null;
  const starts = passStarts(firstStart, seconds, seed);
  const start = starts[starts.length - 1]!;
  const u = (seconds - start) / PASS_S;
  if (u > 1) return null;
  const at = arcAt(u);
  return { azimuthDeg: at.azimuthDeg, elevationDeg: at.elevationDeg + BOB_DEG * Math.sin((2 * Math.PI * (seconds - start)) / BOB_PERIOD_S), progress: u };
}

/** When the first pass starts: as the opening move settles, or just after the scene opens without one. */
export const firstPassStart = (openingS: number): number => openingS + START_DELAY_S;

/** The angle between two sky points, in degrees (small angles: flat is close enough). */
export const skyDistanceDeg = (a: { azimuthDeg: number; elevationDeg: number }, b: { azimuthDeg: number; elevationDeg: number }): number =>
  Math.hypot((a.azimuthDeg - b.azimuthDeg) * Math.cos((MOON_ELEVATION_DEG * Math.PI) / 180), a.elevationDeg - b.elevationDeg);

export const MOON_AT = { azimuthDeg: MOON_AZIMUTH_DEG, elevationDeg: MOON_ELEVATION_DEG };
export { MOON_ANGULAR_RADIUS_DEG };
