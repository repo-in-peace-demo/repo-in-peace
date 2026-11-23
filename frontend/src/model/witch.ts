import { MOON_ANGULAR_RADIUS_DEG, MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG } from './atmosphere';

/**
 * A witch on a broomstick crossing the moon now and then (an ambient sky element, like the clouds: decoration, not data). Pure: where
 * she is, in degrees on the sky, at a time in seconds. One pass glides left to right in a gentle arc that peaks across the moon's
 * disc, with a slight bob; the first starts as the opening move settles, then one every 45 to about 70 seconds, scheduled with the other sky events by
 * model/sky-director.ts (seeded, so the same in every run). The arc stays in the clearing above the forest under the moon and below the top of the establishing shot, so she is always
 * in the sky, never over the graveyard. Reduced motion: never shown.
 */
export const WITCH_SEED = 'repo-in-peace/witch';
export const PASS_S = 7;
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
/** She fades in over the first and out over the last FADE_S of each pass, as if passing through clouds. */
export const FADE_S = 1.5;

/** The highest any treetop reaches (the canopy's base, swell and jitter, and the 2° the clearing allows): she stays above it. */
export const CANOPY_TOP_DEG = 5.95;
/** The top edge of the establishing shot, about 13° up: she stays well below it. */
export const SKY_TOP_DEG = 12;

export interface WitchState {
  azimuthDeg: number;
  elevationDeg: number;
  /** 0 to 1 through the pass. */
  progress: number;
  /** 0 to 1: faded in at the start, out at the end (smoothly: never a jump). */
  opacity: number;
  /** Seconds into the pass. */
  elapsed: number;
}

const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Her opacity `elapsed` seconds into a pass: 0 at both ends, 1 between the fades. */
export const passOpacity = (elapsed: number): number => Math.min(smooth(elapsed / FADE_S), smooth((PASS_S - elapsed) / FADE_S));

/** Where pass `u` (0 to 1) is, without the bob. */
export function arcAt(u: number): { azimuthDeg: number; elevationDeg: number } {
  const x = 2 * u - 1;
  return {
    azimuthDeg: MOON_AZIMUTH_DEG - PASS_HALF_SPAN_DEG + 2 * PASS_HALF_SPAN_DEG * u,
    elevationDeg: MOON_ELEVATION_DEG + ARC_TOP_ABOVE_MOON_DEG - ARC_DROP_DEG * x * x,
  };
}

/** Her passes are scheduled by the sky director (model/sky-director.ts: `witchAt`, `passStarts`), with the other sky events. */

/** When the first pass starts: as the opening move settles, or just after the scene opens without one. */
export const firstPassStart = (openingS: number): number => openingS + START_DELAY_S;

/** The angle between two sky points, in degrees (small angles: flat is close enough). */
export const skyDistanceDeg = (a: { azimuthDeg: number; elevationDeg: number }, b: { azimuthDeg: number; elevationDeg: number }): number =>
  Math.hypot((a.azimuthDeg - b.azimuthDeg) * Math.cos((MOON_ELEVATION_DEG * Math.PI) / 180), a.elevationDeg - b.elevationDeg);

export const MOON_AT = { azimuthDeg: MOON_AZIMUTH_DEG, elevationDeg: MOON_ELEVATION_DEG };
export { MOON_ANGULAR_RADIUS_DEG };
