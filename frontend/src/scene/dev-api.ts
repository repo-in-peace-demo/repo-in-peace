import type { CameraPose } from '../model/camera-pose';
import { clearSelection, getSelection, select } from '../store/selection-store';
import { freezeAnimation, freezeAnimationAt, isReducedMotion, resumeAnimation } from './animation-clock';
import { prSceneDebug, type OverrideFrame } from './pr-overrides';
import { getPrSession } from '../store/pr-store';
import { engravingDebug } from './engraving-atlas';
import { atlasDebug } from './ghost-tag-atlas';
import { horizonDebug } from './Horizon';
import { flyTo, resetView } from './api';
import { signFade } from './sign-fade-state';
import { obstruction } from './obstruction-state';

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
  /** What the renderer drew in the last frame (draw calls and triangles), and what it holds on the GPU now (geometries and textures). */
  getRenderInfo: () => RenderInfo;
  /** Whether the animation clock is standing still because the system asks for reduced motion. */
  isReducedMotion: () => boolean;
  /** For each ghost-tag text, how many pixels of its cell of the atlas are lit: shows that the text was drawn. */
  getGhostTagAtlas: () => Record<string, number>;
  /** This session's pull requests, by grave ("file:<path>" or "ghost:<path>"). */
  getPullRequests: () => Record<string, { action: string; number: number; existing: boolean }>;
  /** Where an overridden grave is in its Bury or Resurrect animation, as last drawn; null when it has none. */
  getOverrideFrame: (path: string) => OverrideFrame | null;
  /** Where the camera is and what it looks at, right now. */
  getPose: () => CameraPose;
  /** The page position (in pixels) of the middle of the stone or ghost with this path, or `null` when it is behind the camera or unknown. */
  getScreenPoint: (path: string) => { x: number; y: number } | null;
  /** The page position (in pixels) of a point of the scene, or `null` when it is behind the camera. */
  projectPoint: (x: number, y: number, z: number) => { x: number; y: number } | null;
  /** For each engraved text ("RIP" and each name), how many pixels of its cell of the atlas are lit: shows that the text was drawn. */
  getEngravingAtlas: () => Record<string, number>;
  /** The opacities under 1 now of the stones and fences fading out of the way of the grave in focus. */
  getObstructionFade: () => { stones: Record<string, number>; fences: Record<string, number> };
  /** Each sign's opacity now, by its folder's path, for the signs fading out of the way of the grave in focus (listed only when under 1). */
  getSignFade: () => Record<string, number>;
  /** Puts the camera at this pose at once (inside the camera limits, which still apply): for pictures from a chosen place. */
  setPose: (pose: CameraPose) => void;
  /** The camera's lens shift now: the share of the frame's height the picture is moved down by (`model/framing.ts`). */
  getViewShift: () => number;
  /** Shows or hides the trees, the haze and the low mist around the graveyard (scene/Horizon.tsx, the back mist in scene/Mist.tsx), to look at the sky alone, which is the same for every graveyard. */
  setHorizonVisible: (visible: boolean) => void;
}

export interface RenderInfo {
  calls: number;
  triangles: number;
  fogDensity: number;
  /** `renderer.info.memory`: geometries and textures the live renderer holds on the GPU. */
  geometries: number;
  textures: number;
}

declare global {
  interface Window {
    repoInPeace?: RepoInPeaceDevApi;
    /** Set by the browser tests (`e2e/fixtures.ts`) before the page loads: the scene opens on the establishing shot, without the opening move. Read in development builds only. */
    __repoInPeaceNoOpening?: boolean;
    /** Set by the browser tests (`e2e/fixtures.ts`): the digging screen goes as soon as the scene is built. Read in development builds only. */
    __repoInPeaceNoDigHold?: boolean;
  }
}

/** Puts the handles on `window`. Returns the function that takes them off again. */
export function installDevApi(
  getPose: () => CameraPose,
  projectPoint: (x: number, y: number, z: number) => { x: number; y: number } | null,
  centreOf: (path: string) => { x: number; y: number; z: number } | null,
  getRenderInfo: () => RenderInfo,
  getViewShift: () => number,
  setPose: (pose: CameraPose) => void,
): () => void {
  const getScreenPoint = (path: string): { x: number; y: number } | null => {
    const centre = centreOf(path);
    return centre === null ? null : projectPoint(centre.x, centre.y, centre.z);
  };
  const api: RepoInPeaceDevApi = { flyTo, resetView, getSelection, select, clearSelection, getPose, getScreenPoint, projectPoint, freezeAnimation, setAnimationTime: freezeAnimationAt, resumeAnimation, isReducedMotion, getRenderInfo, getGhostTagAtlas: () => ({ ...atlasDebug.litPixels }),
    getViewShift,
    setPose,
    getPullRequests: () => Object.fromEntries([...getPrSession().prs].map(([k, p]) => [k, { action: p.action, number: p.number, existing: p.existing }])),
    getOverrideFrame: (path) => prSceneDebug.frames.get(path) ?? null,
    getEngravingAtlas: () => ({ ...engravingDebug.litPixels }),
    getSignFade: () => Object.fromEntries(signFade.alpha),
    getObstructionFade: () => ({ stones: Object.fromEntries(obstruction.alpha.stones), fences: Object.fromEntries(obstruction.alpha.fences) }),
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
