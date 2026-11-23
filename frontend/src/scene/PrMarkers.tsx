import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MAX_GLYPHS, PLATE_H, PLATE_W, STAKE_H, markerGlyphs, slotOf, stakeSpot, type GraveOverride } from '../model/pr-scene';
import { makeGraveMoundGeometry } from './grave-mound-geometry';
import type { SceneModel } from '../model/scene-model';
import { noRaycast, placement } from './instances';
import { GLYPHS, makeMarkerAtlas } from './pr-marker-atlas';
import { currentOverrides, frameOf } from './pr-overrides';

/**
 * What a session's pull requests leave in the scene (bury-and-resurrect Req 10.1, 10.2, 10.6): a fresh grave where a buried stone stood
 * (grave-mound-geometry.ts), and a small wooden stake with a wooden plaque reading "PR #N", pushed into the grave's head, or in front
 * of a resurrected stone. Everything stays inside the stone's layout cell (`marksExtent`).
 * Four instanced meshes (mounds, posts, plates, glyphs) with room for every unused stone and every ghost, all hidden until needed; only
 * the overridden instances are written, each frame while they rise.
 */
const POST_W = 0.07;
const GLYPH_W = 0.105;
const GLYPH_H = 0.2;
/** Revised after review: wood tones for the stake and the plaque (the plate was grey-blue under the moonlight), burnt-in letters. */
const STAKE_WOOD = '#6b4a2c';
const PLAQUE_WOOD = '#c09060';

const GLYPH_VERTEX = /* glsl */ `
attribute float aGlyph;
uniform float uCells;
varying vec2 vUv;
void main() {
  vUv = vec2((uv.x + aGlyph) / uCells, uv.y);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const GLYPH_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
void main() {
  if (texture2D(uAtlas, vUv).a < 0.35) discard;
  gl_FragColor = vec4(0.12, 0.07, 0.035, 1.0);
}
`;

export function PrMarkers({ model }: { model: SceneModel }) {
  const mounds = useRef<THREE.InstancedMesh>(null);
  const posts = useRef<THREE.InstancedMesh>(null);
  const plates = useRef<THREE.InstancedMesh>(null);
  const glyphs = useRef<THREE.InstancedMesh>(null);

  // A slot for every grave that can have a pull request: unused stones (Bury), then ghosts (Resurrect).
  const slots = useMemo(() => {
    const unused = model.stones.map((s, i) => (s.file.unused ? i : -1)).filter((i) => i >= 0);
    const ofStone = new Map(unused.map((stoneIndex, slot) => [stoneIndex, slot]));
    return { ofStone, unusedCount: unused.length, total: unused.length + model.ghosts.length };
  }, [model]);
  const slotOfOverride = (o: GraveOverride): number | undefined => (o.kind === 'buried' ? slots.ofStone.get(o.index) : slots.unusedCount + o.index);

  const assets = useMemo(() => {
    const mound = makeGraveMoundGeometry();
    const post = new THREE.BoxGeometry(POST_W, 1, POST_W).translate(0, 0.5, 0);
    const plate = new THREE.BoxGeometry(PLATE_W, PLATE_H, 0.035);
    const glyph = new THREE.PlaneGeometry(GLYPH_W, GLYPH_H);
    const cells = new THREE.InstancedBufferAttribute(new Float32Array(slots.total * MAX_GLYPHS), 1);
    cells.setUsage(THREE.DynamicDrawUsage);
    glyph.setAttribute('aGlyph', cells);
    const atlas = makeMarkerAtlas();
    return {
      mound,
      post,
      plate,
      glyph,
      cells,
      atlas,
      // Smooth shading (fourth review: flat facets gave the heap hard edges, like a box); the noise in colour and height keeps it rough.
      earth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
      wood: new THREE.MeshStandardMaterial({ color: STAKE_WOOD, roughness: 0.95, metalness: 0 }),
      paint: new THREE.MeshStandardMaterial({ color: PLAQUE_WOOD, roughness: 0.9, metalness: 0 }),
      ink: new THREE.ShaderMaterial({ vertexShader: GLYPH_VERTEX, fragmentShader: GLYPH_FRAGMENT, uniforms: { uAtlas: { value: atlas }, uCells: { value: GLYPHS.length } } }),
    };
  }, [slots]);
  useEffect(
    () => () => {
      for (const g of [assets.mound, assets.post, assets.plate, assets.glyph]) g.dispose();
      for (const m of [assets.earth, assets.wood, assets.paint, assets.ink]) m.dispose();
      assets.atlas.dispose();
    },
    [assets],
  );

  useLayoutEffect(() => {
    for (const mesh of [mounds.current, posts.current, plates.current, glyphs.current]) {
      if (!mesh) continue;
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, placement(0, -1000, 0, 0, 0, 0));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [assets]);

  const drawn = useRef(new Map<number, { heap: number; shown: number }>());
  useFrame(() => {
    let moved = false;
    for (const o of currentOverrides(model)) {
      const slot = slotOfOverride(o);
      if (slot === undefined) continue;
      const frame = frameOf(o);
      const heap = frame.kind === 'buried' ? frame.mound : frame.solid;
      // The stake rises with the mound, or when the gravedigger plants it.
      const shown = frame.kind === 'buried' ? frame.stake : frame.solid;
      const was = drawn.current.get(slot);
      if (was !== undefined && was.heap === heap && was.shown === shown) continue;
      drawn.current.set(slot, { heap, shown });
      moved = true;
      if (o.kind === 'buried') {
        const { x, z } = slotOf(o, model);
        // Below the ground until it rises (a flattened heap would show as a patch on the grass while the stone sinks).
        mounds.current?.setMatrixAt(slot, placement(x, heap > 0 ? 0 : -1000, z, 1, Math.max(0.001, heap), 1));
      }
      const foot = stakeSpot(o, model);
      const s = shown > 0 ? 1 : 0;
      posts.current?.setMatrixAt(slot, placement(foot.x, 0, foot.z, s, STAKE_H * shown, s));
      const plateY = STAKE_H * shown - PLATE_H / 2;
      plates.current?.setMatrixAt(slot, placement(foot.x, plateY, foot.z + POST_W / 2 + 0.016, s, s, s));
      const cells = markerGlyphs(o.number);
      const values = assets.cells.array as Float32Array;
      for (let j = 0; j < MAX_GLYPHS; j++) {
        const at = slot * MAX_GLYPHS + j;
        const visible = j < cells.length && shown > 0;
        const left = foot.x - ((cells.length - 1) * GLYPH_W) / 2 + j * GLYPH_W;
        values[at] = cells[j] ?? 0;
        glyphs.current?.setMatrixAt(at, placement(left, plateY, foot.z + POST_W / 2 + 0.034, visible ? 1 : 0, visible ? 1 : 0, 1));
      }
      assets.cells.needsUpdate = true;
    }
    if (moved) for (const mesh of [mounds.current, posts.current, plates.current, glyphs.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  });

  if (slots.total === 0) return null;
  return (
    <>
      <instancedMesh ref={mounds} args={[assets.mound, assets.earth, slots.total]} frustumCulled={false} raycast={noRaycast} />
      <instancedMesh ref={posts} args={[assets.post, assets.wood, slots.total]} frustumCulled={false} raycast={noRaycast} />
      <instancedMesh ref={plates} args={[assets.plate, assets.paint, slots.total]} frustumCulled={false} raycast={noRaycast} />
      <instancedMesh ref={glyphs} args={[assets.glyph, assets.ink, slots.total * MAX_GLYPHS]} frustumCulled={false} raycast={noRaycast} />
    </>
  );
}
