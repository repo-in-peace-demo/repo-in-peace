import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CELL_D, CELL_W } from './layout-constants';
import {
  GHOST_CURL,
  GHOST_CURL_HEIGHT,
  GHOST_EYES,
  GHOST_MAX_RADIUS,
  GHOST_PROFILE,
  GHOST_SWAY,
  GHOST_TAG,
  GHOST_TOP,
  HEM_BRACES,
  HEM_DEPTH,
  ghostFits,
  ghostRadiusAt,
  ghostTagPlacement,
  ghostTagReach,
  hemHeight,
  tipCurl,
  hemHeightAt,
} from './ghost-shape';
import { GHOST_D, GHOST_FLOAT_AMPLITUDE, GHOST_FLOAT_BASE, GHOST_HEIGHT, GHOST_PICK_HALF, GHOST_W } from './visual-constants';

describe('the sheet ghost\'s outline', () => {
  it('fits inside the ground it is given, sway included, and its tag inside the picking box, which is inside the stone cell', () => {
    expect(ghostFits()).toBe(true);
    expect(2 * (GHOST_MAX_RADIUS + GHOST_CURL + GHOST_SWAY)).toBeLessThanOrEqual(Math.min(GHOST_W, GHOST_D) + 1e-9); // the curled tips included
    expect(2 * GHOST_PICK_HALF).toBeLessThanOrEqual(Math.min(CELL_W, CELL_D));
    expect(ghostTagReach()).toBeLessThanOrEqual(GHOST_PICK_HALF);
  });

  it('is as tall as the height the camera, the picking box and the ring are built for', () => {
    expect(GHOST_TOP).toBeCloseTo(GHOST_HEIGHT, 9);
  });

  it('is a sheet: widest at the hem, narrowing slightly up the body, with a rounded head that comes to a point at the top', () => {
    const radii = GHOST_PROFILE.map(([r]) => r);
    expect(radii[0]).toBe(GHOST_MAX_RADIUS); // the hem is the widest
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeLessThanOrEqual(radii[i - 1]! + 1e-12); // never widens going up
    expect(radii[radii.length - 1]).toBe(0); // the dome closes at the top
    const body = GHOST_PROFILE.filter(([, h]) => h <= 1.3);
    expect(body[body.length - 1]![0]).toBeGreaterThan(0.75 * GHOST_MAX_RADIUS); // only slightly narrower: it is a sheet, not a cone
    expect(GHOST_PROFILE.some(([r, h]) => h > 1.6 && r > 0.25)).toBe(true); // a round head, not a point
  });

  it('goes up from the hem, one point above the other', () => {
    for (let i = 1; i < GHOST_PROFILE.length; i++) expect(GHOST_PROFILE[i]![1]).toBeGreaterThan(GHOST_PROFILE[i - 1]![1]);
  });

  it('has the gap under it about a third of its height, and the bob changes it by a clear amount', () => {
    expect(GHOST_FLOAT_BASE / GHOST_HEIGHT).toBeGreaterThan(0.28);
    expect(GHOST_FLOAT_BASE / GHOST_HEIGHT).toBeLessThan(0.42);
    expect(GHOST_FLOAT_AMPLITUDE / GHOST_FLOAT_BASE).toBeGreaterThanOrEqual(0.3); // the gap visibly changes
    expect(GHOST_FLOAT_BASE - GHOST_FLOAT_AMPLITUDE).toBeGreaterThanOrEqual(0.4); // and never closes
  });
});

describe('the hem, cut like curly braces', () => {
  it('has a tip that points down in the middle of each brace, at the lowest point of the figure', () => {
    expect(hemHeight(0.5)).toBeCloseTo(0, 12);
    for (let u = 0; u <= 1; u += 0.01) expect(hemHeight(u)).toBeGreaterThanOrEqual(-1e-12);
  });

  it('has flat runs either side of the tip, at half the depth, and ends that curl up higher than the runs', () => {
    expect(hemHeight(0.3)).toBeCloseTo(HEM_DEPTH * 0.5, 9);
    expect(hemHeight(0.7)).toBeCloseTo(HEM_DEPTH * 0.5, 9);
    expect(hemHeight(0)).toBeCloseTo(HEM_DEPTH * 1.45, 9);
    expect(hemHeight(1)).toBeCloseTo(HEM_DEPTH * 1.45, 9);
    expect(hemHeight(0.02)).toBeGreaterThan(hemHeight(0.3));
  });

  it('is the same from the left as from the right: a brace is symmetric', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (u) => Math.abs(hemHeight(u) - hemHeight(1 - u)) < 1e-9));
  });

  it('is smooth: it has no jump between nearby points, so the edge is a curve', () => {
    for (let u = 0; u < 1; u += 0.001) expect(Math.abs(hemHeight(u + 0.001) - hemHeight(u))).toBeLessThan(0.01);
  });

  it('repeats HEM_BRACES times round the figure, so the front half, which is what you see, shows a pair', () => {
    expect(HEM_BRACES).toBe(4);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), (a) => Math.abs(hemHeightAt(a) - hemHeightAt(a + (2 * Math.PI) / HEM_BRACES)) < 1e-9),
    );
    // Two tips and two curled-up junctions between the angles -90 and +90 degrees: a `{ }` pair seen from the front.
    const tips = [0, 1, 2, 3].map((k) => hemHeightAt(((k + 0.5) * 2 * Math.PI) / HEM_BRACES));
    expect(tips.every((h) => Math.abs(h) < 1e-9)).toBe(true);
  });

  it('is cut away only low on the figure: below the head and the tag, never more than the depth of the pattern up the body', () => {
    expect(HEM_DEPTH * 1.45).toBeLessThan(0.5); // the cut reaches at most half a unit up the body
    expect(HEM_DEPTH * 1.45).toBeLessThan(GHOST_TAG.attachHeight - GHOST_TAG.thread - GHOST_TAG.height);
  });
});

describe('the curled tips', () => {
  const tipAngle = (k: number) => ((k + 0.5) * 2 * Math.PI) / HEM_BRACES;

  it('bend outward at each tip, most at the lowest point, by GHOST_CURL', () => {
    for (let k = 0; k < HEM_BRACES; k++) expect(tipCurl(tipAngle(k), 0)).toBeCloseTo(GHOST_CURL, 9);
  });

  it('fade away up the body: nothing from GHOST_CURL_HEIGHT up, and less and less above the tip', () => {
    expect(tipCurl(tipAngle(0), GHOST_CURL_HEIGHT)).toBeCloseTo(0, 12);
    expect(tipCurl(tipAngle(0), 1.2)).toBe(0);
    let last = Infinity;
    for (let h = 0; h <= GHOST_CURL_HEIGHT; h += 0.01) {
      const c = tipCurl(tipAngle(0), h);
      expect(c).toBeLessThanOrEqual(last + 1e-12);
      last = c;
    }
  });

  it('leave the rest of the hem alone: nothing between the tips, at the junctions where the braces meet', () => {
    for (let k = 0; k < HEM_BRACES; k++) expect(tipCurl((k * 2 * Math.PI) / HEM_BRACES, 0)).toBe(0);
  });

  it('are outward only (never into the body), never more than GHOST_CURL, and repeat with the braces, for any angle and height', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), fc.double({ min: 0, max: 2, noNaN: true }), (a, h) => {
        const c = tipCurl(a, h);
        return c >= 0 && c <= GHOST_CURL + 1e-12 && Math.abs(c - tipCurl(a + (2 * Math.PI) / HEM_BRACES, h)) < 1e-9;
      }),
    );
  });

  it('are the same on the left tip and the right tip as seen from the front: a mirrored pair, like { and }', () => {
    // The tips of the front half are at 45 degrees either side of straight ahead (angle 0 is +z toward +x).
    expect(tipCurl(Math.PI / 4, 0.05)).toBeCloseTo(tipCurl(-Math.PI / 4, 0.05), 9);
    expect(tipCurl(Math.PI / 4, 0.05)).toBeGreaterThan(0.05);
  });
});

describe('the face', () => {
  it('has two eye holes on the head, inside the outline, symmetric, and well apart', () => {
    expect(GHOST_EYES.left.x).toBeCloseTo(-GHOST_EYES.right.x, 12);
    expect(GHOST_EYES.left.y).toBe(GHOST_EYES.right.y);
    expect(GHOST_EYES.left.y).toBeGreaterThan(GHOST_TOP * 0.6);
    const reach = Math.abs(GHOST_EYES.right.x) + GHOST_EYES.radiusX;
    expect(reach).toBeLessThan(ghostRadiusAt(GHOST_EYES.right.y + GHOST_EYES.radiusY) * 0.95); // the holes lie within the head
    expect(Math.abs(GHOST_EYES.right.x) - GHOST_EYES.radiusX).toBeGreaterThan(0.02); // two holes, not one
  });
});

describe('the tag', () => {
  it('hangs from a point on the body, at the front right, by a thread, below the point where it is fastened', () => {
    const { attach, card } = ghostTagPlacement();
    expect(attach.x).toBeGreaterThan(0);
    expect(attach.z).toBeGreaterThan(0);
    expect(Math.hypot(attach.x, attach.z)).toBeCloseTo(ghostRadiusAt(GHOST_TAG.attachHeight), 9);
    expect(card.y).toBeCloseTo(attach.y - GHOST_TAG.thread - GHOST_TAG.height / 2, 12);
    expect(Math.hypot(card.x, card.z)).toBeGreaterThan(Math.hypot(attach.x, attach.z)); // in front of the body, not inside it
  });

  it('stays inside the picking box and the stone cell with its swing, below the face', () => {
    expect(ghostTagReach()).toBeLessThanOrEqual(GHOST_PICK_HALF);
    expect(GHOST_PICK_HALF).toBeLessThanOrEqual(Math.min(CELL_W, CELL_D) / 2);
    const { card } = ghostTagPlacement();
    expect(card.y + GHOST_TAG.height / 2).toBeLessThan(GHOST_EYES.left.y - GHOST_EYES.radiusY);
  });

  it('is big enough to read up close: a card at least 0.4 wide', () => {
    expect(GHOST_TAG.width).toBeGreaterThanOrEqual(0.4);
  });
});
