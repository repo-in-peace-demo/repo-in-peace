import * as THREE from 'three';
import { GHOST_CURL, GHOST_CURL_HEIGHT, GHOST_EYES, GHOST_SWAY, HEM_BRACES, HEM_DEPTH } from '../model/ghost-shape';
import { GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_FLOAT_SPEED, GHOST_HEIGHT, GHOST_OPACITY } from '../model/visual-constants';
import { EFFECT_COLORS, HOVER_COLOR, SELECTION_RING_COLOR } from './colors';
import { FOG_FRAGMENT_PARS, FOG_VERTEX, FOG_VERTEX_PARS, foggedUniforms } from './fog-fade';

/**
 * The ghost material: a translucent pale-cyan sheet with bright edges and a soft glow, drawn added to what is behind it,
 * without writing depth. Only the front faces are drawn, so the sheet is one layer, and the eye holes and the hem are really
 * holes (you see the ground through them). Three details are cut in the fragment shader, from the same numbers as
 * `model/ghost-shape.ts`:
 *   - the hem, cut like curly braces (`hemHeight`, repeated in GLSL below);
 *   - two eye holes on the side that faces +z, the camera's default direction;
 *   - a bright line along the cut edge, so the braces can be seen.
 * Per instance: `aPhase` (where in its bob it is) and `aHighlight` (0 nothing, 0.5 hover, 1 selected).
 *
 * The bob is `floatAmplitude × sin(floatSpeed × time + phase)` around the float base: the same formula as
 * `ghostBaseHeight` in model/ghost-motion.ts, which the selection ring follows (a browser test compares them). The sway is
 * at most GHOST_SWAY sideways, so the figure stays inside its ground.
 */

export interface GhostUniforms {
  uTime: { value: number };
}

const VERTEX = /* glsl */ `
${FOG_VERTEX_PARS}
attribute float aPhase;
attribute float aHighlight;
uniform float uTime;
uniform float uBase;
uniform float uAmplitude;
uniform float uSpeed;
uniform float uSway;
uniform float uHeight;
uniform float uCurl;
uniform float uCurlHeight;
uniform float uBraces;
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vLocal;
varying float vHighlight;
void main() {
  vLocal = position;
  vHighlight = aHighlight;

  // The lower body drifts sideways like cloth, the more the nearer the hem.
  float h = clamp(position.y / uHeight, 0.0, 1.0);
  float loose = (1.0 - h) * (1.0 - h);
  float angle = atan(position.x, position.z);
  vec3 p = position;

  // The two tips curl outward like the ends of { and }: near a tip, low down, the sheet bends away from the body (the same as tipCurl).
  float turns = angle / 6.28318530718 * uBraces;
  float nearTip = 1.0 - smoothstep(0.0, 0.14, abs(fract(turns) - 0.5));
  float low = 1.0 - smoothstep(0.0, uCurlHeight, position.y);
  vec2 outward = normalize(position.xz + vec2(0.00001, 0.0));
  p.xz += outward * (uCurl * nearTip * low * low);

  p.x += uSway * loose * sin(uTime * 1.3 + aPhase + position.y * 3.0 + angle * 2.0);
  p.z += uSway * loose * cos(uTime * 1.1 + aPhase * 1.3 + position.y * 2.5 + angle * 3.0);
  p.y += uBase + uAmplitude * sin(uSpeed * uTime + aPhase);

  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec4 viewPosition = viewMatrix * world;
  vNormal = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vViewDir = normalize(-viewPosition.xyz);
  vec4 mvPosition = viewPosition;
  ${FOG_VERTEX}
  gl_Position = projectionMatrix * viewPosition;
}
`;

const FRAGMENT = /* glsl */ `
${FOG_FRAGMENT_PARS}
uniform vec3 uColor;
uniform vec3 uHoverColor;
uniform vec3 uSelectedColor;
uniform float uOpacity;
uniform float uTime;
uniform float uHemDepth;
uniform float uBraces;
uniform vec4 uEyes; // x of the right eye, height of the eyes, radius along x, radius along y
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vLocal;
varying float vHighlight;

// The height of the hem's edge along one brace, for u from 0 to 1: the same formula as hemHeight in model/ghost-shape.ts.
float hemHeight(float u) {
  float fromEnd = min(u, 1.0 - u);
  float endsUp = 1.0 - smoothstep(0.0, 0.16, fromEnd);
  float tipDown = 1.0 - smoothstep(0.0, 0.1, abs(u - 0.5));
  return uHemDepth * (0.95 * endsUp + 0.5 * (1.0 - tipDown));
}

void main() {
  // The hem: the sheet is cut away below the line of the braces. Angle 0 faces +z, the camera's default direction.
  float turns = atan(vLocal.x, vLocal.z) / 6.28318530718 * uBraces;
  float hem = hemHeight(fract(turns));
  if (vLocal.y < hem) discard;

  // Two eye holes on the side that faces +z.
  if (vLocal.z > 0.0) {
    vec2 left = vec2((vLocal.x + uEyes.x) / uEyes.z, (vLocal.y - uEyes.y) / uEyes.w);
    vec2 right = vec2((vLocal.x - uEyes.x) / uEyes.z, (vLocal.y - uEyes.y) / uEyes.w);
    if (dot(left, left) < 1.0 || dot(right, right) < 1.0) discard;
  }

  // Brighter where the surface turns away from the viewer, and along the cut edge of the hem.
  float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float edge = pow(1.0 - facing, 1.8);
  float hemEdge = 1.0 - smoothstep(0.0, 0.05, vLocal.y - hem);

  float body = 0.42 + 0.9 * edge;
  vec3 colour = uColor * vec3(0.62, 1.0, 1.0) * (0.6 + 0.9 * edge) + vec3(0.1, 0.3, 0.32) * edge;
  float alpha = uOpacity * body;
  colour += uColor * hemEdge * 0.9;
  alpha = max(alpha, hemEdge * 0.75);

  // Hover and selection: a rim of light at the edge, as on the stones.
  if (vHighlight > 0.01) {
    vec3 rim = vHighlight > 0.75 ? uSelectedColor * (1.3 + 0.3 * sin(uTime * 2.5)) : uHoverColor * 0.9;
    colour += rim * edge * 1.2;
    alpha = max(alpha, edge * 0.5);
  }

  gl_FragColor = vec4(colour, alpha * fogVisibility());
  #include <colorspace_fragment>
}
`;

export function makeGhostMaterial(): { material: THREE.ShaderMaterial; uniforms: GhostUniforms } {
  const uniforms = foggedUniforms({
    uTime: { value: 0 },
    uBase: { value: GHOST_FLOAT_BASE },
    uAmplitude: { value: GHOST_FLOAT_AMPLITUDE },
    uSpeed: { value: GHOST_FLOAT_SPEED },
    uSway: { value: GHOST_SWAY },
    uHeight: { value: GHOST_HEIGHT },
    uCurl: { value: GHOST_CURL },
    uCurlHeight: { value: GHOST_CURL_HEIGHT },
    uHemDepth: { value: HEM_DEPTH },
    uBraces: { value: HEM_BRACES },
    uEyes: { value: new THREE.Vector4(GHOST_EYES.right.x, GHOST_EYES.right.y, GHOST_EYES.radiusX, GHOST_EYES.radiusY) },
    uColor: { value: new THREE.Color(EFFECT_COLORS.ghost) },
    uHoverColor: { value: new THREE.Color(HOVER_COLOR) },
    uSelectedColor: { value: new THREE.Color(SELECTION_RING_COLOR) },
    uOpacity: { value: GHOST_OPACITY * 2.0 },
  });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    fog: true,
  });
  return { material, uniforms: { uTime: uniforms.uTime } };
}
