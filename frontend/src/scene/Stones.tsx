import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SceneModel } from '../model/scene-model';
import { ghostBaseHeight } from '../model/ghost-motion';
import { GHOST_D, GHOST_HEIGHT, GHOST_OPACITY, GHOST_W } from '../model/visual-constants';
import { leanQuaternion, stoneAttributes } from '../model/stone-attributes';
import { GHOST_COLOR } from './colors';
import { useHighlight, useRimHighlight } from './highlight';
import { animationTime } from './animation-clock';
import { makeStoneMaterial } from './stone-material';
import { makeTombstoneGeometry } from './tombstone-geometry';
import { noRaycast, placement } from './instances';

/**
 * The tombstones: one instanced mesh, one draw call. Each instance has its position and, for an ancient stone, its
 * lean (a rotation about its foot, toward a direction from a hash of its path). The rest of its look is per-instance
 * attributes that the stone material reads (moss, cracks and glow, height, hover and selection), written once when
 * the model loads; hover and selection later write a single element. The candles are a separate mesh (task 22).
 */
export function Stones({ model }: { model: SceneModel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const stones = model.stones;

  const assets = useMemo(() => {
    const geometry = makeTombstoneGeometry();
    const values = stoneAttributes(stones);
    const attribute = (array: Float32Array) => new THREE.InstancedBufferAttribute(array, 1);
    geometry.setAttribute('aHeight', attribute(values.height));
    geometry.setAttribute('aMoss', attribute(values.moss));
    geometry.setAttribute('aCrack', attribute(values.crack));
    geometry.setAttribute('aSeed', attribute(values.seed));
    const highlight = attribute(new Float32Array(stones.length));
    highlight.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aHighlight', highlight);
    const { material, uniforms } = makeStoneMaterial();
    return { geometry, material, uniforms, highlight };
  }, [stones]);
  useEffect(
    () => () => {
      assets.geometry.dispose();
      assets.material.dispose();
    },
    [assets],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rotation = new THREE.Quaternion();
    stones.forEach(({ layout, visual }, i) => {
      const q = leanQuaternion(visual.leanDegrees, visual.leanDirection);
      rotation.set(q.x, q.y, q.z, q.w);
      mesh.setMatrixAt(i, placement(layout.x, 0, layout.z, 1, 1, 1, rotation));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [stones]);

  useRimHighlight(assets.highlight, model, 'file');
  useFrame(({ clock }) => {
    assets.uniforms.uTime.value = animationTime(clock.elapsedTime);
  });

  if (stones.length === 0) return null;
  return <instancedMesh ref={ref} args={[assets.geometry, assets.material, stones.length]} frustumCulled={false} raycast={noRaycast} />;
}

/** Plain ghosts: a translucent pale box floating where each deleted file stood, so their places can be checked. */
export function Ghosts({ model }: { model: SceneModel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const ghosts = model.ghosts;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    // The height comes from the same function as the selection ring's, so the two cannot drift apart.
    ghosts.forEach(({ layout, visual }, i) => {
      mesh.setMatrixAt(i, placement(layout.x, ghostBaseHeight(visual, 0) + GHOST_HEIGHT / 2, layout.z, GHOST_W, GHOST_HEIGHT, GHOST_D));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [ghosts]);
  useHighlight(ref, model, 'ghost', GHOST_COLOR);

  if (ghosts.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, ghosts.length]} frustumCulled={false} raycast={noRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#ffffff" transparent opacity={GHOST_OPACITY} depthWrite={false} />
    </instancedMesh>
  );
}
