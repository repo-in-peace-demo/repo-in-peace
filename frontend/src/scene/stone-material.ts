import * as THREE from 'three';
import { NAME_BELOW_SEAM, NAME_BOX, NAME_FAR, NAME_MIN_BOTTOM, NAME_NEAR, RIP_ABOVE_SEAM, RIP_BOX } from '../model/engraving';
import { STONE_D, STONE_W } from '../model/layout-constants';
import { GLOW } from '../model/visual-constants';
import { ENGRAVE_COLUMNS } from './engraving-atlas';
import { EFFECT_COLORS, HOVER_COLOR, SELECTION_RING_COLOR } from './colors';

/**
 * The stone material: three.js's own `MeshStandardMaterial` (so lighting and fog stay three.js's), patched with
 * `onBeforeCompile`. Everything is procedural (no texture). Per-instance attributes drive it:
 *   aHeight     the stone's height; the body is stretched to it without stretching the arch
 *   aMoss       0 to 1; green creeping up from the base (height up the stone plus noise below the amount)
 *   aCrack      1 for an unused stone: dark thin cracks, and a faint red glow inside them
 *   aHighlight  0 nothing, 0.5 hover (a pale rim), 1 selected (a rim in the selection ring's colour, slowly pulsing)
 *   aSeed       0 to 1; varies the noise from stone to stone
 *   aNameCell   the atlas cell of the file's name, or -1 (`model/engraving.ts`)
 * On the front face it carves "RIP" into the arch of an unused stone (aCrack), and the file's name below it, which fades in as
 * the camera comes near (NAME_FAR to NAME_NEAR): darker grooves with a lit lower lip, read from the engraving atlas.
 * The rim is an edge glow only: the surface of a hovered or selected stone is not tinted.
 */

export interface StoneUniforms {
  uTime: { value: number };
}

const VERTEX_DECLARATIONS = /* glsl */ `
attribute float aTop;
attribute float aHeight;
attribute float aMoss;
attribute float aCrack;
attribute float aHighlight;
attribute float aSeed;
attribute float aNameCell;
varying vec3 vLocalPos;
varying float vStoneHeight;
varying float vFront;
varying float vNameCell;
varying float vNameFade;
uniform vec2 uNameFade;
varying float vHeightFrac;
varying float vMoss;
varying float vCrack;
varying float vHighlight;
varying float vSeed;
`;

// The body (aTop 0, heights 0 to 1) is scaled to the body height; the arch (aTop 1, heights 1 to 1.5) is moved up with it.
const VERTEX_BEGIN = /* glsl */ `
float bodyHeight = max(aHeight - 0.5, 0.01);
vec3 transformed = vec3(position);
transformed.y = aTop > 0.5 ? (position.y - 1.0) + bodyHeight : position.y * bodyHeight;
vLocalPos = transformed;
vHeightFrac = transformed.y / max(aHeight, 0.01);
vMoss = aMoss;
vCrack = aCrack;
vHighlight = aHighlight;
vSeed = aSeed;
vStoneHeight = aHeight;
vFront = objectNormal.z;
vNameCell = aNameCell;
#ifdef USE_INSTANCING
  vec4 stoneMiddle = modelMatrix * instanceMatrix * vec4(0.0, aHeight * 0.5, 0.0, 1.0);
#else
  vec4 stoneMiddle = modelMatrix * vec4(0.0, aHeight * 0.5, 0.0, 1.0);
#endif
vNameFade = aNameCell < 0.0 ? 0.0 : 1.0 - smoothstep(uNameFade.x, uNameFade.y, distance(cameraPosition, stoneMiddle.xyz));
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vLocalPos;
varying float vHeightFrac;
varying float vMoss;
varying float vCrack;
varying float vHighlight;
varying float vSeed;
varying float vStoneHeight;
varying float vFront;
varying float vNameCell;
varying float vNameFade;
uniform sampler2D uEngrave;
uniform vec2 uEngraveGrid; // columns, rows
uniform vec4 uRipBox;      // above the seam, width, height, unused
uniform vec4 uNameBox;     // below the seam, width, height, lowest bottom
uniform vec2 uStoneSize;   // width, depth
uniform float uTime;
uniform float uGlow;
uniform vec3 uMossColor;
uniform vec3 uCrackGlowColor;
uniform vec3 uHoverColor;
uniform vec3 uSelectedColor;
float gCrack = 0.0;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// How much of a carved text covers this point of the face (0 to 1), and its lit lower lip: the cell's mask at the point, and a
// little below it. The box is its centre up from the foot and its size; x is measured from the middle of the face.
vec2 carved(float cell, float boxY, float boxW, float boxH) {
  float bu = (vLocalPos.x / boxW) + 0.5;
  float bv = (vLocalPos.y - boxY) / boxH + 0.5;
  if (bu < 0.0 || bu > 1.0 || bv < 0.0 || bv > 1.0 || cell < 0.0) return vec2(0.0);
  float col = mod(cell, uEngraveGrid.x);
  float row = floor(cell / uEngraveGrid.x);
  vec2 at = vec2((col + bu) / uEngraveGrid.x, 1.0 - (row + 1.0 - bv) / uEngraveGrid.y);
  float ink = texture2D(uEngrave, at).a;
  float below = texture2D(uEngrave, at + vec2(0.0, 0.12 / uEngraveGrid.y)).a;
  return vec2(ink, clamp(below - ink, 0.0, 1.0));
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  // Coordinates on the stone's surface: along x and z together on the sides, so the noise does not streak.
  vec2 uv2 = vec2(vLocalPos.x + vLocalPos.z, vLocalPos.y);
  vec2 seedOffset = vec2(vSeed * 37.0, vSeed * 91.0);

  // Weathered stone: a little noise in the brightness.
  float grain = fbm(uv2 * 6.0 + seedOffset);
  diffuseColor.rgb *= 0.78 + 0.4 * grain;

  // Moss rises from the base: a pixel is mossy when its height up the stone, plus noise, is below the amount.
  float mossNoise = fbm(uv2 * 4.0 + seedOffset * 1.7);
  float mossEdge = vMoss * 1.3 - (vHeightFrac + (mossNoise - 0.5) * 0.45);
  float moss = smoothstep(0.0, 0.14, mossEdge) * step(0.001, vMoss);
  vec3 mossShade = uMossColor * (0.65 + 0.7 * fbm(uv2 * 9.0 + seedOffset));
  diffuseColor.rgb = mix(diffuseColor.rgb, mossShade, moss * 0.92);

  // Cracks, only on an unused stone: thin dark lines where the noise crosses a level; red glows inside them.
  if (vCrack > 0.5) {
    float c1 = abs(fbm(uv2 * 4.0 + seedOffset * 2.3) - 0.5);
    float c2 = abs(fbm(uv2 * 7.0 + seedOffset * 3.1 + 7.0) - 0.5);
    float line = max(1.0 - smoothstep(0.0, 0.016, c1), 0.8 * (1.0 - smoothstep(0.0, 0.010, c2)));
    gCrack = line * (1.0 - 0.6 * moss);
    diffuseColor.rgb *= 1.0 - 0.85 * gCrack;
  }

  // The engraving, on the front face only: "RIP" in the arch of an unused stone, the name below it up close.
  if (vFront > 0.7) {
    float seam = max(vStoneHeight - uStoneSize.x * 0.5, 0.01);
    vec2 cut = vec2(0.0);
    if (vCrack > 0.5) cut += carved(0.0, seam + uRipBox.x, uRipBox.y, uRipBox.z);
    if (vNameFade > 0.01) {
      float nameY = max(seam - uNameBox.x - uNameBox.z * 0.5, uNameBox.w) + uNameBox.z * 0.5;
      cut += carved(vNameCell, nameY, uNameBox.y, uNameBox.z) * vNameFade;
    }
    diffuseColor.rgb *= 1.0 - 0.7 * clamp(cut.x, 0.0, 1.0);
    diffuseColor.rgb += vec3(0.08) * clamp(cut.y, 0.0, 1.0);
  }
}
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  // The glow inside the cracks: the same strength for every unused stone, so it means "unused" and nothing else.
  totalEmissiveRadiance += uCrackGlowColor * (uGlow * 1.1) * gCrack;

  // The rim, an edge glow and not a tint: pale for the stone under the pointer, the ring's colour and a slow pulse for the selected one.
  if (vHighlight > 0.01) {
    float edge = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2);
    vec3 rim = vHighlight > 0.75 ? uSelectedColor * (1.5 + 0.35 * sin(uTime * 2.5)) : uHoverColor * 0.9;
    totalEmissiveRadiance += rim * edge;
  }
}
`;

/** One material for every stone, and the uniform the scene advances each frame. */
export function makeStoneMaterial(engraving: { atlas: THREE.Texture; rows: number }): { material: THREE.MeshStandardMaterial; uniforms: StoneUniforms } {
  const uniforms: StoneUniforms = { uTime: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ color: EFFECT_COLORS.stone, roughness: 0.92, metalness: 0 });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uGlow = { value: GLOW };
    shader.uniforms.uMossColor = { value: new THREE.Color(EFFECT_COLORS.moss) };
    shader.uniforms.uCrackGlowColor = { value: new THREE.Color(EFFECT_COLORS.unused) };
    shader.uniforms.uHoverColor = { value: new THREE.Color(HOVER_COLOR) };
    shader.uniforms.uSelectedColor = { value: new THREE.Color(SELECTION_RING_COLOR) };
    shader.uniforms.uEngrave = { value: engraving.atlas };
    shader.uniforms.uEngraveGrid = { value: new THREE.Vector2(ENGRAVE_COLUMNS, engraving.rows) };
    shader.uniforms.uRipBox = { value: new THREE.Vector4(RIP_ABOVE_SEAM, RIP_BOX.w * STONE_W, RIP_BOX.h, 0) };
    shader.uniforms.uNameBox = { value: new THREE.Vector4(NAME_BELOW_SEAM, NAME_BOX.w * STONE_W, NAME_BOX.h, NAME_MIN_BOTTOM) };
    shader.uniforms.uStoneSize = { value: new THREE.Vector2(STONE_W, STONE_D) };
    shader.uniforms.uNameFade = { value: new THREE.Vector2(NAME_NEAR, NAME_FAR) };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'repo-in-peace-stone-v2';
  return { material, uniforms };
}
