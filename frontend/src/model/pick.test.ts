import { describe, expect, it } from 'vitest';
import { PICK_PADDING, buildPickTargets, pickNearest, rayBoxDistance, type PickTarget } from './pick';
import { STONE_D, STONE_W } from './layout-constants';
import { vec3 } from './vec3';
import { GHOST_D, GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_HEIGHT, GHOST_W } from './visual-constants';

const stone = (path: string, x: number, z: number, height = 2, leanDegrees = 0) => ({ path, x, z, height, leanDegrees });
const ghost = (path: string, x: number, z: number) => ({ path, x, z });

/** A ray along the negative z axis from the front, at the given x and height. */
const fromFront = (x: number, y: number) => ({ origin: vec3(x, y, 50), direction: vec3(0, 0, -1) });

const pick = (targets: PickTarget[], ray: { origin: ReturnType<typeof vec3>; direction: ReturnType<typeof vec3> }) =>
  pickNearest(targets, ray.origin, ray.direction)?.path;

describe('buildPickTargets', () => {
  it('makes an upright stone\'s box from the ground to its height, covering its base and the padding', () => {
    const [t] = buildPickTargets([stone('a.ts', 10, 5, 2)], []);
    expect(t!.kind).toBe('file');
    expect(t!.min.x).toBeCloseTo(10 - STONE_W / 2 - PICK_PADDING, 12);
    expect(t!.min.y).toBe(0);
    expect(t!.min.z).toBeCloseTo(5 - STONE_D / 2 - PICK_PADDING, 12);
    expect(t!.max.x).toBeCloseTo(10 + STONE_W / 2 + PICK_PADDING, 12);
    expect(t!.max.y).toBeCloseTo(2 + PICK_PADDING, 12);
    expect(t!.max.z).toBeCloseTo(5 + STONE_D / 2 + PICK_PADDING, 12);
  });

  it('makes a leaning stone\'s box wider on every side by how far its top reaches', () => {
    const upright = buildPickTargets([stone('a.ts', 0, 0, 4, 0)], [])[0]!;
    const leaning = buildPickTargets([stone('a.ts', 0, 0, 4, 10)], [])[0]!;
    const reach = 4 * Math.sin((10 * Math.PI) / 180);
    expect(leaning.max.x - upright.max.x).toBeCloseTo(reach, 9);
    expect(upright.min.x - leaning.min.x).toBeCloseTo(reach, 9);
    expect(leaning.max.z - upright.max.z).toBeCloseTo(reach, 9);
    expect(leaning.max.y).toBe(upright.max.y);
  });

  it('makes a ghost\'s box cover the whole range it floats through', () => {
    const [t] = buildPickTargets([], [ghost('gone.ts', 3, 4)]);
    expect(t!.kind).toBe('ghost');
    expect(t!.min.y).toBeCloseTo(GHOST_FLOAT_BASE - GHOST_FLOAT_AMPLITUDE, 12);
    expect(t!.max.y).toBeCloseTo(GHOST_FLOAT_BASE + GHOST_HEIGHT + GHOST_FLOAT_AMPLITUDE, 12);
    expect(t!.max.x - t!.min.x).toBeCloseTo(GHOST_W + 2 * PICK_PADDING, 12);
    expect(t!.max.z - t!.min.z).toBeCloseTo(GHOST_D + 2 * PICK_PADDING, 12);
  });

  it('makes one box for every stone and ghost, with its path', () => {
    const targets = buildPickTargets([stone('a.ts', 0, 0), stone('b.ts', 5, 0)], [ghost('c.ts', 10, 0)]);
    expect(targets.map((t) => [t.kind, t.path])).toEqual([['file', 'a.ts'], ['file', 'b.ts'], ['ghost', 'c.ts']]);
  });
});

describe('pickNearest', () => {
  const targets = buildPickTargets([stone('near.ts', 0, 0), stone('far.ts', 0, -10)], []);

  it('finds nothing among no targets', () => {
    expect(pickNearest([], vec3(0, 1, 50), vec3(0, 0, -1))).toBeUndefined();
  });

  it('hits the stone the ray runs into', () => {
    expect(pick(buildPickTargets([stone('a.ts', 0, 0)], []), fromFront(0, 1))).toBe('a.ts');
  });

  it('takes the nearer of two stones in line, not the one that comes first in the list', () => {
    expect(pick(targets, fromFront(0, 1))).toBe('near.ts');
    expect(pick([...targets].reverse(), fromFront(0, 1))).toBe('near.ts');
  });

  it('sees the farther stone when the nearer is not in the way', () => {
    const side = buildPickTargets([stone('near.ts', 5, 0), stone('far.ts', 0, -10)], []);
    expect(pick(side, fromFront(0, 1))).toBe('far.ts');
  });

  it('misses a ray that passes above a stone, and one that passes beside it', () => {
    const one = buildPickTargets([stone('a.ts', 0, 0, 2)], []);
    expect(pick(one, fromFront(0, 3))).toBeUndefined(); // the stone is 2.1 tall with padding
    expect(pick(one, fromFront(1.0, 1))).toBeUndefined(); // half width with padding is 0.6
    expect(pick(one, fromFront(0.55, 1))).toBe('a.ts');
  });

  it('is easier to hit a leaning stone, which is wider', () => {
    const upright = buildPickTargets([stone('a.ts', 0, 0, 4, 0)], []);
    const leaning = buildPickTargets([stone('a.ts', 0, 0, 4, 10)], []);
    expect(pick(upright, fromFront(1.0, 1))).toBeUndefined();
    expect(pick(leaning, fromFront(1.0, 1))).toBe('a.ts');
  });

  it('misses a ray pointing away from every stone', () => {
    expect(pickNearest(targets, vec3(0, 1, 50), vec3(0, 0, 1))).toBeUndefined();
    expect(pickNearest(targets, vec3(0, 50, 0), vec3(0, 1, 0))).toBeUndefined();
  });

  it('misses a stone that is behind the origin', () => {
    expect(pickNearest(buildPickTargets([stone('a.ts', 0, 0)], []), vec3(0, 1, -50), vec3(0, 0, -1))).toBeUndefined();
  });

  it('hits the stone the origin is inside of', () => {
    expect(pick(buildPickTargets([stone('a.ts', 0, 0)], []), { origin: vec3(0, 1, 0), direction: vec3(0, 0, -1) })).toBe('a.ts');
    const [t] = buildPickTargets([stone('a.ts', 0, 0)], []);
    expect(rayBoxDistance(t!, vec3(0, 1, 0), vec3(0, 0, -1))).toBe(0);
  });

  it('handles a ray along an axis, parallel to the faces of the box', () => {
    const one = buildPickTargets([stone('a.ts', 0, 0, 2)], []);
    expect(pick(one, { origin: vec3(-20, 1, 0), direction: vec3(1, 0, 0) })).toBe('a.ts');
    expect(pick(one, { origin: vec3(-20, 3, 0), direction: vec3(1, 0, 0) })).toBeUndefined();
    expect(pick(one, { origin: vec3(-20, 1, 2), direction: vec3(1, 0, 0) })).toBeUndefined();
  });

  it('hits a ghost only within the range it floats through', () => {
    const g = buildPickTargets([], [ghost('gone.ts', 0, 0)]);
    expect(pick(g, fromFront(0, 1))).toBe('gone.ts');
    expect(pick(g, fromFront(0, 0.1))).toBeUndefined(); // below where it floats
    expect(pick(g, fromFront(0, 3))).toBeUndefined(); // above it
  });

  it('hits a ghost where it floats, and not in the empty space between it and the ground', () => {
    // `fromFront` looks horizontally, at the given height, through the ghost's x and z.
    const g = buildPickTargets([], [ghost('gone.ts', 0, 0)]);
    const base = GHOST_FLOAT_BASE;
    expect(pick(g, fromFront(0, base + GHOST_HEIGHT / 2))).toBe('gone.ts'); // the middle of the body you see
    expect(pick(g, fromFront(0, base + 0.05))).toBe('gone.ts'); // just above its lower edge
    expect(pick(g, fromFront(0, base - GHOST_FLOAT_AMPLITUDE - 0.05))).toBeUndefined(); // the gap underneath
    expect(pick(g, fromFront(0, 0.1))).toBeUndefined(); // at the ground
  });

  it('finds a ghost behind a stone only when the stone is not in the way', () => {
    const both = buildPickTargets([stone('a.ts', 0, 5, 3)], [ghost('gone.ts', 0, 0)]);
    expect(pick(both, fromFront(0, 1))).toBe('a.ts');
    expect(pick(both, fromFront(0, 3.5))).toBeUndefined(); // over the stone and over the ghost
  });

  it('gives a tie to the smaller path, whatever the order', () => {
    const same = [...buildPickTargets([stone('b.ts', 0, 0)], []), ...buildPickTargets([stone('a.ts', 0, 0)], [])];
    expect(pick(same, fromFront(0, 1))).toBe('a.ts');
    expect(pick([...same].reverse(), fromFront(0, 1))).toBe('a.ts');
  });

  it('reaches nothing with a ray that has no direction', () => {
    expect(pickNearest(targets, vec3(0, 1, 0), vec3(0, 0, 0))).toBeUndefined();
  });

  it('does not depend on the length of the direction vector', () => {
    expect(pick(targets, { origin: vec3(0, 1, 50), direction: vec3(0, 0, -250) })).toBe('near.ts');
    expect(pick(targets, { origin: vec3(0, 1, 50), direction: vec3(0, 0, -0.001) })).toBe('near.ts');
  });
});
