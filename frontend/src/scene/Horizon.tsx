import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { FOREST_COLOR, FOREST_EDGE_COLOR, HAZE_COLOR, HAZE_MAX_ALPHA } from '../model/atmosphere';
import { forestMesh, forestTrees, hazeRingMesh, horizonPlan, nearTrees } from '../model/horizon';
import type { SceneModel } from '../model/scene-model';
import { noRaycast } from './instances';

/**
 * What stands around the graveyard (`model/horizon.ts`), on the flat ground: the far forest in a ring, with a clearing under the
 * moon; a nearer layer of trees behind the back fence; the bare trees that frame the view; and a pale haze at the far forest's foot.
 * Two meshes, two draw calls. The trees are flat, unlit silhouettes with a faint moonlit edge on their tops, hazier the further
 * back they are, and fogged. Only the graveyard's bounds are read, never a file's facts, so this is backdrop like the sky. Nothing
 * here can be picked.
 */
/** For the development API only (`setHorizonVisible`): the group of the trees and haze on the screen, and whether to show it. */
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

    const hazeColour = new THREE.Color(HAZE_COLOR);

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
    const forest = forestMesh([...forestTrees(plan), ...nearTrees(plan)]);
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

    return { forestGeometry, forestMaterial, hazeGeometry, hazeMaterial };
  }, [bounds]);

  useEffect(
    () => () => {
      assets.forestGeometry.dispose();
      assets.forestMaterial.dispose();
      assets.hazeGeometry.dispose();
      assets.hazeMaterial.dispose();
    },
    [assets],
  );

  return (
    <group ref={group}>
      <mesh geometry={assets.forestGeometry} material={assets.forestMaterial} raycast={noRaycast} />
      <mesh geometry={assets.hazeGeometry} material={assets.hazeMaterial} raycast={noRaycast} />
    </group>
  );
}
