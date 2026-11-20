/**
 * Points and directions in the scene: `x` east, `y` up, `z` toward the starting camera. Plain objects, so the
 * model needs no three.js. The helpers return new objects and never change their arguments.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (a: Vec3, k: number): Vec3 => vec3(a.x * k, a.y * k, a.z * k);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/**
 * The same direction with length 1. The zero vector stays the zero vector. It divides by the length, rather than
 * multiplying by 1 / length, which overflows to infinity for a vector as small as the smallest numbers there are.
 */
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l === 0 ? vec3(0, 0, 0) : vec3(a.x / l, a.y / l, a.z / l);
}

/** The point a fraction `t` of the way from `a` to `b`. */
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
