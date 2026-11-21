import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FENCE_POST, FENCE_RAIL, fenceInstances } from '../model/fences';
import type { SceneModel } from '../model/scene-model';
import { stepFade } from '../model/sign-fade';
import { isReducedMotion } from './animation-clock';
import { FENCE_COLOR } from './colors';
import { FADE_FRAGMENT, FADE_FRAGMENT_DECLARATIONS, FADE_VERTEX, FADE_VERTEX_DECLARATIONS } from './fade-dither';
import { noRaycast, placement } from './instances';
import { obstruction } from './obstruction-state';

const POST = FENCE_POST;
const RAIL = FENCE_RAIL;

/** The fence material, with a per-instance fade by dithering (`fade-dither.ts`). */
function makeFenceMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: FENCE_COLOR, roughness: 0.9 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FADE_VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FADE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FADE_FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FADE_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => 'repo-in-peace-fence-fade-v1';
  return material;
}

/** A unit box with a fade value per instance. */
function makeFadingBox(count: number): { geometry: THREE.BoxGeometry; fade: THREE.InstancedBufferAttribute } {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
  fade.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aFade', fade);
  return { geometry, fade };
}

/**
 * Every plot's fence: posts and rails, two instanced meshes in all. A post or rail in front of the grave in focus fades out of the way,
 * and back in when the focus moves on (`Obstructions.tsx`; ids `post:<i>` and `rail:<i>`, as in `model/clear-view.ts`).
 */
export function Fences({ model }: { model: SceneModel }) {
  const fence = useMemo(() => fenceInstances(model.layout), [model.layout]);
  const posts = useRef<THREE.InstancedMesh>(null);
  const rails = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(makeFenceMaterial, []);
  const postBox = useMemo(() => makeFadingBox(fence.posts.length), [fence]);
  const railBox = useMemo(() => makeFadingBox(fence.rails.length), [fence]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => postBox.geometry.dispose(), [postBox]);
  useEffect(() => () => railBox.geometry.dispose(), [railBox]);

  useLayoutEffect(() => {
    const mesh = posts.current;
    if (!mesh) return;
    fence.posts.forEach((p, i) => mesh.setMatrixAt(i, placement(p.x, POST.height / 2, p.z, POST.width, POST.height, POST.width)));
    mesh.instanceMatrix.needsUpdate = true;
  }, [fence]);

  useLayoutEffect(() => {
    const mesh = rails.current;
    if (!mesh) return;
    fence.rails.forEach((r, i) => {
      const along = r.axis === 'x';
      mesh.setMatrixAt(i, placement(r.x, RAIL.y, r.z, along ? r.length : RAIL.thickness, RAIL.height, along ? RAIL.thickness : r.length));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [fence]);

  useFrame((_state, delta) => {
    const seconds = isReducedMotion() ? Number.POSITIVE_INFINITY : delta;
    for (const [prefix, box] of [['post', postBox], ['rail', railBox]] as const) {
      const alphas = box.fade.array as Float32Array;
      let changed = false;
      for (let i = 0; i < alphas.length; i++) {
        const id = `${prefix}:${i}`;
        const target = obstruction.fences.has(id) ? 0 : 1;
        if (alphas[i] === target) continue;
        alphas[i] = stepFade(alphas[i]!, target, seconds);
        changed = true;
        if (alphas[i]! < 1) obstruction.alpha.fences.set(id, alphas[i]!);
        else obstruction.alpha.fences.delete(id);
      }
      if (changed) box.fade.needsUpdate = true;
    }
  });

  return (
    <>
      {fence.posts.length > 0 && (
        <instancedMesh ref={posts} args={[postBox.geometry, material, fence.posts.length]} frustumCulled={false} raycast={noRaycast} />
      )}
      {fence.rails.length > 0 && (
        <instancedMesh ref={rails} args={[railBox.geometry, material, fence.rails.length]} frustumCulled={false} raycast={noRaycast} />
      )}
    </>
  );
}
