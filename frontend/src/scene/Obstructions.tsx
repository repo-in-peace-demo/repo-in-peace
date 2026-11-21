import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { blockersOf, faceOf, sceneOccluders } from '../model/clear-view';
import type { SceneModel } from '../model/scene-model';
import { vec3 } from '../model/vec3';
import { isFlying } from './api';
import { focusPath } from './focus';
import { obstruction } from './obstruction-state';

/**
 * Works out what stands between the camera and the grave in focus (selected, or flown to): the stones, fence posts and rails and sign
 * boards whose boxes cut a line from the camera to its face (`model/clear-view.ts`). `flyTo` already picks a view with nothing in the
 * way when there is one; whatever is left fades (Stones, Fences, Plaques read `obstruction`). It is worked out again only when the
 * focus or the camera has changed, and not during a flight (the view on the way does not matter; the landing does).
 */
export function Obstructions({ model }: { model: SceneModel }) {
  const camera = useThree((state) => state.camera);
  const occluders = useMemo(() => sceneOccluders(model), [model]);
  const last = useRef('');

  useEffect(
    () => () => {
      obstruction.stones = new Set();
      obstruction.fences = new Set();
      obstruction.signs = new Set();
      obstruction.alpha = { stones: new Map(), fences: new Map() };
      obstruction.version++;
    },
    [],
  );

  useFrame(() => {
    const path = focusPath();
    const flying = isFlying();
    const p = camera.position;
    const key = path === null ? '' : `${path}|${flying ? 'flying' : `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`}`;
    if (key === last.current) return;
    // While flying, keep what was faded for the same grave; a new focus clears it until the flight has landed.
    if (flying && path !== null && last.current.startsWith(`${path}|`)) return;
    last.current = key;
    const face = path === null || flying ? null : faceOf(model, path);
    const blockers = face === null ? [] : blockersOf(vec3(p.x, p.y, p.z), face, occluders);
    obstruction.stones = new Set(blockers.filter((b) => b.kind === 'stone').map((b) => b.id));
    obstruction.fences = new Set(blockers.filter((b) => b.kind === 'fence').map((b) => b.id));
    obstruction.signs = new Set(blockers.filter((b) => b.kind === 'sign').map((b) => b.id));
    obstruction.version++;
  });

  return null;
}
