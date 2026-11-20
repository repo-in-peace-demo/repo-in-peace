import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { SceneModel } from '../model/scene-model';
import { signBlocked, stoneOccluders } from '../model/sign-occlusion';
import { placeSignsClear } from '../model/sign-placement';
import { SIGN_MAX_VISIBLE, visibleSigns } from '../model/signs';
import { sameView, type ViewSignature } from '../model/view-signature';
import { vec3 } from '../model/vec3';

/**
 * Keeps the pool of sign elements (ui/SignLayer.tsx) up to date. Each frame it only compares the camera with the last
 * one it worked out; when the camera, its lens and the size of the scene are all unchanged it does nothing at all.
 * Otherwise it asks `visibleSigns` which signs show, projects their anchors to the screen, drops a sign hidden behind a stone and a sign whose text would overlap a nearer one, and writes the text,
 * place and opacity into the pool's elements, touching only what changed. No element is created or removed.
 */
export function SignDriver({ model, container }: { model: SceneModel; container: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const last = useRef<ViewSignature | null>(null);
  const updates = useRef(0);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const sources = useMemo(() => new Map(model.signSources.map((s) => [s.path, s] as const)), [model]);
  const occluders = useMemo(() => stoneOccluders(model.pickTargets), [model]);

  // A new graveyard: work the signs out again at the next frame.
  useEffect(() => {
    last.current = null;
  }, [model, sources]);

  // Leaving: hide every element.
  useEffect(
    () => () => {
      for (const element of Array.from(container.current?.children ?? []) as HTMLElement[]) element.style.display = 'none';
    },
    [container],
  );

  useFrame(() => {
    const root = container.current;
    if (!root) return;

    camera.getWorldDirection(forward);
    const view: ViewSignature = {
      px: camera.position.x,
      py: camera.position.y,
      pz: camera.position.z,
      fx: forward.x,
      fy: forward.y,
      fz: forward.z,
      fovY: camera.fov,
      aspect: camera.aspect,
      width: size.width,
      height: size.height,
    };
    if (sameView(last.current, view)) return;
    last.current = view;

    const visible = visibleSigns(
      model.signSources,
      { position: vec3(view.px, view.py, view.pz), forward: vec3(view.fx, view.fy, view.fz), fovY: view.fovY, aspect: view.aspect },
      SIGN_MAX_VISIBLE,
    );
    // A sign behind a stone is not labelled: its label would be drawn over the stone (the page is on top of the canvas). This runs
    // before the overlap rule, so a hidden sign never takes the place of one further away that can be seen.
    const camera3 = vec3(view.px, view.py, view.pz);
    const unblocked = visible.filter((sign) => {
      const source = sources.get(sign.path);
      return source !== undefined && !signBlocked(camera3, vec3(source.x, source.y, source.z), occluders);
    });
    const placements = placeSignsClear(unblocked, (path) => {
      const source = sources.get(path);
      if (!source) return null;
      point.set(source.x, source.y, source.z).project(camera);
      if (point.z > 1) return null; // behind the camera
      return { x: ((point.x + 1) / 2) * size.width, y: ((1 - point.y) / 2) * size.height };
    });

    const elements = root.children;
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i] as HTMLElement;
      const placement = placements[i];
      if (placement === undefined) {
        if (element.style.display !== 'none') element.style.display = 'none';
        continue;
      }
      if (element.textContent !== placement.label) element.textContent = placement.label; // text, never markup
      element.style.transform = `translate(${placement.x.toFixed(1)}px, ${placement.y.toFixed(1)}px) translate(-50%, -100%)`;
      element.style.opacity = placement.opacity.toFixed(2);
      if (element.style.display !== 'block') element.style.display = 'block';
    }

    if (import.meta.env.DEV) root.dataset.updates = String(++updates.current); // lets the browser test see when it ran
  });

  return null;
}
