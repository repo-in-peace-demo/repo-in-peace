import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ghostTagText, tagAtlasTexts } from '../model/ghost-tag';
import { GHOST_PROFILE } from '../model/ghost-shape';
import type { SceneModel } from '../model/scene-model';
import { animationTime } from './animation-clock';
import { makeGhostMaterial } from './ghost-material';
import { makePoolMaterial, POOL_LIFT, POOL_RADIUS } from './ghost-pool-material';
import { makeTagAtlas } from './ghost-tag-atlas';
import { makeTagGeometry, makeTagMaterial } from './ghost-tag-material';
import { useRimHighlight } from './highlight';
import { noRaycast, placement } from './instances';
import { currentOverrides, frameOf } from './pr-overrides';

/**
 * The ghosts, three instanced meshes (three draw calls however many ghosts there are):
 *  - the figure: a pale-cyan translucent sheet ghost with a rounded head, a hem cut like curly braces, two eye holes on the side
 *    that faces +z, bright edges, floating about a third of its height off the ground and bobbing;
 *  - the toe tag: a small glowing card on a thread, with the type of the deleted file (`.ts`), that hangs from the ghost, sways
 *    with it and fades its text out with distance, leaving a glint;
 *  - the glow pool: a faint cyan light on the ground right under the ghost, which shows from a distance how high it floats.
 * The float, the bob and the sway are in the vertex shaders, from the same formula as `ghostBaseHeight`, which the selection
 * ring reads. An instance only needs its place on the ground, its phase and, for the tag, the cell of its text.
 */
export function Ghosts({ model }: { model: SceneModel }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const tags = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const ghosts = model.ghosts;

  const assets = useMemo(() => {
    const phases = Float32Array.from(ghosts, (g) => g.visual.phase);
    const phase = () => new THREE.InstancedBufferAttribute(phases, 1);

    const bodyGeometry = new THREE.LatheGeometry(
      GHOST_PROFILE.map(([radius, height]) => new THREE.Vector2(radius, height)),
      96,
    );
    bodyGeometry.setAttribute('aPhase', phase());
    const highlight = new THREE.InstancedBufferAttribute(new Float32Array(ghosts.length), 1);
    highlight.setUsage(THREE.DynamicDrawUsage);
    bodyGeometry.setAttribute('aHighlight', highlight);
    const settle = new THREE.InstancedBufferAttribute(new Float32Array(ghosts.length), 1);
    settle.setUsage(THREE.DynamicDrawUsage);
    bodyGeometry.setAttribute('aSettle', settle);
    const bodyMaterial = makeGhostMaterial();

    const texts = tagAtlasTexts(ghosts.map((g) => g.ghost.path));
    const atlas = makeTagAtlas(texts);
    const tagGeometry = makeTagGeometry();
    tagGeometry.setAttribute('aPhase', phase());
    tagGeometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(Float32Array.from(ghosts, (g) => texts.indexOf(ghostTagText(g.ghost.path))), 1));
    const tagMaterial = makeTagMaterial(atlas);

    const poolGeometry = new THREE.PlaneGeometry(2 * POOL_RADIUS, 2 * POOL_RADIUS);
    poolGeometry.rotateX(-Math.PI / 2);
    poolGeometry.translate(0, POOL_LIFT, 0);
    poolGeometry.setAttribute('aPhase', phase());
    const poolMaterial = makePoolMaterial();

    return { bodyGeometry, bodyMaterial, highlight, settle, tagGeometry, tagMaterial, atlas, poolGeometry, poolMaterial };
  }, [ghosts]);
  useEffect(
    () => () => {
      assets.bodyGeometry.dispose();
      assets.bodyMaterial.material.dispose();
      assets.tagGeometry.dispose();
      assets.tagMaterial.material.dispose();
      assets.atlas.dispose();
      assets.poolGeometry.dispose();
      assets.poolMaterial.material.dispose();
    },
    [assets],
  );

  useLayoutEffect(() => {
    for (const mesh of [body.current, tags.current, pools.current]) {
      if (!mesh) continue;
      ghosts.forEach(({ layout }, i) => mesh.setMatrixAt(i, placement(layout.x, 0, layout.z, 1, 1, 1)));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [ghosts]);

  useRimHighlight(assets.highlight, model, 'ghost');
  // Resurrect (bury-and-resurrect Req 10.2): the ghost settles to the ground and turns opaque; its tag and glow pool go at once (it no
  // longer floats over anything); once the new stone stands (RisenStones.tsx), the ghost is gone.
  const shown = useRef(new Map<number, string>());
  useFrame(() => {
    const values = assets.settle.array as Float32Array;
    let changed = false;
    let moved = false;
    for (const o of currentOverrides(model)) {
      if (o.kind !== 'risen') continue;
      const frame = frameOf(o);
      if (frame.kind !== 'risen') continue;
      if (values[o.index] !== frame.settle) {
        values[o.index] = frame.settle;
        changed = true;
      }
      const state = frame.solid >= 0.5 ? 'gone' : frame.settle > 0 ? 'settling' : 'floating';
      if (shown.current.get(o.index) === state) continue;
      shown.current.set(o.index, state);
      const { layout } = ghosts[o.index]!;
      // Hidden by moving far below the ground, not by scaling: the tag is a card built around its instance's centre, so a scale
      // of 0 left it floating in front of the new stone (seen in the first resurrect screenshot).
      const away = -1000;
      body.current?.setMatrixAt(o.index, placement(layout.x, state === 'gone' ? away : 0, layout.z, 1, 1, 1));
      tags.current?.setMatrixAt(o.index, placement(layout.x, state === 'floating' ? 0 : away, layout.z, 1, 1, 1));
      pools.current?.setMatrixAt(o.index, placement(layout.x, state === 'floating' ? 0 : away, layout.z, 1, 1, 1));
      moved = true;
    }
    if (changed) assets.settle.needsUpdate = true;
    if (moved) for (const mesh of [body.current, tags.current, pools.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  });

  useFrame(({ clock }) => {
    const t = animationTime(clock.elapsedTime);
    assets.bodyMaterial.uniforms.uTime.value = t;
    assets.tagMaterial.uniforms.uTime.value = t;
    assets.poolMaterial.uniforms.uTime.value = t;
  });

  if (ghosts.length === 0) return null;
  return (
    <>
      <instancedMesh ref={pools} args={[assets.poolGeometry, assets.poolMaterial.material, ghosts.length]} frustumCulled={false} raycast={noRaycast} renderOrder={3} />
      <instancedMesh ref={body} args={[assets.bodyGeometry, assets.bodyMaterial.material, ghosts.length]} frustumCulled={false} raycast={noRaycast} renderOrder={4} />
      <instancedMesh ref={tags} args={[assets.tagGeometry, assets.tagMaterial.material, ghosts.length]} frustumCulled={false} raycast={noRaycast} renderOrder={5} />
    </>
  );
}
