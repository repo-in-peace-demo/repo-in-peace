import type { CameraPose } from '../model/camera-pose';
import { clearSelection, getSelection, select } from '../store/selection-store';
import { freezeAnimation, freezeAnimationAt, isReducedMotion, resumeAnimation } from './animation-clock';
import { atlasDebug } from './ghost-tag-atlas';
import { horizonDebug } from './Horizon';
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
  /** What the renderer drew in the last frame: draw calls and triangles. */
  getRenderInfo: () => { calls: number; triangles: number; fogDensity: number };
  /** Whether the animation clock is standing still because the system asks for reduced motion. */
  isReducedMotion: () => boolean;
  /** For each ghost-tag text, how many pixels of its cell of the atlas are lit: shows that the text was drawn. */
  getGhostTagAtlas: () => Record<string, number>;
  /** Where the camera is and what it looks at, right now. */
  getPose: () => CameraPose;
  /** The page position (in pixels) of the middle of the stone or ghost with this path, or `null` when it is behind the camera or unknown. */
  getScreenPoint: (path: string) => { x: number; y: number } | null;
  /** The page position (in pixels) of a point of the scene, or `null` when it is behind the camera. */
  projectPoint: (x: number, y: number, z: number) => { x: number; y: number } | null;
  /** The camera's lens shift now: the share of the frame's height the picture is moved down by (`model/framing.ts`). */
  getViewShift: () => number;
  /** Shows or hides the hills and the forest (scene/Horizon.tsx), to look at the sky alone, which is the same for every graveyard. */
  setHorizonVisible: (visible: boolean) => void;
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
  getRenderInfo: () => { calls: number; triangles: number; fogDensity: number },
  getViewShift: () => number,
): () => void {
  const getScreenPoint = (path: string): { x: number; y: number } | null => {
    const centre = centreOf(path);
    return centre === null ? null : projectPoint(centre.x, centre.y, centre.z);
  };
  const api: RepoInPeaceDevApi = { flyTo, resetView, getSelection, select, clearSelection, getPose, getScreenPoint, projectPoint, freezeAnimation, setAnimationTime: freezeAnimationAt, resumeAnimation, isReducedMotion, getRenderInfo, getGhostTagAtlas: () => ({ ...atlasDebug.litPixels }),
    getViewShift,
    setHorizonVisible: (visible) => {
      horizonDebug.visible = visible;
      if (horizonDebug.group) horizonDebug.group.visible = visible;
    },
  };
  window.repoInPeace = api;
  return () => {
    if (window.repoInPeace === api) delete window.repoInPeace;
  };
}
