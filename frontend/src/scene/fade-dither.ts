/**
 * A per-instance fade by dithering: a fragment is dropped when a 4 × 4 ordered-dither threshold at its pixel is above the instance's
 * opacity. An opaque material can fade this way with no transparency sorting, and a fully faded instance draws nothing (so it hides
 * nothing behind it). Used by the stones and the fences to step out of the way of the grave in focus.
 */
export const FADE_VERTEX_DECLARATIONS = /* glsl */ `
attribute float aFade;
varying float vFade;
`;
export const FADE_VERTEX = /* glsl */ `
vFade = aFade;
`;
export const FADE_FRAGMENT_DECLARATIONS = /* glsl */ `
varying float vFade;
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + 4 * int(q.y);
  float m[16];
  m[0] = 0.0; m[1] = 8.0; m[2] = 2.0; m[3] = 10.0;
  m[4] = 12.0; m[5] = 4.0; m[6] = 14.0; m[7] = 6.0;
  m[8] = 3.0; m[9] = 11.0; m[10] = 1.0; m[11] = 9.0;
  m[12] = 15.0; m[13] = 7.0; m[14] = 13.0; m[15] = 5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) if (k == i) v = m[k];
  return (v + 0.5) / 16.0;
}
`;
/** At the start of the fragment shader's main: drop the fragment if the instance has faded past this pixel's threshold. */
export const FADE_FRAGMENT = /* glsl */ `
if (vFade < 0.999 && bayer4(gl_FragCoord.xy) > vFade) discard;
`;
