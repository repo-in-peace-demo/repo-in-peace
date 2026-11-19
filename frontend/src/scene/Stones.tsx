import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { STONE_D, STONE_W } from '../model/layout-constants';
import type { SceneModel } from '../model/scene-model';
import { ghostBaseHeight } from '../model/ghost-motion';
import { GHOST_D, GHOST_HEIGHT, GHOST_OPACITY, GHOST_W } from '../model/visual-constants';
import { GHOST_COLOR, STONE_COLOR } from './colors';
import { useHighlight } from './highlight';
import { noRaycast, placement } from './instances';

/**
 * Plain stones: an upright grey box for every file, as tall as its lines of code say. No moss, lean, cracks or
 * candle yet: those are added once the layout has been checked on real files.
 */
export function Stones({ model }: { model: SceneModel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const stones = model.stones;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    stones.forEach(({ layout }, i) => {
      mesh.setMatrixAt(i, placement(layout.x, layout.height / 2, layout.z, STONE_W, layout.height, STONE_D));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [stones]);
  useHighlight(ref, model, 'file', STONE_COLOR);

  if (stones.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, stones.length]} frustumCulled={false} raycast={noRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#ffffff" roughness={0.9} />
    </instancedMesh>
  );
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
