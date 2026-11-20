import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CameraPose } from './camera-pose';
import {
  FAST_KEY_CODES,
  FLY_FAST_FACTOR,
  FLY_KEY_CODES,
  MIN_CAMERA_HEIGHT,
  MIN_TILT_DEG,
  WANDER_MARGIN_SHARE,
  AZIMUTH_OVERHEAD,
  boundsRadius,
  cameraLimits,
  clampPose,
  flySpeed,
  isFast,
  isTypingElement,
  maxCameraDistance,
  moveCamera,
  movementFromKeys,
  type CameraLimits,
  type FlyInput,
} from './fly-controls';
import { MAX_STONE_H } from './layout-constants';
import { distance, length, sub, vec3 } from './vec3';

const keys = (...codes: string[]): ReadonlySet<string> => new Set(codes);

describe('movementFromKeys', () => {
  it('has no movement when no key is down, and ignores keys that do nothing', () => {
    expect(movementFromKeys(keys())).toEqual({ forward: 0, right: 0, up: 0 });
    expect(movementFromKeys(keys('KeyX', 'Space', 'Enter', 'Escape', 'KeyZ'))).toEqual({ forward: 0, right: 0, up: 0 });
  });

  it.each([
    [['KeyW'], { forward: 1, right: 0, up: 0 }],
    [['ArrowUp'], { forward: 1, right: 0, up: 0 }],
    [['KeyS'], { forward: -1, right: 0, up: 0 }],
    [['ArrowDown'], { forward: -1, right: 0, up: 0 }],
    [['KeyD'], { forward: 0, right: 1, up: 0 }],
    [['ArrowRight'], { forward: 0, right: 1, up: 0 }],
    [['KeyA'], { forward: 0, right: -1, up: 0 }],
    [['ArrowLeft'], { forward: 0, right: -1, up: 0 }],
    [['KeyE'], { forward: 0, right: 0, up: 1 }],
    [['KeyQ'], { forward: 0, right: 0, up: -1 }],
  ])('reads %j as %j', (codes, expected) => {
    expect(movementFromKeys(keys(...codes))).toEqual(expected);
  });

  it('adds keys on different axes', () => {
    expect(movementFromKeys(keys('KeyW', 'KeyD', 'KeyE'))).toEqual({ forward: 1, right: 1, up: 1 });
  });

  it('cancels keys that pull opposite ways', () => {
    expect(movementFromKeys(keys('KeyW', 'KeyS'))).toEqual({ forward: 0, right: 0, up: 0 });
    expect(movementFromKeys(keys('KeyA', 'KeyD'))).toEqual({ forward: 0, right: 0, up: 0 });
    expect(movementFromKeys(keys('KeyQ', 'KeyE'))).toEqual({ forward: 0, right: 0, up: 0 });
    expect(movementFromKeys(keys('ArrowUp', 'KeyS'))).toEqual({ forward: 0, right: 0, up: 0 });
  });

  it('counts an arrow and a letter for the same direction once', () => {
    expect(movementFromKeys(keys('KeyW', 'ArrowUp'))).toEqual({ forward: 1, right: 0, up: 0 });
  });

  it('lists exactly the keys that move the camera, and Shift as the fast keys', () => {
    expect([...FLY_KEY_CODES].sort()).toEqual(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyE', 'KeyQ', 'KeyS', 'KeyW']);
    expect(FAST_KEY_CODES).toEqual(['ShiftLeft', 'ShiftRight']);
  });

  it('always gives a movement from -1 to 1 on every axis, for any keys', () => {
    fc.assert(
      fc.property(fc.subarray([...FLY_KEY_CODES, ...FAST_KEY_CODES, 'KeyX']), (codes) => {
        const m = movementFromKeys(new Set(codes));
        return [m.forward, m.right, m.up].every((v) => v >= -1 && v <= 1);
      }),
    );
  });
});

describe('isFast and flySpeed', () => {
  it('is fast while either Shift is down', () => {
    expect(isFast(keys('ShiftLeft'))).toBe(true);
    expect(isFast(keys('ShiftRight', 'KeyW'))).toBe(true);
    expect(isFast(keys('KeyW'))).toBe(false);
  });

  it('is a share of the graveyard\'s size, between 5 and 80 units a second', () => {
    expect(flySpeed(10, false)).toBe(5);
    expect(flySpeed(200, false)).toBeCloseTo(30, 12);
    expect(flySpeed(100_000, false)).toBe(80);
  });

  it('is three times as fast with Shift', () => {
    expect(FLY_FAST_FACTOR).toBe(3);
    expect(flySpeed(200, true)).toBeCloseTo(90, 12);
    expect(flySpeed(10, true)).toBe(15);
  });

  it('never decreases as the graveyard grows', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.double({ min: 0, max: 1e6, noNaN: true }), fc.boolean(), (a, b, fast) => {
        const [small, big] = a <= b ? [a, b] : [b, a];
        return flySpeed(small, fast) <= flySpeed(big, fast);
      }),
    );
  });
});

describe('isTypingElement', () => {
  it.each(['INPUT', 'input', 'TEXTAREA', 'SELECT'])('is true for %s', (tag) => {
    expect(isTypingElement(tag, false)).toBe(true);
  });

  it('is true for an editable element, whatever its tag', () => {
    expect(isTypingElement('DIV', true)).toBe(true);
  });

  it.each(['CANVAS', 'BODY', 'DIV', 'BUTTON', undefined])('is false for %s', (tag) => {
    expect(isTypingElement(tag, false)).toBe(false);
  });
});

describe('moveCamera', () => {
  // Looking toward negative z, from above and behind: forward is negative z, right is positive x.
  const pose: CameraPose = { position: vec3(0, 20, 30), target: vec3(0, 0, 0) };
  const heading = vec3(0, -0.5, -1);
  const none: FlyInput = { forward: 0, right: 0, up: 0 };

  it('does not move without input, speed or time', () => {
    expect(moveCamera(pose, heading, none, 10, 1)).toBe(pose);
    expect(moveCamera(pose, heading, { ...none, forward: 1 }, 0, 1)).toBe(pose);
    expect(moveCamera(pose, heading, { ...none, forward: 1 }, 10, 0)).toBe(pose);
  });

  it('moves forward along the ground in the direction the camera faces, ignoring how steeply it looks down', () => {
    const next = moveCamera(pose, heading, { ...none, forward: 1 }, 10, 1);
    expect(next.target.x).toBeCloseTo(0, 12);
    expect(next.target.z).toBeCloseTo(-10, 12);
    expect(next.target.y).toBe(0);
    expect(next.position.y).toBe(20);
  });

  it('moves right of the way the camera faces', () => {
    const next = moveCamera(pose, heading, { ...none, right: 1 }, 10, 1);
    expect(next.target.x).toBeCloseTo(10, 12);
    expect(next.target.z).toBeCloseTo(0, 12);
  });

  it('turns with the camera: facing east, forward is east and right is south', () => {
    const east = vec3(1, 0, 0);
    const ahead = moveCamera(pose, east, { ...none, forward: 1 }, 10, 1);
    expect(ahead.target.x).toBeCloseTo(10, 12);
    const right = moveCamera(pose, east, { ...none, right: 1 }, 10, 1);
    expect(right.target.z).toBeCloseTo(10, 12);
  });

  it('moves the camera and the point it looks at by the same amount', () => {
    const next = moveCamera(pose, heading, { forward: 1, right: 1, up: 1 }, 10, 0.5);
    const cameraMoved = sub(next.position, pose.position);
    const targetMoved = sub(next.target, pose.target);
    expect(cameraMoved.x).toBeCloseTo(targetMoved.x, 12);
    expect(cameraMoved.y).toBeCloseTo(targetMoved.y, 12);
    expect(cameraMoved.z).toBeCloseTo(targetMoved.z, 12);
  });

  it('goes no faster diagonally, or in all three directions, than straight', () => {
    const straight = length(sub(moveCamera(pose, heading, { ...none, forward: 1 }, 10, 1).position, pose.position));
    const diagonal = length(sub(moveCamera(pose, heading, { ...none, forward: 1, right: 1 }, 10, 1).position, pose.position));
    const all = length(sub(moveCamera(pose, heading, { forward: 1, right: 1, up: 1 }, 10, 1).position, pose.position));
    expect(straight).toBeCloseTo(10, 9);
    expect(diagonal).toBeCloseTo(10, 9);
    expect(all).toBeCloseTo(10, 9);
  });

  it('goes up and down', () => {
    expect(moveCamera(pose, heading, { ...none, up: 1 }, 10, 1).position.y).toBeCloseTo(30, 12);
    expect(moveCamera(pose, heading, { ...none, up: -1 }, 10, 1).position.y).toBeCloseTo(10, 12);
  });

  it('moves further for more time and more speed', () => {
    const base = moveCamera(pose, heading, { ...none, forward: 1 }, 10, 1);
    expect(moveCamera(pose, heading, { ...none, forward: 1 }, 10, 2).target.z).toBeCloseTo(2 * base.target.z, 12);
    expect(moveCamera(pose, heading, { ...none, forward: 1 }, 30, 1).target.z).toBeCloseTo(3 * base.target.z, 12);
  });

  it('uses the negative z direction as forward when the camera looks straight down', () => {
    const next = moveCamera(pose, vec3(0, -1, 0), { ...none, forward: 1 }, 10, 1);
    expect(next.target.z).toBeCloseTo(-10, 12);
  });

  it('does the same for a camera that looks down so steeply that its direction along the ground is only rounding error', () => {
    for (const x of [1e-12, 1e-300, 5e-324]) {
      const next = moveCamera(pose, vec3(x, -1, 0), { ...none, forward: 1 }, 10, 1);
      expect(next.target.z).toBeCloseTo(-10, 9);
      expect(Number.isFinite(next.position.x) && Number.isFinite(next.position.z)).toBe(true);
    }
  });

  it('copes with a direction made only of the smallest numbers there are', () => {
    const next = moveCamera(pose, vec3(5e-324, 0, 0), { ...none, forward: 1 }, 10, 1);
    expect(next.target.x).toBeCloseTo(10, 9); // the direction is still east, however small
    expect(Number.isFinite(next.target.z)).toBe(true);
  });

  it('applies no limit itself: that is clampPose, applied by the scene after every change', () => {
    const next = moveCamera({ position: vec3(0, 2, 30), target: vec3(0, 0.5, 0) }, heading, { ...none, up: -1 }, 10, 5);
    expect(next.position.y).toBeCloseTo(2 - 50, 12);
    expect(next.target.y).toBeCloseTo(0.5 - 50, 12);
  });

  it('moves the camera the way the keys say, facing negative z: right is +x, forward is -z, for arrows and letters alike', () => {
    const go = (code: string) => moveCamera(pose, heading, { ...movementFromKeys(keys(code)) }, 10, 1);
    for (const [arrow, letter, dx, dz] of [
      ['ArrowRight', 'KeyD', 10, 0],
      ['ArrowLeft', 'KeyA', -10, 0],
      ['ArrowUp', 'KeyW', 0, -10],
      ['ArrowDown', 'KeyS', 0, 10],
    ] as const) {
      for (const code of [arrow, letter]) {
        const moved = sub(go(code).position, pose.position);
        expect(moved.x, code).toBeCloseTo(dx, 9);
        expect(moved.z, code).toBeCloseTo(dz, 9);
      }
    }
  });

  it('does not change the pose it is given', () => {
    const before = JSON.stringify(pose);
    moveCamera(pose, heading, { forward: 1, right: 1, up: 1 }, 10, 1);
    expect(JSON.stringify(pose)).toBe(before);
  });
});

describe('moveCamera for any input', () => {
  const coord = fc.double({ min: -300, max: 300, noNaN: true });
  const poseArb: fc.Arbitrary<CameraPose> = fc.record({
    position: fc.record({ x: coord, y: fc.double({ min: 1, max: 300, noNaN: true }), z: coord }),
    target: fc.record({ x: fc.double({ min: -100, max: 100, noNaN: true }), y: fc.double({ min: 0, max: 20, noNaN: true }), z: fc.double({ min: -100, max: 100, noNaN: true }) }),
  });
  const headingArb = fc
    .record({ x: fc.double({ min: -1, max: 1, noNaN: true }), y: fc.double({ min: -1, max: 1, noNaN: true }), z: fc.double({ min: -1, max: 1, noNaN: true }) })
    .filter((v) => Math.hypot(v.x, v.y, v.z) > 0.01);
  const inputArb: fc.Arbitrary<FlyInput> = fc.record({ forward: fc.integer({ min: -1, max: 1 }), right: fc.integer({ min: -1, max: 1 }), up: fc.integer({ min: -1, max: 1 }) });

  it('never goes further than speed × time in one step, and keeps the camera and its look-at point the same distance apart', () => {
    fc.assert(
      fc.property(poseArb, headingArb, inputArb, fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0, max: 0.5, noNaN: true }), (p, h, input, speed, seconds) => {
        const next = moveCamera(p, h, input, speed, seconds);
        const finite = [next.position.x, next.position.y, next.position.z, next.target.x, next.target.y, next.target.z].every(Number.isFinite);
        return (
          finite &&
          distance(next.target, p.target) <= speed * seconds + 1e-6 &&
          Math.abs(distance(next.position, next.target) - distance(p.position, p.target)) < 1e-6
        );
      }),
    );
  });
});

describe('cameraLimits', () => {
  it('gives the root plot plus a quarter radius of margin, the tallest stone, and a ceiling equal to the furthest zoom', () => {
    const bounds = { x: 10, z: -20, w: 300, d: 400 };
    const radius = 250; // half of the 500-unit diagonal
    const margin = 62.5; // a quarter of the radius
    expect(boundsRadius(bounds)).toBeCloseTo(radius, 9);
    const limits = cameraLimits(bounds);
    expect(WANDER_MARGIN_SHARE).toBe(0.25);
    expect(limits.area.x).toBeCloseTo(10 - margin, 9);
    expect(limits.area.z).toBeCloseTo(-20 - margin, 9);
    expect(limits.area.w).toBeCloseTo(300 + 2 * margin, 9);
    expect(limits.area.d).toBeCloseTo(400 + 2 * margin, 9);
    expect(limits.minCameraHeight).toBe(1);
    expect(limits.maxCameraHeight).toBeCloseTo(750, 9); // 3 × 250
    expect(limits.maxCameraHeight).toBe(maxCameraDistance(radius));
    expect(limits.maxTargetHeight).toBe(MAX_STONE_H);
  });

  it('lets the look-at point go no further beyond the root plot than WANDER_MARGIN_SHARE of the radius, on every side', () => {
    fc.assert(
      fc.property(
        fc.record({ x: fc.double({ min: -1e3, max: 1e3, noNaN: true }), z: fc.double({ min: -1e3, max: 1e3, noNaN: true }), w: fc.double({ min: 0, max: 1e4, noNaN: true }), d: fc.double({ min: 0, max: 1e4, noNaN: true }) }),
        (bounds) => {
          const { area } = cameraLimits(bounds);
          const margin = WANDER_MARGIN_SHARE * boundsRadius(bounds);
          const slack = 1e-6 * (1 + margin);
          return (
            area.x <= bounds.x && area.z <= bounds.z && area.x + area.w >= bounds.x + bounds.w && area.z + area.d >= bounds.z + bounds.d &&
            Math.abs(bounds.x - area.x - margin) <= slack && Math.abs(area.x + area.w - (bounds.x + bounds.w) - margin) <= slack &&
            Math.abs(bounds.z - area.z - margin) <= slack && Math.abs(area.z + area.d - (bounds.z + bounds.d) - margin) <= slack
          );
        },
      ),
    );
  });

  it('keeps a ceiling of 100 for a small graveyard, and never has a ceiling below the floor', () => {
    expect(maxCameraDistance(5)).toBe(100);
    expect(cameraLimits({ x: 0, z: 0, w: 10, d: 10 }).maxCameraHeight).toBe(100);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.double({ min: 0, max: 1e6, noNaN: true }), (w, d) => {
        const limits = cameraLimits({ x: 0, z: 0, w, d });
        return limits.maxCameraHeight >= limits.minCameraHeight && limits.area.w >= 0 && limits.area.d >= 0;
      }),
    );
  });
});

describe('clampPose', () => {
  const limits: CameraLimits = { area: { x: -50, z: -50, w: 100, d: 100 }, minCameraHeight: 1, maxCameraHeight: 100, maxTargetHeight: 4, minTiltDeg: 0 };
  const inside: CameraPose = { position: vec3(10, 30, 40), target: vec3(5, 2, -5) };

  it('returns the very same pose when it is inside every limit', () => {
    expect(clampPose(inside, limits)).toBe(inside);
  });

  it('takes the camera along when the look-at point is stopped sideways, so the view slides to a stop', () => {
    const next = clampPose({ position: vec3(10, 30, 40), target: vec3(80, 2, -5) }, limits);
    expect(next.target).toEqual(vec3(50, 2, -5));
    expect(next.position).toEqual(vec3(-20, 30, 40)); // 10 − 30
    const z = clampPose({ position: vec3(0, 30, 90), target: vec3(0, 2, 60) }, limits);
    expect(z.target.z).toBe(50);
    expect(z.position.z).toBe(80);
  });

  it('holds the look-at point between the ground and the tallest stone without moving the camera', () => {
    const high = clampPose({ position: vec3(0, 60, 0), target: vec3(0, 40, 0) }, limits);
    expect(high).toEqual({ position: vec3(0, 60, 0), target: vec3(0, 4, 0) });
    const low = clampPose({ position: vec3(0, 20, 0), target: vec3(0, -7, 0) }, limits);
    expect(low).toEqual({ position: vec3(0, 20, 0), target: vec3(0, 0, 0) });
  });

  it('holds the camera between the floor and the ceiling, whatever moved it (mouse orbit and zoom included)', () => {
    expect(clampPose({ position: vec3(0, 0.06, 5), target: vec3(0, 0, 0) }, limits).position.y).toBe(1);
    expect(clampPose({ position: vec3(0, -3, 5), target: vec3(0, 0, 0) }, limits).position.y).toBe(1);
    expect(clampPose({ position: vec3(0, 400, 5), target: vec3(0, 0, 0) }, limits).position.y).toBe(100);
  });

  it('does not change the pose it is given', () => {
    const before = JSON.stringify({ position: vec3(0, 400, 5), target: vec3(90, 9, 0) });
    const given: CameraPose = { position: vec3(0, 400, 5), target: vec3(90, 9, 0) };
    clampPose(given, limits);
    expect(JSON.stringify(given)).toBe(before);
  });

  it('holding E: the look-at point stops at the tallest stone and the camera keeps rising to the ceiling, and no further', () => {
    const heading = vec3(0, -0.5, -1);
    let pose: CameraPose = { position: vec3(0, 20, 30), target: vec3(0, 0, 0) };
    const seen: number[] = [];
    for (let i = 0; i < 400; i++) {
      pose = clampPose(moveCamera(pose, heading, { forward: 0, right: 0, up: 1 }, 10, 0.1), limits);
      seen.push(pose.position.y);
    }
    expect(pose.target.y).toBe(4);
    expect(pose.position.y).toBe(100);
    expect(Math.max(...seen)).toBe(100);
    // Once the look-at point has stopped, the camera is above it and the view looks down at it.
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
  });

  it('holding Q: the look-at point stops on the ground and the camera comes down to the floor, and no further', () => {
    const heading = vec3(0, -0.5, -1);
    let pose: CameraPose = { position: vec3(0, 20, 30), target: vec3(0, 3, 0) };
    for (let i = 0; i < 400; i++) pose = clampPose(moveCamera(pose, heading, { forward: 0, right: 0, up: -1 }, 10, 0.1), limits);
    expect(pose.target.y).toBe(0);
    expect(pose.position.y).toBe(MIN_CAMERA_HEIGHT);
  });

  it('holding a sideways key at the edge: the camera and look-at point stop together', () => {
    const heading = vec3(0, -0.5, -1);
    let pose: CameraPose = { position: vec3(0, 20, 30), target: vec3(0, 0, 0) };
    for (let i = 0; i < 400; i++) pose = clampPose(moveCamera(pose, heading, { forward: 0, right: 1, up: 0 }, 10, 0.1), limits);
    expect(pose.target.x).toBe(50);
    expect(pose.position.x).toBeCloseTo(50, 9); // the camera started straight behind its look-at point
  });
});

describe('the tilt limit of clampPose', () => {
  const limits: CameraLimits = { area: { x: -500, z: -500, w: 1000, d: 1000 }, minCameraHeight: 1, maxCameraHeight: 200, maxTargetHeight: 4, minTiltDeg: MIN_TILT_DEG };
  const tilt = (p: CameraPose): number => (Math.atan2(p.position.y - p.target.y, Math.hypot(p.position.x - p.target.x, p.position.z - p.target.z)) * 180) / Math.PI;

  it('is 20 degrees for the app', () => {
    expect(MIN_TILT_DEG).toBe(20);
    expect(cameraLimits({ x: 0, z: 0, w: 100, d: 100 }).minTiltDeg).toBe(20);
  });

  it('lifts a camera that is too flat until it is exactly at the limit, and does not move it sideways', () => {
    const flat: CameraPose = { position: vec3(0, 2, 30), target: vec3(0, 0, 0) }; // about 3.8 degrees
    const next = clampPose(flat, limits);
    expect(next.position.x).toBe(0);
    expect(next.position.z).toBe(30);
    expect(tilt(next)).toBeCloseTo(20, 9);
    expect(next.target).toEqual(flat.target);
  });

  it('leaves a camera that is above the limit alone, also straight overhead', () => {
    const high: CameraPose = { position: vec3(0, 40, 30), target: vec3(0, 0, 0) };
    expect(clampPose(high, limits)).toBe(high);
    const overhead: CameraPose = { position: vec3(0, 40, 0), target: vec3(0, 0, 0) };
    expect(clampPose(overhead, limits)).toBe(overhead);
  });

  it('measures from the look-at point: a raised look-at point raises the least height of the camera', () => {
    const next = clampPose({ position: vec3(0, 3, 20), target: vec3(0, 4, 0) }, limits);
    expect(next.position.y).toBeCloseTo(4 + 20 * Math.tan((20 * Math.PI) / 180), 9);
  });

  it('brings the camera in along the ground when the ceiling would stop the lift, so both limits hold', () => {
    const far: CameraPose = { position: vec3(0, 5, 2000), target: vec3(0, 0, 0) };
    const next = clampPose(far, limits);
    expect(next.position.y).toBe(200);
    expect(tilt(next)).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(next.position.z).toBeLessThan(2000);
    expect(next.position.x).toBe(0);
  });

  it('holds when keys lower the camera: Q stops at the 20 degree line, not at the floor', () => {
    const heading = vec3(0, -0.5, -1);
    let pose: CameraPose = { position: vec3(0, 20, 30), target: vec3(0, 3, 0) };
    for (let i = 0; i < 400; i++) pose = clampPose(moveCamera(pose, heading, { forward: 0, right: 0, up: -1 }, 10, 0.1), limits);
    expect(pose.target.y).toBe(0);
    expect(tilt(pose)).toBeCloseTo(20, 6);
    expect(pose.position.y).toBeGreaterThan(MIN_CAMERA_HEIGHT);
  });

  it('is off when minTiltDeg is 0 (the opening move of the app uses this)', () => {
    const flat: CameraPose = { position: vec3(0, 2, 30), target: vec3(0, 0, 0) };
    expect(clampPose(flat, { ...limits, minTiltDeg: 0 })).toBe(flat);
  });
});

describe('clampPose for any pose', () => {
  const coord = (range: number) => fc.double({ min: -range, max: range, noNaN: true });
  const limitsArb: fc.Arbitrary<CameraLimits> = fc
    .record({
      x: coord(500),
      z: coord(500),
      w: fc.double({ min: 0, max: 1000, noNaN: true }),
      d: fc.double({ min: 0, max: 1000, noNaN: true }),
      minCameraHeight: fc.double({ min: 0, max: 10, noNaN: true }),
      room: fc.double({ min: 0, max: 500, noNaN: true }),
      maxTargetHeight: fc.double({ min: 0, max: 10, noNaN: true }),
      minTiltDeg: fc.oneof(fc.constant(0), fc.constant(20), fc.double({ min: 0, max: 60, noNaN: true })),
    })
    .map(({ x, z, w, d, minCameraHeight, room, maxTargetHeight, minTiltDeg }) => ({
      area: { x, z, w, d },
      minCameraHeight,
      // The ceiling is above the highest look-at point, so that some angle above the horizontal is possible at all.
      maxCameraHeight: Math.max(minCameraHeight, maxTargetHeight) + 1 + room,
      maxTargetHeight,
      minTiltDeg,
    }));
  const elevationDeg = (p: CameraPose): number => (Math.atan2(p.position.y - p.target.y, Math.hypot(p.position.x - p.target.x, p.position.z - p.target.z)) * 180) / Math.PI;
  const anyPose: fc.Arbitrary<CameraPose> = fc.record({
    position: fc.record({ x: coord(2000), y: coord(1000), z: coord(2000) }),
    target: fc.record({ x: coord(2000), y: coord(1000), z: coord(2000) }),
  });

  it('P-clamp-1: the result is inside every limit', () => {
    fc.assert(
      fc.property(anyPose, limitsArb, (pose, l) => {
        const { position: c, target: t } = clampPose(pose, l);
        return (
          t.x >= l.area.x && t.x <= l.area.x + l.area.w &&
          t.z >= l.area.z && t.z <= l.area.z + l.area.d &&
          t.y >= 0 && t.y <= l.maxTargetHeight &&
          c.y >= l.minCameraHeight && c.y <= l.maxCameraHeight &&
          [c.x, c.y, c.z, t.x, t.y, t.z].every(Number.isFinite)
        );
      }),
      { numRuns: 500 },
    );
  });

  it('P-clamp-1b: the camera is at least minTiltDeg above the horizontal, seen from the look-at point', () => {
    fc.assert(
      fc.property(anyPose, limitsArb, (pose, l) => {
        const next = clampPose(pose, l);
        // No direction to measure: the camera is on its look-at point, or so nearly above it that the rounding of the coordinates
        // is a large part of the offset.
        const scaleOf = 1 + Math.abs(next.target.x) + Math.abs(next.target.y) + Math.abs(next.target.z);
        const together =
          Math.hypot(next.position.x - next.target.x, next.position.y - next.target.y, next.position.z - next.target.z) < 1e-9 ||
          Math.hypot(next.position.x - next.target.x, next.position.z - next.target.z) <= AZIMUTH_OVERHEAD * scaleOf;
        return l.minTiltDeg === 0 || together || elevationDeg(next) >= l.minTiltDeg - 1e-7;
      }),
      { numRuns: 500 },
    );
  });

  it('P-clamp-2: clamping a clamped pose changes nothing', () => {
    fc.assert(
      fc.property(anyPose, limitsArb, (pose, l) => {
        const once = clampPose(pose, l);
        expect(clampPose(once, l)).toEqual(once);
      }),
      { numRuns: 500 },
    );
  });

  it('P-clamp-3: a pose that is already inside the limits comes back unchanged', () => {
    const insidePose = limitsArb
      .chain((l) =>
        fc
          .record({
            cx: coord(2000),
            cz: coord(2000),
            tx: fc.double({ min: l.area.x, max: l.area.x + l.area.w, noNaN: true }),
            ty: fc.double({ min: 0, max: l.maxTargetHeight, noNaN: true }),
            tz: fc.double({ min: l.area.z, max: l.area.z + l.area.d, noNaN: true }),
            share: fc.double({ min: 0, max: 1, noNaN: true }),
          })
          .map(({ cx, cz, tx, ty, tz, share }) => {
            const lowest = Math.max(l.minCameraHeight, ty + Math.hypot(cx - tx, cz - tz) * Math.tan((l.minTiltDeg * Math.PI) / 180));
            const y = lowest + share * (l.maxCameraHeight - lowest);
            return { pose: { position: vec3(cx, y, cz), target: vec3(tx, ty, tz) } as CameraPose, l, ok: lowest <= l.maxCameraHeight };
          }),
      )
      .filter(({ ok }) => ok);
    fc.assert(
      fc.property(insidePose, ({ pose, l }) => {
        const next = clampPose(pose, l);
        expect(next).toBe(pose);
        expect(next).toEqual(pose);
      }),
      { numRuns: 500 },
    );
  });

  it('P-clamp-4: when only the look-at point is stopped sideways, the camera moves with it and the view direction is unchanged', () => {
    const sidewaysOnly = limitsArb
      .chain((l) =>
        fc
          .record({ cx: coord(2000), cz: coord(2000), tx: coord(2000), ty: fc.double({ min: 0, max: l.maxTargetHeight, noNaN: true }), tz: coord(2000), share: fc.double({ min: 0, max: 1, noNaN: true }) })
          .map(({ cx, cz, tx, ty, tz, share }) => {
            const lowest = Math.max(l.minCameraHeight, ty + Math.hypot(cx - tx, cz - tz) * Math.tan((l.minTiltDeg * Math.PI) / 180));
            const y = lowest + share * (l.maxCameraHeight - lowest);
            return { pose: { position: vec3(cx, y, cz), target: vec3(tx, ty, tz) } as CameraPose, l, ok: lowest <= l.maxCameraHeight };
          }),
      )
      .filter(({ ok }) => ok);
    fc.assert(
      fc.property(sidewaysOnly, ({ pose, l }) => {
        const next = clampPose(pose, l);
        const before = sub(pose.target, pose.position);
        const after = sub(next.target, next.position);
        // Heights are not touched at all, and the offset from the camera to its look-at point is the same up to rounding.
        return (
          Math.abs(next.position.y - pose.position.y) < 1e-9 && // (a sideways shift can change the rounding of a tiny offset)
          next.target.y === pose.target.y &&
          Math.abs(after.x - before.x) < 1e-6 &&
          Math.abs(after.y - before.y) < 1e-6 &&
          Math.abs(after.z - before.z) < 1e-6
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe('clampPose with the scene\'s extra limits (a furthest distance, a circle, a line)', () => {
  const coord = (range: number) => fc.double({ min: -range, max: range, noNaN: true });
  // A graveyard-like setup: the area inside the circle and in front of the line, as the scene's limits are.
  const extrasArb: fc.Arbitrary<CameraLimits> = fc
    .record({
      half: fc.double({ min: 1, max: 300, noNaN: true }),
      ring: fc.double({ min: 1.5, max: 4, noNaN: true }),
      lineShare: fc.double({ min: 0.5, max: 1.4, noNaN: true }),
      maxDistance: fc.double({ min: 5, max: 1500, noNaN: true }),
      minTiltDeg: fc.oneof(fc.constant(0), fc.constant(20)),
      refAngle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      maxDeg: fc.oneof(fc.constant(50), fc.double({ min: 5, max: 170, noNaN: true })),
      withAzimuth: fc.boolean(),
    })
    .map(({ half, ring, lineShare, maxDistance, minTiltDeg, refAngle, maxDeg, withAzimuth }) => ({
      area: { x: -half, z: -half, w: 2 * half, d: 2 * half },
      minCameraHeight: 1,
      maxCameraHeight: 2000,
      maxTargetHeight: 4,
      minTiltDeg,
      maxDistance,
      keepInside: { x: 0, z: 0, radius: half * ring },
      minZ: -half * Math.min(lineShare, ring * 0.99),
      ...(withAzimuth ? { azimuth: { x: Math.sin(refAngle), z: Math.cos(refAngle), maxDeg } } : {}),
    }));
  /** The camera's angle around its look-at point from the reference direction, in degrees, or null when it is right above it. */
  const azimuthOff = (p: CameraPose, a: { x: number; z: number }): number | null => {
    const ox = p.position.x - p.target.x;
    const oz = p.position.z - p.target.z;
    if (Math.hypot(ox, oz) <= AZIMUTH_OVERHEAD * (1 + Math.abs(p.target.x) + Math.abs(p.target.z))) return null; // right above it
    const d = Math.atan2(ox, oz) - Math.atan2(a.x, a.z);
    return Math.abs((Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI);
  };
  const anyPose: fc.Arbitrary<CameraPose> = fc.record({
    position: fc.record({ x: coord(3000), y: coord(1500), z: coord(3000) }),
    target: fc.record({ x: coord(3000), y: coord(1500), z: coord(3000) }),
  });
  const modeArb = fc.constantFrom('pull' as const, 'slide' as const);

  it('P-clamp-7: sliding (a pan or a flight) into the circle or the line stops the view without turning it, when the look-at point can stop there', () => {
    // A pose inside every other limit, slid out past the circle: the camera and the look-at point moved together.
    const slid = extrasArb.chain((l) =>
      fc.record({ angle: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }), back: fc.double({ min: 1, max: 60, noNaN: true }), share: fc.double({ min: 0, max: 0.9, noNaN: true }) }).map(({ angle, back, share }) => {
        const k = l.keepInside!;
        const half = l.area.w / 2;
        const target = vec3(Math.cos(angle) * half * share, 1, Math.sin(angle) * half * share);
        const position = vec3(target.x + Math.cos(angle) * (k.radius + back), 1 + (k.radius + back) * 0.6, target.z + Math.sin(angle) * (k.radius + back));
        return { l, pose: { position, target } as CameraPose };
      }),
    );
    fc.assert(
      fc.property(slid, ({ l, pose }) => {
        const next = clampPose(pose, { ...l, maxDistance: undefined, minZ: undefined, minTiltDeg: 0, azimuth: undefined }, 'slide');
        const before = sub(pose.position, pose.target);
        const after = sub(next.position, next.target);
        const moved = next.target.x !== pose.target.x || next.target.z !== pose.target.z;
        // Either the view slid to a stop with its direction unchanged, or the look-at point could not stop there and the camera came in.
        return !moved || (Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6 && Math.abs(after.z - before.z) < 1e-6);
      }),
      { numRuns: 500 },
    );
  });

  it('P-clamp-8: the camera stays within the orbit angle of the reference direction', () => {
    fc.assert(
      fc.property(anyPose, extrasArb, modeArb, (pose, l, mode) => {
        const off = l.azimuth ? azimuthOff(clampPose(pose, l, mode), l.azimuth) : null;
        return off === null || off <= l.azimuth!.maxDeg + 1e-6;
      }),
      { numRuns: 800 },
    );
  });

  it('P-clamp-8b: turning the camera back within the angle keeps its look-at point, its distance and its height, so its tilt', () => {
    const wide = { area: { x: -1e6, z: -1e6, w: 2e6, d: 2e6 }, minCameraHeight: -1e6, maxCameraHeight: 1e6, maxTargetHeight: 1e6, minTiltDeg: 0 };
    fc.assert(
      fc.property(
        fc.record({ x: coord(3000), y: coord(1500), z: coord(3000) }),
        fc.record({ x: coord(3000), y: fc.double({ min: 0, max: 1000, noNaN: true }), z: coord(3000) }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 5, max: 170, noNaN: true }),
        (position, target, ref, maxDeg) => {
          const pose = { position, target } as CameraPose;
          const next = clampPose(pose, { ...wide, azimuth: { x: Math.sin(ref), z: Math.cos(ref), maxDeg } });
          const dist = (p: CameraPose) => Math.hypot(p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z);
          return next.target === pose.target || (next.target.x === target.x && next.target.y === target.y && next.target.z === target.z)
            ? next.position.y === position.y && Math.abs(dist(next) - dist(pose)) <= 1e-6 * Math.max(1, dist(pose))
            : false;
        },
      ),
      { numRuns: 800 },
    );
  });

  it('P-clamp-5: the camera and its look-at point are inside the circle and in front of the line, and the camera no further than maxDistance', () => {
    fc.assert(
      fc.property(anyPose, extrasArb, modeArb, (pose, l, mode) => {
        const { position: c, target: t } = clampPose(pose, l, mode);
        const k = l.keepInside!;
        return (
          Math.hypot(c.x - k.x, c.z - k.z) <= k.radius + 1e-9 &&
          Math.hypot(t.x - k.x, t.z - k.z) <= k.radius + 1e-9 &&
          c.z >= l.minZ! - 1e-9 &&
          t.z >= l.minZ! - 1e-9 &&
          Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z) <= l.maxDistance! + 1e-9
        );
      }),
      { numRuns: 800 },
    );
  });

  it('P-clamp-6: with them, the tilt limit still holds and clamping a clamped pose changes nothing', () => {
    fc.assert(
      fc.property(anyPose, extrasArb, modeArb, (pose, l, mode) => {
        const once = clampPose(pose, l, mode);
        expect(clampPose(once, l, mode)).toEqual(once);
        const along = Math.hypot(once.position.x - once.target.x, once.position.z - once.target.z);
        const up = once.position.y - once.target.y;
        if (l.minTiltDeg > 0 && along > AZIMUTH_OVERHEAD * (1 + Math.abs(once.target.x) + Math.abs(once.target.z)) && Math.hypot(along, up) > 1e-6 && once.position.y < l.maxCameraHeight) {
          expect((Math.atan2(up, along) * 180) / Math.PI).toBeGreaterThanOrEqual(l.minTiltDeg - 1e-6);
        }
      }),
      { numRuns: 800 },
    );
  });
});
