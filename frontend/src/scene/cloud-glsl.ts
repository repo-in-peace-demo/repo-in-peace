/**
 * The cloud layer near the moon, in GLSL, shared by the sky (scene/Atmosphere.tsx), which draws it, and the witch (scene/Witch.tsx),
 * whom it partly covers: the same field at the same time, so a cloud in front of her is the cloud you see.
 */
export const CLOUD_GLSL = /* glsl */ `
float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cFbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * cNoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}
/** Where the clouds may be: around the moon, low above the horizon (0 elsewhere). */
float cloudAround(vec3 d, vec3 moonDirection) {
  float near = dot(d, moonDirection);
  return smoothstep(0.93, 0.985, near) * smoothstep(0.0, 0.05, d.y) * (1.0 - smoothstep(0.32, 0.45, d.y));
}
/** The cloud field in this direction: thin, torn strips drifting along the wind. */
float cloudField(vec3 d, float time) {
  vec2 plane = d.xz / max(d.y + 0.08, 0.05);          // a flat cloud layer seen from below
  plane = vec2(plane.x * 0.9 + plane.y * 0.4, plane.y * 2.6); // stretched along the wind
  plane += vec2(time * 0.035, 0.0);
  return cFbm(plane * 1.4);
}
float cloudCover(float field) { return smoothstep(0.5, 0.72, field); }
`;
