import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SceneModel } from '../model/scene-model';
import { FLOOR_COLOR, GROUND_COLOR } from './colors';
import { noRaycast, placement } from './instances';

/** The ground: a large dark plane under everything, reaching well past the graveyard. */
export function Ground({ model }: { model: SceneModel }) {
  const { x, z, w, d } = model.layout.bounds;
  const size = Math.max(w, d) * 8 + 400;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x + w / 2, -0.02, z + d / 2]} renderOrder={-20} raycast={noRaycast}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={GROUND_COLOR} roughness={1} />
    </mesh>
  );
}

const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/**
 * One floor for every plot, one instanced mesh. A deeper folder's floor is a little darker (plotFloorShade).
 * Floors are drawn first and in the order of the plots, a parent before the folders inside it, without depth, so a
 * plot's floor lies over its parent's without the two flickering against each other.
 */
export function PlotFloors({ model }: { model: SceneModel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const floors = model.floors;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const color = new THREE.Color();
    floors.forEach(({ plot, shade }, i) => {
      const { x, z, w, d } = plot.rect;
      mesh.setMatrixAt(i, placement(x + w / 2, 0.01, z + d / 2, w, d, 1, FLAT));
      mesh.setColorAt(i, color.set(FLOOR_COLOR).multiplyScalar(shade));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [floors]);

  if (floors.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, floors.length]} frustumCulled={false} renderOrder={-10} raycast={noRaycast}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial depthTest={false} depthWrite={false} />
    </instancedMesh>
  );
}
