import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clickAction, escapeAction } from './selection-actions';

describe('selection actions', () => {
  it('a click on a stone selects it, and a click on a ghost selects the ghost', () => {
    expect(clickAction({ kind: 'file', path: 'src/a.ts' })).toEqual({ type: 'select', kind: 'file', path: 'src/a.ts' });
    expect(clickAction({ kind: 'ghost', path: 'src/gone.ts' })).toEqual({ type: 'select', kind: 'ghost', path: 'src/gone.ts' });
  });

  it('a click on empty ground clears the selection', () => {
    expect(clickAction(undefined)).toEqual({ type: 'clear' });
  });

  it('Escape does exactly what a click on empty ground does, and asks for nothing else', () => {
    expect(escapeAction()).toEqual(clickAction(undefined));
    expect(Object.keys(escapeAction())).toEqual(['type']); // no camera instruction, no path
  });

  it('only ever selects or clears, and selects exactly what was hit', () => {
    fc.assert(
      fc.property(fc.option(fc.record({ kind: fc.constantFrom('file' as const, 'ghost' as const), path: fc.string({ unit: 'grapheme' }) }), { nil: undefined }), (hit) => {
        const action = clickAction(hit);
        return hit === undefined ? action.type === 'clear' : action.type === 'select' && action.kind === hit.kind && action.path === hit.path;
      }),
    );
  });
});
