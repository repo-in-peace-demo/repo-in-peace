import * as THREE from 'three';
import { GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_FLOAT_SPEED, GHOST_OPACITY } from '../model/visual-constants';
import { GHOST_SWAY } from '../model/ghost-shape';
import { EFFECT_COLORS, HOVER_COLOR, SELECTION_RING_COLOR } from './colors';

/**
 * The ghost material: a translucent pale-cyan figure with a soft glow and brighter edges, that fades out toward the bottom
 * (so it has no solid foot) and floats. A ShaderMaterial, drawn added to what is behind it, without writing depth, after
 * everything solid. Per instance: `aPhase` (where in its bob it is) and `aHighlight` (0 nothing, 0.5 hover, 1 selected).
 *
 * The bob is `floatAmplitude × sin(floatSpeed × time + phase)` around the float base: the same formula as
 * `ghostBaseHeight` in model/ghost-motion.ts, which the selection ring follows (a browser test compares them). The sway and
 * the wavy hem are a few centimetres of sideways movement, at most GHOST_SWAY, so the figure stays inside its ground.
 */

export interface GhostUniforms {
  uTime: { value: number };
}

const VERTEX = /* glsl */ `
attribute float aPhase;
attribute float aHighlight;
uniform float uTime;
uniform float uBase;
uniform float uAmplitude;
uniform float uSpeed;
uniform float uSway;
uniform float uHeight;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vHeight;
varying float vHighlight;
void main() {
  float h = clamp(position.y / uHeight, 0.0, 1.0);
  vHeight = h;
  vHighlight = aHighlight;

  // The hem and the lower body drift sideways like a cloth, and the nearer the bottom the more.
  float loose = (1.0 - h) * (1.0 - h);
  float angle = atan(position.z, position.x);
  vec3 p = position;
  p.x += uSway * loose * sin(uTime * 1.3 + aPhase + position.y * 3.0 + angle * 2.0);
  p.z += uSway * loose * cos(uTime * 1.1 + aPhase * 1.3 + position.y * 2.5 + angle * 3.0);
  p.y += uBase + uAmplitude * sin(uSpeed * uTime + aPhase);

  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec4 viewPosition = viewMatrix * world;
  vNormal = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vViewDir = normalize(-viewPosition.xyz);
  gl_Position = projectionMatrix * viewPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHoverColor;
uniform vec3 uSelectedColor;
uniform float uOpacity;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vHeight;
varying float vHighlight;
void main() {
  // Brighter where the surface turns away from the viewer: the edges of the figure glow.
  float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float edge = pow(1.0 - facing, 1.8);

  // Fades out toward the bottom, so there is no solid foot, and a little toward the very top.
  float fade = smoothstep(0.0, 0.6, vHeight);

  float body = 0.28 + 0.9 * edge;
  vec3 colour = uColor * (0.55 + 0.9 * edge) + vec3(0.18, 0.28, 0.3) * edge;
  float alpha = uOpacity * fade * body;

  // Hover and selection: a rim of light at the edge, as on the stones.
  if (vHighlight > 0.01) {
    vec3 rim = vHighlight > 0.75 ? uSelectedColor * (1.3 + 0.3 * sin(uTime * 2.5)) : uHoverColor * 0.9;
    colour += rim * edge * 1.2;
    alpha = max(alpha, edge * 0.5 * fade);
  }

  gl_FragColor = vec4(colour, alpha);
  #include <colorspace_fragment>
}
`;

export function makeGhostMaterial(): { material: THREE.ShaderMaterial; uniforms: GhostUniforms } {
  const uniforms = {
    uTime: { value: 0 },
    uBase: { value: GHOST_FLOAT_BASE },
    uAmplitude: { value: GHOST_FLOAT_AMPLITUDE },
    uSpeed: { value: GHOST_FLOAT_SPEED },
    uSway: { value: GHOST_SWAY },
    uHeight: { value: 1.6 },
    uColor: { value: new THREE.Color(EFFECT_COLORS.ghost) },
    uHoverColor: { value: new THREE.Color(HOVER_COLOR) },
    uSelectedColor: { value: new THREE.Color(SELECTION_RING_COLOR) },
    uOpacity: { value: GHOST_OPACITY * 1.6 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  return { material, uniforms: { uTime: uniforms.uTime } };
}
