import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { candleSpots } from '../model/candle-placement';
import type { SceneModel } from '../model/scene-model';
import { CANDLE_GLOW_SIZE, CANDLE_HEIGHT, CANDLE_RADIUS, FLAME_HEIGHT } from '../model/visual-constants';
import { animationTime } from './animation-clock';
import { EFFECT_COLORS } from './colors';
import { FOG_FRAGMENT_PARS, FOG_VERTEX, FOG_VERTEX_PARS, foggedUniforms } from './fog-fade';
import { noRaycast, placement } from './instances';
import { currentOverrides, frameOf } from './pr-overrides';

/**
 * A lit candle for every hot stone (requirement 5.4): two instanced meshes, so two draw calls however many there are.
 * The wax is a short cream cylinder. The flame is a small teardrop that flickers (it stretches and shrinks with time and
 * the stone's own phase), with a soft glow around it that is a camera-facing quad in the same shader. There are no real
 * lights (requirement 11.4): the glow is only drawn, added to what is behind it, after everything solid.
 */

const FLAME_SHADER_VERTEX = /* glsl */ `
${FOG_VERTEX_PARS}
attribute float aGlow;
attribute float aPhase;
uniform float uTime;
uniform float uBase;
uniform float uFlameHeight;
varying vec2 vUv;
varying float vGlow;
varying float vHeight;
varying float vFar;
void main() {
  float flicker = 1.0 + 0.10 * sin(uTime * 9.0 + aPhase) + 0.06 * sin(uTime * 17.3 + aPhase * 1.7);
  vUv = uv;
  vGlow = aGlow;
  vHeight = clamp((position.y - uBase) / uFlameHeight, 0.0, 1.0);
  vec4 world;
  if (aGlow > 0.5) {
    // The glow quad always faces the camera: its corners are along the camera's right and up directions.
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, uBase + 0.5 * uFlameHeight, 0.0, 1.0)).xyz;
    // From far away the glow grows with the distance (up to 2.6 times as wide), so a candle of a few pixels still reads as a lit spot
    // from the overview; up close (within 18 units) it is the same as before. The same for every candle at a given distance.
    vFar = smoothstep(18.0, 70.0, distance(cameraPosition, centre));
    world = vec4(centre + (right * position.x + up * position.y) * (0.92 + 0.5 * (flicker - 1.0)) * (1.0 + 1.6 * vFar), 1.0);
  } else {
    vFar = 0.0;
    vec3 p = position;
    p.y = uBase + (p.y - uBase) * flicker;
    p.x *= 2.0 - flicker;
    p.z *= 2.0 - flicker;
    world = modelMatrix * instanceMatrix * vec4(p, 1.0);
  }
  vec4 mvPosition = viewMatrix * world;
  ${FOG_VERTEX}
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FLAME_SHADER_FRAGMENT = /* glsl */ `
${FOG_FRAGMENT_PARS}
uniform vec3 uColor;
varying vec2 vUv;
varying float vGlow;
varying float vHeight;
varying float vFar;
void main() {
  if (vGlow > 0.5) {
    float d = length(vUv - 0.5) * 2.0;
    // Brighter and with a fuller core from far away (distance only), the same soft glow up close.
    float a = pow(clamp(1.0 - d, 0.0, 1.0), mix(2.4, 1.7, vFar)) * (0.55 + 0.4 * vFar);
    gl_FragColor = vec4(uColor, a);
  } else {
    // A hotter, paler heart at the foot of the flame, the candle's own colour toward the tip.
    gl_FragColor = vec4(mix(vec3(1.0, 0.96, 0.78), uColor, vHeight), 1.0);
  }
  gl_FragColor.a *= fogVisibility(); // drawn added to the background, so fade it with the fog instead of mixing the fog colour in
  #include <colorspace_fragment>
}
`;

function makeWaxGeometry(): THREE.BufferGeometry {
  const wax = new THREE.CylinderGeometry(CANDLE_RADIUS, CANDLE_RADIUS * 1.08, CANDLE_HEIGHT, 12);
  wax.translate(0, CANDLE_HEIGHT / 2, 0);
  return wax;
}

/** The flame (a teardrop turned on a lathe) and the glow quad as one geometry; `aGlow` is 1 on the quad's vertices. */
function makeFlameGeometry(): THREE.BufferGeometry {
  const profile = [
    [0, 0],
    [0.034, 0.02],
    [0.046, 0.06],
    [0.034, 0.12],
    [0.014, 0.17],
    [0, FLAME_HEIGHT],
  ].map(([x, y]) => new THREE.Vector2(x, CANDLE_HEIGHT + y!));
  const flame = new THREE.LatheGeometry(profile, 10);
  const glow = new THREE.PlaneGeometry(CANDLE_GLOW_SIZE, CANDLE_GLOW_SIZE);
  for (const [geometry, value] of [[flame, 0], [glow, 1]] as const) {
    geometry.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(value), 1));
  }
  const merged = mergeGeometries([flame, glow]);
  flame.dispose();
  glow.dispose();
  if (merged === null) throw new Error('the flame shapes could not be joined');
  return merged;
}

export function Candles({ model }: { model: SceneModel }) {
  const spots = useMemo(() => candleSpots(model.stones), [model]);
  const wax = useRef<THREE.InstancedMesh>(null);
  const flame = useRef<THREE.InstancedMesh>(null);

  const assets = useMemo(() => {
    const waxGeometry = makeWaxGeometry();
    const flameGeometry = makeFlameGeometry();
    flameGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(Float32Array.from(spots, (s) => s.phase), 1));
    const waxMaterial = new THREE.MeshStandardMaterial({ color: '#d8d0bc', roughness: 0.8 });
    const uniforms = foggedUniforms({ uTime: { value: 0 }, uBase: { value: CANDLE_HEIGHT }, uFlameHeight: { value: FLAME_HEIGHT }, uColor: { value: new THREE.Color(EFFECT_COLORS.candle) } });
    const flameMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: FLAME_SHADER_VERTEX,
      fragmentShader: FLAME_SHADER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    });
    return { waxGeometry, flameGeometry, waxMaterial, flameMaterial, uniforms };
  }, [spots]);
  useEffect(
    () => () => {
      assets.waxGeometry.dispose();
      assets.flameGeometry.dispose();
      assets.waxMaterial.dispose();
      assets.flameMaterial.dispose();
    },
    [assets],
  );

  useLayoutEffect(() => {
    for (const mesh of [wax.current, flame.current]) {
      if (!mesh) continue;
      spots.forEach((spot, i) => mesh.setMatrixAt(i, placement(spot.x, 0, spot.z, 1, 1, 1)));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [spots]);

  // A buried stone's candle goes down with it (bury-and-resurrect Req 10.1), and its glow with it.
  const spotOf = useMemo(() => new Map(spots.map((s, i) => [s.path, i])), [spots]);
  const sunk = useRef(new Map<number, number>());
  useFrame(({ clock }) => {
    assets.uniforms.uTime.value = animationTime(clock.elapsedTime);
    let moved = false;
    for (const o of currentOverrides(model)) {
      const i = o.kind === 'buried' ? spotOf.get(o.path) : undefined;
      if (i === undefined) continue;
      const frame = frameOf(o);
      if (frame.kind !== 'buried' || sunk.current.get(i) === frame.sink) continue;
      sunk.current.set(i, frame.sink);
      const spot = spots[i]!;
      // Below the ground at the end, far enough that the glow (a card built around its centre, which ignores scale) can't show.
      const y = frame.sink >= 1 ? -1000 : -frame.sink * 1.2;
      for (const mesh of [wax.current, flame.current]) mesh?.setMatrixAt(i, placement(spot.x, y, spot.z, 1, 1, 1));
      moved = true;
    }
    if (moved) for (const mesh of [wax.current, flame.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  });

  if (spots.length === 0) return null;
  return (
    <>
      <instancedMesh ref={wax} args={[assets.waxGeometry, assets.waxMaterial, spots.length]} frustumCulled={false} raycast={noRaycast} />
      <instancedMesh ref={flame} args={[assets.flameGeometry, assets.flameMaterial, spots.length]} frustumCulled={false} raycast={noRaycast} renderOrder={3} />
    </>
  );
}
