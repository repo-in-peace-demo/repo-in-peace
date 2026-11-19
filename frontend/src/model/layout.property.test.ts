import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  crowdedGraveyardArb,
  deepGraveyardArb,
  graveyardArb,
  shuffledGraveyard,
  smallGraveyardArb,
} from '../../test/arbitraries';
import {
  cellOverlap,
  cellsVersusChildPlots,
  containment,
  coverage,
  firstLayoutProblem,
  nonFinite,
  plotOverlap,
  signOverlap,
} from '../../test/layout-checks';
import { validateGraveyard } from '@shared/graveyard-schema';
import { layout } from './layout';
import { MAX_STONE_H, MIN_STONE_H } from './layout-constants';
import { stoneHeight } from './tombstone-height';

/**
 * Properties of the layout (requirements P1 to P4, P6, P10). The checks themselves are in test/layout-checks.ts,
 * written apart from the layout and tested to be able to fail (test/layout-checks.test.ts).
 *
 * Generated graveyards are of every shape: random trees, one crowded folder, chains up to 300 folders deep,
 * wide trees, mixtures; with folders that hold nothing, and ghosts whose folders do and do not exist.
 */

describe('the generated graveyards are valid data files', () => {
  it('pass the shared validator, whatever the shape', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const result = validateGraveyard(g);
        expect(result).toEqual({ ok: true });
        return true;
      }),
      { numRuns: 150 },
    );
  });
});

describe('P1: nothing overlaps', () => {
  it('no two stones or ghosts overlap, anywhere in the graveyard', () => {
    fc.assert(fc.property(graveyardArb, (g) => cellOverlap(layout(g)) === undefined));
  });

  it('no two sibling plots overlap, and no two plots at the same depth', () => {
    fc.assert(fc.property(graveyardArb, (g) => plotOverlap(layout(g)) === undefined));
  });

  it('a folder\'s stones and ghosts do not overlap its child plots', () => {
    fc.assert(fc.property(graveyardArb, (g) => cellsVersusChildPlots(layout(g)) === undefined));
  });

  it('a plot\'s sign overlaps none of its stones, ghosts or child plots', () => {
    fc.assert(fc.property(graveyardArb, (g) => signOverlap(layout(g)) === undefined));
  });

  it('holds for chains of folders 100 to 300 deep', () => {
    fc.assert(
      fc.property(deepGraveyardArb, (g) => {
        const l = layout(g);
        return cellOverlap(l) === undefined && plotOverlap(l) === undefined && cellsVersusChildPlots(l) === undefined;
      }),
      { numRuns: 30 },
    );
  });

  it('holds for 500 to 800 files in one folder', () => {
    fc.assert(
      fc.property(crowdedGraveyardArb, (g) => {
        const l = layout(g);
        return cellOverlap(l) === undefined && cellsVersusChildPlots(l) === undefined;
      }),
      { numRuns: 30 },
    );
  });
});

describe('P2: everything lies inside its plot', () => {
  it('every stone and ghost is inside the content area of its folder\'s plot, every child plot inside its parent\'s, every block and sign inside its plot', () => {
    fc.assert(fc.property(graveyardArb, (g) => containment(layout(g)) === undefined));
  });

  it('holds for deep chains and crowded folders', () => {
    fc.assert(fc.property(deepGraveyardArb, (g) => containment(layout(g)) === undefined), { numRuns: 30 });
    fc.assert(fc.property(crowdedGraveyardArb, (g) => containment(layout(g)) === undefined), { numRuns: 30 });
  });

  it('the bounds are the root plot, which holds every plot, stone and ghost', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const { x, z, w, d } = l.bounds;
        const inside = (r: { x: number; z: number; w: number; d: number }) =>
          r.x >= x - 1e-9 && r.z >= z - 1e-9 && r.x + r.w <= x + w + 1e-9 && r.z + r.d <= z + d + 1e-9;
        return l.plots.every((p) => inside(p.rect)) && l.stones.every((s) => inside(s.cell)) && l.ghosts.every((q) => inside(q.cell));
      }),
    );
  });
});

describe('P3: the same data gives the same layout', () => {
  it('laying out twice gives identical results', () => {
    fc.assert(fc.property(graveyardArb, (g) => JSON.stringify(layout(g)) === JSON.stringify(layout(g))));
  });

  it('does not depend on the order of the folders, files and ghosts in the data file', () => {
    fc.assert(
      fc.property(graveyardArb, fc.integer({ min: 0, max: 1_000_000 }), (g, seed) => {
        return JSON.stringify(layout(shuffledGraveyard(g, seed))) === JSON.stringify(layout(g));
      }),
    );
  });

  it('does not change the data file it is given', () => {
    fc.assert(
      fc.property(smallGraveyardArb, (g) => {
        const before = JSON.stringify(g);
        layout(g);
        return JSON.stringify(g) === before;
      }),
    );
  });
});

describe('P4: one position for every file and ghost, one plot for every folder', () => {
  it('has exactly the paths of the data file, each once, and each stone in its own folder', () => {
    fc.assert(fc.property(graveyardArb, (g) => coverage(g, layout(g)) === undefined));
  });

  it('gives every stone the height of its file\'s lines of code, within the range', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const lines = new Map(g.files.map((f) => [f.path, f.linesOfCode] as const));
        return layout(g).stones.every(
          (s) => s.height === stoneHeight(lines.get(s.path)!) && s.height >= MIN_STONE_H && s.height <= MAX_STONE_H,
        );
      }),
    );
  });
});

describe('P6: ghosts sit in their old folder, or the nearest ancestor that still exists', () => {
  /** The oracle: walk up the path one directory at a time through the set of folders. */
  function expectedFolder(path: string, folders: Set<string>): string {
    const segments = path.split('/');
    for (let length = segments.length - 1; length >= 1; length--) {
      const candidate = segments.slice(0, length).join('/');
      if (folders.has(candidate)) return candidate;
    }
    return '';
  }

  it('agrees with the oracle for every ghost', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const folders = new Set(g.folders.map((f) => f.path));
        return layout(g).ghosts.every((ghost) => ghost.folder === expectedFolder(ghost.path, folders));
      }),
    );
  });

  it('always names a folder that has a plot', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const plots = new Set(l.plots.map((p) => p.path));
        return l.ghosts.every((ghost) => plots.has(ghost.folder));
      }),
    );
  });

  it('puts a ghost in a cell of its own, after all the stones of its folder', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const order = (a: { cell: { x: number; z: number } }, b: { cell: { x: number; z: number } }) =>
          a.cell.z - b.cell.z || a.cell.x - b.cell.x;
        for (const block of l.blocks) {
          const stones = l.stones.filter((s) => s.folder === block.folder).sort(order);
          const ghosts = l.ghosts.filter((q) => q.folder === block.folder).sort(order);
          const lastStone = stones[stones.length - 1];
          const firstGhost = ghosts[0];
          if (lastStone && firstGhost && order(lastStone, firstGhost) >= 0) return false;
        }
        return true;
      }),
    );
  });
});

describe('P10: finite numbers, and a crowded folder is not a long strip', () => {
  it('has no NaN or infinite number anywhere in the layout', () => {
    fc.assert(fc.property(graveyardArb, (g) => nonFinite(layout(g)) === undefined));
  });

  it('gives a plot for 500 to 800 files, and nothing else, that is at most 3 times longer than wide', () => {
    fc.assert(
      fc.property(crowdedGraveyardArb, (g) => {
        const l = layout(g);
        const src = l.plots.find((p) => p.path === 'src')!;
        const longest = Math.max(src.rect.w, src.rect.d);
        const shortest = Math.min(src.rect.w, src.rect.d);
        return longest / shortest <= 3;
      }),
      { numRuns: 50 },
    );
  });

  it('keeps every checked property for a graveyard of any shape, in one go', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        expect(firstLayoutProblem(g, layout(g))).toBeUndefined();
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
