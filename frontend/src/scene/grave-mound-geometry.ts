import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MOUND_H, MOUND_HALF_D, MOUND_HALF_W } from '../model/pr-scene';

/**
 * A fresh grave (bury-and-resurrect Req 10.1, revised after review): a long, low, rectangular heap of dark soil, longer front to back
 * (z) than wide, flat-topped with sloping edges, lumpy (its top pushed up and down by a fixed noise), with a few clods around it. The
 * soil's shading varies per vertex (vertex colours), and the faces are flat-shaded, so it reads as turned earth, not a smooth dome.
 * Made once; the same shape for every grave. Deterministic: no Math.random.
 */
const SOIL = new THREE.Color('#3a291b');

/** A small fixed noise in [-1, 1] from a position (a hash of sines, as in many shaders). */
const noise = (x: number, z: number, salt: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
  return 2 * (s - Math.floor(s)) - 1;
};
const smoothNoise = (x: number, z: number): number => 0.55 * Math.sin(x * 11.3 + z * 4.1) * Math.cos(z * 9.7 - x * 3.3) + 0.45 * noise(Math.round(x * 14), Math.round(z * 14), 1);

function shade(geometry: THREE.BufferGeometry, salt: number): void {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const k = 0.72 + 0.4 * (0.5 + 0.5 * noise(position.getX(i), position.getZ(i), salt + position.getY(i) * 3));
    c.copy(SOIL).multiplyScalar(k);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function makeGraveMoundGeometry(): THREE.BufferGeometry {
  // The heap: a box with a fine top, its top vertices raised to a flat-topped profile with sloping edges, then lumped.
  const heap = new THREE.BoxGeometry(2 * MOUND_HALF_W, 1, 2 * MOUND_HALF_D, 10, 1, 18).toNonIndexed();
  heap.translate(0, 0.5, 0);
  const p = heap.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    if (p.getY(i) < 0.5) {
      p.setY(i, 0);
      continue;
    }
    const ex = Math.min(1, Math.abs(x) / MOUND_HALF_W);
    const ez = Math.min(1, Math.abs(z) / MOUND_HALF_D);
    // 1 across the middle, falling to about 0.2 at the long sides and the ends: a low rectangular heap, not a dome.
    const profile = (1 - Math.pow(ex, 3)) * (1 - Math.pow(ez, 5));
    const h = MOUND_H * (0.2 + 0.8 * profile) + 0.03 * smoothNoise(x, z) * (0.4 + profile);
    p.setXYZ(i, x * (1 - 0.12 * (h / MOUND_H)), Math.max(0.01, h), z * (1 - 0.05 * (h / MOUND_H)));
  }
  heap.computeVertexNormals();
  shade(heap, 2);

  // A few clods: small rough lumps on the heap and at its foot.
  const spots: Array<[number, number, number, number]> = [
    [0.18, 0.2, 0.06, 1],
    [-0.15, -0.35, 0.05, 2],
    [0.05, 0.48, 0.045, 3],
    [-0.47, 0.25, 0.055, 4],
    [0.49, -0.1, 0.05, 5],
    [0.36, 0.7, 0.045, 6],
    [-0.3, 0.74, 0.04, 7],
    [-0.08, 0.05, 0.05, 8],
  ];
  const clods = spots.map(([x, z, r, salt]) => {
    const g = new THREE.DodecahedronGeometry(r, 0);
    g.scale(1 + 0.3 * noise(x, z, salt), 0.7, 1 - 0.2 * noise(z, x, salt));
    const onHeap = Math.abs(x) < MOUND_HALF_W * 0.85 && Math.abs(z) < MOUND_HALF_D * 0.85;
    g.translate(x, onHeap ? MOUND_H * 0.95 + r * 0.3 : r * 0.4, z);
    shade(g, salt);
    return g;
  });

  const merged = mergeGeometries([heap, ...clods], false)!;
  for (const g of [heap, ...clods]) g.dispose();
  return merged;
}
