import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLOD_COUNT, SHOULDER, SHOVEL, BLADE_HALF_W, armsTransform, diggerPose, endOf, type DiggerJob } from '../model/gravedigger';
import type { SceneModel } from '../model/scene-model';
import { isReducedMotion } from './animation-clock';
import { getDiggerJobs, getDiggerVersion, startGravediggers, subscribeDiggers } from './gravedigger-state';
import { noRaycast } from './instances';

/**
 * The gravedigger who performs a Bury (model/gravedigger.ts): a low-poly figure of our own, from primitives, mostly silhouette in
 * the scene's palette: a long cloak, a hood under a wide-brimmed hat, a shovel, and a small lantern at his belt that glows faintly
 * (emissive, no light). Decoration, so not in the legend; picking never sees him. Five draw calls (body, head, arms and shovel,
 * lantern, clods), and none once he has gone. Under reduced motion he is never drawn.
 */

// Revised after the first screenshots: near-black was lost against the fences at night; still dark, a shade lighter than the shadows.
const CLOAK = '#2f2d3b';
const HAT = '#22212c';
const HOOD = '#3a3746';
const HANDLE = '#5a4230';
const BLADE = '#7d828b';
const LANTERN_FRAME = '#1c1712';
const LANTERN_GLOW = '#ffb04a';
const DIRT = '#2f2319';
/** The rim light on his cloak and hat: the moonlight's pale blue. */
const RIM = '#8ea6d6';

const NECK_Y = 1.45;

function coloured(geometry: THREE.BufferGeometry, colour: string): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  geometry.dispose();
  const c = new THREE.Color(colour);
  const colours = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < colours.length; i += 3) colours.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.deleteAttribute('uv');
  return g;
}

/** A box of thickness `t` from `a` to `b`. */
function rod(a: THREE.Vector3, b: THREE.Vector3, t: number, colour: string, w = t): THREE.BufferGeometry {
  const length = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, t, length);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return coloured(g, colour);
}

function figureGeometries() {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // The body: a long cloak (a seven-sided cone, wide at the hem), shoulders, a belt and the lantern's frame.
  const cloak = new THREE.ConeGeometry(0.34, 1.38, 7, 1).translate(0, 0.69, 0);
  const shoulders = new THREE.SphereGeometry(0.2, 7, 4).scale(1.15, 0.7, 0.9).translate(0, 1.3, 0);
  const belt = new THREE.CylinderGeometry(0.2, 0.22, 0.05, 7).translate(0, 0.9, 0);
  const hook = rod(v(-0.2, 0.9, 0.05), v(-0.25, 0.8, 0.07), 0.02, LANTERN_FRAME);
  const cap = new THREE.ConeGeometry(0.06, 0.05, 6).translate(-0.25, 0.8, 0.07);
  const body = mergeGeometries([coloured(cloak, CLOAK), coloured(shoulders, CLOAK), coloured(belt, HAT), hook, coloured(cap, LANTERN_FRAME)])!;

  // The head, about the neck: a hood and a wide-brimmed hat.
  const hood = new THREE.SphereGeometry(0.14, 8, 6).scale(1, 1.1, 1).translate(0, 0.1, 0.01);
  const brim = new THREE.CylinderGeometry(0.3, 0.3, 0.025, 12).translate(0, 0.2, 0);
  const crown = new THREE.CylinderGeometry(0.12, 0.15, 0.2, 9).translate(0, 0.31, 0);
  const head = mergeGeometries([coloured(hood, HOOD), coloured(brim, HAT), coloured(crown, HAT)])!;

  // The arms and shovel, about the shoulders: hands at the handle, the blade near the ground ahead of him.
  const handTop = v(0, -0.15, 0.3);
  const handLow = v(0, -0.42, 0.42);
  // The shovel's numbers are the model's (model/gravedigger.ts), which keeps it out of the stones.
  const bladeTop = v(SHOVEL.bladeTop.x, SHOVEL.bladeTop.y, SHOVEL.bladeTop.z);
  const bladeTip = v(SHOVEL.bladeTip.x, SHOVEL.bladeTip.y, SHOVEL.bladeTip.z);
  const grip = v(SHOVEL.grip.x, SHOVEL.grip.y, SHOVEL.grip.z);
  const arms = mergeGeometries([
    rod(v(0.19, 0, 0), handTop.clone().setX(0.04), 0.075, CLOAK),
    rod(v(-0.19, 0, 0), handLow.clone().setX(-0.04), 0.075, CLOAK),
    rod(grip, bladeTop, 0.035, HANDLE),
    rod(v(-0.06, grip.y, grip.z), v(0.06, grip.y, grip.z), 0.03, HANDLE), // the grip
    rod(bladeTop, bladeTip, 0.02, BLADE, 2 * BLADE_HALF_W),
  ])!;

  const lantern = new THREE.BoxGeometry(0.07, 0.1, 0.07).translate(-0.25, 0.72, 0.07);
  const clod = new THREE.IcosahedronGeometry(0.045, 0);
  return { body, head, arms, lantern, clod };
}

function Digger({ job, assets }: { job: DiggerJob; assets: ReturnType<typeof useAssets> }) {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const arms = useRef<THREE.Group>(null);
  const clods = useRef<THREE.InstancedMesh>(null);
  const end = endOf(job);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const now = performance.now();
    const r = root.current;
    if (!r) return;
    const pose = diggerPose(job, now);
    const shown = pose.phase !== 'gone' && !isReducedMotion() && now < end;
    r.visible = shown;
    if (!shown) return;
    for (const m of assets.materials) m.opacity = pose.opacity;
    tilt.current!.rotation.x = pose.lean;
    head.current!.rotation.y = pose.head;
    const a = arms.current!;
    // Positive: the blade pushed down into the ground; negative: lifted, tipped forward with its load.
    const at = armsTransform(pose);
    a.position.set(at.position.x, at.position.y, at.position.z);
    a.rotation.set(at.rotation.x, at.rotation.y, 0);
    const c = clods.current!;
    for (let i = 0; i < CLOD_COUNT; i++) {
      const at = pose.clods[i];
      dummy.position.set(at?.x ?? 0, at ? at.y : -100, at?.z ?? 0);
      dummy.rotation.set(i, i * 2, 0);
      dummy.updateMatrix();
      c.setMatrixAt(i, dummy.matrix);
    }
    c.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={root} position={[job.spot.x, 0, job.spot.z]} rotation={[0, job.spot.yaw, 0]} visible={false}>
      <group ref={tilt}>
        <mesh geometry={assets.geometries.body} material={assets.cloth} raycast={noRaycast} />
        <group ref={head} position={[0, NECK_Y, 0]}>
          <mesh geometry={assets.geometries.head} material={assets.cloth} raycast={noRaycast} />
        </group>
        <mesh geometry={assets.geometries.lantern} material={assets.glow} raycast={noRaycast} />
        <group ref={arms}>
          <mesh geometry={assets.geometries.arms} material={assets.cloth} raycast={noRaycast} />
        </group>
      </group>
      <instancedMesh ref={clods} args={[assets.geometries.clod, assets.dirt, CLOD_COUNT]} frustumCulled={false} raycast={noRaycast} />
    </group>
  );
}

function useAssets() {
  const assets = useMemo(() => {
    const geometries = figureGeometries();
    const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, transparent: true }); // one-sided: a transparent double-sided material is drawn twice
    // A faint moonlit rim along his edges, so the dark figure stands out from the dark ground and stones (revised after the live site,
    // where he was hard to make out). Emissive, so it adds no light to anything else.
    cloth.onBeforeCompile = (shader) => {
      shader.uniforms['uRim'] = { value: new THREE.Color(RIM) };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  float rimEdge = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));\n  totalEmissiveRadiance += uRim * pow(rimEdge, 2.5) * 0.9;',
        );
    };
    const glow = new THREE.MeshStandardMaterial({ color: LANTERN_FRAME, emissive: LANTERN_GLOW, emissiveIntensity: 1.1, roughness: 0.8, transparent: true });
    const dirt = new THREE.MeshStandardMaterial({ color: DIRT, roughness: 1, metalness: 0, transparent: true });
    return { geometries, cloth, glow, dirt, materials: [cloth, glow, dirt] };
  }, []);
  useEffect(
    () => () => {
      for (const g of Object.values(assets.geometries)) g.dispose();
      for (const m of assets.materials) m.dispose();
    },
    [assets],
  );
  return assets;
}

/**
 * Watches this scene's Bury requests (scene/gravedigger-state.ts) and draws a gravedigger for each job until he has gone. Mounted
 * with the scene; the figure's geometry is built only when the first job starts.
 */
export function Gravediggers({ model }: { model: SceneModel }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => startGravediggers(model, () => ({ x: camera.position.x, z: camera.position.z })), [model, camera]);
  useSyncExternalStore(subscribeDiggers, getDiggerVersion, getDiggerVersion);
  const jobs = [...getDiggerJobs().values()];
  if (jobs.length === 0) return null;
  return <Figures jobs={jobs} />;
}

function Figures({ jobs }: { jobs: DiggerJob[] }) {
  const assets = useAssets();
  return (
    <>
      {jobs.map((job) => (
        <Digger key={`${job.path}@${job.start}`} job={job} assets={assets} />
      ))}
    </>
  );
}
