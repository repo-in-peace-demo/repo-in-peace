import type { Layout } from './layout';
import { compareCodePoint } from './sort';
import { distance, dot, normalize, sub, vec3, type Vec3 } from './vec3';

/**
 * Folder signs (requirement 10). A plaque stands at the middle of each plot's front fence; its text is drawn as a
 * page element, and only while the camera is near enough to read it, fading out with distance. Pure: which signs
 * show, and how clearly, is a function of where the plaques are and where the camera is.
 */

/** How high above the ground the text is anchored: the face of the plaque. */
export const SIGN_HEIGHT = 1.4;

/**
 * A sign is fully readable within `SIGN_NEAR_BASE + SIGN_NEAR_PER_SIZE × (the longer side of its plot)` units.
 * The factor is 1 so that the root's sign, whose plot is the whole graveyard, can be read from the starting view of a
 * graveyard of any size: the starting camera is about 1.5 times the root's longer side away from its sign, and the
 * sign has faded out only at 2.2 × (14 + that side). A smaller factor would lose the root's name in a large graveyard.
 */
export const SIGN_NEAR_BASE = 14;
export const SIGN_NEAR_PER_SIZE = 1;

/** A sign has faded out completely at this many times its near distance. */
export const SIGN_FAR_FACTOR = 2.2;

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

/** One sign source for every plot of the layout. `repoName` is the label of the root's sign. */
export function buildSignSources(layout: Layout, repoName: string): SignSource[] {
  return layout.plots.map((plot) => {
    const near = SIGN_NEAR_BASE + SIGN_NEAR_PER_SIZE * Math.max(plot.rect.w, plot.rect.d);
    return {
      path: plot.path,
      label: plot.path === '' ? repoName : plot.path.slice(plot.path.lastIndexOf('/') + 1),
      x: plot.sign.x,
      y: SIGN_HEIGHT,
      z: plot.sign.z,
      near,
      far: near * SIGN_FAR_FACTOR,
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
