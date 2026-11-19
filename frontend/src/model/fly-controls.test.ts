import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CameraPose } from './camera-pose';
import {
  FAST_KEY_CODES,
  FLY_FAST_FACTOR,
  FLY_KEY_CODES,
  MIN_CAMERA_HEIGHT,
  flySpeed,
  isFast,
  isTypingElement,
  moveCamera,
  movementFromKeys,
  type FlyInput,
} from './fly-controls';
import { distance, length, sub, vec3 } from './vec3';

const keys = (...codes: string[]): ReadonlySet<string> => new Set(codes);
const WIDE = { x: -1000, z: -1000, w: 2000, d: 2000 };

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
    expect(moveCamera(pose, heading, none, 10, 1, WIDE)).toBe(pose);
    expect(moveCamera(pose, heading, { ...none, forward: 1 }, 0, 1, WIDE)).toBe(pose);
    expect(moveCamera(pose, heading, { ...none, forward: 1 }, 10, 0, WIDE)).toBe(pose);
  });

  it('moves forward along the ground in the direction the camera faces, ignoring how steeply it looks down', () => {
    const next = moveCamera(pose, heading, { ...none, forward: 1 }, 10, 1, WIDE);
    expect(next.target.x).toBeCloseTo(0, 12);
    expect(next.target.z).toBeCloseTo(-10, 12);
    expect(next.target.y).toBe(0);
    expect(next.position.y).toBe(20);
  });

  it('moves right of the way the camera faces', () => {
    const next = moveCamera(pose, heading, { ...none, right: 1 }, 10, 1, WIDE);
    expect(next.target.x).toBeCloseTo(10, 12);
    expect(next.target.z).toBeCloseTo(0, 12);
  });

  it('turns with the camera: facing east, forward is east and right is south', () => {
    const east = vec3(1, 0, 0);
    const ahead = moveCamera(pose, east, { ...none, forward: 1 }, 10, 1, WIDE);
    expect(ahead.target.x).toBeCloseTo(10, 12);
    const right = moveCamera(pose, east, { ...none, right: 1 }, 10, 1, WIDE);
    expect(right.target.z).toBeCloseTo(10, 12);
  });

  it('moves the camera and the point it looks at by the same amount', () => {
    const next = moveCamera(pose, heading, { forward: 1, right: 1, up: 1 }, 10, 0.5, WIDE);
    const cameraMoved = sub(next.position, pose.position);
    const targetMoved = sub(next.target, pose.target);
    expect(cameraMoved.x).toBeCloseTo(targetMoved.x, 12);
    expect(cameraMoved.y).toBeCloseTo(targetMoved.y, 12);
    expect(cameraMoved.z).toBeCloseTo(targetMoved.z, 12);
  });

  it('goes no faster diagonally, or in all three directions, than straight', () => {
    const straight = length(sub(moveCamera(pose, heading, { ...none, forward: 1 }, 10, 1, WIDE).position, pose.position));
    const diagonal = length(sub(moveCamera(pose, heading, { ...none, forward: 1, right: 1 }, 10, 1, WIDE).position, pose.position));
    const all = length(sub(moveCamera(pose, heading, { forward: 1, right: 1, up: 1 }, 10, 1, WIDE).position, pose.position));
    expect(straight).toBeCloseTo(10, 9);
    expect(diagonal).toBeCloseTo(10, 9);
    expect(all).toBeCloseTo(10, 9);
  });

  it('goes up and down', () => {
    expect(moveCamera(pose, heading, { ...none, up: 1 }, 10, 1, WIDE).position.y).toBeCloseTo(30, 12);
    expect(moveCamera(pose, heading, { ...none, up: -1 }, 10, 1, WIDE).position.y).toBeCloseTo(10, 12);
  });

  it('moves further for more time and more speed', () => {
    const base = moveCamera(pose, heading, { ...none, forward: 1 }, 10, 1, WIDE);
    expect(moveCamera(pose, heading, { ...none, forward: 1 }, 10, 2, WIDE).target.z).toBeCloseTo(2 * base.target.z, 12);
    expect(moveCamera(pose, heading, { ...none, forward: 1 }, 30, 1, WIDE).target.z).toBeCloseTo(3 * base.target.z, 12);
  });

  it('uses the negative z direction as forward when the camera looks straight down', () => {
    const next = moveCamera(pose, vec3(0, -1, 0), { ...none, forward: 1 }, 10, 1, WIDE);
    expect(next.target.z).toBeCloseTo(-10, 12);
  });

  it('does the same for a camera that looks down so steeply that its direction along the ground is only rounding error', () => {
    for (const x of [1e-12, 1e-300, 5e-324]) {
      const next = moveCamera(pose, vec3(x, -1, 0), { ...none, forward: 1 }, 10, 1, WIDE);
      expect(next.target.z).toBeCloseTo(-10, 9);
      expect(Number.isFinite(next.position.x) && Number.isFinite(next.position.z)).toBe(true);
    }
  });

  it('copes with a direction made only of the smallest numbers there are', () => {
    const next = moveCamera(pose, vec3(5e-324, 0, 0), { ...none, forward: 1 }, 10, 1, WIDE);
    expect(next.target.x).toBeCloseTo(10, 9); // the direction is still east, however small
    expect(Number.isFinite(next.target.z)).toBe(true);
  });

  it('lets the camera come down even when the point it looks at is already on the ground', () => {
    const onGround: CameraPose = { position: vec3(0, 20, 30), target: vec3(0, 0, 0) };
    const next = moveCamera(onGround, heading, { ...none, up: -1 }, 10, 1, WIDE);
    expect(next.position.y).toBeCloseTo(10, 12);
    expect(next.target.y).toBe(0);
  });

  it('never lets the camera below the minimum height, and never the look-at point below the ground', () => {
    const low: CameraPose = { position: vec3(0, 2, 30), target: vec3(0, 0.5, 0) };
    const next = moveCamera(low, heading, { ...none, up: -1 }, 10, 5, WIDE);
    expect(next.position.y).toBe(MIN_CAMERA_HEIGHT);
    expect(next.target.y).toBe(0);
  });

  it('keeps the look-at point inside the limits, and the camera moves back with it', () => {
    const limits = { x: -5, z: -5, w: 10, d: 10 };
    const next = moveCamera(pose, heading, { ...none, forward: 1 }, 100, 10, limits);
    expect(next.target.z).toBe(-5);
    expect(next.position.z).toBeCloseTo(30 - 5, 12); // the camera stopped with its look-at point
    expect(next.position.x).toBeCloseTo(0, 12);
  });

  it('does not change the pose it is given', () => {
    const before = JSON.stringify(pose);
    moveCamera(pose, heading, { forward: 1, right: 1, up: 1 }, 10, 1, WIDE);
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
  const limits = { x: -150, z: -150, w: 300, d: 300 };

  it('never goes further than speed × time in one step, and keeps the look-at point in the limits and above the ground', () => {
    fc.assert(
      fc.property(poseArb, headingArb, inputArb, fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0, max: 0.5, noNaN: true }), (p, h, input, speed, seconds) => {
        const next = moveCamera(p, h, input, speed, seconds, limits);
        const t = next.target;
        const inside = t.x >= limits.x - 1e-9 && t.x <= limits.x + limits.w + 1e-9 && t.z >= limits.z - 1e-9 && t.z <= limits.z + limits.d + 1e-9;
        // The target of a pose that starts outside the limits is brought back in; one that starts inside stays inside.
        const startsInside = p.target.x >= limits.x && p.target.x <= limits.x + limits.w && p.target.z >= limits.z && p.target.z <= limits.z + limits.d;
        const stepOk = distance(next.target, p.target) <= speed * seconds + 1e-6;
        return (!startsInside || inside) && t.y >= 0 && next.position.y >= MIN_CAMERA_HEIGHT && stepOk && [next.position.x, next.position.y, next.position.z, t.x, t.y, t.z].every(Number.isFinite);
      }),
    );
  });

  it('keeps the camera and its look-at point the same distance apart unless the ground or the limits stop one of them', () => {
    fc.assert(
      fc.property(poseArb, headingArb, inputArb, fc.double({ min: 0.1, max: 100, noNaN: true }), fc.double({ min: 0.01, max: 0.2, noNaN: true }), (p, h, input, speed, seconds) => {
        // Far from the limits and the ground: nothing stops either.
        const high: CameraPose = { position: vec3(p.position.x, p.position.y + 400, p.position.z), target: vec3(p.target.x, p.target.y + 400, p.target.z) };
        const wide = { x: -1e6, z: -1e6, w: 2e6, d: 2e6 };
        const next = moveCamera(high, h, input, speed, seconds, wide);
        return Math.abs(distance(next.position, next.target) - distance(high.position, high.target)) < 1e-6;
      }),
    );
  });
});
