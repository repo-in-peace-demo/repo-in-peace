import * as THREE from 'three';

/**
 * Fog for the shaders that draw things added to what is behind them (the candle flames, the ghosts, their tags and pools).
 * three.js's own fog mixes a colour into the surface, which would brighten something that is drawn added; so these shaders
 * scale their alpha by the fog's visibility instead (`exp(-(density × depth)²)`, the same as `FogExp2`), and a candle or
 * ghost at the far edge fades into the dark like everything else. Use the pieces below in a ShaderMaterial made with
 * `fogged(...)`.
 */

/** The uniforms of the scene fog, merged with a material's own. Use with `fog: true`. */
export function foggedUniforms<T extends Record<string, THREE.IUniform>>(own: T): T & Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, own]) as T & Record<string, THREE.IUniform>;
}

/** Put before `void main()` of a vertex shader. */
export const FOG_VERTEX_PARS = /* glsl */ `
#include <fog_pars_vertex>
`;

/** Put in `main()` of a vertex shader after `vec4 mvPosition` (the position of the point in the camera's space) is set. */
export const FOG_VERTEX = /* glsl */ `
#include <fog_vertex>
`;

/** Put before `void main()` of a fragment shader: declares `fogVisibility()`, which is 1 where there is no fog. */
export const FOG_FRAGMENT_PARS = /* glsl */ `
#include <fog_pars_fragment>
float fogVisibility() {
#ifdef USE_FOG
  #ifdef FOG_EXP2
    return exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    return 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#else
  return 1.0;
#endif
}
`;
