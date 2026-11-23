import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MOON_ELEVATION_DEG, SKY_RADIUS, skyDirection } from '../model/atmosphere';
import { OPENING_DURATION_MS } from '../model/framing';
import { playsOpening } from '../model/opening-move';
import {
  BAT_MAX,
  FORK_PEAK,
  GLOW_CENTRE_DEG,
  GLOW_HALF_H_DEG,
  GLOW_HALF_W_DEG,
  GLOW_LOWEST_DEG,
  GLOW_PEAK,
  batAt,
  batFlight,
  flashLevel,
  lightningOf,
  skyEventAt,
  starAt,
  starPath,
  type SkyKind,
  type SkyPoint,
} from '../model/sky-director';
import { firstPassStart } from '../model/witch';
import { animationTime, isReducedMotion } from './animation-clock';
import { CLOUD_GLSL } from './cloud-glsl';
import { prefersReducedMotion } from './reduced-motion';

/**
 * The sky events other than the witch (model/sky-director.ts): shooting stars, bats crossing the moon, and distant lightning behind
 * the clouds over the forest. Decoration, not data: not in the legend, never picked. One quad on the sky, drawn behind everything
 * (no depth), so the forest and the graveyard always cover it; its fragment shader draws the one event in the sky, in degrees on the
 * sky. One draw call while an event is on, none between. Lightning only lights its patch of sky: no scene light changes, so the
 * graveyard, its stones and the ground never brighten.
 */
export const skyEventDebug: { state: { kind: SkyKind; index: number; elapsed: number } | null } = { state: null };

const FORK_POINTS = 12;
const KIND_CODE: Record<Exclude<SkyKind, 'witch'>, number> = { star: 1, bats: 2, lightning: 3 };
const COS_EL = Math.cos((MOON_ELEVATION_DEG * Math.PI) / 180);
const flat = (p: SkyPoint): THREE.Vector2 => new THREE.Vector2(p.azimuthDeg * COS_EL, p.elevationDeg);

const VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uHalfSize;
varying vec3 vDirection;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vDirection = normalize(normalize(uCentre) + (right * position.x + up * position.y) * uHalfSize);
  vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(uCentre, 1.0);
  clip.xy += position.xy * uHalfSize * vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * clip.w;
  gl_Position = clip;
}
`;

const FRAGMENT = /* glsl */ `
uniform int uKind;
uniform float uCosEl;
uniform float uSkyTime;
uniform float uLevel;
uniform vec2 uA;
uniform vec2 uB;
uniform vec4 uBats[${BAT_MAX}];
uniform float uWings[${BAT_MAX}];
uniform int uCount;
uniform vec2 uGlowAt;
uniform vec3 uGlow; // half width, half height, lowest elevation
uniform float uGlowPeak;
uniform vec2 uFork[${FORK_POINTS}];
uniform vec2 uBranch[4];
uniform int uBranchCount;
uniform float uForkLevel;
varying vec3 vDirection;
${CLOUD_GLSL}
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
float along(vec2 p, vec2 a, vec2 b) {
  vec2 ba = b - a;
  return clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
}
float ellipse(vec2 p, vec2 c, vec2 r) { return (length((p - c) / r) - 1.0) * min(r.x, r.y); }
float tri(vec2 p, vec2 a, vec2 b, vec2 c) {
  // Negative inside: the largest of the three edge distances (enough for small, sharp shapes).
  vec2 e0 = normalize(b - a), e1 = normalize(c - b), e2 = normalize(a - c);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  return max(max(s * (e0.x * (p.y - a.y) - e0.y * (p.x - a.x)), s * (e1.x * (p.y - b.y) - e1.y * (p.x - b.x))), s * (e2.x * (p.y - c.y) - e2.y * (p.x - c.x)));
}
/** One bat, in its own units (half-width 1), wings from -1 (down) to 1 (up). */
float bat(vec2 q, float wings) {
  q.x = abs(q.x);
  float tipY = 0.1 + 0.5 * wings;
  float d = ellipse(q, vec2(0.0, -0.02), vec2(0.13, 0.24));        // the body
  d = min(d, ellipse(q, vec2(0.0, 0.22), vec2(0.1, 0.09)));        // the head
  d = min(d, tri(q, vec2(0.02, 0.26), vec2(0.09, 0.27), vec2(0.07, 0.4))); // an ear
  float wing = tri(q, vec2(0.08, 0.12), vec2(1.0, tipY), vec2(0.1, -0.18));
  wing = min(wing, tri(q, vec2(0.1, -0.18), vec2(1.0, tipY), vec2(0.6, tipY * 0.4 - 0.22)));
  // The scalloped trailing edge: bites out of the wing's lower side.
  for (int k = 0; k < 3; k++) {
    float x = 0.3 + 0.24 * float(k);
    float y = mix(-0.2, tipY * 0.4 - 0.2, (x - 0.1) / 0.9) - 0.02;
    wing = max(wing, -(length(q - vec2(x, y)) - 0.1));
  }
  return min(d, wing);
}
void main() {
  vec3 d = normalize(vDirection);
  vec2 p = vec2(degrees(atan(d.x, -d.z)) * uCosEl, degrees(asin(clamp(d.y, -1.0, 1.0))));
  float px = max(length(fwidth(p)), 1e-4); // one pixel, in degrees
  vec3 colour = vec3(0.0);
  float alpha = 0.0;
  if (uKind == 1) {
    // A shooting star: a thin bright streak from the tail to the head, brighter toward the head, and a small glow at the head.
    float w = max(0.035, px * 0.9);
    float line = 1.0 - smoothstep(w * 0.4, w + px, segment(p, uB, uA));
    float k = along(p, uB, uA);
    float head = exp(-pow(length(p - uA) / max(0.12, px * 2.0), 2.0));
    alpha = uLevel * clamp(line * k * k + head * 0.8, 0.0, 1.0);
    colour = vec3(0.86, 0.92, 1.0);
  } else if (uKind == 2) {
    // Bats: dark silhouettes like the witch.
    float best = 0.0;
    for (int i = 0; i < ${BAT_MAX}; i++) {
      if (i >= uCount) break;
      vec4 b = uBats[i];
      if (b.w <= 0.0) continue;
      float dist = bat((p - b.xy) / b.z, uWings[i]) * b.z;
      best = max(best, b.w * (1.0 - smoothstep(-px * 0.5, px * 0.5, dist)));
    }
    alpha = best * 0.95;
    colour = vec3(0.02, 0.025, 0.04);
  } else if (uKind == 3) {
    // Distant lightning: a dim glow behind the clouds over the forest, stronger where the clouds are, and never below its lowest edge.
    vec2 e = (p - uGlowAt) / uGlow.xy;
    float r = length(e);
    float glow = p.y < uGlow.z ? 0.0 : uGlowPeak * (1.0 - min(r, 1.0));
    float cover = cloudCover(cloudField(d, uSkyTime));
    alpha = uLevel * glow * (0.5 + 0.5 * cover);
    // The fork: a thin jagged streak, fading toward its foot.
    float fork = 1e3;
    for (int i = 0; i < ${FORK_POINTS} - 1; i++) {
      if (i + 1 >= uCount) break;
      fork = min(fork, segment(p, uFork[i], uFork[i + 1]));
    }
    for (int i = 0; i < 3; i++) {
      if (i + 1 >= uBranchCount) break;
      fork = min(fork, segment(p, uBranch[i], uBranch[i + 1]) + 0.008); // a little thinner
    }
    float w = max(0.025, px * 0.6);
    float streak = (1.0 - smoothstep(w * 0.3, w + px, fork)) * uForkLevel * smoothstep(uGlow.z, uGlow.z + 2.0, p.y);
    alpha = max(alpha, streak);
    colour = vec3(0.78, 0.82, 1.0);
  }
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(colour, alpha);
}
`;

export function SkyEvents() {
  const mesh = useRef<THREE.Mesh>(null);
  const assets = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uCentre: { value: new THREE.Vector3() },
        uHalfSize: { value: 0.1 },
        uKind: { value: 0 },
        uCosEl: { value: COS_EL },
        uSkyTime: { value: 0 },
        uLevel: { value: 0 },
        uA: { value: new THREE.Vector2() },
        uB: { value: new THREE.Vector2() },
        uBats: { value: Array.from({ length: BAT_MAX }, () => new THREE.Vector4()) },
        uWings: { value: new Array<number>(BAT_MAX).fill(0) },
        uCount: { value: 0 },
        uGlowAt: { value: new THREE.Vector2() },
        uGlow: { value: new THREE.Vector3(GLOW_HALF_W_DEG, GLOW_HALF_H_DEG, GLOW_LOWEST_DEG) },
        uGlowPeak: { value: GLOW_PEAK },
        uFork: { value: Array.from({ length: FORK_POINTS }, () => new THREE.Vector2()) },
        uForkLevel: { value: 0 },
        uBranch: { value: Array.from({ length: 4 }, () => new THREE.Vector2()) },
        uBranchCount: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    return { material, geometry: new THREE.PlaneGeometry(2, 2) };
  }, []);
  useEffect(
    () => () => {
      assets.material.dispose();
      assets.geometry.dispose();
      skyEventDebug.state = null;
    },
    [assets],
  );
  // The same first moment as the witch's (scene/Witch.tsx): the director's schedule starts with her pass.
  const first = useMemo(() => {
    const turnedOff = import.meta.env.DEV && window.__repoInPeaceNoOpening === true;
    return firstPassStart(playsOpening(prefersReducedMotion(), turnedOff) ? OPENING_DURATION_MS / 1000 : 0);
  }, []);
  // An event's details are worked out once, when it starts.
  const details = useRef<{ index: number; star?: ReturnType<typeof starPath>; bats?: ReturnType<typeof batFlight>; lightning?: ReturnType<typeof lightningOf> } | null>(null);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = animationTime(clock.elapsedTime);
    const e = skyEventAt(t, first, isReducedMotion());
    skyEventDebug.state = e && e.kind !== 'witch' ? { kind: e.kind, index: e.index, elapsed: e.elapsed } : null;
    m.visible = e !== null && e.kind !== 'witch';
    if (!e || e.kind === 'witch') return;
    if (details.current?.index !== e.index) {
      details.current = { index: e.index };
      if (e.kind === 'star') details.current.star = starPath(e.index);
      if (e.kind === 'bats') details.current.bats = batFlight(e.index);
      if (e.kind === 'lightning') details.current.lightning = lightningOf(e.index);
    }
    const u = assets.material.uniforms;
    u.uKind!.value = KIND_CODE[e.kind];
    u.uSkyTime!.value = t;
    const place = (centre: SkyPoint, halfDeg: number): void => {
      const dir = skyDirection(centre.azimuthDeg, centre.elevationDeg);
      u.uCentre!.value.set(dir.x, dir.y, dir.z).multiplyScalar(SKY_RADIUS * 0.94);
      u.uHalfSize!.value = Math.tan((halfDeg * Math.PI) / 180);
    };
    if (e.kind === 'star') {
      const path = details.current.star!;
      const s = starAt(path, e.elapsed);
      u.uA!.value.copy(flat(s.head));
      u.uB!.value.copy(flat(s.tail));
      u.uLevel!.value = s.brightness;
      const mid = { azimuthDeg: (path.from.azimuthDeg + path.to.azimuthDeg) / 2, elevationDeg: (path.from.elevationDeg + path.to.elevationDeg) / 2 };
      place(mid, Math.hypot((path.to.azimuthDeg - path.from.azimuthDeg) * COS_EL, path.to.elevationDeg - path.from.elevationDeg) / 2 + 1);
    } else if (e.kind === 'bats') {
      const bats = details.current.bats!;
      u.uCount!.value = bats.length;
      let minAz = Infinity;
      let maxAz = -Infinity;
      bats.forEach((bat, i) => {
        const b = batAt(bat, e.elapsed);
        const v = u.uBats!.value[i] as THREE.Vector4;
        if (b === null) v.set(0, 0, 1, 0);
        else v.set(b.at.azimuthDeg * COS_EL, b.at.elevationDeg, b.halfSizeDeg, b.opacity);
        (u.uWings!.value as number[])[i] = b?.wings ?? 0;
        minAz = Math.min(minAz, bat.from.azimuthDeg, bat.to.azimuthDeg);
        maxAz = Math.max(maxAz, bat.from.azimuthDeg, bat.to.azimuthDeg);
      });
      place({ azimuthDeg: (minAz + maxAz) / 2, elevationDeg: MOON_ELEVATION_DEG + 0.5 }, ((maxAz - minAz) * COS_EL) / 2 + 1.5);
    } else {
      const l = details.current.lightning!;
      u.uGlowAt!.value.copy(flat(l.at));
      const level = flashLevel(l, e.elapsed);
      u.uLevel!.value = level;
      const firstFlash = l.flashes[0]!;
      const inFirst = e.elapsed >= firstFlash.start && e.elapsed <= firstFlash.start + firstFlash.duration;
      u.uForkLevel!.value = l.fork !== null && inFirst ? FORK_PEAK * level : 0;
      const fork = l.fork ?? [];
      u.uCount!.value = Math.min(fork.length, FORK_POINTS);
      fork.slice(0, FORK_POINTS).forEach((p, i) => (u.uFork!.value[i] as THREE.Vector2).copy(flat(p)));
      u.uBranchCount!.value = l.branch.length;
      l.branch.forEach((p, i) => (u.uBranch!.value[i] as THREE.Vector2).copy(flat(p)));
      place({ azimuthDeg: l.at.azimuthDeg, elevationDeg: GLOW_CENTRE_DEG + 0.5 }, GLOW_HALF_W_DEG + 1);
    }
  });

  return <mesh ref={mesh} geometry={assets.geometry} material={assets.material} renderOrder={-26} frustumCulled={false} raycast={() => undefined} visible={false} />;
}
