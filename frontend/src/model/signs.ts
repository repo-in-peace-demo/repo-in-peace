import type { Layout } from './layout';
import { compareCodePoint } from './sort';
import { distance, dot, normalize, sub, vec3, type Vec3 } from './vec3';

/**
 * Folder signs (requirement 10). A plaque stands at the middle of each plot's front fence; its text is drawn as a
 * page element, and only while the camera is near enough to read it, fading out with distance. Pure: which signs
 * show, and how clearly, is a function of where the plaques are and where the camera is.
 */

/** How high above the ground the text is anchored: the face of the plaque. */
export const SIGN_HEIGHT = 1.0; // task 25 follow-up: from 1.4, with a smaller board, so a plaque does not hide the stones behind it up close

/** The plaque's board (width, height, thickness), centred at SIGN_HEIGHT on a post. Task 25: from 1.4 by 0.6 by 0.08. */
export const PLAQUE_BOARD = { w: 0.9, h: 0.3, d: 0.06 };

/** The post under the board: it ends at the board's lower edge. */
export const PLAQUE_POST = { w: 0.08, h: SIGN_HEIGHT - PLAQUE_BOARD.h / 2 };

/**
 * A sign is fully readable within `SIGN_NEAR_BASE + SIGN_NEAR_PER_SIZE × (the size of its plot)` units, where the size is the
 * square root of the plot's area, so a plot with more area never has the shorter range. The root's size is its longer side
 * (never less than the square root of its area, and the root holds every other plot, so it still has the longest range): the
 * factor is 1 so that the root's sign can be read from the starting view of a graveyard of any size. A smaller factor would
 * lose the root's name in a large graveyard.
 */
export const SIGN_NEAR_BASE = 14;
export const SIGN_NEAR_PER_SIZE = 1;

/** A sign of a major plot has faded out completely at this many times its near distance. */
export const SIGN_FAR_FACTOR = 2.2;

/**
 * Smaller plots fade out sooner, so that the overview is labelled with the major folders only. A plot with at least
 * `SIGN_MAJOR_SHARE` of the root's area fades out at `SIGN_FAR_FACTOR` times its near distance; one with at most
 * `SIGN_MINOR_SHARE` at `SIGN_MINOR_FAR_SCALE` times that; and in between the scale rises smoothly with the area.
 */
export const SIGN_MAJOR_SHARE = 0.1;
export const SIGN_MINOR_SHARE = 0.02;
// Task 25.3 fixes: from 0.7, so the smallest folders' labels are gone by about 22 units (fully readable within 18, so still after a
// fly-to at 8 to 14) instead of 28, and cover fewer of the stones behind them on the way in. Far stays above near (2.2 × 0.55 = 1.21).
export const SIGN_MINOR_FAR_SCALE = 0.55;

/** How much of `SIGN_FAR_FACTOR` a plot with this share of the root's area gets: from SIGN_MINOR_FAR_SCALE to 1, never falling as the share grows. */
export function signFarScale(share: number): number {
  if (!(share > SIGN_MINOR_SHARE)) return SIGN_MINOR_FAR_SCALE; // also for NaN
  if (share >= SIGN_MAJOR_SHARE) return 1;
  const t = (share - SIGN_MINOR_SHARE) / (SIGN_MAJOR_SHARE - SIGN_MINOR_SHARE);
  return SIGN_MINOR_FAR_SCALE + (1 - SIGN_MINOR_FAR_SCALE) * t * t * (3 - 2 * t);
}

/** At most this many signs show at once. */
export const SIGN_MAX_VISIBLE = 30;

/** A sign fainter than this is not shown at all. */
export const SIGN_MIN_OPACITY = 0.02;

/** How far, in radians, past the edge of the view a sign still counts as in view, so labels do not pop at the edge. */
export const SIGN_VIEW_MARGIN = 0.1;

export interface SignSource {
  /** The folder's path. The root is `""`. */
  path: string;
  /** What the sign says: the repository name for the root, the folder's own name for every other. */
  label: string;
  /** Where the text is anchored in the scene. */
  x: number;
  y: number;
  z: number;
  /** Fully readable within this distance. */
  near: number;
  /** Faded out completely from this distance. */
  far: number;
}

export interface CameraView {
  position: Vec3;
  /** Which way the camera looks. It need not have length 1. */
  forward: Vec3;
  /** Vertical field of view, in degrees, as three.js takes it. */
  fovY: number;
  /** Width over height of the screen. */
  aspect: number;
}

export interface VisibleSign {
  path: string;
  label: string;
  /** 0 to 1: 1 is fully readable. */
  opacity: number;
}

/**
 * One sign source for every plot of the layout. A plot that is only the root says `repoName`; a plot that begins with the
 * root and goes on into a folder says `repoName / app`; every other plot says its label: the folder's own name, or the
 * names of the folders shown together joined by "/" (`accounts/compare`).
 */
export function buildSignSources(layout: Layout, repoName: string): SignSource[] {
  const rootArea = layout.bounds.w * layout.bounds.d;
  return layout.plots.map((plot) => {
    const area = plot.rect.w * plot.rect.d;
    const size = plot.parent === null ? Math.max(plot.rect.w, plot.rect.d) : Math.sqrt(area);
    const near = SIGN_NEAR_BASE + SIGN_NEAR_PER_SIZE * size;
    const share = plot.parent === null || rootArea <= 0 ? 1 : area / rootArea;
    return {
      path: plot.path,
      label: plot.folders[0] === '' ? (plot.label === '' ? repoName : `${repoName} / ${plot.label}`) : plot.label,
      x: plot.sign.x,
      y: SIGN_HEIGHT,
      z: plot.sign.z,
      near,
      far: near * SIGN_FAR_FACTOR * signFarScale(share),
    };
  });
}

/** 1 up to `near`, 0 from `far`, and a smooth fall in between. It never rises as the distance grows. */
export function signOpacity(distanceToSign: number, near: number, far: number): number {
  if (distanceToSign <= near) return 1;
  if (distanceToSign >= far) return 0;
  const t = (distanceToSign - near) / (far - near);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The signs to show for this camera: those within their far distance and in view (a cone a little wider than
 * the screen's diagonal, which also drops everything behind the camera), fainter than SIGN_MIN_OPACITY dropped,
 * nearest first (ties by path), at most `limit`. The result does not depend on the order of `sources`.
 */
export function visibleSigns(sources: readonly SignSource[], view: CameraView, limit: number = SIGN_MAX_VISIBLE): VisibleSign[] {
  const forward = normalize(view.forward);
  const checkView = forward.x !== 0 || forward.y !== 0 || forward.z !== 0;

  // The angle from the view direction to a corner of the screen, plus a margin, as a cosine.
  const halfFov = (view.fovY * Math.PI) / 360;
  const cornerAngle = Math.atan(Math.tan(halfFov) * Math.sqrt(1 + view.aspect * view.aspect));
  const minCosine = Math.cos(Math.min(Math.PI, cornerAngle + SIGN_VIEW_MARGIN));

  const candidates: Array<{ distance: number; sign: VisibleSign }> = [];
  for (const source of sources) {
    const at = vec3(source.x, source.y, source.z);
    const d = distance(view.position, at);
    if (d >= source.far) continue;

    if (checkView && d > 0) {
      const cosine = dot(normalize(sub(at, view.position)), forward);
      if (cosine < minCosine) continue;
    }

    const opacity = signOpacity(d, source.near, source.far);
    if (opacity < SIGN_MIN_OPACITY) continue;
    candidates.push({ distance: d, sign: { path: source.path, label: source.label, opacity } });
  }

  candidates.sort((a, b) => a.distance - b.distance || compareCodePoint(a.sign.path, b.sign.path));
  return candidates.slice(0, Math.max(0, limit)).map((c) => c.sign);
}
