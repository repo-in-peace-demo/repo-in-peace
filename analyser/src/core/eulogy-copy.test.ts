import { describe, expect, it } from 'vitest';
import type { Graveyard } from '../../../shared/graveyard-schema';
import { copyEulogies } from './eulogy-copy';

const file = (path: string, eulogy = '') => ({ path, eulogy }) as Graveyard['files'][number];
const ghost = (path: string, eulogy?: string) => ({ path, ...(eulogy === undefined ? {} : { eulogy }) }) as Graveyard['ghosts'][number];
const data = (files: Graveyard['files'], ghosts: Graveyard['ghosts'], eulogyModel?: string) =>
  ({ meta: { name: 'r', ...(eulogyModel ? { eulogyModel } : {}) }, folders: [], files, ghosts }) as unknown as Graveyard;

describe('copyEulogies', () => {
  it('matches files to files and ghosts to ghosts by path, and takes the model', () => {
    const earlier = data([file('a.ts', 'A.'), file('gone.ts', 'G as a file.')], [ghost('gone.ts', 'G as a ghost.'), ghost('b.ts', 'B.')], 'm:1b');
    const { graveyard, missing } = copyEulogies(data([file('a.ts')], [ghost('gone.ts'), ghost('b.ts')]), earlier);
    expect(graveyard.meta.eulogyModel).toBe('m:1b');
    expect(graveyard.files.map((f) => f.eulogy)).toEqual(['A.']);
    expect(graveyard.ghosts.map((g) => g.eulogy)).toEqual(['G as a ghost.', 'B.']);
    expect(missing).toEqual([]);
  });

  it('keeps an empty eulogy as copied, and gives "" to what is missing, listing files then ghosts', () => {
    const earlier = data([file('a.ts', '')], [ghost('x.ts')], 'm');
    const { graveyard, missing } = copyEulogies(data([file('new.ts'), file('a.ts')], [ghost('x.ts'), ghost('y.ts')]), earlier);
    expect(graveyard.files.map((f) => f.eulogy)).toEqual(['', '']);
    expect(graveyard.ghosts.map((g) => g.eulogy)).toEqual(['', '']);
    expect(missing).toEqual(['new.ts (file)', 'x.ts (ghost)', 'y.ts (ghost)']);
  });

  it('changes nothing else, and leaves its inputs alone', () => {
    const now = data([file('a.ts')], [], undefined);
    const frozen = JSON.stringify(now);
    const { graveyard } = copyEulogies(now, data([file('a.ts', 'A.')], [], 'm'));
    expect(JSON.stringify(now)).toBe(frozen);
    expect({ ...graveyard, meta: { ...graveyard.meta, eulogyModel: undefined }, files: graveyard.files.map((f) => ({ ...f, eulogy: '' })) }).toEqual({
      ...now,
      meta: { ...now.meta, eulogyModel: undefined },
    });
  });
});
