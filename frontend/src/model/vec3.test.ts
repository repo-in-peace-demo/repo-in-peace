import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { add, distance, dot, length, lerp, normalize, scale, sub, vec3, type Vec3 } from './vec3';

const coord = fc.double({ min: -1000, max: 1000, noNaN: true });
const vec = fc.record({ x: coord, y: coord, z: coord });

describe('vec3 examples', () => {
  it('adds, subtracts and scales without changing its arguments', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    expect(add(a, b)).toEqual({ x: 5, y: 7, z: 9 });
    expect(sub(b, a)).toEqual({ x: 3, y: 3, z: 3 });
    expect(scale(a, 2)).toEqual({ x: 2, y: 4, z: 6 });
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
    expect(b).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('has the usual dot product, length and distance', () => {
    expect(dot(vec3(1, 2, 3), vec3(4, -5, 6))).toBe(12);
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(distance(vec3(1, 1, 1), vec3(4, 5, 1))).toBe(5);
  });

  it('normalises to length 1, and leaves the zero vector alone', () => {
    expect(length(normalize(vec3(0, 3, 4)))).toBeCloseTo(1, 12);
    expect(normalize(vec3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('finds the point between two points', () => {
    expect(lerp(vec3(0, 0, 0), vec3(10, 20, 30), 0.5)).toEqual({ x: 5, y: 10, z: 15 });
    expect(lerp(vec3(2, 2, 2), vec3(4, 4, 4), 0)).toEqual({ x: 2, y: 2, z: 2 });
    expect(lerp(vec3(2, 2, 2), vec3(4, 4, 4), 1)).toEqual({ x: 4, y: 4, z: 4 });
  });
});

describe('vec3 properties', () => {
  it('has a distance that is symmetric, never negative, and zero from a point to itself', () => {
    fc.assert(
      fc.property(vec, vec, (a: Vec3, b: Vec3) => {
        return distance(a, b) === distance(b, a) && distance(a, b) >= 0 && distance(a, a) === 0;
      }),
    );
  });

  it('normalises any non-zero vector to length 1, in the same direction', () => {
    fc.assert(
      fc.property(vec.filter((v) => length(v) > 1e-6), (v) => {
        const n = normalize(v);
        return Math.abs(length(n) - 1) < 1e-9 && dot(n, v) > 0;
      }),
    );
  });

  it('has a lerp that reaches both ends and lies on the way between', () => {
    fc.assert(
      fc.property(vec, vec, fc.double({ min: 0, max: 1, noNaN: true }), (a, b, t) => {
        const end0 = lerp(a, b, 0);
        const end1 = lerp(a, b, 1);
        const mid = lerp(a, b, t);
        return (
          end0.x === a.x && end0.y === a.y && end0.z === a.z &&
          Math.abs(end1.x - b.x) < 1e-9 && Math.abs(end1.y - b.y) < 1e-9 && Math.abs(end1.z - b.z) < 1e-9 &&
          Math.abs(distance(a, mid) + distance(mid, b) - distance(a, b)) < 1e-6
        );
      }),
    );
  });
});
