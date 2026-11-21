import { sceneCameraLimits } from '../src/model/camera-bounds';
import { DEFAULT_FOV_Y, type CameraPose } from '../src/model/camera-pose';
import { clearFlyPose, sceneOccluders, type Occluder } from '../src/model/clear-view';
import { projectToFrame, safeEstablishingShot } from '../src/model/framing';
import type { SceneModel } from '../src/model/scene-model';
import type { FadeSign, ScreenPoint } from '../src/model/sign-fade';
import { dot, normalize, sub, vec3, type Vec3 } from '../src/model/vec3';

/**
 * Where `flyTo` leaves the camera for a grave (the clear view of `model/clear-view.ts`), in a window of this size, and the projection of that camera to pixels (with the lens
 * shift the scene applies), from the same pure modules the app uses. For tests of what is in the way of a grave after a flight.
 */
/** The scene's occluders, worked out once per model. */
const cache = new WeakMap<SceneModel, Occluder[]>();
export function occludersOf(model: SceneModel): Occluder[] {
  let o = cache.get(model);
  if (!o) cache.set(model, (o = sceneOccluders(model)));
  return o;
}

export function flyView(model: SceneModel, path: string, width = 1280, height = 720): { pose: CameraPose; project: (p: Vec3) => ScreenPoint | null } {
  const aspect = width / height;
  const chosen = clearFlyPose(model, path, sceneCameraLimits(model.layout.bounds, aspect), occludersOf(model))!;
  const pose = chosen.pose;
  const shift = safeEstablishingShot(model.layout.bounds, DEFAULT_FOV_Y, aspect).viewShift;
  const forward = normalize(sub(pose.target, pose.position));
  const project = (p: Vec3): ScreenPoint | null => {
    const depth = dot(sub(p, pose.position), forward);
    const at = projectToFrame(pose, DEFAULT_FOV_Y, aspect, shift, p);
    return at === null || depth <= 0 ? null : { x: at.x * width, y: at.y * height, depth };
  };
  return { pose, project };
}

export const fadeSignsOf = (model: SceneModel): FadeSign[] => model.signSources.map((s) => ({ path: s.path, label: s.label, x: s.x, z: s.z, anchor: vec3(s.x, s.y, s.z) }));
