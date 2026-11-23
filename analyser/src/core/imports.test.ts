import { describe, expect, it } from 'vitest';
import { findImports } from './imports';

const refs = (text: string, path = 'a.ts') => findImports(path, text).refs.map((r) => `${r.kind}:${r.typeOnly ? 'type:' : ''}${r.specifier}`);

describe('findImports', () => {
  it('finds every import form', () => {
    expect(
      refs(`
        import a from './a';
        import { b } from './b';
        import * as c from './c';
        import './d';
        export { e } from './e';
        export * from './f';
        export * as g from './g';
        import h = require('./h');
        const i = await import('./i');
        const j = require('./j');
        const k = import(\`./k\`);
      `),
    ).toEqual(['static:./a', 'static:./b', 'static:./c', 'static:./d', 'reexport:./e', 'reexport:./f', 'reexport:./g', 'require:./h', 'dynamic:./i', 'require:./j', 'dynamic:./k']);
  });

  it('marks type-only imports and re-exports', () => {
    expect(
      refs(`
        import type { A } from './a';
        import { type B, type C } from './b';
        import { type D, E } from './d';
        import type F from './f';
        export type { G } from './g';
        export { type H } from './h';
        type I = typeof import('./i');
        import type J = require('./j');
      `),
    ).toEqual(['static:type:./a', 'static:type:./b', 'static:./d', 'static:type:./f', 'reexport:type:./g', 'reexport:type:./h', 'dynamic:type:./i', 'require:type:./j']);
  });

  it('ignores imports in comments and strings, and counts non-literal specifiers', () => {
    const found = findImports(
      'a.ts',
      `
      // import x from './comment';
      /* require('./block') */
      const s = "import y from './string'";
      const t = \`require('./template')\`;
      import(name);
      require(\`./\${name}\`);
      `,
    );
    expect(found.refs).toEqual([]);
    expect(found.nonLiteral).toBe(2);
  });

  it('reads JS, JSX, TSX, MJS and CJS', () => {
    expect(refs(`import React from 'react'; export const A = () => <div>{require('./x')}</div>;`, 'a.jsx')).toEqual(['static:react', 'require:./x']);
    expect(refs(`import { b } from './b'; export const C = (): JSX.Element => <b.X />;`, 'c.tsx')).toEqual(['static:./b']);
    expect(refs(`import x from './x.mjs'; export default x;`, 'a.mjs')).toEqual(['static:./x.mjs']);
    expect(refs(`const y = require('./y.cjs'); module.exports = y;`, 'a.cjs')).toEqual(['require:./y.cjs']);
  });

  it('does not take a method called require or import for an import', () => {
    expect(refs(`obj.require('./x'); obj.import('./y');`)).toEqual([]);
  });
});
