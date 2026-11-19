import * as THREE from 'three';

/**
 * Small helpers for instanced meshes. Every stone, post, rail and plaque is one instance of one shared shape,
 * so the number of draw calls does not grow with the number of files.
 */

const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const NO_ROTATION = new THREE.Quaternion();

/**
 * A matrix that places a shape at (x, y, z), stretched to the size (sx, sy, sz). The same matrix object is returned
 * every time, so use it at once (`mesh.setMatrixAt` copies it), and do not keep it.
 */
export function placement(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rotation: THREE.Quaternion = NO_ROTATION,
): THREE.Matrix4 {
  position.set(x, y, z);
  scale.set(sx, sy, sz);
  return matrix.compose(position, rotation, scale);
}

/** Meshes the scene draws only: nothing in it is picked by three.js. Picking is done from the layout (model/pick.ts). */
export const noRaycast = (): void => undefined;
