import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HORIZON_FROM_TOP, establishingShot, projectToFrame } from '../model/framing';
import { vec3 } from '../model/vec3';
import { applyLensShift } from './lens-shift';

/** Where three.js draws a point, from 0 to 1 across and down, for this camera. */
function drawnAt(camera: THREE.PerspectiveCamera, x: number, y: number, z: number): { x: number; y: number } {
  const p = new THREE.Vector3(x, y, z).project(camera);
  return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
}

function cameraFor(fovY: number, aspect: number, pose: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }) {
  const camera = new THREE.PerspectiveCamera(fovY, aspect, 0.1, 1e9);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('applyLensShift', () => {
  it('makes three.js draw every point where projectToFrame says, the horizon included, for any lens and window', () => {
    fc.assert(
      fc.property(fc.double({ min: 45, max: 75, noNaN: true }), fc.double({ min: 1, max: 2.4, noNaN: true }), (fovY, aspect) => {
        const bounds = { x: 0, z: 0, w: 120, d: 90 };
        const shot = establishingShot(bounds, fovY, aspect);
        const camera = cameraFor(fovY, aspect, shot.pose);
        applyLensShift(camera, shot.viewShift, 1000 * aspect, 1000);
        const points = [vec3(0, 0, 0), vec3(120, 0, 90), vec3(60, 4, 45), vec3(shot.pose.position.x, shot.pose.position.y, shot.pose.position.z - 1e6)];
        return points.every((p) => {
          const want = projectToFrame(shot.pose, fovY, aspect, shot.viewShift, p)!;
          const got = drawnAt(camera, p.x, p.y, p.z);
          return Math.abs(want.x - got.x) < 1e-6 && Math.abs(want.y - got.y) < 1e-6;
        });
      }),
      { numRuns: 100 },
    );
  });

  it('moves the picture down, so the horizon of the establishing shot comes down to HORIZON_FROM_TOP (the opposite sign would raise it)', () => {
    const shot = establishingShot({ x: 0, z: 0, w: 100, d: 80 }, 60, 1.6);
    expect(shot.viewShift).toBeGreaterThan(0.05);
    const camera = cameraFor(60, 1.6, shot.pose);
    const horizon = () => drawnAt(camera, 50, shot.pose.position.y, -1e6).y;
    expect(horizon()).toBeCloseTo(HORIZON_FROM_TOP - shot.viewShift, 4); // without the shift: higher up, nearer the top edge
    applyLensShift(camera, shot.viewShift, 1600, 1000);
    expect(horizon()).toBeCloseTo(HORIZON_FROM_TOP, 4);
  });

  it('with no shift is the plain camera, and follows a new window size', () => {
    const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 1000);
    applyLensShift(camera, 0.12, 1600, 1000);
    applyLensShift(camera, 0, 800, 1000);
    expect(camera.view === null || camera.view.enabled === false).toBe(true);
    expect(camera.aspect).toBeCloseTo(0.8, 12);
    applyLensShift(camera, 0.12, 2400, 1000);
    expect(camera.aspect).toBeCloseTo(2.4, 12);
    expect(camera.view?.offsetY).toBeCloseTo(-120, 9);
  });
});
