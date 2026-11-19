import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CameraPose } from './camera-pose';
import {
  FAST_KEY_CODES,
  FLY_FAST_FACTOR,
  FLY_KEY_CODES,
  MIN_CAMERA_HEIGHT,
  WANDER_MARGIN_SHARE,
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
  const limits: CameraLimits = { area: { x: -50, z: -50, w: 100, d: 100 }, minCameraHeight: 1, maxCameraHeight: 100, maxTargetHeight: 4 };
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
    })
    .map(({ x, z, w, d, minCameraHeight, room, maxTargetHeight }) => ({
      area: { x, z, w, d },
      minCameraHeight,
      maxCameraHeight: minCameraHeight + room,
      maxTargetHeight,
    }));
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
    const insidePose = limitsArb.chain((l) =>
      fc
        .record({
          position: fc.record({ x: coord(2000), y: fc.double({ min: l.minCameraHeight, max: l.maxCameraHeight, noNaN: true }), z: coord(2000) }),
          target: fc.record({
            x: fc.double({ min: l.area.x, max: l.area.x + l.area.w, noNaN: true }),
            y: fc.double({ min: 0, max: l.maxTargetHeight, noNaN: true }),
            z: fc.double({ min: l.area.z, max: l.area.z + l.area.d, noNaN: true }),
          }),
        })
        .map((pose) => ({ pose, l })),
    );
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
    const sidewaysOnly = limitsArb.chain((l) =>
      fc
        .record({
          position: fc.record({ x: coord(2000), y: fc.double({ min: l.minCameraHeight, max: l.maxCameraHeight, noNaN: true }), z: coord(2000) }),
          target: fc.record({ x: coord(2000), y: fc.double({ min: 0, max: l.maxTargetHeight, noNaN: true }), z: coord(2000) }),
        })
        .map((pose) => ({ pose, l })),
    );
    fc.assert(
      fc.property(sidewaysOnly, ({ pose, l }) => {
        const next = clampPose(pose, l);
        const before = sub(pose.target, pose.position);
        const after = sub(next.target, next.position);
        // Heights are not touched at all, and the offset from the camera to its look-at point is the same up to rounding.
        return (
          next.position.y === pose.position.y &&
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
