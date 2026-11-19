import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fenceInstances } from '../model/fences';
import type { SceneModel } from '../model/scene-model';
import { FENCE_COLOR } from './colors';
import { noRaycast, placement } from './instances';

const POST = { width: 0.12, height: 1.1 };
const RAIL = { thickness: 0.06, height: 0.08, y: 0.85 };

/** Every plot's fence: posts and rails, two instanced meshes in all. */
export function Fences({ model }: { model: SceneModel }) {
  const fence = useMemo(() => fenceInstances(model.layout), [model.layout]);
  const posts = useRef<THREE.InstancedMesh>(null);
  const rails = useRef<THREE.InstancedMesh>(null);

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
      mesh.setMatrixAt(
        i,
        placement(r.x, RAIL.y, r.z, along ? r.length : RAIL.thickness, RAIL.height, along ? RAIL.thickness : r.length),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [fence]);

  return (
    <>
      {fence.posts.length > 0 && (
        <instancedMesh ref={posts} args={[undefined, undefined, fence.posts.length]} frustumCulled={false} raycast={noRaycast}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={FENCE_COLOR} roughness={0.9} />
        </instancedMesh>
      )}
      {fence.rails.length > 0 && (
        <instancedMesh ref={rails} args={[undefined, undefined, fence.rails.length]} frustumCulled={false} raycast={noRaycast}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={FENCE_COLOR} roughness={0.9} />
        </instancedMesh>
      )}
    </>
  );
}
