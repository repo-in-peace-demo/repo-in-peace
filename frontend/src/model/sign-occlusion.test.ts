import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { labelBlocked, labelPoints, signBlocked, stoneOccluders, type OccluderBox } from './sign-occlusion';
import { signBox } from './sign-placement';
import { PICK_PADDING, type PickTarget } from './pick';
import { vec3 } from './vec3';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): OccluderBox => ({ min: vec3(x0, y0, z0), max: vec3(x1, y1, z1) });
const stone = box(-0.7, 0, -0.25, 0.7, 2, 0.25);

describe('signBlocked', () => {
  it('hides a sign straight behind a stone, and not one in front of it or beside it', () => {
    const camera = vec3(0, 1, 10);
    expect(signBlocked(camera, vec3(0, 1, -3), [stone])).toBe(true); // behind the stone
    expect(signBlocked(camera, vec3(0, 1, 3), [stone])).toBe(false); // between the camera and the stone
    expect(signBlocked(camera, vec3(3, 1, -3), [stone])).toBe(false); // the line passes beside it
    expect(signBlocked(camera, vec3(0, 4, -3), [stone])).toBe(false); // a sign high enough is seen over the stone's top
  });

  it('hides nothing without boxes, and a sign at the camera is not hidden', () => {
    expect(signBlocked(vec3(0, 1, 10), vec3(0, 1, -3), [])).toBe(false);
    expect(signBlocked(vec3(0, 1, -3), vec3(0, 1, -3), [stone])).toBe(false);
  });

  it('builds one box per stone, its pick box less the padding, and none for ghosts', () => {
    const targets: PickTarget[] = [
      { kind: 'file', path: 'a', min: vec3(-1, 0, -1), max: vec3(1, 2, 1) },
      { kind: 'ghost', path: 'g', min: vec3(5, 0, 5), max: vec3(6, 3, 6) },
    ];
    expect(stoneOccluders(targets)).toEqual([box(-1 + PICK_PADDING, 0, -1 + PICK_PADDING, 1 - PICK_PADDING, 2 - PICK_PADDING, 1 - PICK_PADDING)]);
  });

  const coord = fc.double({ min: -20, max: 20, noNaN: true });
  const point = fc.record({ x: coord, y: fc.double({ min: 0, max: 10, noNaN: true }), z: coord });

  it('for any boxes: a sign is hidden exactly when some box meets the line before it, and adding a box never shows a hidden sign', () => {
    fc.assert(
      fc.property(point, point, fc.array(fc.tuple(point, fc.double({ min: 0.1, max: 3, noNaN: true })), { maxLength: 6 }), fc.tuple(point, fc.double({ min: 0.1, max: 3, noNaN: true })), (camera, anchor, raw, extra) => {
        const boxes = raw.map(([c, h]) => box(c.x - h, c.y, c.z - h, c.x + h, c.y + h, c.z + h));
        const more = [...boxes, box(extra[0].x - extra[1], extra[0].y, extra[0].z - extra[1], extra[0].x + extra[1], extra[0].y + extra[1], extra[0].z + extra[1])];
        const hidden = signBlocked(camera, anchor, boxes);
        // Monotone: more geometry can only hide more.
        if (hidden && !signBlocked(camera, anchor, more)) return false;
        // Each box alone decides the same way as within the list.
        return hidden === boxes.some((b) => signBlocked(camera, anchor, [b]));
      }),
      { numRuns: 300 },
    );
  });

  it('for any box beyond the sign (further from the camera along the line), the sign is not hidden by it', () => {
    fc.assert(
      fc.property(point, point, fc.double({ min: 1.2, max: 3, noNaN: true }), fc.double({ min: 0.01, max: 0.15, noNaN: true }), (camera, anchor, beyond, half) => {
        const d = { x: anchor.x - camera.x, y: anchor.y - camera.y, z: anchor.z - camera.z };
        const len = Math.hypot(d.x, d.y, d.z);
        fc.pre(len > 1);
        const c = { x: camera.x + d.x * beyond, y: camera.y + d.y * beyond, z: camera.z + d.z * beyond };
        // A box this small around a point past the anchor, further than its own size from it, cannot be before the anchor.
        fc.pre(len * (beyond - 1) > 2 * half * Math.sqrt(3));
        return !signBlocked(camera, anchor, [box(c.x - half, c.y - half, c.z - half, c.x + half, c.y + half, c.z + half)]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('labelBlocked: any part of the label', () => {
  const view = { position: vec3(0, 1, 10), forward: vec3(0, 0, -1), fovY: 60, viewportHeight: 720 };

  it('puts the six points round the label in the plane facing the camera, the anchor in the middle of the bottom edge', () => {
    const anchor = vec3(0, 1, 0);
    const pts = labelPoints(view, anchor, 'compare');
    expect(pts).toHaveLength(6);
    for (const p of pts) expect(p.z).toBeCloseTo(0, 9);
    const perPixel = (2 * 10 * Math.tan(Math.PI / 6)) / 720;
    const b = signBox('compare', 0, 0);
    expect(Math.min(...pts.map((p) => p.x))).toBeCloseTo(b.x0 * perPixel, 9);
    expect(Math.max(...pts.map((p) => p.x))).toBeCloseTo(b.x1 * perPixel, 9);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(1, 9);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(1 + -b.y0 * perPixel, 9);
  });

  it('hides a label whose anchor is clear but whose text runs behind a stone beside it', () => {
    // The stone covers x from 0.2 to 1.6, just right of the anchor; the label (about 1 unit wide at 10 units) runs over it.
    const beside = box(0.2, 0, -1, 1.6, 3, -0.5);
    const anchor = vec3(0, 1, -3);
    expect(signBlocked(view.position, anchor, [beside])).toBe(false);
    expect(labelBlocked(view, anchor, 'public', [beside])).toBe(true);
  });

  it('for any boxes: a label is hidden whenever its anchor is', () => {
    const coord = fc.double({ min: -10, max: 10, noNaN: true });
    fc.assert(
      fc.property(fc.record({ x: coord, y: fc.double({ min: 0, max: 4, noNaN: true }), z: fc.double({ min: -10, max: 5, noNaN: true }) }), fc.array(fc.tuple(coord, coord, fc.double({ min: 0.2, max: 2, noNaN: true })), { maxLength: 5 }), (anchor, raw) => {
        const boxes = raw.map(([x, z, h]) => box(x - h, 0, z - h, x + h, 2 * h, z + h));
        return !signBlocked(view.position, anchor, boxes) || labelBlocked(view, anchor, 'label', boxes);
      }),
      { numRuns: 300 },
    );
  });
});
