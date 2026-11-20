import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { horizonPlan } from '../model/horizon';
import { HILL_MIST_MAX_ALPHA, MIST_COLOR, MIST_LAYER_MAX_ALPHA, hillMistMesh, mistMesh, type MistMesh } from '../model/mist';
import type { SceneModel } from '../model/scene-model';
import { animationTime } from './animation-clock';
import { FOG_FRAGMENT_PARS, FOG_VERTEX, FOG_VERTEX_PARS, foggedUniforms } from './fog-fade';
import { noRaycast } from './instances';

/**
 * Ground mist (`model/mist.ts`): thin, low sheets over the graveyard's ground, one draw call. A slow two-scale noise rolls through
 * them along the rows, each sheet at its own speed, so the mist drifts and folds between the stones. Drawn after the solid scene
 * without writing depth (so it never covers a stone, candle or ghost in front of it), and faded by the fog like everything else.
 * It stands still with the animation clock.
 */

const VERTEX = /* glsl */ `
attribute float aWeight;
attribute float aLayer;
varying float vWeight;
varying float vLayer;
varying vec2 vGround;
${FOG_VERTEX_PARS}
void main() {
  vWeight = aWeight;
  vLayer = aLayer;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vGround = world.xz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_VERTEX}
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uMaxAlpha;
uniform vec2 uScale;
uniform vec3 uColor;
varying float vWeight;
varying float vLayer;
varying vec2 vGround;
${FOG_FRAGMENT_PARS}
float mHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mHash(i), mHash(i + vec2(1.0, 0.0)), f.x), mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  if (vWeight <= 0.001) discard;
  // Each sheet rolls at its own speed along the rows (x), with a slow drift across them, so the sheets slide over each other.
  float speed = 0.35 + 0.18 * vLayer;
  vec2 p = vGround * uScale + vec2(uTime * speed * 0.12, uTime * 0.015) + vLayer * 7.3; // stretched along the rows (x) in the graveyard
  float n = mNoise(p) * 0.62 + mNoise(p * 2.7 + vec2(-uTime * 0.05, 3.1)) * 0.38;
  float wisps = smoothstep(0.25, 0.7, n);
  float a = uMaxAlpha * vWeight * wisps;
  gl_FragColor = vec4(uColor, a * fogVisibility());
  #include <colorspace_fragment>
}
`;

function mistAssets(mesh: MistMesh, maxAlpha: number, scale: [number, number]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('aWeight', new THREE.BufferAttribute(mesh.weights, 1));
  geometry.setAttribute('aLayer', new THREE.BufferAttribute(mesh.layers, 1));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  const uniforms = foggedUniforms({
    uTime: { value: 0 },
    uMaxAlpha: { value: maxAlpha },
    uScale: { value: new THREE.Vector2(...scale) },
    uColor: { value: new THREE.Color(MIST_COLOR) },
  });
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  return { geometry, material, uniforms };
}

export function Mist({ model }: { model: SceneModel }) {
  const bounds = model.layout.bounds;
  const assets = useMemo(() => {
    const plan = horizonPlan(bounds);
    // In the graveyard: thin, low, rolling along the rows. On the hills: pooling in the dips, in broader shapes.
    return [mistAssets(mistMesh(plan), MIST_LAYER_MAX_ALPHA, [0.16, 0.35]), mistAssets(hillMistMesh(plan), HILL_MIST_MAX_ALPHA, [0.05, 0.08])];
  }, [bounds]);

  useEffect(
    () => () => {
      for (const a of assets) {
        a.geometry.dispose();
        a.material.dispose();
      }
    },
    [assets],
  );

  useFrame(({ clock }) => {
    const time = animationTime(clock.elapsedTime);
    for (const a of assets) a.uniforms.uTime!.value = time;
  });

  // Drawn after the solid scene and before the see-through things that stand in it (the ghosts' pools, the flames, the ghosts).
  return (
    <>
      {assets.map((a, i) => (
        <mesh key={i} geometry={a.geometry} material={a.material} renderOrder={1} frustumCulled={false} raycast={noRaycast} />
      ))}
    </>
  );
}
