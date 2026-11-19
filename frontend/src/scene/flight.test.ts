import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { interpolatePose, type CameraPose } from '../model/camera-pose';
import { vec3 } from '../model/vec3';
import { FLIGHT_DURATION_MS, IDLE, cancelFlight, startFlight, stepFlight } from './flight';

const a: CameraPose = { position: vec3(0, 10, 0), target: vec3(0, 0, -10) };
const b: CameraPose = { position: vec3(100, 20, 50), target: vec3(100, 2, 40) };

describe('a flight', () => {
  it('takes one second', () => {
    expect(FLIGHT_DURATION_MS).toBe(1000);
  });

  it('is at the start pose at the moment it starts', () => {
    const state = startFlight(a, b, 5000);
    const step = stepFlight(state, 5000);
    expect(step.pose).toEqual(a);
    expect(step.state.phase).toBe('flying');
  });

  it('is on its way part of the way through, at the eased position', () => {
    const state = startFlight(a, b, 5000);
    const step = stepFlight(state, 5500);
    expect(step.pose).toEqual(interpolatePose(a, b, 0.5));
    expect(step.state).toBe(state); // nothing changes while it flies
  });

  it('is at the end pose, exactly, and over, after a second', () => {
    const state = startFlight(a, b, 5000);
    const step = stepFlight(state, 6000);
    expect(step.pose).toBe(b);
    expect(step.state).toBe(IDLE);
  });

  it('is over, at the end pose, however late the next frame comes', () => {
    const step = stepFlight(startFlight(a, b, 0), 90_000);
    expect(step.pose).toBe(b);
    expect(step.state.phase).toBe('idle');
  });

  it('does not move the camera once it is over', () => {
    const over = stepFlight(startFlight(a, b, 0), 2000).state;
    expect(stepFlight(over, 3000)).toEqual({ state: IDLE, pose: undefined });
  });

  it('has no pose while idle, and stays idle', () => {
    expect(stepFlight(IDLE, 123)).toEqual({ state: IDLE, pose: undefined });
  });

  it('counts a clock that has gone backwards as the start', () => {
    const step = stepFlight(startFlight(a, b, 5000), 4000);
    expect(step.pose).toEqual(a);
    expect(step.state.phase).toBe('flying');
  });

  it('ends where it is when cancelled, and then has no pose to put the camera in', () => {
    const state = startFlight(a, b, 0);
    expect(stepFlight(state, 300).pose).toBeDefined();
    const cancelled = cancelFlight();
    expect(cancelled).toBe(IDLE);
    expect(stepFlight(cancelled, 400).pose).toBeUndefined();
  });

  it('is replaced by a new flight, which starts from its own start pose at its own start time', () => {
    const first = startFlight(a, b, 0);
    const second = startFlight(b, a, 400);
    expect(stepFlight(second, 400).pose).toEqual(b);
    expect(stepFlight(second, 1400).pose).toBe(a);
    expect(stepFlight(first, 400).pose).not.toEqual(b); // the old one is simply not used any more
  });

  it('does not change the poses it is given', () => {
    const before = JSON.stringify([a, b]);
    stepFlight(startFlight(a, b, 0), 500);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe('a flight at any time', () => {
  const coord = fc.double({ min: -500, max: 500, noNaN: true });
  const pose: fc.Arbitrary<CameraPose> = fc.record({
    position: fc.record({ x: coord, y: fc.double({ min: 1, max: 200, noNaN: true }), z: coord }),
    target: fc.record({ x: coord, y: fc.double({ min: 0, max: 20, noNaN: true }), z: coord }),
  });

  it('gives the interpolated pose for the share of the second that has passed, and ends exactly at the end', () => {
    // Whole milliseconds, so that (start + elapsed) - start is exactly elapsed.
    fc.assert(
      fc.property(pose, pose, fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 1_000_000 }), (from, to, elapsed, startedAt) => {
        const step = stepFlight(startFlight(from, to, startedAt), startedAt + elapsed);
        if (elapsed >= FLIGHT_DURATION_MS) return step.pose === to && step.state.phase === 'idle';
        return JSON.stringify(step.pose) === JSON.stringify(interpolatePose(from, to, elapsed / FLIGHT_DURATION_MS)) && step.state.phase === 'flying';
      }),
    );
  });

  it('always keeps the camera above the ground on the way, when both ends are above it', () => {
    fc.assert(
      fc.property(pose, pose, fc.double({ min: 0, max: 1500, noNaN: true }), (from, to, elapsed) => {
        const step = stepFlight(startFlight(from, to, 0), elapsed);
        return step.pose !== undefined && step.pose.position.y > 0;
      }),
    );
  });
});
