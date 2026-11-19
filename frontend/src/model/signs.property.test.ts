import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb, shuffled } from '../../test/arbitraries';
import { cellOverlap, signOverlap } from '../../test/layout-checks';
import { layout } from './layout';
import {
  SIGN_FAR_FACTOR,
  SIGN_HEIGHT,
  SIGN_MAX_VISIBLE,
  SIGN_MIN_OPACITY,
  SIGN_VIEW_MARGIN,
  buildSignSources,
  signOpacity,
  visibleSigns,
  type CameraView,
  type SignSource,
} from './signs';
import { distance, dot, length, normalize, sub, vec3 } from './vec3';

/**
 * P14: signs. One sign for every plot, on its front fence and in the way of nothing; at most 30 shown, nearest first;
 * opacity from 0 to 1 and never rising as the camera moves away; none beyond its far distance; and the result does
 * not depend on the order of the plots. (That the root's name is readable from the starting view is tested with the
 * camera poses, where the starting view is defined.)
 */

const coord = fc.double({ min: -300, max: 300, noNaN: true });

const sourcesArb: fc.Arbitrary<SignSource[]> = fc
  .array(fc.record({ x: coord, z: coord, near: fc.double({ min: 5, max: 150, noNaN: true }) }), { maxLength: 80 })
  .map((items) =>
    items.map((item, i) => ({
      path: `p${String(i).padStart(3, '0')}`,
      label: `label ${i}`,
      x: item.x,
      y: SIGN_HEIGHT,
      z: item.z,
      near: item.near,
      far: item.near * SIGN_FAR_FACTOR,
    })),
  );

const viewArb: fc.Arbitrary<CameraView> = fc.record({
  position: fc.record({ x: coord, y: fc.double({ min: 1, max: 200, noNaN: true }), z: coord }),
  forward: fc
    .record({ x: fc.double({ min: -1, max: 1, noNaN: true }), y: fc.double({ min: -1, max: 1, noNaN: true }), z: fc.double({ min: -1, max: 1, noNaN: true }) })
    .filter((v) => length(v) > 0.1),
  fovY: fc.double({ min: 20, max: 100, noNaN: true }),
  aspect: fc.double({ min: 0.5, max: 3, noNaN: true }),
});

/** The angle in radians between the camera's view direction and a sign, worked out from the cosine. */
function angleToSign(view: CameraView, s: SignSource): number {
  const toSign = sub(vec3(s.x, s.y, s.z), view.position);
  if (length(toSign) === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(normalize(toSign), normalize(view.forward)))));
}

function cornerAngle(view: CameraView): number {
  const halfFov = (view.fovY * Math.PI) / 360;
  return Math.atan(Math.tan(halfFov) * Math.sqrt(1 + view.aspect * view.aspect));
}

describe('P14: one sign for every plot, on the front fence, in the way of nothing', () => {
  it('has one source for every plot, anchored at the plaque', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const sources = buildSignSources(l, g.meta.name);
        return (
          sources.length === l.plots.length &&
          sources.every((s, i) => s.path === l.plots[i]!.path && s.x === l.plots[i]!.sign.x && s.z === l.plots[i]!.sign.z && s.y === SIGN_HEIGHT) &&
          new Set(sources.map((s) => s.path)).size === sources.length
        );
      }),
    );
  });

  it('puts the plaque in the middle of its plot\'s front edge', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        return layout(g).plots.every((p) => {
          const f = p.sign.footprint;
          return (
            Math.abs(f.z + f.d - (p.rect.z + p.rect.d)) < 1e-9 && // its back edge is the front edge of the plot
            Math.abs(f.x + f.w / 2 - (p.rect.x + p.rect.w / 2)) < 1e-9 // centred
          );
        });
      }),
    );
  });

  it('puts the plaque in the way of no stone, ghost or child plot, and the stones are still clear of one another', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        return signOverlap(l) === undefined && cellOverlap(l) === undefined;
      }),
    );
  });

  it('makes the near distance grow with the size of the plot, and the far distance a fixed multiple of it', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const sources = buildSignSources(l, g.meta.name);
        const sized = l.plots.map((p, i) => ({ size: Math.max(p.rect.w, p.rect.d), near: sources[i]!.near, far: sources[i]!.far }));
        const farIsAMultiple = sized.every((a) => Math.abs(a.far - a.near * SIGN_FAR_FACTOR) < 1e-9);
        // A plot that is smaller than another never has the larger near distance.
        const growsWithSize = sized.every((a) => sized.every((b) => !(a.size < b.size) || a.near <= b.near));
        return farIsAMultiple && growsWithSize;
      }),
      { numRuns: 40 },
    );
  });

  it('labels the plot that holds the root with the repository name (and the folders after it), and every other plot with the names of its folders joined by a slash', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const sources = buildSignSources(l, g.meta.name);
        return sources.every((s, i) => {
          const plot = l.plots[i]!;
          const names = plot.folders.filter((f) => f !== '').map((f) => f.slice(f.lastIndexOf('/') + 1)).join('/');
          // A plot that holds the root says the repository name, then " / " and the folders after it if there are any.
          return plot.folders[0] === '' ? s.label === (names === '' ? g.meta.name : `${g.meta.name} / ${names}`) : s.label === names && s.label.length > 0;
        });
      }),
    );
  });
});

describe('P14: which signs show', () => {
  it('shows at most 30 signs, and at most the limit given', () => {
    fc.assert(
      fc.property(sourcesArb, viewArb, fc.integer({ min: 0, max: 40 }), (sources, view, limit) => {
        return visibleSigns(sources, view).length <= SIGN_MAX_VISIBLE && visibleSigns(sources, view, limit).length <= limit;
      }),
    );
  });

  it('gives every shown sign an opacity from the minimum to 1, and shows no sign twice', () => {
    fc.assert(
      fc.property(sourcesArb, viewArb, (sources, view) => {
        const shown = visibleSigns(sources, view);
        return shown.every((s) => s.opacity >= SIGN_MIN_OPACITY && s.opacity <= 1) && new Set(shown.map((s) => s.path)).size === shown.length;
      }),
    );
  });

  it('shows no sign beyond its far distance, and no sign out of view', () => {
    fc.assert(
      fc.property(sourcesArb, viewArb, (sources, view) => {
        const byPath = new Map(sources.map((s) => [s.path, s] as const));
        return visibleSigns(sources, view).every((shown) => {
          const s = byPath.get(shown.path)!;
          const d = distance(view.position, vec3(s.x, s.y, s.z));
          return d < s.far && angleToSign(view, s) <= cornerAngle(view) + SIGN_VIEW_MARGIN + 1e-9;
        });
      }),
    );
  });

  it('shows the nearest first', () => {
    fc.assert(
      fc.property(sourcesArb, viewArb, (sources, view) => {
        const byPath = new Map(sources.map((s) => [s.path, s] as const));
        const distances = visibleSigns(sources, view).map((shown) => {
          const s = byPath.get(shown.path)!;
          return distance(view.position, vec3(s.x, s.y, s.z));
        });
        return distances.every((d, i) => i === 0 || distances[i - 1]! <= d);
      }),
    );
  });

  it('shows every sign that clearly qualifies, unless 30 nearer ones fill the screen', () => {
    fc.assert(
      fc.property(sourcesArb, viewArb, (sources, view) => {
        const shown = visibleSigns(sources, view);
        const shownPaths = new Set(shown.map((s) => s.path));
        const distanceTo = (s: SignSource): number => distance(view.position, vec3(s.x, s.y, s.z));
        const byPath = new Map(sources.map((s) => [s.path, s] as const));
        const farthestShown = Math.max(0, ...shown.map((s) => distanceTo(byPath.get(s.path)!)));
        for (const s of sources) {
          const d = distanceTo(s);
          const clearlyInView = angleToSign(view, s) <= cornerAngle(view) + SIGN_VIEW_MARGIN - 1e-6;
          const clearlyVisible = d < s.far * (1 - 1e-9) && signOpacity(d, s.near, s.far) >= SIGN_MIN_OPACITY + 1e-9;
          if (clearlyInView && clearlyVisible && !shownPaths.has(s.path)) {
            // It may only be missing because the screen is full of nearer signs.
            if (shown.length < SIGN_MAX_VISIBLE || d < farthestShown - 1e-9) return false;
          }
        }
        return true;
      }),
    );
  });

  it('gives the same result whatever order the signs are listed in', () => {
    fc.assert(
      fc.property(sourcesArb, viewArb, fc.integer({ min: 0, max: 1_000_000 }), (sources, view, seed) => {
        return JSON.stringify(visibleSigns(shuffled(sources, seed), view)) === JSON.stringify(visibleSigns(sources, view));
      }),
    );
  });

  it('gives the same result every time, and does not change what it is given', () => {
    fc.assert(
      fc.property(sourcesArb, viewArb, (sources, view) => {
        const before = JSON.stringify({ sources, view });
        const first = JSON.stringify(visibleSigns(sources, view));
        const second = JSON.stringify(visibleSigns(sources, view));
        return first === second && JSON.stringify({ sources, view }) === before;
      }),
    );
  });
});

describe('P14: opacity never rises as the camera moves away', () => {
  it('holds for the opacity function itself', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 200, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        (near, a, b) => {
          const far = near * SIGN_FAR_FACTOR;
          const [closer, farther] = a <= b ? [a, b] : [b, a];
          const o1 = signOpacity(closer, near, far);
          const o2 = signOpacity(farther, near, far);
          return o1 >= o2 && o1 >= 0 && o1 <= 1 && o2 >= 0 && o2 <= 1;
        },
      ),
    );
  });

  it('holds for a sign the camera is looking at from different distances', () => {
    fc.assert(
      fc.property(
        fc.record({ x: coord, z: coord }),
        fc.record({ x: fc.double({ min: -1, max: 1, noNaN: true }), y: fc.double({ min: 0.1, max: 1, noNaN: true }), z: fc.double({ min: -1, max: 1, noNaN: true }) }),
        fc.double({ min: 5, max: 150, noNaN: true }),
        fc.double({ min: 0.5, max: 400, noNaN: true }),
        fc.double({ min: 0.5, max: 400, noNaN: true }),
        (at, direction, near, a, b) => {
          const sign: SignSource = { path: 'p', label: 'p', x: at.x, y: SIGN_HEIGHT, z: at.z, near, far: near * SIGN_FAR_FACTOR };
          const away = normalize(direction);
          const target = vec3(sign.x, sign.y, sign.z);
          const opacityAt = (d: number): number => {
            const position = vec3(target.x + away.x * d, target.y + away.y * d, target.z + away.z * d);
            const view: CameraView = { position, forward: vec3(-away.x, -away.y, -away.z), fovY: 50, aspect: 1.6 };
            return visibleSigns([sign], view)[0]?.opacity ?? 0;
          };
          const [closer, farther] = a <= b ? [a, b] : [b, a];
          return opacityAt(closer) >= opacityAt(farther);
        },
      ),
    );
  });

  it('is 0 beyond the far distance, whatever the direction', () => {
    fc.assert(
      fc.property(fc.double({ min: 5, max: 150, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), (near, extra) => {
        return signOpacity(near * SIGN_FAR_FACTOR + extra, near, near * SIGN_FAR_FACTOR) === 0;
      }),
    );
  });
});
