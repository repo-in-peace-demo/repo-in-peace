import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SKY_RADIUS, skyDirection } from '../model/atmosphere';
import { OPENING_DURATION_MS } from '../model/framing';
import { playsOpening } from '../model/opening-move';
import { WITCH_VIEWBOX, witchSvg } from '../model/witch-drawing';
import { WITCH_HALF_SIZE_DEG, firstPassStart, type WitchState } from '../model/witch';
import { witchAt } from '../model/sky-director';
import { animationTime, isReducedMotion } from './animation-clock';
import { CLOUD_GLSL } from './cloud-glsl';
import { MOON_DIRECTION } from '../model/atmosphere';
import { prefersReducedMotion } from './reduced-motion';

/**
 * The witch on her broom (model/witch.ts): an ambient sky element, decoration and not data, so not in the legend. A flat dark
 * silhouette of our own design, the same drawing as the landing page's (model/witch-drawing.ts), rasterised once into a texture and
 * drawn on one screen-space quad like the moon's, so she is the same size and shape anywhere in the frame.
 * One draw call, one small texture. Drawn in the sky (behind everything, no depth), so the forest and the graveyard always cover her, and
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
uniform sampler2D uDrawing;
uniform float uAspect; // the drawing's height over its width
varying vec2 vP;
varying vec3 vDirection;
${CLOUD_GLSL}
void main() {
  // The drawing (model/witch-drawing.ts) fills the quad's width; its height is the quad's times uAspect, centred.
  vec2 uv = vec2(0.5 + 0.5 * vP.x, 0.5 + 0.5 * vP.y / uAspect);
  if (uv.y < 0.0 || uv.y > 1.0) discard;
  // The wind: the bristles (the back fifth) and the cloak and hair (behind her shoulders, above the broom) ripple a little.
  float back = 1.0 - smoothstep(0.12, 0.22, uv.x);
  float cloak = smoothstep(0.28, 0.4, uv.x) * (1.0 - smoothstep(0.5, 0.58, uv.x)) * smoothstep(0.38, 0.5, uv.y);
  uv.y += (back * 0.012 + cloak * 0.008) * sin(uTime * 11.0 + uv.x * 40.0);
  float alpha = texture2D(uDrawing, uv).a;
  // As if through clouds: she fades in and out, and the drifting clouds in front of her cover her, more the more she has faded.
  float cover = cloudCover(cloudField(normalize(vDirection), uSkyTime)) * cloudAround(normalize(vDirection), uMoonDirection);
  alpha *= uOpacity * (1.0 - cover * (0.45 + 0.5 * (1.0 - uOpacity)));
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(0.025, 0.03, 0.045, alpha * 0.96);
}
`;

/** The shared drawing, rasterised once into a texture (transparent until the image has loaded, a frame or two). */
function witchTexture(): THREE.CanvasTexture {
  const width = 512;
  const height = Math.round((width * WITCH_VIEWBOX.h) / WITCH_VIEWBOX.w);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  const image = new Image();
  image.onload = () => {
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    texture.needsUpdate = true;
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(witchSvg(width, height))}`;
  return texture;
}

export function Witch() {
  const mesh = useRef<THREE.Mesh>(null);
  const assets = useMemo(() => {
    const drawing = witchTexture();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uCentre: { value: new THREE.Vector3() },
        uHalfSize: { value: Math.tan((WITCH_HALF_SIZE_DEG * Math.PI) / 180) },
        uTime: { value: 0 },
        uSkyTime: { value: 0 },
        uOpacity: { value: 0 },
        uMoonDirection: { value: new THREE.Vector3(MOON_DIRECTION.x, MOON_DIRECTION.y, MOON_DIRECTION.z) },
        uDrawing: { value: drawing },
        uAspect: { value: WITCH_VIEWBOX.h / WITCH_VIEWBOX.w },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    return { material, drawing, geometry: new THREE.PlaneGeometry(2, 2) };
  }, []);
  useEffect(
    () => () => {
      assets.material.dispose();
      assets.geometry.dispose();
      assets.drawing.dispose();
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
