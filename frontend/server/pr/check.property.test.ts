import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buryOffered } from '../../src/model/grave-facts';
import { makeSyntheticGraveyard } from '../../src/model/synthetic';
import { checkAgainstGraveyard } from './check';
import { ACTIONS } from './request';

const graveyardArb = fc.record({ files: fc.integer({ min: 1, max: 60 }), seed: fc.nat(10_000), ghosts: fc.integer({ min: 0, max: 6 }) }).map((o) => makeSyntheticGraveyard(o));

describe('P1 (pure part): the check against the data file', () => {
  const seen = { bury: 0, resurrect: 0, refused: 0 };

  it('accepts exactly Bury on unused current files and Resurrect on ghosts; everything else is refused', () => {
    fc.assert(
      fc.property(graveyardArb, fc.constantFrom(...ACTIONS), fc.nat(), fc.constantFrom('unused', 'used', 'ghost', 'elsewhere'), (g, action, i, from) => {
        const pool = from === 'unused' ? g.files.filter((f) => f.unused) : from === 'used' ? g.files.filter((f) => !f.unused) : from === 'ghost' ? g.ghosts : [];
        const path = pool.length > 0 ? pool[i % pool.length]!.path : `nowhere/${i}.ts`;
        const file = g.files.find((f) => f.path === path);
        const ghost = g.ghosts.find((x) => x.path === path);
        const expected = action === 'bury' ? file !== undefined && buryOffered(file) : ghost !== undefined;
        const r = checkAgainstGraveyard(g, action, path);
        if (expected) seen[action]++;
        else seen.refused++;
        if (expected) {
          expect(r).toEqual(action === 'bury' ? { action, file } : { action, ghost });
        } else {
          expect(r).toMatchObject({ status: file === undefined && ghost === undefined ? 404 : 409 });
          expect('error' in r && r.error.length > 0).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('saw both actions accepted and many refusals, so the property is not empty', () => {
    expect(seen.bury).toBeGreaterThan(5);
    expect(seen.resurrect).toBeGreaterThan(5);
    expect(seen.refused).toBeGreaterThan(50);
  });

  it('matches paths exactly: no case folding, trimming or normalising', () => {
    const g = makeSyntheticGraveyard({ files: 20, seed: 3, ghosts: 2 });
    const unused = g.files.find((f) => f.unused)!;
    for (const variant of [unused.path.toUpperCase(), ` ${unused.path}`, `./${unused.path}`, unused.path.replace('/', '//'), `${unused.path}/`]) {
      if (variant === unused.path) continue;
      expect(checkAgainstGraveyard(g, 'bury', variant)).toMatchObject({ status: 404 });
    }
  });

  it('says why', () => {
    const g = makeSyntheticGraveyard({ files: 30, seed: 5, ghosts: 2 });
    const used = g.files.find((f) => !f.unused)!;
    const ghost = g.ghosts[0]!;
    expect(checkAgainstGraveyard(g, 'bury', used.path)).toEqual({ error: `Only unused files can be buried; ${used.path} is used.`, status: 409 });
    expect(checkAgainstGraveyard(g, 'bury', ghost.path)).toMatchObject({ status: 409, error: expect.stringContaining('resurrected, not buried') });
    expect(checkAgainstGraveyard(g, 'resurrect', used.path)).toMatchObject({ status: 409, error: expect.stringContaining('still in the repository') });
    expect(checkAgainstGraveyard(g, 'resurrect', 'no/such.ts')).toEqual({ error: 'no/such.ts is not in this graveyard.', status: 404 });
  });
});
