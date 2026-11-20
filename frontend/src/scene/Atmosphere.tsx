import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  AMBIENT_COLOR,
  AMBIENT_INTENSITY,
  CLOUD_COLOR,
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
 * light, no shadows), a dim light from the sky and a little even fill (so the backs of stones are dim, not black), and exponential fog that hides the far edge of the ground. The sky, the stars
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
uniform float uTime;
uniform vec3 uCloudColor;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uMoonDirection;
uniform vec3 uMoonColor;
varying vec3 vDirection;
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
void main() {
  vec3 d = normalize(vDirection);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 colour = mix(uHorizon, uTop, smoothstep(0.0, 0.55, up));
  // A faint halo of moonlight in the sky around the moon.
  float halo = pow(max(dot(d, uMoonDirection), 0.0), 24.0);
  colour += uMoonColor * halo * 0.08;
  // Clouds: thin, torn strips drifting slowly past the moon, only in the part of the sky around it, low above the horizon.
  float near = dot(d, uMoonDirection);
  float around = smoothstep(0.93, 0.985, near) * smoothstep(0.0, 0.05, d.y) * (1.0 - smoothstep(0.32, 0.45, d.y));
  if (around > 0.0) {
    vec2 plane = d.xz / max(d.y + 0.08, 0.05);          // a flat cloud layer seen from below
    plane = vec2(plane.x * 0.9 + plane.y * 0.4, plane.y * 2.6); // stretched along the wind
    plane += vec2(uTime * 0.035, 0.0);
    float c = cFbm(plane * 1.4);
    float cover = smoothstep(0.5, 0.72, c) * around;
    // Lit from the moon: the edges near it are silver, the bodies a dark grey-blue that hides the stars behind them.
    float lit = pow(smoothstep(0.95, 0.9995, near), 1.5);
    vec3 cloud = mix(uCloudColor, uMoonColor * 0.55, lit * (1.0 - smoothstep(0.55, 0.8, c)) + 0.15 * lit);
    colour = mix(colour, cloud, cover * 0.85);
  }
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

/**
 * The moon is drawn in screen space: the middle of the quad is the moon's direction, projected, and its corners are set out from
 * there by a fixed angle (the halo's), scaled by the lens only. A quad in the world would be stretched into an oval near the edge
 * of a wide lens, the more so with the lens shift; this one is always round, and the same size anywhere in the frame.
 */
const MOON_VERTEX = /* glsl */ `
uniform vec3 uCentre;   // the moon's middle, relative to the sky group (which is at the camera)
uniform float uHalfSize; // tan of the halo's angular radius
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(uCentre, 1.0);
  // position.xy is the corner, from -1 to 1. P[0][0] and P[1][1] turn a tangent into a share of the frame, with the aspect.
  clip.xy += position.xy * uHalfSize * vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * clip.w;
  gl_Position = clip;
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
  vec2 q = p / uDiscRadius; // on the disc, from -1 to 1
  float disc = 1.0 - smoothstep(0.9, 1.0, r / uDiscRadius);
  // Faint surface detail: soft dark seas (maria) and a little grain, and the edge a touch darker than the middle.
  // The bright highlands are past white; only the seas come down into the visible range, as grey-blue patches.
  float seas = exp(-dot(q - vec2(-0.32, 0.22), q - vec2(-0.32, 0.22)) / 0.09)
             + 0.8 * exp(-dot(q - vec2(0.18, 0.34), q - vec2(0.18, 0.34)) / 0.05)
             + 0.7 * exp(-dot(q - vec2(0.05, -0.2), q - vec2(0.05, -0.2)) / 0.07);
  seas = clamp(seas * (0.7 + 0.6 * noise(q * 5.0 + 2.0)), 0.0, 1.0);
  float grain = noise(q * 14.0);
  float limb = sqrt(max(0.0, 1.0 - dot(q, q)));
  float surface = 0.95 + 0.15 * limb - 0.6 * seas - 0.08 * grain * seas; // fitted to the screen: about 0.6 is already white
  // A soft halo around the disc, falling to nothing at the edge of the quad (MOON_GLOW_ANGULAR_RADIUS_DEG).
  float outside = clamp((r - uDiscRadius) / (1.0 - uDiscRadius), 0.0, 1.0);
  float halo = (1.0 - disc) * pow(1.0 - outside, 2.6) * 0.22 * (1.0 - smoothstep(0.85, 1.0, r));
  vec3 colour = uColor * (disc * surface + halo);
  gl_FragColor = vec4(colour, clamp(disc + halo, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

export function Atmosphere({ model }: { model: SceneModel }) {
  const camera = useThree((state) => state.camera);
  const pixelRatio = useThree((state) => state.viewport.dpr);
  const group = useRef<THREE.Group>(null);
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
        uTime: { value: 0 },
        uCloudColor: { value: new THREE.Color(CLOUD_COLOR) },
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

    const moonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(MOON_COLOR) },
        uDiscRadius: { value: Math.tan((MOON_ANGULAR_RADIUS_DEG * Math.PI) / 180) / Math.tan((MOON_GLOW_ANGULAR_RADIUS_DEG * Math.PI) / 180) },
        uCentre: { value: MOON.clone().multiplyScalar(SKY_RADIUS * 0.95) },
        uHalfSize: { value: Math.tan((MOON_GLOW_ANGULAR_RADIUS_DEG * Math.PI) / 180) },
      },
      vertexShader: MOON_VERTEX,
      fragmentShader: MOON_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    return { starGeometry, starMaterial, skyMaterial, moonMaterial, moonGeometry: new THREE.PlaneGeometry(2, 2), skyGeometry: new THREE.SphereGeometry(SKY_RADIUS, 32, 16) };
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

  useFrame(({ clock }) => {
    group.current?.position.copy(camera.position); // the sky is always the same distance away
    const time = animationTime(clock.elapsedTime);
    assets.starMaterial.uniforms.uTime!.value = time;
    assets.skyMaterial.uniforms.uTime!.value = time;
    assets.starMaterial.uniforms.uPixelRatio!.value = pixelRatio;
  });

  return (
    <>
      <fogExp2 attach="fog" args={[FOG_COLOR, density]} />
      <hemisphereLight args={[HEMISPHERE_SKY_COLOR, HEMISPHERE_GROUND_COLOR, HEMISPHERE_INTENSITY]} />
      <ambientLight args={[AMBIENT_COLOR, AMBIENT_INTENSITY]} />
      <directionalLight position={[MOONLIGHT_DIRECTION.x * 100, MOONLIGHT_DIRECTION.y * 100, MOONLIGHT_DIRECTION.z * 100]} intensity={MOONLIGHT_INTENSITY} color={MOONLIGHT_COLOR} />
      <group ref={group}>
        <mesh geometry={assets.skyGeometry} material={assets.skyMaterial} renderOrder={-30} frustumCulled={false} raycast={() => undefined} />
        <points geometry={assets.starGeometry} material={assets.starMaterial} renderOrder={-29} frustumCulled={false} raycast={() => undefined} />
        <mesh geometry={assets.moonGeometry} material={assets.moonMaterial} renderOrder={-28} frustumCulled={false} raycast={() => undefined} />
      </group>
    </>
  );
}
