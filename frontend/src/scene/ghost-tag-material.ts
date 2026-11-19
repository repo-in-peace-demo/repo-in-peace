import * as THREE from 'three';
import { GHOST_TAG, ghostTagPlacement } from '../model/ghost-shape';
import { GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_FLOAT_SPEED } from '../model/visual-constants';
import { EFFECT_COLORS } from './colors';
import { FOG_FRAGMENT_PARS, FOG_VERTEX, FOG_VERTEX_PARS, foggedUniforms } from './fog-fade';
import type { TagAtlas } from './ghost-tag-atlas';

/**
 * The toe tag: a small glowing card on a thread, fastened to the front right of the ghost, with the deleted file's type on it.
 * One instanced mesh, one draw call, three shapes in one geometry (`aKind`: 0 the card, 1 the thread, 2 the soft glint around
 * the card). The tag faces the camera (turning only about the vertical), bobs with the ghost (the same formula) and swings a
 * little on its thread. Its text fades out with the distance of the camera, like the plaques' text, and what is left from far
 * away is the glint: a small glow in the ghost's colour.
 */

/** The camera is this close and the text is fully readable; it has faded out completely at the far distance. */
export const TAG_TEXT_NEAR = 14;
export const TAG_TEXT_FAR = 32;

const VERTEX = /* glsl */ `
${FOG_VERTEX_PARS}
attribute float aKind;
attribute float aCell;
attribute float aPhase;
uniform float uTime;
uniform float uBase;
uniform float uAmplitude;
uniform float uSpeed;
uniform vec3 uAttach;
uniform vec3 uCard;
uniform float uCardHeight;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
varying float vKind;
varying float vCell;
varying float vTextFade;
void main() {
  vUv = uv;
  vKind = aKind;
  vCell = aCell;

  float bob = uBase + uAmplitude * sin(uSpeed * uTime + aPhase);
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float angle = atan(uAttach.x, uAttach.z);
  vec3 tangent = vec3(cos(angle), 0.0, -sin(angle));
  float swing = 0.05 * sin(uTime * 1.7 + aPhase * 1.3);

  vec3 attach = origin + vec3(uAttach.x, bob + uAttach.y, uAttach.z);
  vec3 card = origin + vec3(uCard.x, bob + uCard.y, uCard.z) + tangent * swing;
  vec3 right = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
  right = length(right) > 0.0001 ? normalize(right) : vec3(1.0, 0.0, 0.0);
  vec3 up = vec3(0.0, 1.0, 0.0);

  vec3 world;
  if (aKind < 0.5) {
    world = card + right * position.x + up * position.y;
  } else if (aKind < 1.5) {
    // The thread runs from where it is fastened (position.y = 0) to the top of the card (position.y = 1).
    vec3 top = card + up * (uCardHeight * 0.5);
    world = mix(attach, top, position.y) + right * position.x;
  } else {
    world = card + right * position.x + up * position.y;
  }
  vTextFade = 1.0 - smoothstep(uNear, uFar, distance(cameraPosition, card));
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  ${FOG_VERTEX}
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
${FOG_FRAGMENT_PARS}
uniform vec3 uColor;
uniform sampler2D uAtlas;
uniform vec2 uCells; // columns, rows
varying vec2 vUv;
varying float vKind;
varying float vCell;
varying float vTextFade;
void main() {
  if (vKind < 0.5) {
    // The card: a dim cyan board with a bright border, and the text in the atlas cell of this ghost.
    vec2 edge = min(vUv, 1.0 - vUv);
    float border = 1.0 - smoothstep(0.0, 0.07, min(edge.x * 2.0, edge.y * 3.0));
    float col = mod(vCell, uCells.x);
    float row = floor(vCell / uCells.x);
    vec2 atlas = vec2((col + vUv.x) / uCells.x, 1.0 - (row + 1.0 - vUv.y) / uCells.y);
    float text = texture2D(uAtlas, atlas).a * vTextFade;
    vec3 colour = uColor * (0.22 + 0.9 * border + 1.5 * text);
    float alpha = 0.55 + 0.45 * max(border, text);
    gl_FragColor = vec4(colour, alpha);
  } else if (vKind < 1.5) {
    gl_FragColor = vec4(uColor * 0.9, 0.7);
  } else {
    // The glint: a soft glow around the card, the part that is left of the tag when the camera is far.
    float d = length(vUv - 0.5) * 2.0;
    float glow = pow(clamp(1.0 - d, 0.0, 1.0), 2.2);
    gl_FragColor = vec4(uColor, glow * mix(0.85, 0.3, vTextFade));
  }
  gl_FragColor.a *= fogVisibility();
  #include <colorspace_fragment>
}
`;

/** The card, the thread and the glint as one geometry. */
export function makeTagGeometry(): THREE.BufferGeometry {
  const card = new THREE.PlaneGeometry(GHOST_TAG.width, GHOST_TAG.height);
  const thread = new THREE.PlaneGeometry(0.014, 1);
  thread.translate(0, 0.5, 0); // position.y runs from 0 to 1
  const glint = new THREE.PlaneGeometry(0.95, 0.95);
  const parts: THREE.BufferGeometry[] = [card, thread, glint];
  parts.forEach((geometry, kind) => geometry.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(kind), 1)));
  const merged = mergeParts(parts);
  parts.forEach((geometry) => geometry.dispose());
  return merged;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const names = ['position', 'uv', 'aKind'] as const;
  for (const name of names) {
    const size = parts[0]!.getAttribute(name).itemSize;
    const total = parts.reduce((sum, part) => sum + part.getAttribute(name).count, 0);
    const array = new Float32Array(total * size);
    let offset = 0;
    for (const part of parts) {
      array.set(part.getAttribute(name).array as Float32Array, offset);
      offset += part.getAttribute(name).count * size;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  const indices: number[] = [];
  let base = 0;
  for (const part of parts) {
    for (const index of Array.from(part.index!.array)) indices.push(index + base);
    base += part.getAttribute('position').count;
  }
  merged.setIndex(indices);
  return merged;
}

export function makeTagMaterial(atlas: TagAtlas): { material: THREE.ShaderMaterial; uniforms: { uTime: { value: number } } } {
  const { attach, card } = ghostTagPlacement();
  const uniforms = foggedUniforms({
    uTime: { value: 0 },
    uBase: { value: GHOST_FLOAT_BASE },
    uAmplitude: { value: GHOST_FLOAT_AMPLITUDE },
    uSpeed: { value: GHOST_FLOAT_SPEED },
    uAttach: { value: new THREE.Vector3(attach.x, attach.y, attach.z) },
    uCard: { value: new THREE.Vector3(card.x, card.y, card.z) },
    uCardHeight: { value: GHOST_TAG.height },
    uNear: { value: TAG_TEXT_NEAR },
    uFar: { value: TAG_TEXT_FAR },
    uColor: { value: new THREE.Color(EFFECT_COLORS.ghost) },
    uAtlas: { value: atlas.texture },
    uCells: { value: new THREE.Vector2(atlas.columns, atlas.rows) },
  });
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  });
  return { material, uniforms: { uTime: uniforms.uTime } };
}
