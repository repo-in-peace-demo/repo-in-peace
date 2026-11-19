import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  FOG_COLOR,
  HEMISPHERE_GROUND_COLOR,
  HEMISPHERE_INTENSITY,
  HEMISPHERE_SKY_COLOR,
  MOONLIGHT_COLOR,
  MOONLIGHT_DIRECTION,
  MOONLIGHT_INTENSITY,
  MOON_ANGULAR_RADIUS_DEG,
  MOON_COLOR,
  MOON_DIRECTION,
  MOON_GLOW_ANGULAR_RADIUS_DEG,
  SKY_HORIZON_COLOR,
  SKY_RADIUS,
  SKY_TOP_COLOR,
  STAR_COLOR,
  fogDensity,
  starDirections,
} from '../model/atmosphere';
import { boundsRadius } from '../model/fly-controls';
import type { SceneModel } from '../model/scene-model';
import { animationTime } from './animation-clock';

/**
 * The night (requirement 6): a dark sky with a gradient, about 900 stars, a moon with a soft glow, moonlight (one directional
 * light, no shadows), a dim light from the sky, and exponential fog that hides the far edge of the ground. The sky, the stars
 * and the moon are drawn around the camera, first, without depth, so they are always behind everything and always far away: three
 * draw calls. Nothing here depends on a file's facts; the only thing taken from the data file is the size of the graveyard, for the fog.
 */

const MOON = new THREE.Vector3(MOON_DIRECTION.x, MOON_DIRECTION.y, MOON_DIRECTION.z).normalize();

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uMoonDirection;
uniform vec3 uMoonColor;
varying vec3 vDirection;
void main() {
  vec3 d = normalize(vDirection);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 colour = mix(uHorizon, uTop, smoothstep(0.0, 0.55, up));
  // A faint halo of moonlight in the sky around the moon.
  float halo = pow(max(dot(d, uMoonDirection), 0.0), 24.0);
  colour += uMoonColor * halo * 0.08;
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
`;

const STAR_VERTEX = /* glsl */ `
attribute float aBrightness;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
varying float vBrightness;
void main() {
  float twinkle = 0.85 + 0.15 * sin(uTime * 1.4 + aPhase);
  vBrightness = aBrightness * twinkle;
  gl_PointSize = (1.3 + 2.0 * aBrightness) * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vBrightness;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.3, 1.0, d)) * vBrightness;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

const MOON_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MOON_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uDiscRadius; // the disc's radius, as a share of the quad's half width
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float disc = 1.0 - smoothstep(uDiscRadius * 0.92, uDiscRadius, r);
  float glow = pow(clamp(1.0 - r, 0.0, 1.0), 3.0) * 0.35;
  // A few dark patches on the disc, so it is a moon and not a lamp.
  float patches = noise(p / uDiscRadius * 3.0 + 4.0) * 0.5 + noise(p / uDiscRadius * 7.0) * 0.25;
  vec3 colour = uColor * (disc * (0.78 + 0.35 * (1.0 - patches)) + glow);
  gl_FragColor = vec4(colour, clamp(disc + glow, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

export function Atmosphere({ model }: { model: SceneModel }) {
  const camera = useThree((state) => state.camera);
  const pixelRatio = useThree((state) => state.viewport.dpr);
  const group = useRef<THREE.Group>(null);
  const moon = useRef<THREE.Mesh>(null);
  const density = fogDensity(boundsRadius(model.layout.bounds));

  const assets = useMemo(() => {
    const stars = starDirections();
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(stars.flatMap((s) => [s.x * SKY_RADIUS * 0.97, s.y * SKY_RADIUS * 0.97, s.z * SKY_RADIUS * 0.97])), 3));
    starGeometry.setAttribute('aBrightness', new THREE.BufferAttribute(Float32Array.from(stars, (s) => s.brightness), 1));
    starGeometry.setAttribute('aPhase', new THREE.BufferAttribute(Float32Array.from(stars, (s) => s.phase), 1));
    const starMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uColor: { value: new THREE.Color(STAR_COLOR) } },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });

    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(SKY_TOP_COLOR) },
        uHorizon: { value: new THREE.Color(SKY_HORIZON_COLOR) },
        uMoonDirection: { value: MOON.clone() },
        uMoonColor: { value: new THREE.Color(MOON_COLOR) },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    const glowHalf = Math.tan((MOON_GLOW_ANGULAR_RADIUS_DEG * Math.PI) / 180) * SKY_RADIUS * 0.95;
    const moonMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(MOON_COLOR) }, uDiscRadius: { value: Math.tan((MOON_ANGULAR_RADIUS_DEG * Math.PI) / 180) / Math.tan((MOON_GLOW_ANGULAR_RADIUS_DEG * Math.PI) / 180) } },
      vertexShader: MOON_VERTEX,
      fragmentShader: MOON_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    return { starGeometry, starMaterial, skyMaterial, moonMaterial, moonGeometry: new THREE.PlaneGeometry(2 * glowHalf, 2 * glowHalf), skyGeometry: new THREE.SphereGeometry(SKY_RADIUS, 32, 16) };
  }, []);
  useEffect(
    () => () => {
      assets.starGeometry.dispose();
      assets.starMaterial.dispose();
      assets.skyMaterial.dispose();
      assets.moonMaterial.dispose();
      assets.moonGeometry.dispose();
      assets.skyGeometry.dispose();
    },
    [assets],
  );

  // The moon faces the middle of the sky dome, which is the camera.
  useLayoutEffect(() => {
    const mesh = moon.current;
    if (!mesh) return;
    mesh.position.copy(MOON).multiplyScalar(SKY_RADIUS * 0.95);
    mesh.lookAt(0, 0, 0);
  }, []);

  useFrame(({ clock }) => {
    group.current?.position.copy(camera.position); // the sky is always the same distance away
    assets.starMaterial.uniforms.uTime!.value = animationTime(clock.elapsedTime);
    assets.starMaterial.uniforms.uPixelRatio!.value = pixelRatio;
  });

  return (
    <>
      <fogExp2 attach="fog" args={[FOG_COLOR, density]} />
      <hemisphereLight args={[HEMISPHERE_SKY_COLOR, HEMISPHERE_GROUND_COLOR, HEMISPHERE_INTENSITY]} />
      <directionalLight position={[MOONLIGHT_DIRECTION.x * 100, MOONLIGHT_DIRECTION.y * 100, MOONLIGHT_DIRECTION.z * 100]} intensity={MOONLIGHT_INTENSITY} color={MOONLIGHT_COLOR} />
      <group ref={group}>
        <mesh geometry={assets.skyGeometry} material={assets.skyMaterial} renderOrder={-30} frustumCulled={false} raycast={() => undefined} />
        <points geometry={assets.starGeometry} material={assets.starMaterial} renderOrder={-29} frustumCulled={false} raycast={() => undefined} />
        <mesh ref={moon} geometry={assets.moonGeometry} material={assets.moonMaterial} renderOrder={-28} frustumCulled={false} raycast={() => undefined} />
      </group>
    </>
  );
}
