import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GHOST_PROFILE } from '../model/ghost-shape';
import type { SceneModel } from '../model/scene-model';
import { animationTime } from './animation-clock';
import { makeGhostMaterial } from './ghost-material';
import { useRimHighlight } from './highlight';
import { noRaycast, placement } from './instances';

/**
 * The ghosts: a translucent pale-cyan figure with a rounded head that tapers away to a wisp at the bottom, floating well
 * above the ground and bobbing gently, one instanced mesh and one draw call. It is turned on a lathe from `GHOST_PROFILE`, so
 * it is round and fits inside its cell. The float and the bob are in the vertex shader (and in `ghostBaseHeight`, which the
 * selection ring reads), so an instance only needs its place on the ground and its phase.
 */
export function Ghosts({ model }: { model: SceneModel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const ghosts = model.ghosts;

  const assets = useMemo(() => {
    const geometry = new THREE.LatheGeometry(
      GHOST_PROFILE.map(([radius, height]) => new THREE.Vector2(radius, height)),
      28,
    );
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(Float32Array.from(ghosts, (g) => g.visual.phase), 1));
    const highlight = new THREE.InstancedBufferAttribute(new Float32Array(ghosts.length), 1);
    highlight.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aHighlight', highlight);
    const { material, uniforms } = makeGhostMaterial();
    return { geometry, material, uniforms, highlight };
  }, [ghosts]);
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
    ghosts.forEach(({ layout }, i) => mesh.setMatrixAt(i, placement(layout.x, 0, layout.z, 1, 1, 1)));
    mesh.instanceMatrix.needsUpdate = true;
  }, [ghosts]);

  useRimHighlight(assets.highlight, model, 'ghost');
  useFrame(({ clock }) => {
    assets.uniforms.uTime.value = animationTime(clock.elapsedTime);
  });

  if (ghosts.length === 0) return null;
  return <instancedMesh ref={ref} args={[assets.geometry, assets.material, ghosts.length]} frustumCulled={false} raycast={noRaycast} renderOrder={4} />;
}
