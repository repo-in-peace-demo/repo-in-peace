import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type Graveyard } from '@shared/graveyard-schema';
import {
  GRAVEYARD_NAME_PATTERN,
  checkGraveyardData,
  graveyardUrl,
  parseGraveyardName,
  routeFromAddress,
} from './graveyard-load';

const SHA = 'a'.repeat(40);

/** A small graveyard that passes the shared validator. */
function validGraveyard(): Graveyard {
  return {
    meta: {
      name: 'demo',
      snapshotSha: SHA,
      snapshotDate: '2026-03-01T12:00:00.000Z',
      analysedAt: '2026-03-02T09:30:00.000Z',
      schemaVersion: SCHEMA_VERSION,
      thresholds: { staleAfterDays: 21, ancientAfterDays: 45, decayCapDays: 90, hotCommits: 5, hotWindowDays: 30 },
    },
    folders: [
      { path: '', parent: null },
      { path: 'src', parent: '' },
    ],
    files: [
      {
        path: 'src/a.ts',
        folder: 'src',
        linesOfCode: 12,
        lastCommitDate: '2026-02-27T08:00:00.000Z',
        lastCommitAuthor: 'Ann',
        recentCommits: 1,
        unused: false,
        decayScore: 0.0044,
        decayState: 'fresh',
        hot: false,
        eulogy: '',
      },
    ],
    ghosts: [],
  };
}

describe('parseGraveyardName', () => {
  it('names nothing when the address has no graveyard parameter (the boot screen shows then)', () => {
    expect(parseGraveyardName('')).toBeNull();
    expect(parseGraveyardName('?other=1')).toBeNull();
  });

  it.each([
    ['?graveyard=demo.oikosledger', 'demo.oikosledger'],
    ['graveyard=demo.oikosledger', 'demo.oikosledger'], // without the question mark
    ['?x=1&graveyard=my_repo-2.v1&y=2', 'my_repo-2.v1'],
    ['?graveyard=a', 'a'],
    ['?graveyard=A.B_c-D', 'A.B_c-D'],
  ])('reads %s as %s', (search, name) => {
    expect(parseGraveyardName(search)).toEqual({ ok: true, name });
  });

  it('uses the first graveyard parameter when there are several', () => {
    expect(parseGraveyardName('?graveyard=one&graveyard=two')).toEqual({ ok: true, name: 'one' });
  });

  it('accepts exactly 100 characters', () => {
    expect(parseGraveyardName(`?graveyard=${'a'.repeat(100)}`)?.ok).toBe(true);
  });

  it.each([
    ['an empty name', '?graveyard='],
    ['101 characters', `?graveyard=${'a'.repeat(101)}`],
    ['a slash', '?graveyard=a%2Fb'],
    ['a path that climbs out', '?graveyard=..%2Fsecret'],
    ['an absolute path', '?graveyard=%2Fetc%2Fpasswd'],
    ['a backslash', '?graveyard=a%5Cb'],
    ['a space', '?graveyard=a%20b'],
    ['a URL', '?graveyard=https%3A%2F%2Fevil.example%2Fx'],
    ['a null character', '?graveyard=a%00b'],
    ['a non-ASCII letter', '?graveyard=caf%C3%A9'],
    ['a plus sign, which the address reads as a space', '?graveyard=a+b'],
    ['markup', '?graveyard=%3Cscript%3E'],
  ])('rejects %s, with a message and no name', (_label, search) => {
    const result = parseGraveyardName(search);
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.message).toContain('is not allowed');
  });

  it('shortens a very long name in the message', () => {
    const result = parseGraveyardName(`?graveyard=${'x'.repeat(5000)}%2F`);
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.message.length).toBeLessThan(300);
  });

  it('accepts a name made only of dots, which cannot leave the graveyards folder', () => {
    // "..", but with ".graveyard.json" added the file is "...graveyard.json" inside graveyards/.
    expect(parseGraveyardName('?graveyard=..')?.ok).toBe(true);
    expect(graveyardUrl('..', '/')).toBe('/graveyards/...graveyard.json');
  });
});

describe('routeFromAddress', () => {
  it('shows the boot screen for a bare address, and for an address with other parameters only', () => {
    expect(routeFromAddress('')).toEqual({ kind: 'boot' });
    expect(routeFromAddress('?stats')).toEqual({ kind: 'boot' });
  });

  it('goes to a named demo, and refuses a bad name with the message (nothing to request)', () => {
    expect(routeFromAddress('?graveyard=demo.oikosledger')).toEqual({ kind: 'demo', name: 'demo.oikosledger' });
    const bad = routeFromAddress('?graveyard=..%2Fsecret');
    expect(bad.kind).toBe('bad-name');
    if (bad.kind === 'bad-name') expect(bad.message).toContain('is not allowed');
  });

  it('goes to a made-up graveyard only when the build passes a count, and a graveyard name wins over it', () => {
    expect(routeFromAddress('?synthetic=2000', null)).toEqual({ kind: 'boot' }); // production: the count is never read
    expect(routeFromAddress('?synthetic=2000', 2000)).toEqual({ kind: 'made', files: 2000 });
    expect(routeFromAddress('?graveyard=demo.spatialql&synthetic=5', 5)).toEqual({ kind: 'demo', name: 'demo.spatialql' });
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(routeFromAddress('', bad)).toEqual({ kind: 'boot' });
  });

  it('for any address: a graveyard parameter decides alone, and without one it is boot or made', () => {
    fc.assert(
      fc.property(fc.option(fc.string({ maxLength: 40 }), { nil: undefined }), fc.option(fc.integer({ min: -5, max: 5000 }), { nil: null }), (name, made) => {
        const search = name === undefined ? '?x=1' : `?graveyard=${encodeURIComponent(name)}`;
        const route = routeFromAddress(search, made);
        if (name !== undefined) return route.kind === (GRAVEYARD_NAME_PATTERN.test(name) ? 'demo' : 'bad-name');
        return route.kind === (made !== null && made >= 1 ? 'made' : 'boot');
      }),
    );
  });
});

describe('graveyardUrl', () => {
  it('puts the file in graveyards/ under the base address', () => {
    expect(graveyardUrl('demo.spatialql', '/')).toBe('/graveyards/demo.spatialql.graveyard.json');
  });

  it('works when the site is served from a sub-path, with or without a trailing slash', () => {
    expect(graveyardUrl('demo', '/repo-in-peace/')).toBe('/repo-in-peace/graveyards/demo.graveyard.json');
    expect(graveyardUrl('demo', '/repo-in-peace')).toBe('/repo-in-peace/graveyards/demo.graveyard.json');
  });
});

describe('P13: the name check accepts exactly the allowed names', () => {
  it('agrees with the rule for any text, including text near the length limits', () => {
    const text = fc.oneof(
      fc.string({ unit: 'grapheme', maxLength: 130 }),
      fc.stringMatching(/^[A-Za-z0-9._-]{0,110}$/),
      fc.stringMatching(/^[A-Za-z0-9._-]{0,50}[/\\ %+:?#][A-Za-z0-9._-]{0,50}$/),
    );
    fc.assert(
      fc.property(text, (name) => {
        const result = parseGraveyardName(`?graveyard=${encodeURIComponent(name)}`)!;
        return result.ok === GRAVEYARD_NAME_PATTERN.test(name) && (!result.ok || result.name === name);
      }),
    );
  });

  it('never names a file outside graveyards/: an accepted name has no slash and no backslash', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 130 }), (name) => {
        const result = parseGraveyardName(`?graveyard=${encodeURIComponent(name)}`)!;
        return !result.ok || !/[/\\]/.test(result.name);
      }),
    );
  });
});

describe('checkGraveyardData', () => {
  it('accepts a valid file and returns it', () => {
    const data = validGraveyard();
    const result = checkGraveyardData(data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.graveyard).toBe(data);
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['text', 'hello'],
    ['a list', []],
    ['an empty object', {}],
    ['a meta that is not an object', { meta: 5 }],
    ['a null meta', { meta: null }],
    ['a list as meta', { meta: [] }],
  ])('says it is not a graveyard file for %s', (_label, value) => {
    const result = checkGraveyardData(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('not-a-graveyard');
      expect(result.message).toContain('not a graveyard file');
    }
  });

  describe('schema version', () => {
    it('names both versions for a version 1 file, and tells the user to make the file again', () => {
      const v1 = { ...validGraveyard(), meta: { ...validGraveyard().meta, schemaVersion: 1 } };
      const result = checkGraveyardData(v1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('wrong-version');
        expect(result.message).toContain('schema version 1');
        expect(result.message).toContain('reads version 2');
        expect(result.message).toContain('current analyser');
      }
    });

    it('gives the version message, and not a list of missing fields, for an old file with other differences', () => {
      const old = { meta: { name: 'x', schemaVersion: 1 }, folders: [], files: [{ path: 'a.ts', commitsLast30Days: 1 }] };
      const result = checkGraveyardData(old);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('wrong-version');
        expect(result.details).toEqual([]);
      }
    });

    it('also rejects a newer version', () => {
      const v3 = { ...validGraveyard(), meta: { ...validGraveyard().meta, schemaVersion: 3 } };
      const result = checkGraveyardData(v3);
      expect(!result.ok && result.kind === 'wrong-version' && result.message.includes('schema version 3')).toBe(true);
    });

    it('P7 (interface spec): any version other than 2 always gives the version message, and a valid version 2 file always loads; a file picked from disk takes this check too', () => {
      fc.assert(
        fc.property(fc.oneof(fc.integer(), fc.double(), fc.string(), fc.constant(null), fc.boolean()), (version) => {
          const result = checkGraveyardData({ ...validGraveyard(), meta: { ...validGraveyard().meta, schemaVersion: version } });
          if (version === SCHEMA_VERSION) return result.ok;
          return !result.ok && result.kind === 'wrong-version' && result.message.includes(`reads version ${SCHEMA_VERSION}`);
        }),
      );
      expect(checkGraveyardData(validGraveyard()).ok).toBe(true);
    });

    it.each([
      ['missing', undefined, 'missing, or not a number'],
      ['a string', '2', '"2"'],
      ['null', null, 'missing, or not a number'],
      ['a fraction', 2.5, '2.5'],
    ])('rejects a version that is %s', (_label, version, shown) => {
      const meta: Record<string, unknown> = { ...validGraveyard().meta };
      if (version === undefined) delete meta['schemaVersion'];
      else meta['schemaVersion'] = version;
      const result = checkGraveyardData({ ...validGraveyard(), meta });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('wrong-version');
        expect(result.message).toContain(shown);
      }
    });

    it('shortens a very long version string in the message', () => {
      const meta = { ...validGraveyard().meta, schemaVersion: 'x'.repeat(5000) };
      const result = checkGraveyardData({ ...validGraveyard(), meta });
      expect(!result.ok && result.message.length < 300).toBe(true);
    });
  });

  describe('structure', () => {
    it('reports a broken folder reference as invalid, with the problem', () => {
      const data = validGraveyard();
      data.files[0]!.folder = 'nowhere';
      const result = checkGraveyardData(data);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('invalid');
        expect(result.details).toEqual(['files[0].folder "nowhere" is not in the folder list']);
        expect(result.message).toContain('1 problem found');
      }
    });

    it('reports missing thresholds as invalid', () => {
      const data = validGraveyard();
      Reflect.deleteProperty(data.meta, 'thresholds');
      const result = checkGraveyardData(data);
      expect(!result.ok && result.kind === 'invalid' && result.details.includes('meta.thresholds must be an object')).toBe(true);
    });

    it('shows at most the first five problems, and says there are more', () => {
      const data = validGraveyard();
      data.files = Array.from({ length: 20 }, (_, i) => ({ ...data.files[0]!, path: `src/f${i}.ts`, decayScore: 9 }));
      const result = checkGraveyardData(data);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.details).toHaveLength(5);
        expect(result.message).toContain('20 problems found, the first 5 are shown');
      }
    });
  });

  describe('properties', () => {
    it('gives the version message for any schemaVersion other than 2', () => {
      fc.assert(
        fc.property(
          fc.jsonValue().filter((v) => v !== SCHEMA_VERSION),
          fc.boolean(),
          (version, missing) => {
            const meta: Record<string, unknown> = { ...validGraveyard().meta, schemaVersion: version };
            if (missing) delete meta['schemaVersion'];
            const result = checkGraveyardData({ ...validGraveyard(), meta });
            return !result.ok && result.kind === 'wrong-version' && result.message.includes('reads version 2');
          },
        ),
      );
    });

    it('never gives the version message for version 2', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (junk) => {
          const result = checkGraveyardData({ ...validGraveyard(), files: junk });
          return result.ok || result.kind !== 'wrong-version';
        }),
      );
    });

    it('returns a result, and never throws, for any JSON value', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (value) => {
          const result = checkGraveyardData(value);
          return result.ok || ['not-a-graveyard', 'wrong-version', 'invalid'].includes(result.kind);
        }),
      );
    });
  });
});

describe('the real test files', () => {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/graveyards/${name}.graveyard.json`, import.meta.url)), 'utf8'));

  it.each(['demo.oikosledger', 'demo.spatialql'])('%s loads', (name) => {
    const result = checkGraveyardData(read(name));
    expect(result.ok).toBe(true);
  });

  it('read as the schema says: thresholds and counts of the two files', () => {
    const oikos = checkGraveyardData(read('demo.oikosledger'));
    const spatial = checkGraveyardData(read('demo.spatialql'));
    if (!oikos.ok || !spatial.ok) throw new Error('the test files should load');

    expect(oikos.graveyard.meta.thresholds).toMatchObject({ staleAfterDays: 21, ancientAfterDays: 45, decayCapDays: 90 });
    expect(oikos.graveyard.files).toHaveLength(129);
    expect(oikos.graveyard.ghosts).toHaveLength(0);

    expect(spatial.graveyard.meta.thresholds).toMatchObject({ staleAfterDays: 14, ancientAfterDays: 30, decayCapDays: 60 });
    expect(spatial.graveyard.files).toHaveLength(120);
    expect(spatial.graveyard.ghosts.map((g) => g.path).sort()).toEqual([
      'src/data/surface-placement.test.ts',
      'src/surface-placement.ts',
    ]);
  });
});

describe('P9 (eulogies spec): the optional eulogy fields', () => {
  it('loads a file with them, and one without them, the same way otherwise', () => {
    const plain = validGraveyard();
    const withFields = { ...validGraveyard(), meta: { ...validGraveyard().meta, eulogyModel: 'qwen2.5:7b' }, ghosts: validGraveyard().ghosts.map((g) => ({ ...g, eulogy: 'Here lay a file.' })) };
    const a = checkGraveyardData(plain);
    const b = checkGraveyardData(withFields);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.graveyard.meta.eulogyModel).toBe('qwen2.5:7b');
      expect(a.graveyard.meta.eulogyModel).toBeUndefined();
      expect(b.graveyard.files).toEqual(a.graveyard.files);
    }
  });

  it('refuses a model that is not a non-empty string', () => {
    const bad = { ...validGraveyard(), meta: { ...validGraveyard().meta, eulogyModel: '' } };
    const result = checkGraveyardData(bad);
    expect(result.ok).toBe(false);
  });
});

