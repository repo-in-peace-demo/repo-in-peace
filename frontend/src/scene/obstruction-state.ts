/**
 * What stands between the camera and the grave in focus now (scene/Obstructions.tsx works it out with `model/clear-view.ts`), for the
 * stones, the fences and the plaques to fade (interface spec, Req 4.11). Each id set is by kind; `version` changes when any set does.
 * The current opacities are kept here too, for the development API.
 */
export const obstruction: {
  stones: Set<string>;
  fences: Set<string>;
  signs: Set<string>;
  version: number;
  /** Opacities under 1, by kind and id. */
  alpha: { stones: Map<string, number>; fences: Map<string, number> };
} = { stones: new Set(), fences: new Set(), signs: new Set(), version: 0, alpha: { stones: new Map(), fences: new Map() } };
