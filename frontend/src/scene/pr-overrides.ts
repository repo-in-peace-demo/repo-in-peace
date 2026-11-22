import { buryFrame, overridesOf, riseFrame, type BuryFrame, type GraveOverride, type RiseFrame } from '../model/pr-scene';
import type { SceneModel } from '../model/scene-model';
import { getPrSession, type PrSession } from '../store/pr-store';
import { isReducedMotion } from './animation-clock';

/**
 * The session's pull requests as scene overrides, for the meshes to read each frame (bury-and-resurrect Req 10). Worked out again
 * only when the session or the scene changes, so a frame with no pull request costs one comparison.
 */
let cached: { model: SceneModel; prs: PrSession['prs']; overrides: GraveOverride[] } | null = null;

export function currentOverrides(model: SceneModel): GraveOverride[] {
  const { prs } = getPrSession();
  if (cached === null || cached.model !== model || cached.prs !== prs) cached = { model, prs, overrides: overridesOf(model, prs) };
  return cached.overrides;
}

export type OverrideFrame = ({ kind: 'buried' } & BuryFrame) | ({ kind: 'risen' } & RiseFrame);

/** Each override's frame now, by path: written by the meshes as they draw, read by the dev API for the browser tests. */
export const prSceneDebug: { frames: Map<string, OverrideFrame> } = { frames: new Map() };

export function frameOf(o: GraveOverride, nowMs: number = performance.now()): OverrideFrame {
  const reduced = isReducedMotion();
  const frame: OverrideFrame = o.kind === 'buried' ? { kind: 'buried', ...buryFrame(o.startedAt, nowMs, reduced) } : { kind: 'risen', ...riseFrame(o.startedAt, nowMs, reduced) };
  prSceneDebug.frames.set(o.path, frame);
  return frame;
}
