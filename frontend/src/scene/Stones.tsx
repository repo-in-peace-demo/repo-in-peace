import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SceneModel } from '../model/scene-model';
import { engravingCells, engravingFor } from '../model/engraving';
import { leanQuaternion, stoneAttributes } from '../model/stone-attributes';
import { ENGRAVE_CAPACITY, makeEngravingAtlas } from './engraving-atlas';
import { useRimHighlight } from './highlight';
import { animationTime, isReducedMotion } from './animation-clock';
import { stepFade } from '../model/sign-fade';
import { obstruction } from './obstruction-state';
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
    // The engraving: RIP and the names in one atlas, and each stone's name cell.
    const { texts, nameCell } = engravingCells(stones.map((s) => engravingFor(s.file.path, s.file.unused)), ENGRAVE_CAPACITY);
    geometry.setAttribute('aNameCell', attribute(Float32Array.from(nameCell)));
    const fade = attribute(new Float32Array(stones.length).fill(1));
    fade.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFade', fade);
    const atlas = makeEngravingAtlas(texts);
    const { material, uniforms } = makeStoneMaterial({ atlas: atlas.texture, rows: atlas.rows });
    return { geometry, material, uniforms, highlight, fade, atlas: atlas.texture };
  }, [stones]);
  useEffect(
    () => () => {
      assets.geometry.dispose();
      assets.material.dispose();
      assets.atlas.dispose();
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
  // Stones in front of the grave in focus fade out of the way, and back in when the focus moves on (scene/Obstructions.tsx).
  const paths = useMemo(() => stones.map((st) => st.file.path), [stones]);
  useFrame(({ clock }, delta) => {
    assets.uniforms.uTime.value = animationTime(clock.elapsedTime);
    const alphas = assets.fade.array as Float32Array;
    const seconds = isReducedMotion() ? Number.POSITIVE_INFINITY : delta;
    let changed = false;
    for (let i = 0; i < paths.length; i++) {
      const target = obstruction.stones.has(paths[i]!) ? 0 : 1;
      if (alphas[i] === target) continue;
      alphas[i] = stepFade(alphas[i]!, target, seconds);
      changed = true;
      if (alphas[i]! < 1) obstruction.alpha.stones.set(paths[i]!, alphas[i]!);
      else obstruction.alpha.stones.delete(paths[i]!);
    }
    if (changed) assets.fade.needsUpdate = true;
  });

  if (stones.length === 0) return null;
  return <instancedMesh ref={ref} args={[assets.geometry, assets.material, stones.length]} frustumCulled={false} raycast={noRaycast} />;
}
