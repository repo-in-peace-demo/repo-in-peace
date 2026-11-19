import type { CameraPose } from '../model/camera-pose';
import { clearSelection, getSelection, select } from '../store/selection-store';
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
  /** Where the camera is and what it looks at, right now. */
  getPose: () => CameraPose;
}

declare global {
  interface Window {
    repoInPeace?: RepoInPeaceDevApi;
  }
}

/** Puts the handles on `window`. Returns the function that takes them off again. */
export function installDevApi(getPose: () => CameraPose): () => void {
  const api: RepoInPeaceDevApi = { flyTo, resetView, getSelection, select, clearSelection, getPose };
  window.repoInPeace = api;
  return () => {
    if (window.repoInPeace === api) delete window.repoInPeace;
  };
}
