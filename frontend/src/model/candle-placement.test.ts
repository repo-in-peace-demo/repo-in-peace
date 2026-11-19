import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { graveyardArb } from '../../test/arbitraries';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { candleCentre, candleSpots } from './candle-placement';
import { STONE_D, STONE_W } from './layout-constants';
import { buildSceneModel } from './scene-model';
import { CANDLE_HEIGHT, CANDLE_RADIUS, FLAME_HEIGHT } from './visual-constants';
import { MIN_STONE_H } from './layout-constants';

describe('candleCentre', () => {
  it('stands in front of the stone and to the right of its middle, clear of the stone\'s base', () => {
    const c = candleCentre(10, 20);
    expect(c.x).toBeGreaterThan(10 + STONE_W / 2); // beside the stone, so the sign board in front of it does not hide it
    expect(c.z - CANDLE_RADIUS).toBeGreaterThan(20 + STONE_D / 2); // the candle's back edge is in front of the stone's front face
  });
});

describe('candleSpots', () => {
  it.each(REAL_GRAVEYARDS)('%s: one candle for every hot file, and none for the others', (name) => {
    const g = loadRealGraveyard(name);
    const model = buildSceneModel(g);
    const spots = candleSpots(model.stones);
    const hot = g.files.filter((f) => f.hot).map((f) => f.path).sort();
    expect(spots.map((s) => s.path).sort()).toEqual(hot);
  });

  it('puts every candle inside its stone\'s cell, clear of the stone, and lower than the shortest stone, for any graveyard', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const model = buildSceneModel(g);
        const byPath = new Map(model.stones.map((s) => [s.file.path, s] as const));
        return candleSpots(model.stones).every((spot) => {
          const stone = byPath.get(spot.path)!;
          const cell = stone.layout.cell;
          const inside =
            spot.x - CANDLE_RADIUS >= cell.x && spot.x + CANDLE_RADIUS <= cell.x + cell.w &&
            spot.z - CANDLE_RADIUS >= cell.z && spot.z + CANDLE_RADIUS <= cell.z + cell.d;
          const clearOfStone = spot.z - CANDLE_RADIUS >= stone.layout.z + STONE_D / 2;
          return inside && clearOfStone;
        });
      }),
      { numRuns: 40 },
    );
  });

  it('flipping hot changes only the candle list, and flipping unused changes nothing in it', () => {
    fc.assert(
      fc.property(graveyardArb, fc.nat(), (g, k) => {
        if (g.files.length === 0) return true;
        const target = g.files[k % g.files.length]!.path;
        const flipped = (field: 'unused' | 'hot') => ({ ...g, files: g.files.map((f) => (f.path === target ? { ...f, [field]: !f[field] } : f)) });
        const paths = (graveyard: typeof g) => candleSpots(buildSceneModel(graveyard).stones).map((s) => s.path);
        const base = paths(g);
        const wasHot = g.files.find((f) => f.path === target)!.hot;
        const expected = wasHot ? base.filter((p) => p !== target) : [...base, target].sort();
        return JSON.stringify(paths(flipped('unused'))) === JSON.stringify(base) && JSON.stringify([...paths(flipped('hot'))].sort()) === JSON.stringify([...expected].sort());
      }),
      { numRuns: 40 },
    );
  });

  it('keeps the wax and the flame below the height where the stones start', () => {
    expect(CANDLE_HEIGHT).toBeLessThan(MIN_STONE_H);
    expect(CANDLE_HEIGHT + FLAME_HEIGHT).toBeLessThan(MIN_STONE_H);
  });
});
