import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MOUND_H, MOUND_HALF_D, MOUND_HALF_W } from '../model/pr-scene';

/**
 * A fresh grave (bury-and-resurrect Req 10.1, revised after review): a long, low, rectangular heap of dark soil, longer front to back
 * (z) than wide, flat-topped with sloping edges, lumpy (its top pushed up and down by a fixed noise), with a few clods around it. The
 * soil's shading varies per vertex (vertex colours), and the faces are flat-shaded, so it reads as turned earth, not a smooth dome.
 * Made once; the same shape for every grave. Deterministic: no Math.random.
 */
// Second review: #3a291b read as a black hole under the moonlight; this stays darker than the grass but shows as soil.
const SOIL = new THREE.Color('#6a4b30');

/** A small fixed noise in [-1, 1] from a position (a hash of sines, as in many shaders). */
const noise = (x: number, z: number, salt: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
  return 2 * (s - Math.floor(s)) - 1;
};
const smoothNoise = (x: number, z: number): number => 0.55 * Math.sin(x * 11.3 + z * 4.1) * Math.cos(z * 9.7 - x * 3.3) + 0.45 * noise(Math.round(x * 14), Math.round(z * 14), 1);

function shade(geometry: THREE.BufferGeometry, salt: number, lift = 1): void {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    // Lighter on top (catching the moonlight), darker at the foot; noisy, so the soil looks turned.
    const top = Math.min(1, position.getY(i) / MOUND_H);
    const k = 0.6 + 0.35 * top + 0.35 * (0.5 + 0.5 * noise(position.getX(i), position.getZ(i), salt + position.getY(i) * 3));
    c.copy(SOIL).multiplyScalar(k * lift);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function makeGraveMoundGeometry(): THREE.BufferGeometry {
  // The heap: a grid over the grave's footprint, raised to a heaped profile that meets the ground at every edge, so its long sides
  // and its ends slope like piled earth (third review: the first version stood on near-vertical walls and read as a box).
  const heap = new THREE.PlaneGeometry(2 * MOUND_HALF_W, 2 * MOUND_HALF_D, 16, 24);
  heap.rotateX(-Math.PI / 2);
  const p = heap.getAttribute('position');
  const SIDE = 0.45; // the share of each half-width given to the slope; the rest is the rounded crest
  const END = 0.3;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const ex = Math.abs(x) / MOUND_HALF_W;
    const ez = Math.abs(z) / MOUND_HALF_D;
    const across = ex < 1 - SIDE ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (ex - (1 - SIDE))) / SIDE);
    const along = ez < 1 - END ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (ez - (1 - END))) / END);
    const crown = 1 - 0.18 * ex * ex; // a little higher along the middle line
    const profile = across * along * crown;
    const h = MOUND_H * profile + 0.035 * smoothNoise(x, z) * profile;
    p.setY(i, Math.max(0, h));
  }
  heap.deleteAttribute('uv');
  const heapFaces = heap.toNonIndexed(); // the clods are not indexed, and merging needs all alike
  heap.dispose();
  heapFaces.computeVertexNormals();
  shade(heapFaces, 2);

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
    const onHeap = Math.abs(x) < MOUND_HALF_W * 0.6 && Math.abs(z) < MOUND_HALF_D * 0.7;
    g.translate(x, onHeap ? MOUND_H * 0.9 + r * 0.3 : r * 0.4, z);
    g.deleteAttribute('uv');
    // The soil's own colour, a little lighter: lumps of the same earth catching the light (third review: they read as black dots).
    shade(g, salt, 1.25);
    return g;
  });

  const merged = mergeGeometries([heapFaces, ...clods], false)!;
  for (const g of [heapFaces, ...clods]) g.dispose();
  return merged;
}
