import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SceneModel } from '../model/scene-model';
import { GROUND_BASE_COLOR, groundSize } from '../model/atmosphere';
import { FLOOR_COLOR } from './colors';
import { noRaycast, placement } from './instances';

/**
 * The ground: a very dark plane under everything, so large (`groundSize`) that the fog hides its edge from any camera the
 * limits allow. Its colour has a faint noise, in two sizes (patches of a few units and a fine grain), from the position on the
 * ground, so it is not a flat colour and does not swim when the camera moves. The noise is the same everywhere and reads nothing from the data.
 */
export function Ground({ model }: { model: SceneModel }) {
  const { x, z, w, d } = model.layout.bounds;
  const size = groundSize(model.layout.bounds);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: GROUND_BASE_COLOR, roughness: 1 });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vGround;
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
  float patches = gNoise(vGround.xz * 0.18) * 0.6 + gNoise(vGround.xz * 0.7) * 0.4;
  float grain = gNoise(vGround.xz * 6.0);
  diffuseColor.rgb *= 0.7 + 0.6 * patches + 0.12 * (grain - 0.5);
}`,
        );
    };
    m.customProgramCacheKey = () => 'repo-in-peace-ground-v1';
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x + w / 2, -0.02, z + d / 2]} renderOrder={-20} raycast={noRaycast} material={material}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}

const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/**
 * One floor for every plot, one instanced mesh. A deeper folder's floor is a little darker (plotFloorShade).
 * Floors are drawn first and in the order of the plots, a parent before the folders inside it, without depth, so a
 * plot's floor lies over its parent's without the two flickering against each other.
 */
export function PlotFloors({ model }: { model: SceneModel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const floors = model.floors;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const color = new THREE.Color();
    floors.forEach(({ plot, shade }, i) => {
      const { x, z, w, d } = plot.rect;
      mesh.setMatrixAt(i, placement(x + w / 2, 0.01, z + d / 2, w, d, 1, FLAT));
      mesh.setColorAt(i, color.set(FLOOR_COLOR).multiplyScalar(shade));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [floors]);

  if (floors.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, floors.length]} frustumCulled={false} renderOrder={-10} raycast={noRaycast}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial depthTest={false} depthWrite={false} />
    </instancedMesh>
  );
}
