import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import {
  FOG_COLOR,
  FOG_K,
  FOG_MIN_RADIUS,
  HEMISPHERE_GROUND_COLOR,
  HEMISPHERE_INTENSITY,
  HEMISPHERE_SKY_COLOR,
  GROUND_BASE_COLOR,
  MOONLIGHT_COLOR,
  MOONLIGHT_DIRECTION,
  MOONLIGHT_INTENSITY,
  MOON_ANGULAR_RADIUS_DEG,
  MOON_COLOR,
  MOON_DIRECTION,
  MOON_GLOW_ANGULAR_RADIUS_DEG,
  SKY_HORIZON_COLOR,
  SKY_RADIUS,
  SKY_TOP_COLOR,
  STAR_COLOR,
  STAR_COUNT,
  fogDensity,
  fogVisibility,
  groundSize,
  starDirections,
} from './atmosphere';
import { layout } from './layout';
import { startPose } from './camera-pose';
import { boundsRadius, maxCameraDistance } from './fly-controls';
import { distance } from './vec3';

const COLOURS = { SKY_TOP_COLOR, SKY_HORIZON_COLOR, FOG_COLOR, GROUND_BASE_COLOR, MOON_COLOR, MOONLIGHT_COLOR, HEMISPHERE_SKY_COLOR, HEMISPHERE_GROUND_COLOR, STAR_COLOR };
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('the colours', () => {
  it.each(Object.entries(COLOURS))('%s is a #rrggbb colour', (_name, hex) => {
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keep the night dark: the sky, the fog and the ground are all very dark, and the sky is a little lighter at the horizon than at the top', () => {
    for (const hex of [SKY_TOP_COLOR, SKY_HORIZON_COLOR, FOG_COLOR, GROUND_BASE_COLOR]) expect(luminance(hex)).toBeLessThan(0.1);
    expect(luminance(SKY_HORIZON_COLOR)).toBeGreaterThan(luminance(SKY_TOP_COLOR));
  });

  it('make the fog the colour of the horizon, nearly, so the far edge dissolves into the sky', () => {
    expect(Math.abs(luminance(FOG_COLOR) - luminance(SKY_HORIZON_COLOR))).toBeLessThan(0.02);
  });

  it('make the moon and the stars bright against the sky', () => {
    expect(luminance(MOON_COLOR)).toBeGreaterThan(0.7);
    expect(luminance(STAR_COLOR)).toBeGreaterThan(0.7);
  });
});

describe('the light', () => {
  it('is a bright enough moonlight and a dim sky light, with positive intensities', () => {
    expect(MOONLIGHT_INTENSITY).toBeGreaterThan(0);
    expect(HEMISPHERE_INTENSITY).toBeGreaterThan(0);
    expect(HEMISPHERE_INTENSITY).toBeLessThan(MOONLIGHT_INTENSITY); // the moon is the main light
  });
});

describe('the moonlight\'s direction', () => {
  it('has length 1, comes from high above, and lights the faces that the opening view sees (facing +z, toward the camera)', () => {
    const { x, y, z } = MOONLIGHT_DIRECTION;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);
    expect((Math.asin(y) * 180) / Math.PI).toBeGreaterThan(40);
    expect(z).toBeGreaterThan(0.3); // a stone's front face has the normal (0, 0, 1): the light on it is z
  });
});

describe('the moon', () => {
  it('has a direction of length 1, above the horizon but low enough to be in view when the camera looks toward it', () => {
    const { x, y, z } = MOON_DIRECTION;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);
    const elevation = (Math.asin(y) * 180) / Math.PI;
    expect(elevation).toBeGreaterThan(10);
    expect(elevation).toBeLessThan(25); // the camera's field of view is 50 degrees tall
    expect(z).toBeLessThan(0); // behind the graveyard when seen from the opening view, which looks toward -z
  });

  it('has a glow wider than the disc, and both small', () => {
    expect(MOON_GLOW_ANGULAR_RADIUS_DEG).toBeGreaterThan(MOON_ANGULAR_RADIUS_DEG);
    expect(MOON_GLOW_ANGULAR_RADIUS_DEG).toBeLessThan(30);
  });
});

describe('starDirections', () => {
  const stars = starDirections();

  it('gives about 900 stars, each a direction of length 1 in the sky above the horizon', () => {
    expect(STAR_COUNT).toBe(900);
    expect(stars).toHaveLength(STAR_COUNT);
    for (const s of stars) {
      expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 9);
      expect(s.y).toBeGreaterThan(0.01);
      expect(s.brightness).toBeGreaterThanOrEqual(0.3);
      expect(s.brightness).toBeLessThanOrEqual(1);
    }
  });

  it('are the same every time, and for every graveyard: the sky does not read the data', () => {
    expect(JSON.stringify(starDirections())).toBe(JSON.stringify(stars));
  });

  it('are spread over the sky: all four quarters have stars, and heights are not bunched', () => {
    const quarters = [0, 0, 0, 0];
    for (const s of stars) quarters[(s.x >= 0 ? 1 : 0) + (s.z >= 0 ? 2 : 0)]!++;
    for (const n of quarters) expect(n).toBeGreaterThan(150);
    const high = stars.filter((s) => s.y > 0.5).length;
    expect(high).toBeGreaterThan(300);
    expect(high).toBeLessThan(600);
  });

  it('are all different, and fit in the sky dome with a far plane of 1000', () => {
    expect(new Set(stars.map((s) => `${s.x.toFixed(6)},${s.y.toFixed(6)},${s.z.toFixed(6)}`)).size).toBe(STAR_COUNT);
    expect(SKY_RADIUS).toBeLessThan(1000);
  });
});

describe('the fog', () => {
  it('has the density FOG_K over the radius of the graveyard, but not for a radius below FOG_MIN_RADIUS', () => {
    expect(fogDensity(200)).toBeCloseTo(FOG_K / 200, 12);
    expect(fogDensity(10)).toBeCloseTo(FOG_K / FOG_MIN_RADIUS, 12);
    expect(fogDensity(0)).toBeCloseTo(FOG_K / FOG_MIN_RADIUS, 12);
  });

  it('is exponential squared: 1 at the camera, falling, never negative', () => {
    expect(fogVisibility(0, 0.01)).toBe(1);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 5000, noNaN: true }), fc.double({ min: 0, max: 5000, noNaN: true }), fc.double({ min: 1e-4, max: 0.05, noNaN: true }), (a, b, d) => {
        const [near, far] = a <= b ? [a, b] : [b, a];
        return fogVisibility(far, d) <= fogVisibility(near, d) && fogVisibility(far, d) >= 0;
      }),
    );
  });

  it.each(REAL_GRAVEYARDS)('%s: the graveyard is still clear from the opening view, and the edge of the ground is gone', (name) => {
    const l = layout(loadRealGraveyard(name));
    const density = fogDensity(boundsRadius(l.bounds));
    const pose = startPose(l.bounds, 50);
    const farSide = distance(pose.position, pose.target) + boundsRadius(l.bounds); // the far side of the graveyard
    expect(fogVisibility(farSide, density)).toBeGreaterThan(0.5);
    expect(fogVisibility(groundSize(l.bounds) / 2, density)).toBeLessThan(0.02);
  });

  it('keeps the whole graveyard readable from the opening view and hides the edge of the ground, for any graveyard', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const r = boundsRadius(l.bounds);
        const density = fogDensity(r);
        const pose = startPose(l.bounds, 50);
        const farSide = distance(pose.position, pose.target) + r;
        return fogVisibility(farSide, density) > 0.45 && fogVisibility(groundSize(l.bounds) / 2, density) < 0.05;
      }),
      { numRuns: 60 },
    );
  });

  it('still hides the edge of the ground from the furthest the camera can be from its look-at point', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 800, noNaN: true }), fc.double({ min: 0, max: 800, noNaN: true }), (w, d) => {
        const bounds = { x: 0, z: 0, w, d };
        const r = boundsRadius(bounds);
        const farthestEdge = groundSize(bounds) / 2 - r; // the nearest the edge of the ground can be to the camera
        return fogVisibility(Math.max(farthestEdge, 0) , fogDensity(r)) < 0.05 && maxCameraDistance(r) >= 100;
      }),
    );
  });
});
