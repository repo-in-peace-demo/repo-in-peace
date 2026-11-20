import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FOREST_COLOR, FOREST_EDGE_COLOR, GROUND_BASE_COLOR, HAZE_COLOR, HAZE_MAX_ALPHA, HILL_COLOR, HILL_HAZE } from '../model/atmosphere';
import { forestMesh, forestTrees, hazeRingMesh, horizonPlan, landMesh } from '../model/horizon';
import type { SceneModel } from '../model/scene-model';
import { noRaycast } from './instances';

/**
 * The land around the graveyard (`model/horizon.ts`): moonlit hills that rise from just behind the fence to a ridge, low far hills
 * beyond, a dense forest of dark silhouettes on the ridge, with a clearing under the moon, and a pale haze at the forest's foot.
 * Three meshes, three draw calls. The
 * hills are the ground's colour and lit like it, by the moonlight and the sky, and the fog fades them into the haze at the
 * horizon; the forest is flat and unlit, so it is a silhouette, and fades into the haze too. Only the graveyard's bounds are
 * read, never a file's facts, so this is backdrop like the sky. Nothing here can be picked.
 */
/** For the development API only (`setHorizonVisible`): the group of the hills and forest on the screen, and whether to show it. */
export const horizonDebug: { group: THREE.Group | null; visible: boolean } = { group: null, visible: true };

export function Horizon({ model }: { model: SceneModel }) {
  const bounds = model.layout.bounds;
  const group = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    horizonDebug.group = g;
    g.visible = horizonDebug.visible;
    return () => {
      if (horizonDebug.group === g) horizonDebug.group = null;
    };
  }, []);
  const assets = useMemo(() => {
    const plan = horizonPlan(bounds);

    const land = landMesh(plan);
    const landGeometry = new THREE.BufferGeometry();
    landGeometry.setAttribute('position', new THREE.BufferAttribute(land.positions, 3));
    landGeometry.setAttribute('aRise', new THREE.BufferAttribute(land.rise, 1));
    landGeometry.setIndex(new THREE.BufferAttribute(land.indices, 1));
    landGeometry.computeVertexNormals();
    landGeometry.computeBoundingSphere();
    const landMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff', // the colour is set in the shader, from the ground's at the foot to the hills' up the slope
      roughness: 1,
      // Where the hills start, just above the flat ground plane (at -0.02): win the depth test against it, without flicker.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // The hills: lit by the moonlight like the ground, with a faint mottling (patches of grass and earth), and taking on the
    // haze as they rise to the ridge, so the band under the forest is pale and moonlit, not a dead dark strip.
    const hazeColour = new THREE.Color(HAZE_COLOR);
    landMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uHaze = { value: hazeColour };
      shader.uniforms.uHazeAmount = { value: HILL_HAZE };
      shader.uniforms.uGround = { value: new THREE.Color(GROUND_BASE_COLOR) };
      shader.uniforms.uHill = { value: new THREE.Color(HILL_COLOR) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRise;\nvarying float vRise;\nvarying vec3 vLand;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRise = aRise;\nvLand = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vRise;
varying vec3 vLand;
uniform vec3 uHaze;
uniform float uHazeAmount;
uniform vec3 uGround;
uniform vec3 uHill;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  // At the foot: exactly the ground's colour and noise (scene/Ground.tsx), so there is no seam where the two meet. Up the slope:
  // the lighter hill colour with a broader mottling.
  float up = smoothstep(0.0, 0.35, vRise);
  float patches = gNoise(vLand.xz * 0.18) * 0.6 + gNoise(vLand.xz * 0.7) * 0.4;
  float grain = gNoise(vLand.xz * 6.0);
  vec3 ground = uGround * (0.7 + 0.6 * patches + 0.12 * (grain - 0.5));
  vec3 hill = uHill * (0.75 + 0.35 * gNoise(vLand.xz * 0.06) + 0.15 * gNoise(vLand.xz * 0.4));
  diffuseColor.rgb = mix(ground, hill, up);
}`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze * 0.45, uHazeAmount * smoothstep(0.75, 1.02, vRise));`,
        );
    };
    landMaterial.customProgramCacheKey = () => 'repo-in-peace-hills-v2';

    // The haze in front of the forest's foot: a ring, densest at the foot of the trees, fading up and down.
    const ring = hazeRingMesh(plan);
    const hazeGeometry = new THREE.BufferGeometry();
    hazeGeometry.setAttribute('position', new THREE.BufferAttribute(ring.positions, 3));
    hazeGeometry.setAttribute('aDensity', new THREE.BufferAttribute(ring.density, 1));
    hazeGeometry.setIndex(new THREE.BufferAttribute(ring.indices, 1));
    hazeGeometry.computeBoundingSphere();
    const hazeMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: hazeColour }, uMax: { value: HAZE_MAX_ALPHA } },
      vertexShader: /* glsl */ `
attribute float aDensity;
varying float vDensity;
void main() {
  vDensity = aDensity;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uMax;
varying float vDensity;
void main() {
  gl_FragColor = vec4(uColor, uMax * vDensity * vDensity * (3.0 - 2.0 * vDensity));
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    // The forest: flat dark silhouettes, with a faint moonlit edge along the treetops (brighter on the trees toward the moon),
    // and the back rows mixed toward the haze, so the forest has depth. Unlit by the scene's lights, and fogged.
    const forest = forestMesh(forestTrees(plan));
    const forestGeometry = new THREE.BufferGeometry();
    forestGeometry.setAttribute('position', new THREE.BufferAttribute(forest.positions, 3));
    forestGeometry.setAttribute('aUp', new THREE.BufferAttribute(forest.up, 1));
    forestGeometry.setAttribute('aMoonward', new THREE.BufferAttribute(forest.moonward, 1));
    forestGeometry.setAttribute('aHaze', new THREE.BufferAttribute(forest.haze, 1));
    forestGeometry.computeBoundingSphere();
    const forestMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uColor: { value: new THREE.Color(FOREST_COLOR) }, uEdge: { value: new THREE.Color(FOREST_EDGE_COLOR) }, uHaze: { value: hazeColour } },
      ]),
      vertexShader: /* glsl */ `
attribute float aUp;
attribute float aMoonward;
attribute float aHaze;
varying float vUp;
varying float vMoonward;
varying float vHaze;
#include <fog_pars_vertex>
void main() {
  vUp = aUp;
  vMoonward = aMoonward;
  vHaze = aHaze;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform vec3 uEdge;
uniform vec3 uHaze;
varying float vUp;
varying float vMoonward;
varying float vHaze;
#include <fog_pars_fragment>
void main() {
  float edge = smoothstep(0.9, 1.0, vUp) * (0.25 + 0.75 * vMoonward);
  vec3 colour = mix(uColor, uEdge, edge * 0.4);
  colour = mix(colour, uHaze * 0.22, vHaze);
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
      side: THREE.DoubleSide,
      fog: true,
    });

    return { landGeometry, landMaterial, forestGeometry, forestMaterial, hazeGeometry, hazeMaterial };
  }, [bounds]);

  useEffect(
    () => () => {
      assets.landGeometry.dispose();
      assets.landMaterial.dispose();
      assets.forestGeometry.dispose();
      assets.forestMaterial.dispose();
      assets.hazeGeometry.dispose();
      assets.hazeMaterial.dispose();
    },
    [assets],
  );

  return (
    <group ref={group}>
      <mesh geometry={assets.landGeometry} material={assets.landMaterial} raycast={noRaycast} />
      <mesh geometry={assets.forestGeometry} material={assets.forestMaterial} raycast={noRaycast} />
      <mesh geometry={assets.hazeGeometry} material={assets.hazeMaterial} raycast={noRaycast} />
    </group>
  );
}
