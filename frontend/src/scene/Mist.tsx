import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { horizonPlan } from '../model/horizon';
import { MIST_COLOR, MIST_LAYER_HEIGHTS, MIST_LAYER_MAX_ALPHA, mistMesh } from '../model/mist';
import type { SceneModel } from '../model/scene-model';
import { animationTime } from './animation-clock';
import { FOG_FRAGMENT_PARS, FOG_VERTEX, FOG_VERTEX_PARS, foggedUniforms } from './fog-fade';
import { noRaycast } from './instances';

/**
 * Ground mist (`model/mist.ts`): thin sheets over the ground and the hills, one draw call. A slow two-scale noise rolls through
 * them across the rows, each sheet at its own speed, so the mist drifts and folds; it pools at the foot of the hills. Drawn after
 * the solid scene without writing depth, and faded by the fog like everything else. It stands still with the animation clock.
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
uniform float uLayers;
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
  vec2 p = vGround * 0.09 + vec2(uTime * speed * 0.09, uTime * 0.012) + vLayer * 7.3;
  float n = mNoise(p) * 0.62 + mNoise(p * 2.7 + vec2(-uTime * 0.05, 3.1)) * 0.38;
  float wisps = smoothstep(0.32, 0.78, n);
  float a = uMaxAlpha * vWeight * wisps;
  gl_FragColor = vec4(uColor, a * fogVisibility());
  #include <colorspace_fragment>
}
`;

export function Mist({ model }: { model: SceneModel }) {
  const bounds = model.layout.bounds;
  const assets = useMemo(() => {
    const mesh = mistMesh(horizonPlan(bounds));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('aWeight', new THREE.BufferAttribute(mesh.weights, 1));
    geometry.setAttribute('aLayer', new THREE.BufferAttribute(mesh.layers, 1));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geometry.computeBoundingSphere();
    const uniforms = foggedUniforms({
      uTime: { value: 0 },
      uMaxAlpha: { value: MIST_LAYER_MAX_ALPHA },
      uLayers: { value: MIST_LAYER_HEIGHTS.length },
      uColor: { value: new THREE.Color(MIST_COLOR) },
    });
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    return { geometry, material, uniforms };
  }, [bounds]);

  useEffect(
    () => () => {
      assets.geometry.dispose();
      assets.material.dispose();
    },
    [assets],
  );

  useFrame(({ clock }) => {
    assets.uniforms.uTime!.value = animationTime(clock.elapsedTime);
  });

  // Drawn after the solid scene and before the see-through things that stand in it (the ghosts' pools, the flames, the ghosts).
  return <mesh geometry={assets.geometry} material={assets.material} renderOrder={1} frustumCulled={false} raycast={noRaycast} />;
}
