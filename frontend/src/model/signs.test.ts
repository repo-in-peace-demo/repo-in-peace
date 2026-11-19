import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { graveyardFrom } from '../../test/make-graveyard';
import { layout } from './layout';
import {
  SIGN_FAR_FACTOR,
  SIGN_HEIGHT,
  SIGN_MAX_VISIBLE,
  SIGN_MIN_OPACITY,
  SIGN_NEAR_BASE,
  SIGN_NEAR_PER_SIZE,
  buildSignSources,
  signOpacity,
  visibleSigns,
  type CameraView,
  type SignSource,
} from './signs';
import { vec3 } from './vec3';

const source = (path: string, x: number, z: number, near = 30): SignSource => ({
  path,
  label: path || 'root',
  x,
  y: SIGN_HEIGHT,
  z,
  near,
  far: near * SIGN_FAR_FACTOR,
});

/** A camera at the origin looking down the negative z axis (toward the far end of the graveyard). */
const lookingAhead: CameraView = { position: vec3(0, 1.4, 0), forward: vec3(0, 0, -1), fovY: 50, aspect: 1.6 };

describe('the sign constants', () => {
  it('make a sign fade over a range, and keep every sign readable close up', () => {
    expect(SIGN_FAR_FACTOR).toBeGreaterThan(1);
    expect(SIGN_NEAR_BASE).toBeGreaterThan(0);
    expect(SIGN_NEAR_PER_SIZE).toBeGreaterThan(0);
    expect(SIGN_MAX_VISIBLE).toBe(30);
    expect(SIGN_MIN_OPACITY).toBeGreaterThan(0);
    expect(SIGN_MIN_OPACITY).toBeLessThan(0.1);
  });
});

describe('signOpacity', () => {
  it('is 1 up to the near distance, 0 from the far distance, and 0.5 halfway', () => {
    expect(signOpacity(0, 30, 66)).toBe(1);
    expect(signOpacity(30, 30, 66)).toBe(1);
    expect(signOpacity(66, 30, 66)).toBe(0);
    expect(signOpacity(500, 30, 66)).toBe(0);
    expect(signOpacity(48, 30, 66)).toBeCloseTo(0.5, 12);
  });

  it('falls steadily between near and far', () => {
    let last = 1;
    for (let d = 30; d <= 66; d += 1) {
      const o = signOpacity(d, 30, 66);
      expect(o).toBeLessThanOrEqual(last + 1e-12);
      last = o;
    }
    expect(signOpacity(31, 30, 66)).toBeLessThan(1);
    expect(signOpacity(65, 30, 66)).toBeGreaterThan(0);
  });
});

describe('buildSignSources', () => {
  const g = graveyardFrom({ files: ['a/b/c.ts', 'd.ts', 'a/e.ts'], name: 'demo-repo' });
  const l = layout(g);
  const sources = buildSignSources(l, 'demo-repo');

  it('makes one source for every plot, in the order of the plots', () => {
    expect(sources.map((s) => s.path)).toEqual(l.plots.map((p) => p.path));
    expect(sources.map((s) => s.path)).toEqual(['', 'a', 'a/b']);
  });

  it('says the repository name on the root, and the folder\'s own name on every other sign', () => {
    expect(sources.map((s) => s.label)).toEqual(['demo-repo', 'a', 'b']);
  });

  it('anchors the text on the plaque, at the height of its face', () => {
    sources.forEach((s, i) => {
      expect(s.x).toBe(l.plots[i]!.sign.x);
      expect(s.z).toBe(l.plots[i]!.sign.z);
      expect(s.y).toBe(SIGN_HEIGHT);
    });
  });

  it('makes the distances grow with the plot, and the far distance a fixed multiple of the near one', () => {
    for (const [i, s] of sources.entries()) {
      const rect = l.plots[i]!.rect;
      expect(s.near).toBeCloseTo(SIGN_NEAR_BASE + SIGN_NEAR_PER_SIZE * Math.max(rect.w, rect.d), 9);
      expect(s.far).toBeCloseTo(s.near * SIGN_FAR_FACTOR, 9);
    }
    expect(sources[0]!.near).toBeGreaterThan(sources[1]!.near);
    expect(sources[1]!.near).toBeGreaterThan(sources[2]!.near);
  });

  it.each(REAL_GRAVEYARDS)('labels every plot of %s with a non-empty name', (name) => {
    const real = loadRealGraveyard(name);
    const realSources = buildSignSources(layout(real), real.meta.name);
    expect(realSources.every((s) => s.label.length > 0)).toBe(true);
    expect(realSources.find((s) => s.path === '')!.label).toBe(real.meta.name);
    expect(realSources.every((s) => s.path === '' || !s.label.includes('/'))).toBe(true);
  });
});

describe('visibleSigns', () => {
  it('shows nothing when there are no signs', () => {
    expect(visibleSigns([], lookingAhead)).toEqual([]);
  });

  it('shows a sign in front of the camera and within its near distance at full strength', () => {
    expect(visibleSigns([source('a', 0, -10)], lookingAhead)).toEqual([{ path: 'a', label: 'a', opacity: 1 }]);
  });

  it('fades a sign between its near and far distances', () => {
    const [shown] = visibleSigns([source('a', 0, -45)], lookingAhead); // near 30, far 66
    expect(shown!.opacity).toBeGreaterThan(0);
    expect(shown!.opacity).toBeLessThan(1);
  });

  it('shows nothing for a sign beyond its far distance', () => {
    expect(visibleSigns([source('a', 0, -70)], lookingAhead)).toEqual([]);
  });

  it('drops a sign behind the camera, however close', () => {
    expect(visibleSigns([source('a', 0, 5)], lookingAhead)).toEqual([]);
  });

  it('keeps a sign at the side that is still in view, and drops one far to the side', () => {
    expect(visibleSigns([source('inside', 5, -10)], lookingAhead).map((s) => s.path)).toEqual(['inside']);
    expect(visibleSigns([source('outside', 25, -10)], lookingAhead)).toEqual([]);
  });

  it('keeps a sign just outside the screen, so that it does not pop in at the edge', () => {
    // At 10.5 / 10 the sign is about 46.4 degrees off the view direction. The screen corner is about 41.3 degrees,
    // and the margin adds about 5.7 more, so the sign is outside the screen and still shown.
    expect(visibleSigns([source('edge', 10.5, -10)], lookingAhead).map((s) => s.path)).toEqual(['edge']);
    // At 11 / 10 (47.7 degrees) it is past the margin.
    expect(visibleSigns([source('past', 11, -10)], lookingAhead)).toEqual([]);
  });

  it('works for a camera looking in any direction, and for a forward vector that is not of length 1', () => {
    const east: CameraView = { ...lookingAhead, forward: vec3(7, 0, 0) };
    expect(visibleSigns([source('ahead', 10, 0)], east).map((s) => s.path)).toEqual(['ahead']);
    expect(visibleSigns([source('behind', -10, 0)], east)).toEqual([]);
  });

  it('shows a sign the camera is standing at', () => {
    const at = source('here', 0, 0);
    expect(visibleSigns([{ ...at, y: 1.4 }], lookingAhead)[0]!.opacity).toBe(1);
  });

  it('does not test the view when the camera has no direction', () => {
    const noDirection: CameraView = { ...lookingAhead, forward: vec3(0, 0, 0) };
    expect(visibleSigns([source('behind', 0, 5)], noDirection).map((s) => s.path)).toEqual(['behind']);
  });

  it('shows the nearest signs first, ties by path', () => {
    const sources = [source('far', 0, -40), source('b-tie', 10, -10), source('a-tie', -10, -10), source('close', 0, -5)];
    expect(visibleSigns(sources, lookingAhead).map((s) => s.path)).toEqual(['close', 'a-tie', 'b-tie', 'far']);
  });

  it('shows at most 30 signs, and at most the limit it is given', () => {
    const many = Array.from({ length: 50 }, (_, i) => source(`s${String(i).padStart(2, '0')}`, 0, -5 - i * 0.2));
    expect(visibleSigns(many, lookingAhead)).toHaveLength(30);
    expect(visibleSigns(many, lookingAhead, 3).map((s) => s.path)).toEqual(['s00', 's01', 's02']);
    expect(visibleSigns(many, lookingAhead, 0)).toEqual([]);
    expect(visibleSigns(many, lookingAhead, 100)).toHaveLength(50);
  });

  it('keeps the 30 nearest of many, not the first 30 in the list', () => {
    const many = Array.from({ length: 50 }, (_, i) => source(`s${String(i).padStart(2, '0')}`, 0, -5 - (49 - i) * 0.3));
    const shown = visibleSigns(many, lookingAhead).map((s) => s.path);
    expect(shown[0]).toBe('s49');
    expect(shown).toHaveLength(30);
    expect(shown).not.toContain('s00');
  });

  it('gives the same result whatever order the signs are listed in', () => {
    const sources = [source('a', 0, -10), source('b', 3, -20), source('c', -3, -30), source('d', 0, -40)];
    const reversed = [...sources].reverse();
    expect(visibleSigns(reversed, lookingAhead)).toEqual(visibleSigns(sources, lookingAhead));
  });
});
