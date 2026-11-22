import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { engravingCells, engravingFor } from '../model/engraving';
import { hash01 } from '../model/hash';
import { risenHeight } from '../model/pr-scene';
import type { SceneModel } from '../model/scene-model';
import { animationTime } from './animation-clock';
import { ENGRAVE_CAPACITY, makeEngravingAtlas } from './engraving-atlas';
import { useRimHighlight } from './highlight';
import { noRaycast, placement } from './instances';
import { currentOverrides, frameOf } from './pr-overrides';
import { makeStoneMaterial } from './stone-material';
import { makeTombstoneGeometry } from './tombstone-geometry';

/**
 * The stones that resurrected ghosts become in this session (bury-and-resurrect Req 10.2): one instanced mesh with an instance per
 * ghost, all hidden until their ghost's pull request is opened. Each is a clean, upright stone (the fresh look: no moss, no cracks,
 * no lean) with the ghost's name engraved, at the ghost's slot, the graveyard's shortest height (a ghost has no line count). It fades
 * in through the stones' own dither, and takes the ghost's hover and selection highlight.
 */
export function RisenStones({ model }: { model: SceneModel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const ghosts = model.ghosts;

  const assets = useMemo(() => {
    const n = ghosts.length;
    const geometry = makeTombstoneGeometry();
    const attribute = (array: Float32Array) => new THREE.InstancedBufferAttribute(array, 1);
    geometry.setAttribute('aHeight', attribute(new Float32Array(n).fill(risenHeight(model))));
    geometry.setAttribute('aMoss', attribute(new Float32Array(n)));
    geometry.setAttribute('aCrack', attribute(new Float32Array(n)));
    geometry.setAttribute('aSeed', attribute(Float32Array.from(ghosts, (g) => hash01(g.ghost.path, 'stone-seed'))));
    const highlight = attribute(new Float32Array(n));
    highlight.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aHighlight', highlight);
    const { texts, nameCell } = engravingCells(ghosts.map((g) => engravingFor(g.ghost.path, false)), ENGRAVE_CAPACITY);
    geometry.setAttribute('aNameCell', attribute(Float32Array.from(nameCell)));
    const fade = attribute(new Float32Array(n));
    fade.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFade', fade);
    const atlas = makeEngravingAtlas(texts);
    const { material, uniforms } = makeStoneMaterial({ atlas: atlas.texture, rows: atlas.rows });
    return { geometry, material, uniforms, highlight, fade, atlas: atlas.texture };
  }, [ghosts, model]);
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
    ghosts.forEach(({ layout }, i) => mesh.setMatrixAt(i, placement(layout.x, 0, layout.z, 0, 0, 0)));
    mesh.instanceMatrix.needsUpdate = true;
  }, [ghosts]);

  useRimHighlight(assets.highlight, model, 'ghost');
  const shown = useRef(new Map<number, number>());
  useFrame(({ clock }) => {
    assets.uniforms.uTime.value = animationTime(clock.elapsedTime);
    const mesh = ref.current;
    if (!mesh) return;
    const fades = assets.fade.array as Float32Array;
    let changed = false;
    for (const o of currentOverrides(model)) {
      if (o.kind !== 'risen') continue;
      const frame = frameOf(o);
      if (frame.kind !== 'risen' || shown.current.get(o.index) === frame.solid) continue;
      shown.current.set(o.index, frame.solid);
      const { layout } = ghosts[o.index]!;
      const scale = frame.solid > 0 ? 1 : 0;
      mesh.setMatrixAt(o.index, placement(layout.x, 0, layout.z, scale, scale, scale));
      fades[o.index] = frame.solid;
      changed = true;
    }
    if (changed) {
      mesh.instanceMatrix.needsUpdate = true;
      assets.fade.needsUpdate = true;
    }
  });

  if (ghosts.length === 0) return null;
  return <instancedMesh ref={ref} args={[assets.geometry, assets.material, ghosts.length]} frustumCulled={false} raycast={noRaycast} />;
}
