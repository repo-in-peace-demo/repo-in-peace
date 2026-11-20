import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FOREST_COLOR, HAZE_COLOR, HAZE_MAX_ALPHA, HILL_COLOR, HILL_HAZE } from '../model/atmosphere';
import { forestTrees, forestTriangles, hazeRingMesh, horizonPlan, landMesh } from '../model/horizon';
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
    landGeometry.setIndex(new THREE.BufferAttribute(land.indices, 1));
    landGeometry.computeVertexNormals();
    landGeometry.computeBoundingSphere();
    const landMaterial = new THREE.MeshStandardMaterial({
      color: HILL_COLOR,
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
      shader.uniforms.uRidge = { value: plan.ridgeHeight };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLand;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLand = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vLand;
uniform vec3 uHaze;
uniform float uHazeAmount;
uniform float uRidge;
float hHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hHash(i), hHash(i + vec2(1.0, 0.0)), f.x), mix(hHash(i + vec2(0.0, 1.0)), hHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
diffuseColor.rgb *= 0.75 + 0.35 * hNoise(vLand.xz * 0.06) + 0.15 * hNoise(vLand.xz * 0.4);`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze * 0.45, uHazeAmount * smoothstep(uRidge * 0.45, uRidge * 1.02, vLand.y));`,
        );
    };
    landMaterial.customProgramCacheKey = () => 'repo-in-peace-hills-v1';

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

    const forestGeometry = new THREE.BufferGeometry();
    forestGeometry.setAttribute('position', new THREE.BufferAttribute(forestTriangles(forestTrees(plan)), 3));
    forestGeometry.computeBoundingSphere();
    const forestMaterial = new THREE.MeshBasicMaterial({ color: FOREST_COLOR, side: THREE.DoubleSide });

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
