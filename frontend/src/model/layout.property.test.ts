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
  AREA_BOUND,
  areaProblems,
  cellOverlap,
  cellsVersusChildPlots,
  containment,
  coverage,
  firstLayoutProblem,
  mergeProblems,
  nonFinite,
  plotOverlap,
  signOverlap,
  signSeparation,
} from '../../test/layout-checks';
import { makeSyntheticGraveyard } from './synthetic';
import { validateGraveyard } from '@shared/graveyard-schema';
import { layout } from './layout';
import { MAX_STONE_H, MIN_STONE_H, PACK_LIMIT_ASPECT } from './layout-constants';
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

  it('P14: no two plaques are close enough to overlap on the screen, for graveyards of every shape (a plot and the one inside it have their signs far enough apart)', () => {
    fc.assert(fc.property(graveyardArb, (g) => signSeparation(layout(g)) === undefined), { numRuns: 150 });
    fc.assert(fc.property(deepGraveyardArb, (g) => signSeparation(layout(g)) === undefined), { numRuns: 20 });
    fc.assert(fc.property(crowdedGraveyardArb, (g) => signSeparation(layout(g)) === undefined), { numRuns: 10 });
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

describe('P4: one position for every file and ghost, every folder in exactly one plot', () => {
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

describe('folders shown together', () => {
  it('follows the rules, for graveyards of every shape: only empty single-child folders are merged, chains are as long as they can be (the root\'s too), folders with ghosts never are, and every plot is named for its folders', () => {
    fc.assert(fc.property(graveyardArb, (g) => mergeProblems(g, layout(g)) === undefined), { numRuns: 150 });
  });

  it('shows every folder in exactly one plot, and the plot for a folder with files or ghosts is its own', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const shown = l.plots.flatMap((p) => p.folders);
        const inPlot = new Set(shown);
        const holders = new Set([...g.files.map((f) => f.folder), ...l.ghosts.map((q) => q.folder)]);
        return (
          shown.length === g.folders.length &&
          inPlot.size === g.folders.length &&
          g.folders.every((f) => inPlot.has(f.path)) &&
          [...holders].every((h) => l.plots.some((p) => p.path === h))
        );
      }),
    );
  });

  it('has exactly one plot that holds the root, with no plot around it and the bounds for its rectangle; it is the root alone when the root holds a file or a ghost or has other than one folder, and is shown with the folder inside it otherwise', () => {
    fc.assert(
      fc.property(graveyardArb, (g) => {
        const l = layout(g);
        const outermost = l.plots.filter((p) => p.parent === null);
        if (outermost.length !== 1) return false;
        const root = outermost[0]!;
        const holdsSomething = g.files.some((f) => f.folder === '') || l.ghosts.some((q) => q.folder === '');
        const rootChildren = g.folders.filter((f) => f.parent === '').length;
        const alone = holdsSomething || rootChildren !== 1;
        return (
          root.folders[0] === '' &&
          JSON.stringify(l.bounds) === JSON.stringify(root.rect) &&
          (alone ? root.folders.length === 1 && root.path === '' : root.folders.length >= 2)
        );
      }),
    );
  });

  it('does not make a graveyard bigger: it never has more plots than folders', () => {
    fc.assert(fc.property(graveyardArb, (g) => layout(g).plots.length <= g.folders.length));
  });

  it('shows a deep chain as one plot when only its bottom holds files, and as one plot per level when every level does', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 0, max: 20 }), (depth, files) => {
        // No ghosts here (they are 2% of the files, and there are fewer than 50). The files are shared out one level at a time:
        // every level gets some when there are at least as many files as levels, and otherwise only the deepest level gets them.
        const g = makeSyntheticGraveyard({ files, seed: 3, shape: 'deep', depth });
        const l = layout(g);
        const expectedPlots = files >= depth ? depth : 1; // one plot for every level (the root, which holds nothing, is in the first), or one for the whole chain
        return l.plots.length === expectedPlots && mergeProblems(g, l) === undefined;
      }),
      { numRuns: 80 },
    );
  });
});

describe('packing: little empty ground, close to a square', () => {
  it(`keeps every plot's content within ${AREA_BOUND} times the area of what it holds, gaps counted, for graveyards of every shape`, () => {
    fc.assert(fc.property(graveyardArb, (g) => areaProblems(layout(g)) === undefined), { numRuns: 150 });
  });

  it('holds for 500 to 800 files in one folder, and for chains', () => {
    fc.assert(fc.property(crowdedGraveyardArb, (g) => areaProblems(layout(g)) === undefined), { numRuns: 30 });
    fc.assert(fc.property(deepGraveyardArb, (g) => areaProblems(layout(g)) === undefined), { numRuns: 30 });
  });

  it('puts a wide tree of similar folders into a plot that is close to a square', () => {
    const wide = fc.record({ files: fc.integer({ min: 150, max: 700 }), seed: fc.integer({ min: 0, max: 100_000 }) });
    fc.assert(
      fc.property(wide, ({ files, seed }) => {
        const l = layout(makeSyntheticGraveyard({ files, seed, shape: 'wide', ghosts: 0 }));
        const { w, d } = l.bounds;
        return Math.max(w, d) / Math.min(w, d) <= 1.5;
      }),
      { numRuns: 40 },
    );
  });

  it('is never longer than PACK_LIMIT_ASPECT (2.2) times as wide for the whole graveyard, for a tree with many folders', () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 700 }), fc.integer({ min: 0, max: 100_000 }), (files, seed) => {
        const l = layout(makeSyntheticGraveyard({ files, seed, shape: 'tree' }));
        const { w, d } = l.bounds;
        return Math.max(w, d) / Math.min(w, d) <= PACK_LIMIT_ASPECT + 1e-9;
      }),
      { numRuns: 40 },
    );
  });
});
