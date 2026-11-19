import type { CameraPose } from '../model/camera-pose';
import { clearSelection, getSelection, select } from '../store/selection-store';
import { freezeAnimation, freezeAnimationAt, resumeAnimation } from './animation-clock';
import { flyTo, resetView } from './api';

/**
 * `window.repoInPeace`: handles for trying the scene from the browser console and for the end-to-end test.
 * Development builds only. `CameraRig` imports this module with a dynamic `import()` behind `import.meta.env.DEV`,
 * so a production build does not contain it (task 26 greps `dist` to check).
 */
export interface RepoInPeaceDevApi {
  flyTo: typeof flyTo;
  resetView: typeof resetView;
  getSelection: typeof getSelection;
  select: typeof select;
  clearSelection: typeof clearSelection;
  /** Holds every animation (candle flicker, the selected stone's pulse) still, and lets them run again: for comparing two pictures exactly. */
  freezeAnimation: () => void;
  /** Holds every animation at this time in seconds (a ghost's bob, a flame's flicker), to see the scene at a chosen moment. */
  setAnimationTime: (seconds: number) => void;
  resumeAnimation: () => void;
  /** Where the camera is and what it looks at, right now. */
  getPose: () => CameraPose;
  /** The page position (in pixels) of the middle of the stone or ghost with this path, or `null` when it is behind the camera or unknown. */
  getScreenPoint: (path: string) => { x: number; y: number } | null;
  /** The page position (in pixels) of a point of the scene, or `null` when it is behind the camera. */
  projectPoint: (x: number, y: number, z: number) => { x: number; y: number } | null;
}

declare global {
  interface Window {
    repoInPeace?: RepoInPeaceDevApi;
  }
}

/** Puts the handles on `window`. Returns the function that takes them off again. */
export function installDevApi(
  getPose: () => CameraPose,
  projectPoint: (x: number, y: number, z: number) => { x: number; y: number } | null,
  centreOf: (path: string) => { x: number; y: number; z: number } | null,
): () => void {
  const getScreenPoint = (path: string): { x: number; y: number } | null => {
    const centre = centreOf(path);
    return centre === null ? null : projectPoint(centre.x, centre.y, centre.z);
  };
  const api: RepoInPeaceDevApi = { flyTo, resetView, getSelection, select, clearSelection, getPose, getScreenPoint, projectPoint, freezeAnimation, setAnimationTime: freezeAnimationAt, resumeAnimation };
  window.repoInPeace = api;
  return () => {
    if (window.repoInPeace === api) delete window.repoInPeace;
  };
}
