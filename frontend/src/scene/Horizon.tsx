import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FOREST_COLOR, GROUND_BASE_COLOR } from '../model/atmosphere';
import { forestTrees, forestTriangles, horizonPlan, landMesh } from '../model/horizon';
import type { SceneModel } from '../model/scene-model';
import { noRaycast } from './instances';

/**
 * The land around the graveyard (`model/horizon.ts`): moonlit hills that rise from just behind the fence to a ridge, low far hills
 * beyond, and a dense forest of dark silhouettes on the ridge, with a clearing under the moon. Two meshes, two draw calls. The
 * hills are the ground's colour and lit like it, by the moonlight and the sky, and the fog fades them into the haze at the
 * horizon; the forest is flat and unlit, so it is a silhouette, and fades into the haze too. Only the graveyard's bounds are
 * read, never a file's facts, so this is backdrop like the sky. Nothing here can be picked.
 */
/** For the development API only (`setHorizonVisible`): the group of the hills and forest on the screen, and whether to show it. */
export const horizonDebug: { group: THREE.Group | null; visible: boolean } = { group: null, visible: true };

export function Horizon({ model }: { model: SceneModel }) {
  const bounds = model.layout.bounds;
  const group = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    horizonDebug.group = g;
    g.visible = horizonDebug.visible;
    return () => {
      if (horizonDebug.group === g) horizonDebug.group = null;
    };
  }, []);
  const assets = useMemo(() => {
    const plan = horizonPlan(bounds);

    const land = landMesh(plan);
    const landGeometry = new THREE.BufferGeometry();
    landGeometry.setAttribute('position', new THREE.BufferAttribute(land.positions, 3));
    landGeometry.setIndex(new THREE.BufferAttribute(land.indices, 1));
    landGeometry.computeVertexNormals();
    landGeometry.computeBoundingSphere();
    const landMaterial = new THREE.MeshStandardMaterial({
      color: GROUND_BASE_COLOR,
      roughness: 1,
      // Where the hills start, just above the flat ground plane (at -0.02): win the depth test against it, without flicker.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const forestGeometry = new THREE.BufferGeometry();
    forestGeometry.setAttribute('position', new THREE.BufferAttribute(forestTriangles(forestTrees(plan)), 3));
    forestGeometry.computeBoundingSphere();
    const forestMaterial = new THREE.MeshBasicMaterial({ color: FOREST_COLOR, side: THREE.DoubleSide });

    return { landGeometry, landMaterial, forestGeometry, forestMaterial };
  }, [bounds]);

  useEffect(
    () => () => {
      assets.landGeometry.dispose();
      assets.landMaterial.dispose();
      assets.forestGeometry.dispose();
      assets.forestMaterial.dispose();
    },
    [assets],
  );

  return (
    <group ref={group}>
      <mesh geometry={assets.landGeometry} material={assets.landMaterial} raycast={noRaycast} />
      <mesh geometry={assets.forestGeometry} material={assets.forestMaterial} raycast={noRaycast} />
    </group>
  );
}
