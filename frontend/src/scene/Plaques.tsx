import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneModel } from '../model/scene-model';
import { signsInTheWay, stepFade, type FadeSign, type ScreenPoint } from '../model/sign-fade';
import { PLAQUE_BOARD, PLAQUE_POST, SIGN_HEIGHT } from '../model/signs';
import { vec3, type Vec3 } from '../model/vec3';
import { isReducedMotion } from './animation-clock';
import { PLAQUE_COLOR } from './colors';
import { focusPath } from './focus';
import { noRaycast, placement } from './instances';
import { signFade } from './sign-fade-state';

/** A post with a board on it, as one shape, so all the plaques are one draw call. */
function makePlaqueGeometry(): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(PLAQUE_POST.w, PLAQUE_POST.h, PLAQUE_POST.w);
  post.translate(0, PLAQUE_POST.h / 2, 0);
  const board = new THREE.BoxGeometry(PLAQUE_BOARD.w, PLAQUE_BOARD.h, PLAQUE_BOARD.d);
  board.translate(0, SIGN_HEIGHT, 0);
  const merged = mergeGeometries([post, board]);
  post.dispose();
  board.dispose();
  if (merged === null) throw new Error('the plaque shapes could not be joined');
  return merged;
}

/** The plaque material, with a per-plaque opacity (`aFade`) so a sign in front of the grave in focus can fade out of the way. */
function makePlaqueMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: PLAQUE_COLOR, roughness: 0.9, transparent: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      // A fully faded plaque writes nothing, not even depth, so it hides nothing behind it.
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vFade < 0.01) discard;\ndiffuseColor.a *= vFade;');
  };
  material.customProgramCacheKey = () => 'repo-in-peace-plaque-fade-v1';
  return material;
}

/**
 * A plaque at the gate of every plot. Its text is a page element (ui/SignLayer.tsx), shown only when the camera is near. While a stone
 * or ghost is in focus (selected, or flown to), the plaques whose board or label would cover it fade out, and back in when the focus
 * moves on (`model/sign-fade.ts`); the labels follow (`sign-fade-state.ts`).
 */
export function Plaques({ model }: { model: SceneModel }) {
  const geometry = useMemo(makePlaqueGeometry, []);
  const material = useMemo(makePlaqueMaterial, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const ref = useRef<THREE.InstancedMesh>(null);
  const plots = model.layout.plots;
  const fade = useRef<Float32Array>(new Float32Array(0));
  const last = useRef<{ key: string; hidden: Set<string> }>({ key: '', hidden: new Set() });

  const signs = useMemo<FadeSign[]>(
    () => model.signSources.map((s) => ({ path: s.path, label: s.label, x: s.x, z: s.z, anchor: vec3(s.x, s.y, s.z) })),
    [model],
  );
  const boxes = useMemo(() => new Map(model.pickTargets.map((t) => [t.path, { min: t.min, max: t.max }] as const)), [model]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    plots.forEach((plot, i) => mesh.setMatrixAt(i, placement(plot.sign.x, 0, plot.sign.z, 1, 1, 1)));
    mesh.instanceMatrix.needsUpdate = true;
    fade.current = new Float32Array(plots.length).fill(1);
    geometry.setAttribute('aFade', new THREE.InstancedBufferAttribute(fade.current, 1));
    signFade.alpha = new Map();
    signFade.version++;
  }, [plots, geometry]);
  useEffect(
    () => () => {
      signFade.alpha = new Map();
      signFade.version++;
    },
    [],
  );

  const point = useMemo(() => new THREE.Vector3(), []);
  const project = (p: Vec3): ScreenPoint | null => {
    point.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
    const depth = -point.z;
    if (depth <= 0) return null;
    point.applyMatrix4(camera.projectionMatrix);
    return { x: ((point.x + 1) / 2) * size.width, y: ((1 - point.y) / 2) * size.height, depth };
  };

  useFrame((_state, delta) => {
    const mesh = ref.current;
    const alphas = fade.current;
    if (!mesh || alphas.length !== plots.length) return;
    // Which signs are in the way: worked out again only when the focus or the camera has changed.
    const focus = focusPath();
    const box = focus === null ? undefined : boxes.get(focus);
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const key = box === undefined ? '' : `${focus}|${e.map((v) => v.toFixed(3)).join(',')}|${size.width}x${size.height}`;
    if (key !== last.current.key) last.current = { key, hidden: box === undefined ? new Set() : signsInTheWay(box, signs, project) };
    const hidden = last.current.hidden;
    // Each sign eases toward its target; nothing is written while nothing moves.
    const seconds = isReducedMotion() ? Number.POSITIVE_INFINITY : delta;
    let changed = false;
    for (let i = 0; i < plots.length; i++) {
      const target = hidden.has(plots[i]!.path) ? 0 : 1;
      if (alphas[i] === target) continue;
      alphas[i] = stepFade(alphas[i]!, target, seconds);
      changed = true;
    }
    if (!changed) return;
    (geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute).needsUpdate = true;
    const next = new Map<string, number>();
    plots.forEach((plot, i) => {
      if (alphas[i]! < 1) next.set(plot.path, alphas[i]!);
    });
    signFade.alpha = next;
    signFade.version++;
  });

  if (plots.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, plots.length]} frustumCulled={false} raycast={noRaycast} />;
}
