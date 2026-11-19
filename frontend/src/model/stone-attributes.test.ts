import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { buildSceneModel } from './scene-model';
import { highlightValue, leanQuaternion, stoneAttributes, type Quaternion } from './stone-attributes';

/** Rotates the vector (x, y, z) by the unit quaternion q. */
function rotate(q: Quaternion, v: { x: number; y: number; z: number }) {
  const { x: qx, y: qy, z: qz, w } = q;
  // v' = v + 2 w (q × v) + 2 q × (q × v)
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + w * tx + (qy * tz - qz * ty),
    y: v.y + w * ty + (qz * tx - qx * tz),
    z: v.z + w * tz + (qx * ty - qy * tx),
  };
}

describe('leanQuaternion', () => {
  it('is no rotation for an upright stone', () => {
    expect(leanQuaternion(0, 1.234)).toEqual({ x: 0, y: 0, z: -0, w: 1 });
    expect(rotate(leanQuaternion(0, 2), { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('tips the top of the stone toward the lean direction, by the lean angle, keeping the base where it is', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10, noNaN: true }), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), (degrees, direction) => {
        const q = leanQuaternion(degrees, direction);
        const up = rotate(q, { x: 0, y: 1, z: 0 });
        const angle = (Math.acos(Math.min(1, up.y)) * 180) / Math.PI;
        const sideways = Math.hypot(up.x, up.z);
        const towards = sideways < 1e-9 ? true : Math.abs(up.x / sideways - Math.cos(direction)) < 1e-6 && Math.abs(up.z / sideways - Math.sin(direction)) < 1e-6;
        return Math.abs(angle - degrees) < 1e-6 && towards && Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-12;
      }),
    );
  });

  it('leans toward +x for direction 0 and toward +z for a quarter turn', () => {
    expect(rotate(leanQuaternion(10, 0), { x: 0, y: 1, z: 0 }).x).toBeGreaterThan(0.17);
    expect(rotate(leanQuaternion(10, Math.PI / 2), { x: 0, y: 1, z: 0 }).z).toBeGreaterThan(0.17);
  });
});

describe('highlightValue', () => {
  it('is 0 for nothing, 0.5 for hover and 1 for selected, and selected wins', () => {
    expect(highlightValue(false, false)).toBe(0);
    expect(highlightValue(true, false)).toBe(0.5);
    expect(highlightValue(false, true)).toBe(1);
    expect(highlightValue(true, true)).toBe(1);
  });
});

describe('stoneAttributes', () => {
  it.each(REAL_GRAVEYARDS)('%s: one value per stone, from the stone\'s own facts', (name) => {
    const g = loadRealGraveyard(name);
    const model = buildSceneModel(g);
    const a = stoneAttributes(model.stones);
    expect(a.height).toHaveLength(g.files.length);
    model.stones.forEach(({ file, layout, visual }, i) => {
      expect(a.height[i]).toBeCloseTo(layout.height, 5);
      expect(a.moss[i]).toBeCloseTo(visual.mossAmount, 5);
      expect(a.crack[i]).toBe(file.unused ? 1 : 0);
      expect(a.seed[i]).toBeGreaterThanOrEqual(0);
      expect(a.seed[i]).toBeLessThan(1);
    });
  });

  it('counts the cracked stones as the unused files, and gives no moss to a fresh stone', () => {
    const g = loadRealGraveyard('demo.oikosledger');
    const model = buildSceneModel(g);
    const a = stoneAttributes(model.stones);
    expect(a.crack.reduce((sum, v) => sum + v, 0)).toBe(g.files.filter((f) => f.unused).length);
    model.stones.forEach(({ file }, i) => {
      if (file.decayState === 'fresh') expect(a.moss[i]).toBe(0);
      else expect(a.moss[i]).toBeGreaterThan(0);
    });
  });

  it('each fact changes only its own attribute: unused only the cracks of that stone, hot nothing, for any graveyard', () => {
    fc.assert(
      fc.property(graveyardArb, fc.nat(), (g, k) => {
        if (g.files.length === 0) return true;
        const target = g.files[k % g.files.length]!.path;
        const flipped = (field: 'unused' | 'hot') => ({ ...g, files: g.files.map((f) => (f.path === target ? { ...f, [field]: !f[field] } : f)) });
        const base = buildSceneModel(g);
        const index = base.lookup.get(target)!.index;
        const baseAttrs = stoneAttributes(base.stones);
        const unused = stoneAttributes(buildSceneModel(flipped('unused')).stones);
        const hot = stoneAttributes(buildSceneModel(flipped('hot')).stones);
        const same = (a: Float32Array, b: Float32Array, except = -1) => a.every((v, j) => j === except || v === b[j]);
        return (
          same(unused.height, baseAttrs.height) && same(unused.moss, baseAttrs.moss) && same(unused.seed, baseAttrs.seed) &&
          same(unused.crack, baseAttrs.crack, index) && unused.crack[index] !== baseAttrs.crack[index] &&
          same(hot.height, baseAttrs.height) && same(hot.moss, baseAttrs.moss) && same(hot.seed, baseAttrs.seed) && same(hot.crack, baseAttrs.crack)
        );
      }),
      { numRuns: 40 },
    );
  });
});
