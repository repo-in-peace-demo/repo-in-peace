import type * as THREE from 'three';

/**
 * The lens shift of `model/framing.ts` on a three.js camera: the picture is moved down by `shift` of the frame's height, as a
 * shift lens does, with `setViewOffset`. The camera then renders the part of a larger, unshifted picture that starts `shift` of
 * the height above its top, so every point shows `shift` lower. Everything that projects through the camera (`project`,
 * `Raycaster.setFromCamera`) sees the shift too. `width` and `height` are the size of the canvas, in any unit.
 */
export function applyLensShift(camera: THREE.PerspectiveCamera, shift: number, width: number, height: number): void {
  if (!(width > 0 && height > 0) || !Number.isFinite(shift)) return;
  if (shift === 0) {
    camera.clearViewOffset(); // also sets the projection again
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    return;
  }
  // Also sets camera.aspect to width / height and the projection matrix.
  camera.setViewOffset(width, height, 0, -shift * height, width, height);
}
