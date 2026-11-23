import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeRepo, type BuiltRepo } from '../../test/make-repo';
import { listTree, mapBlobs } from './git';
import { snapshotResolver } from './resolve';

const repos: BuiltRepo[] = [];
afterAll(() => {
  for (const r of repos) r.cleanup();
});

const w = (path: string, content: string) => ({ op: 'write' as const, path, content });

async function setUp() {
  const repo = makeRepo([
    {
      kind: 'commit',
      message: 'one',
      author: 'Ann',
      date: '2026-01-01T10:00:00+00:00',
      ops: [
        w('tsconfig.base.json', JSON.stringify({ compilerOptions: { strict: true } })),
        w('app/tsconfig.json', JSON.stringify({ extends: '../tsconfig.base.json', compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] }, moduleResolution: 'bundler', module: 'esnext' } })),
        w('app/lib/db.ts', 'export const db = 1;\n'),
        w('app/lib/util/index.ts', 'export const u = 1;\n'),
        w('app/lib/types.d.ts', 'export type T = 1;\n'),
        w('app/page.tsx', 'export default 1;\n'),
        w('app/globals.css', 'body {}\n'),
        w('web/jsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: 'src' } })),
        w('web/src/main.js', 'export const m = 1;\n'),
        w('web/src/helpers/a.js', 'export const a = 1;\n'),
        w('tools/x.ts', 'export {};\n'),
        w('tools/y.ts', 'export {};\n'),
        w('package.json', '{"name":"x"}\n'),
      ],
    },
  ]);
  repos.push(repo);
  // A package installed (untracked, as node_modules always is), and an uncommitted file the snapshot doesn't have.
  mkdirSync(join(repo.dir, 'node_modules', 'react'), { recursive: true });
  writeFileSync(join(repo.dir, 'node_modules', 'react', 'package.json'), '{"name":"react","main":"index.js"}');
  writeFileSync(join(repo.dir, 'node_modules', 'react', 'index.js'), 'module.exports = {};');
  writeFileSync(join(repo.dir, 'tools', 'new.ts'), 'export {};\n');
  const tree = await listTree(repo.dir, repo.shas[0]!);
  const configs = tree.filter((f) => /(^|\/)(tsconfig[^/]*\.json|jsconfig\.json|package\.json)$/.test(f.path));
  const blobTexts = await mapBlobs(repo.dir, configs.map((f) => f.blobSha), (b) => new TextDecoder().decode(b));
  const texts = new Map(configs.map((f) => [f.path, blobTexts.get(f.blobSha)!]));
  const analysed = new Set(tree.map((f) => f.path).filter((p) => /\.(ts|tsx|js)$/.test(p) && !p.endsWith('.d.ts')));
  return snapshotResolver({ root: realpathSync(repo.dir), tracked: new Set(tree.map((f) => f.path)), texts, analysed });
}

describe('snapshotResolver', () => {
  it('resolves relative paths, folders with index.ts, and .js specifiers written for .ts files', async () => {
    const resolve = await setUp();
    expect(resolve('app/page.tsx', './lib/db')).toEqual({ to: 'app/lib/db.ts' });
    expect(resolve('app/page.tsx', './lib/util')).toEqual({ to: 'app/lib/util/index.ts' });
    expect(resolve('app/page.tsx', './lib/db.js')).toEqual({ to: 'app/lib/db.ts' });
    expect(resolve('tools/x.ts', './y')).toEqual({ to: 'tools/y.ts' });
  });

  it('follows the nearest config: paths aliases with extends, and a jsconfig baseUrl', async () => {
    const resolve = await setUp();
    expect(resolve('app/page.tsx', '@/lib/db')).toEqual({ to: 'app/lib/db.ts' });
    expect(resolve('web/src/main.js', 'helpers/a')).toEqual({ to: 'web/src/helpers/a.js' });
    expect(resolve('tools/x.ts', '@/lib/db'), 'no alias outside app/').toEqual({ ignored: 'missing' });
  });

  it('tells packages, files outside the analysed set and missing files apart', async () => {
    const resolve = await setUp();
    expect(resolve('app/page.tsx', 'react')).toEqual({ ignored: 'package' });
    expect(resolve('app/page.tsx', 'node:fs')).toEqual({ ignored: 'package' });
    expect(resolve('app/page.tsx', 'path')).toEqual({ ignored: 'package' });
    expect(resolve('app/page.tsx', './lib/types')).toEqual({ ignored: 'outside' });
    expect(resolve('app/page.tsx', './nope')).toEqual({ ignored: 'missing' });
    expect(resolve('app/page.tsx', './globals.css'), 'a tracked stylesheet').toEqual({ ignored: 'outside' });
    expect(resolve('app/lib/db.ts', '../globals.css')).toEqual({ ignored: 'outside' });
    expect(resolve('app/page.tsx', './nope.css'), 'an untracked one').toEqual({ ignored: 'missing' });
    expect(resolve('app/page.tsx', 'not-installed')).toEqual({ ignored: 'missing' });
  });

  it('uses the snapshot: a file on disk but not committed does not resolve', async () => {
    const resolve = await setUp();
    expect(resolve('tools/x.ts', './new')).toEqual({ ignored: 'missing' });
  });
});
