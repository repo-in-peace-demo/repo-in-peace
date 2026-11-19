import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hoverLabel } from './hover-label';

describe('hoverLabel', () => {
  it('shows the name and the full folder path of a file', () => {
    expect(hoverLabel({ kind: 'file', path: 'app/components/voice/index.ts' })).toEqual({ ghost: false, name: 'index.ts', folder: 'app/components/voice' });
  });

  it('shows a file in the root folder with "/" as its folder', () => {
    expect(hoverLabel({ kind: 'file', path: 'package.json' })).toEqual({ ghost: false, name: 'package.json', folder: '/' });
  });

  it('marks a ghost', () => {
    expect(hoverLabel({ kind: 'ghost', path: 'src/surface-placement.ts' })).toEqual({ ghost: true, name: 'surface-placement.ts', folder: 'src' });
  });

  it('keeps markup and spaces as they are: it is text', () => {
    expect(hoverLabel({ kind: 'file', path: 'a b/<script>.ts' })).toEqual({ ghost: false, name: '<script>.ts', folder: 'a b' });
  });

  it('gives back the path from the folder and the name, for any path', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ unit: 'grapheme', minLength: 1 }).filter((s) => !s.includes('/')), { minLength: 1, maxLength: 6 }), fc.constantFrom('file' as const, 'ghost' as const), (parts, kind) => {
        const path = parts.join('/');
        const label = hoverLabel({ kind, path });
        const rebuilt = label.folder === '/' ? label.name : `${label.folder}/${label.name}`;
        return rebuilt === path && !label.name.includes('/') && label.ghost === (kind === 'ghost');
      }),
    );
  });
});
