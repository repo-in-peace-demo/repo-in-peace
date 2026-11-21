import * as THREE from 'three';
import { NAME_BELOW_SEAM, NAME_BOX, NAME_FAR, NAME_MIN_BOTTOM, NAME_NEAR, RIP_ABOVE_SEAM, RIP_BOX} from '../model/engraving';
import { STONE_D, STONE_W } from '../model/layout-constants';
import { GLOW } from '../model/visual-constants';
import { ENGRAVE_CELL_H, ENGRAVE_CELL_W, ENGRAVE_COLUMNS } from './engraving-atlas';
import { FADE_FRAGMENT, FADE_FRAGMENT_DECLARATIONS, FADE_VERTEX, FADE_VERTEX_DECLARATIONS } from './fade-dither';
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
 *   aFade       1 shown, 0 gone: a stone in front of the grave in focus fades out of the way, by dithering (`fade-dither.ts`)
 * On the front face it carves "RIP" into the arch of an unused stone (aCrack), and the file's name below it, which fades in as
 * the camera comes near (NAME_FAR to NAME_NEAR): letters paler than the face with a thin dark shadow on the upper edge, read from the
 * engraving atlas. Moss runs on under the letters (only the letters differ from the stone) and the crack glow keeps off them.
 * The rim is an edge glow only: the surface of a hovered or selected stone is not tinted.
 */

export interface StoneUniforms {
  uTime: { value: number };
}

const VERTEX_DECLARATIONS = /* glsl */ `
${FADE_VERTEX_DECLARATIONS}
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

// The body (aTop 0, heights 0 to 1) is scaled to the body height; the arch (aTop 1, from 1 up by half the stone's width) is moved up
// with it, so the stone's top is at its height. (Until task 25 follow-up 5 this said 0.5, the arch of a 1.0-wide stone, and stones
// 1.4 wide were drawn 0.2 taller than their height.)
const VERTEX_BEGIN = /* glsl */ `
${FADE_VERTEX}
float bodyHeight = max(aHeight - ${(STONE_W / 2).toFixed(4)}, 0.01);
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
${FADE_FRAGMENT_DECLARATIONS}
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
uniform vec2 uEngraveCell; // a cell's size in texels
uniform vec4 uRipBox;      // above the seam, width, height, unused
uniform vec4 uNameBox;     // below the seam, width, height, lowest bottom
uniform vec2 uStoneSize;   // width, depth
uniform vec3 uLetterColor; // carved letters: pale stone, lighter than the face
uniform float uTime;
uniform float uGlow;
uniform vec3 uMossColor;
uniform vec3 uCrackGlowColor;
uniform vec3 uHoverColor;
uniform vec3 uSelectedColor;
float gCrack = 0.0;
float gMoss = 0.0;
// 0 up close, 1 from the overview: lets a stone a few pixels wide still show its moss and cracks.
float gFar = 0.0;
float gInk = 0.0;
float gFaint = 0.0;

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
// A text's cell at this point of the face. Always sampled, never inside a branch: a texture read in a branch gets the wrong mip
// level at the edge of the branch (the 2 by 2 pixel blocks the GPU takes derivatives over straddle it), which drew a line along
// the edge of the text's box and a lighter box on distant stones. The coordinate is clamped inside the cell (half a texel in) and
// the gradients come from the unclamped one, so the mip level is right on the edge too. inside is 1 within the box.
struct Engrave { vec2 at; vec2 dx; vec2 dy; float inside; float texels; };
Engrave engraveAt(float cell, float boxY, float boxW, float boxH, vec2 shift) {
  float bu = ((vLocalPos.x + shift.x) / boxW) + 0.5;
  float bv = ((vLocalPos.y + shift.y) - boxY) / boxH + 0.5;
  float c = max(cell, 0.0);
  float col = mod(c, uEngraveGrid.x);
  float row = floor(c / uEngraveGrid.x);
  vec2 raw = vec2((col + bu) / uEngraveGrid.x, 1.0 - (row + 1.0 - bv) / uEngraveGrid.y);
  vec2 inset = vec2(0.5 / uEngraveCell.x, 0.5 / uEngraveCell.y);
  vec2 cu = clamp(vec2(bu, bv), inset, 1.0 - inset);
  Engrave e;
  e.at = vec2((col + cu.x) / uEngraveGrid.x, 1.0 - (row + 1.0 - cu.y) / uEngraveGrid.y);
  e.dx = dFdx(raw);
  e.dy = dFdy(raw);
  e.inside = (cell < 0.0 || bu < 0.0 || bu > 1.0 || bv < 0.0 || bv > 1.0) ? 0.0 : 1.0;
  // Atlas texels per screen pixel, across the cell's height: large when the text is only a few pixels tall on screen.
  e.texels = max(length(vec2(dFdx(bv), dFdy(bv))), 1e-6) * uEngraveCell.y;
  return e;
}
// How much of a carved text covers this point (x, 0 to 1), and the thin dark shadow along the upper edge of its letters (y): the
// mask here, and the mask a little further down, which is lit where this point is not. Letters fade out when their box would be
// under about 9 pixels tall on screen (8 or more atlas texels to a pixel), so a distant stone shows plain stone and no smudge of text.
vec2 carved(float cell, float boxY, float boxW, float boxH) {
  Engrave e = engraveAt(cell, boxY, boxW, boxH, vec2(0.0));
  Engrave l = engraveAt(cell, boxY, boxW, boxH, vec2(0.0, -0.012));
  float ink = textureGrad(uEngrave, e.at, e.dx, e.dy).a * e.inside;
  float lower = textureGrad(uEngrave, l.at, l.dx, l.dy).a * l.inside;
  // Full from a box of about 9 px on screen (8 texels to a pixel), gone below about 5 px (14): a stone flown to (up to 14 units
  // away) shows its name; a distant stone's few-pixel box shows plain stone, never a smudge.
  float legible = 1.0 - smoothstep(8.0, 14.0, e.texels);
  return vec2(ink, clamp(lower - ink, 0.0, 1.0)) * legible;
}
// 1 on a text's letters and within about reach (scene units) of them: eight taps round the point. Only ever this close to the letters,
// and only while the letters can be seen: it fades out with them (as in carved), so a distant unused stone keeps its whole glow.
float nearInk(float cell, float boxY, float boxW, float boxH, float reach) {
  float m = 0.0;
  float texels = 0.0;
  for (int i = 0; i < 9; i++) {
    float a = float(i) * 0.7853982;
    vec2 shift = i == 8 ? vec2(0.0) : reach * vec2(cos(a), sin(a));
    Engrave e = engraveAt(cell, boxY, boxW, boxH, shift);
    m = max(m, textureGrad(uEngrave, e.at, e.dx, e.dy).a * e.inside);
    texels = e.texels;
  }
  return smoothstep(0.0, 0.6, m) * (1.0 - smoothstep(8.0, 14.0, texels));
}
// Cracks: the borders of a jittered cell pattern, a few of them kept, so they run as long thin lines that branch, not as
// contours of noise (which closed into specks all over the stone). The distance to the nearest kept border, in the pattern's units.
vec2 crackPoint(vec2 id) {
  return id + vec2(hash21(id + 7.3), hash21(id + 19.1));
}
float crackEdge(vec2 p) {
  vec2 id = floor(p);
  vec2 nearest = vec2(0.0);
  vec2 nearestId = id;
  float best = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = id + vec2(float(i), float(j));
      vec2 pt = crackPoint(g);
      float d = dot(pt - p, pt - p);
      if (d < best) { best = d; nearest = pt; nearestId = g; }
    }
  }
  float edge = 1e9;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = nearestId + vec2(float(i), float(j));
      if (g == nearestId) continue;
      // The same for both cells either side of a border, so a kept border is kept all along its length.
      if (hash21((nearestId + g) * 0.37 + 11.0) < 0.35) continue;
      vec2 pt = crackPoint(g);
      edge = min(edge, dot(0.5 * (nearest + pt) - p, normalize(pt - nearest)));
    }
  }
  return edge;
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
${FADE_FRAGMENT}
{
  // Coordinates on the stone's surface: along x and z together on the sides, so the noise does not streak.
  vec2 uv2 = vec2(vLocalPos.x + vLocalPos.z, vLocalPos.y);
  vec2 seedOffset = vec2(vSeed * 37.0, vSeed * 91.0);

  // Weathered stone: a little noise in the brightness.
  float grain = fbm(uv2 * 6.0 + seedOffset);
  diffuseColor.rgb *= 0.78 + 0.4 * grain;

  // Where the texts are on the front face. Nothing is drawn band-wide: moss and cracks run on under the letters, which are carved
  // through them, and only the crack glow keeps off the letters themselves (nearInk).
  float frontness = smoothstep(0.5, 0.85, vFront);
  float seam = max(vStoneHeight - uStoneSize.x * 0.5, 0.01);
  float nameY = max(seam - uNameBox.x - uNameBox.z * 0.5, uNameBox.w) + uNameBox.z * 0.5;

  // Moss rises from the base: a pixel is mossy when its height up the stone, plus noise, is below the amount, the same on every face
  // so the height reads the age. The letters are carved through it (their colour replaces the moss's on the letters alone).
  // The amount: 0.39 of the stone on the first stale day, 0.85 on the last, 0.9 and up when ancient (the 0.3 start keeps the least
  // stale moss above the foot, which the row in front hides from the overview).
  gFar = smoothstep(18.0, 70.0, length(vViewPosition));
  float mossNoise = fbm(uv2 * 4.0 + seedOffset * 1.7);
  float mossEdge = 0.3 + vMoss * 0.85 - (vHeightFrac + (mossNoise - 0.5) * 0.4);
  float moss = smoothstep(0.0, 0.1, mossEdge) * step(0.001, vMoss);
  // A cap of moss on the top, deeper the older (0.15 of the stone on the first stale day, 0.35 when ancient): from the
  // overview a stone in a back row shows only its top. Still the age alone.
  float capEdge = vHeightFrac - (1.0 - 0.1 - vMoss * 0.35) + (mossNoise - 0.5) * 0.25;
  float cap = smoothstep(0.0, 0.08, capEdge) * step(0.001, vMoss);
  moss = max(moss, cap);
  vec3 mossShade = uMossColor * (0.85 + 0.5 * fbm(uv2 * 9.0 + seedOffset));
  diffuseColor.rgb = mix(diffuseColor.rgb, mossShade, moss);
  gMoss = moss;

  // Cracks, only on an unused stone: a few thin lines, jagged and branching, dark with a red glow inside them, and a faint red
  // glow over the whole stone, so it still reads as unused from the overview where the lines are only a pixel or two wide.
  if (vCrack > 0.5) {
    vec2 warp = vec2(vnoise(uv2 * 6.0 + seedOffset), vnoise(uv2 * 6.0 + seedOffset + 9.0)) - 0.5;
    float edge = crackEdge(uv2 * 1.7 + seedOffset * 0.1 + 0.3 * warp);
    // Widened toward a pixel on screen (fwidth), and more for a stone only a few pixels tall, so it does not vanish from the overview.
    float tiny = smoothstep(0.025, 0.07, fwidth(vHeightFrac));
    float w = clamp(1.2 * fwidth(edge), 0.016, 0.04) * (1.0 + 3.0 * tiny);
    float line = 1.0 - smoothstep(0.0, w, edge);
    gCrack = line * (1.0 - 0.25 * moss);
    gFaint = 1.0;
    // Not on the letters or within a hair of them: RIP always, the name when it shows.
    if (frontness > 0.01) {
      float keepOff = nearInk(0.0, seam + uRipBox.x, uRipBox.y, uRipBox.z, 0.035);
      if (vNameFade > 0.01) keepOff = max(keepOff, vNameFade * nearInk(vNameCell, nameY, uNameBox.y, uNameBox.z, 0.03));
      gCrack *= 1.0 - frontness * keepOff;
      gFaint = 1.0 - frontness * keepOff;
    }
    // The lines are nearly black, so the glow in them is its own red-orange whatever the stone's colour; and under the faint glow over
    // the stone the blue of the stone is taken down toward a warm grey (not where moss is, which stays green), so red added onto a
    // blue-grey stone does not come out pink. The same for every unused stone; it says "unused", as the glow does.
    diffuseColor.rgb *= 1.0 - 0.95 * gCrack;
    float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(diffuseColor.rgb, grey * vec3(1.08, 0.94, 0.72), 0.55 * (1.0 - moss));
  }

  // The engraving, on the front face only: "RIP" in the arch of an unused stone, the name below it up close. The letters are
  // paler than the face, as if moonlight caught them, with a thin dark shadow along the upper edge of each.
  if (vFront > 0.7) {
    vec2 cut = vec2(0.0);
    if (vCrack > 0.5) cut += carved(0.0, seam + uRipBox.x, uRipBox.y, uRipBox.z);
    if (vNameFade > 0.01) cut += carved(vNameCell, nameY, uNameBox.y, uNameBox.z) * vNameFade;
    float ink = clamp(cut.x, 0.0, 1.0);
    float shade = clamp(cut.y, 0.0, 1.0) * (1.0 - ink);
    diffuseColor.rgb *= 1.0 - 0.8 * shade;
    diffuseColor.rgb = mix(diffuseColor.rgb, uLetterColor, 0.92 * ink);
    gInk = ink;
  }
}
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  // The glow inside the cracks: the same strength for every unused stone, so it means "unused" and nothing else.
  // From far away it is boosted by distance alone, so it is still the same for every unused stone at a given distance.
  totalEmissiveRadiance += uCrackGlowColor * (uGlow * (1.6 + 2.6 * gFar)) * gCrack; // far: from 1.6 × gFar, once moss ran under RIP
  // The faint red glow over a whole unused stone: the same for every unused stone (distance only), dimmer under the letters.
  totalEmissiveRadiance += uCrackGlowColor * (uGlow * (0.12 + 1.1 * gFar)) * gFaint * (1.0 - gInk);
  // A little light in the letters, so they read under the dim moonlight.
  totalEmissiveRadiance += uLetterColor * 0.16 * gInk;
  // A little of the moss's own colour from far away, so it is still green under the dim moonlight (age only: gMoss reads vMoss).
  totalEmissiveRadiance += uMossColor * (0.06 + 0.14 * gFar) * gMoss * (1.0 - gInk);

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
    shader.uniforms.uEngraveCell = { value: new THREE.Vector2(ENGRAVE_CELL_W, ENGRAVE_CELL_H) };
    shader.uniforms.uLetterColor = { value: new THREE.Color('#c9cfda') };
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
  material.customProgramCacheKey = () => 'repo-in-peace-stone-v9';
  return { material, uniforms };
}
