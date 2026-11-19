import { describe, expect, it } from 'vitest';
import { CELL_D, CELL_W } from './layout-constants';
import { GHOST_MAX_RADIUS, GHOST_PROFILE, GHOST_SWAY, GHOST_TOP, ghostFits } from './ghost-shape';
import { GHOST_D, GHOST_HEIGHT, GHOST_W } from './visual-constants';

describe('the ghost\'s silhouette', () => {
  it('fits inside the ground it is given, sway included, and that ground is inside the stone cell', () => {
    expect(ghostFits()).toBe(true);
    expect(2 * (GHOST_MAX_RADIUS + GHOST_SWAY)).toBeLessThanOrEqual(Math.min(GHOST_W, GHOST_D));
    expect(GHOST_W).toBeLessThanOrEqual(CELL_W);
    expect(GHOST_D).toBeLessThanOrEqual(CELL_D);
  });

  it('is as tall as the height the camera, the picking box and the ring are built for', () => {
    expect(GHOST_TOP).toBeGreaterThan(GHOST_HEIGHT - 0.05);
    expect(GHOST_TOP).toBeLessThan(GHOST_HEIGHT + 0.05);
  });

  it('has no base: it narrows toward the bottom to a point, where a gravestone is widest', () => {
    const [bottom, ...rest] = GHOST_PROFILE;
    expect(bottom![0]).toBe(0);
    expect(rest[0]![0]).toBeLessThan(0.1);
    const lowerThird = GHOST_PROFILE.filter(([, h]) => h < GHOST_TOP / 3).map(([r]) => r);
    expect(Math.max(...lowerThird)).toBeLessThan(0.5 * GHOST_MAX_RADIUS);
  });

  it('has a rounded head: it comes in to a point at the top, with each step narrower than the one below it', () => {
    const head = GHOST_PROFILE.filter(([, h]) => h > 1.3);
    for (let i = 1; i < head.length; i++) expect(head[i]![0]).toBeLessThan(head[i - 1]![0]);
    expect(GHOST_PROFILE[GHOST_PROFILE.length - 1]![0]).toBe(0);
  });

  it('is widest in the upper half, widening upward through the body', () => {
    const widest = GHOST_PROFILE.reduce((a, b) => (b[0] > a[0] ? b : a));
    expect(widest[1]).toBeGreaterThan(GHOST_TOP / 2);
    const body = GHOST_PROFILE.filter(([, h]) => h <= widest[1]);
    for (let i = 1; i < body.length; i++) expect(body[i]![0]).toBeGreaterThan(body[i - 1]![0]);
  });

  it('goes up from the bottom, one point above the other', () => {
    for (let i = 1; i < GHOST_PROFILE.length; i++) expect(GHOST_PROFILE[i]![1]).toBeGreaterThan(GHOST_PROFILE[i - 1]![1]);
  });
});
