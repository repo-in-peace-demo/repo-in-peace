import * as THREE from 'three';
import { GHOST_FLOAT_SPEED } from '../model/visual-constants';
import { EFFECT_COLORS } from './colors';
import { FOG_FRAGMENT_PARS, FOG_VERTEX, FOG_VERTEX_PARS, foggedUniforms } from './fog-fade';

/**
 * The glow pool: a soft, faint cyan light on the ground right under each ghost, which shows from far away how high the ghost
 * floats (the pool is on the ground and the ghost is above it). It breathes with the bob: a little brighter when the ghost is
 * lower. One instanced quad, one draw call, drawn added to the ground, without writing depth.
 */

/** The pool's radius: it stays inside the ghost's own cell (a cell is 2.4 by 1.8). */
export const POOL_RADIUS = 0.85;

/** The height above the floor at which it is drawn, so it does not flicker against it. */
export const POOL_LIFT = 0.04;

const VERTEX = /* glsl */ `
${FOG_VERTEX_PARS}
attribute float aPhase;
uniform float uTime;
varying vec2 vUv;
varying float vLow;
void main() {
  vUv = uv;
  // 1 when the ghost is at the bottom of its bob and -1 at the top.
  vLow = -sin(${GHOST_FLOAT_SPEED.toFixed(3)} * uTime + aPhase);
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  ${FOG_VERTEX}
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
${FOG_FRAGMENT_PARS}
uniform vec3 uColor;
varying vec2 vUv;
varying float vLow;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float pool = pow(clamp(1.0 - d, 0.0, 1.0), 1.8);
  float strength = 0.34 + 0.08 * vLow;
  gl_FragColor = vec4(uColor, pool * strength * fogVisibility());
  #include <colorspace_fragment>
}
`;

export function makePoolMaterial(): { material: THREE.ShaderMaterial; uniforms: { uTime: { value: number } } } {
  const uniforms = foggedUniforms({ uTime: { value: 0 }, uColor: { value: new THREE.Color(EFFECT_COLORS.ghost) } });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  return { material, uniforms: { uTime: uniforms.uTime } };
}
