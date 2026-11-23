import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SKY_RADIUS, skyDirection } from '../model/atmosphere';
import { OPENING_DURATION_MS } from '../model/framing';
import { playsOpening } from '../model/opening-move';
import { WITCH_HALF_SIZE_DEG, firstPassStart, type WitchState } from '../model/witch';
import { witchAt } from '../model/sky-director';
import { animationTime, isReducedMotion } from './animation-clock';
import { CLOUD_GLSL } from './cloud-glsl';
import { MOON_DIRECTION } from '../model/atmosphere';
import { prefersReducedMotion } from './reduced-motion';

/**
 * The witch on her broom (model/witch.ts): an ambient sky element, decoration and not data, so not in the legend. A flat dark
 * silhouette of our own design, drawn in the fragment shader from simple shapes (a stick, bristles, a body, a head, a pointed hat with
 * a brim, and a trailing cloak), on one screen-space quad like the moon's, so she is the same size and shape anywhere in the frame.
 * One draw call, no texture. Drawn in the sky (behind everything, no depth), so the forest and the graveyard always cover her, and
 * picking never sees her (picking uses the layout's boxes only).
 */
export const witchDebug: { state: WitchState | null } = { state: null };

const VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uHalfSize;
varying vec2 vP;
varying vec3 vDirection; // this corner's direction on the sky, for the clouds in front of her
void main() {
  vP = position.xy; // -1 to 1, x to the right on screen
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vDirection = normalize(normalize(uCentre) + (right * position.x + up * position.y) * uHalfSize);
  vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(uCentre, 1.0);
  clip.xy += position.xy * uHalfSize * vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * clip.w;
  gl_Position = clip;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSkyTime; // the sky's clock, so the clouds over her are the clouds drawn
uniform float uOpacity;
uniform vec3 uMoonDirection;
varying vec2 vP;
varying vec3 vDirection;
${CLOUD_GLSL}
float segment(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float ellipse(vec2 p, vec2 c, vec2 r) { return (length((p - c) / r) - 1.0) * min(r.x, r.y); }
float triangle(vec2 p, vec2 a, vec2 b, vec2 c) {
  // Signed distance to a triangle (negative inside).
  vec2 e0 = b - a, e1 = c - b, e2 = a - c;
  vec2 v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
void main() {
  vec2 p = vP;
  float flutter = sin(uTime * 11.0 + p.x * 9.0) * 0.025;
  // The broomstick, slightly raised to the front, and the bristles fanning out behind, fluttering at their tips.
  float d = segment(p, vec2(-0.62, -0.08), vec2(0.86, 0.06), 0.022);
  for (int i = 0; i < 7; i++) {
    float k = float(i) / 6.0 - 0.5;
    vec2 tip = vec2(-0.98, -0.1 + k * 0.34 + flutter * (1.0 + abs(k) * 2.0));
    d = min(d, segment(p, vec2(-0.6, -0.08 + k * 0.05), tip, 0.018));
  }
  d = min(d, ellipse(p, vec2(-0.6, -0.08), vec2(0.05, 0.075))); // the binding
  // The rider: body leaning forward, head, a pointed hat bent back at the tip, its brim.
  d = min(d, ellipse(p, vec2(0.02, 0.1), vec2(0.17, 0.16)));
  d = min(d, ellipse(p, vec2(0.13, 0.33), vec2(0.075, 0.08)));
  d = min(d, ellipse(p, vec2(0.12, 0.4), vec2(0.2, 0.03)));
  d = min(d, triangle(p, vec2(0.02, 0.41), vec2(0.23, 0.41), vec2(-0.02, 0.72)));
  d = min(d, segment(p, vec2(-0.02, 0.71), vec2(-0.14, 0.76), 0.022));
  // An arm to the stick, and a leg hanging below it.
  d = min(d, segment(p, vec2(0.08, 0.18), vec2(0.36, 0.03), 0.035));
  d = min(d, segment(p, vec2(0.0, -0.02), vec2(0.14, -0.2), 0.04));
  // The cloak, trailing behind from the shoulders and rippling.
  vec2 c1 = vec2(-0.5, 0.2 + flutter * 3.0), c2 = vec2(-0.38, 0.0 + flutter * 2.0);
  d = min(d, triangle(p, vec2(0.08, 0.27), vec2(-0.02, 0.0), c1));
  d = min(d, triangle(p, vec2(-0.02, 0.0), c2, c1));
  float edge = fwidth(d) + 0.004;
  float alpha = 1.0 - smoothstep(-edge, edge, d);
  // As if through clouds: she fades in and out, and the drifting clouds in front of her cover her, more the more she has faded.
  float cover = cloudCover(cloudField(normalize(vDirection), uSkyTime)) * cloudAround(normalize(vDirection), uMoonDirection);
  alpha *= uOpacity * (1.0 - cover * (0.45 + 0.5 * (1.0 - uOpacity)));
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(0.025, 0.03, 0.045, alpha * 0.96);
}
`;

export function Witch() {
  const mesh = useRef<THREE.Mesh>(null);
  const assets = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uCentre: { value: new THREE.Vector3() },
        uHalfSize: { value: Math.tan((WITCH_HALF_SIZE_DEG * Math.PI) / 180) },
        uTime: { value: 0 },
        uSkyTime: { value: 0 },
        uOpacity: { value: 0 },
        uMoonDirection: { value: new THREE.Vector3(MOON_DIRECTION.x, MOON_DIRECTION.y, MOON_DIRECTION.z) },
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
      witchDebug.state = null;
    },
    [assets],
  );
  // When the first pass starts: as the opening move settles (it plays only without reduced motion, and the browser tests turn it off).
  const first = useMemo(() => {
    const turnedOff = import.meta.env.DEV && window.__repoInPeaceNoOpening === true;
    return firstPassStart(playsOpening(prefersReducedMotion(), turnedOff) ? OPENING_DURATION_MS / 1000 : 0);
  }, []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = animationTime(clock.elapsedTime);
    const state = witchAt(t, first, isReducedMotion());
    witchDebug.state = state;
    m.visible = state !== null;
    if (!state) return;
    const d = skyDirection(state.azimuthDeg, state.elevationDeg);
    assets.material.uniforms.uCentre!.value.set(d.x, d.y, d.z).multiplyScalar(SKY_RADIUS * 0.94);
    assets.material.uniforms.uTime!.value = t;
    assets.material.uniforms.uSkyTime!.value = t; // the sky uses the same animation time
    assets.material.uniforms.uOpacity!.value = state.opacity;
  });

  return <mesh ref={mesh} geometry={assets.geometry} material={assets.material} renderOrder={-27} frustumCulled={false} raycast={() => undefined} visible={false} />;
}
