import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REAL_GRAVEYARDS, loadRealGraveyard } from '../../test/real-data';
import { TAG_MAX_LENGTH, TAG_NO_TYPE, ghostTagText, tagAtlasTexts } from './ghost-tag';

describe('ghostTagText', () => {
  it('is the type of the file, from the last dot', () => {
    expect(ghostTagText('src/surface-placement.ts')).toBe('.ts');
    expect(ghostTagText('src/data/surface-placement.test.ts')).toBe('.ts');
    expect(ghostTagText('app/page.tsx')).toBe('.tsx');
    expect(ghostTagText('a.config.mjs')).toBe('.mjs');
    expect(ghostTagText('x.js')).toBe('.js');
  });

  it('says a dot alone for a file with no type: no dot, a leading dot only, or a dot at the end', () => {
    for (const path of ['Makefile', 'src/Makefile', '.gitignore', 'src/.eslintrc', 'weird.', 'a/b/c']) expect(ghostTagText(path)).toBe(TAG_NO_TYPE);
  });

  it('cuts a long type and marks it', () => {
    expect(ghostTagText('a.verylongextension')).toBe('.very…');
    expect(ghostTagText('a.verylongextension').length).toBe(TAG_MAX_LENGTH);
  });

  it('is never longer than the limit, never empty, and a type or the no-type mark, for any path', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 40 }), (path) => {
        const text = ghostTagText(path);
        return text.length >= 1 && [...text].length <= TAG_MAX_LENGTH && (text === TAG_NO_TYPE || text.startsWith('.'));
      }),
    );
  });

  it('does not depend on the folders', () => {
    fc.assert(fc.property(fc.stringMatching(/^[a-z]{1,6}(\/[a-z]{1,6}){0,3}$/), fc.stringMatching(/^[a-z]{1,6}\.[a-z]{1,4}$/), (folder, name) => ghostTagText(`${folder}/${name}`) === ghostTagText(name)));
  });

  it.each(REAL_GRAVEYARDS)('%s: the ghosts of the test file say .ts', (name) => {
    const g = loadRealGraveyard(name);
    for (const ghost of g.ghosts) expect(ghostTagText(ghost.path)).toBe('.ts');
  });
});

describe('tagAtlasTexts', () => {
  it('lists each distinct text once, in order', () => {
    expect(tagAtlasTexts(['a.ts', 'b.tsx', 'c.ts', 'd/e.ts', 'Makefile'])).toEqual(['.ts', '.tsx', '·'].sort());
    expect(tagAtlasTexts([])).toEqual([]);
  });
});
