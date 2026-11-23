import { describe, expect, it } from 'vitest';
import type { FileEntry, RepoMeta } from '@shared/graveyard-schema';
import { usageDetail } from './grave-facts';
import type { SceneModel } from './scene-model';
import { usageView } from './usage';

const meta = { name: 'r', thresholds: { staleAfterDays: 90, ancientAfterDays: 360, hotCommits: 5, hotWindowDays: 30, decayCapDays: 720 } } as unknown as RepoMeta;
const file = (path: string, over: Partial<FileEntry> = {}): FileEntry => ({ path, unused: false, importedBy: [], eulogy: '', ...over }) as FileEntry;

/** The other files of the project, as the scene model holds them. */
function modelOf(...others: FileEntry[]): Pick<SceneModel, 'lookup' | 'stones'> {
  const stones = others.map((f) => ({ file: f })) as unknown as SceneModel['stones'];
  return { stones, lookup: new Map(others.map((f, index) => [f.path, { kind: 'file' as const, index }])) };
}
const test1 = file('src/a.test.ts', { entry: { kind: 'test', label: 'test' } });
const test2 = file('test/b.spec.ts', { entry: { kind: 'test', label: 'test' } });
const used1 = file('src/main.ts');
const used2 = file('src/app.ts');
const dead1 = file('src/dead/section.ts', { unused: true });
const model = modelOf(test1, test2, used1, used2, dead1);
const by = (...paths: string[]) => paths.map((path) => ({ path }));
const text = (f: FileEntry): string => {
  const v = usageView(f, meta, model);
  if ('legacy' in v) throw new Error('legacy');
  return v.text;
};

describe('usageView: the wording table', () => {
  it('used, an entry point: the label, then any importers; a test file as "a test file"', () => {
    expect(text(file('src/main.tsx', { entry: { kind: 'framework', label: 'Vite entry' } }))).toBe('Entry point: Vite entry');
    expect(text(file('app/page.tsx', { entry: { kind: 'framework', label: 'Next.js page' }, importedBy: by('src/main.ts') }))).toBe('Entry point: Next.js page, and imported by 1 file');
    expect(text(file('x.test.ts', { entry: { kind: 'test', label: 'test' } }))).toBe('Entry point: a test file');
  });

  it('used, only tests import it', () => {
    expect(text(file('src/x.ts', { importedBy: by('src/a.test.ts', 'test/b.spec.ts') }))).toBe('Used only by tests');
  });

  it('used, with importers: the count, singular and plural', () => {
    expect(text(file('src/x.ts', { importedBy: by('src/main.ts') }))).toBe('Imported by 1 file');
    expect(text(file('src/x.ts', { importedBy: by('src/a.test.ts', 'src/app.ts', 'src/main.ts') }))).toBe('Imported by 3 files');
  });

  it('used, no importers and not an entry point', () => {
    expect(text(file('src/x.ts'))).toBe('Used (Knip), but no file in the project imports it');
  });

  it('unused: nothing, only tests, only unused files (tests among them or not), a used importer', () => {
    expect(text(file('src/x.ts', { unused: true }))).toBe('Unused: nothing in the project imports it (Knip)');
    expect(text(file('src/x.ts', { unused: true, importedBy: by('src/a.test.ts') }))).toBe('Unused: only imported by tests');
    expect(text(file('src/x.ts', { unused: true, importedBy: by('src/dead/section.ts') }))).toBe('Unused: only imported by other unused files');
    expect(text(file('src/x.ts', { unused: true, importedBy: by('src/a.test.ts', 'src/dead/section.ts') }))).toBe('Unused: only imported by other unused files');
    expect(text(file('src/x.ts', { unused: true, importedBy: by('src/dead/section.ts', 'src/main.ts') }))).toBe('Unused (Knip), though imported by 2 files');
  });

  it('follows Knip over the entry point: an unused entry point reads as unused', () => {
    expect(text(file('vite.config.ts', { unused: true, entry: { kind: 'config', label: 'Vite config' } }))).toBe('Unused: nothing in the project imports it (Knip)');
  });

  it('an older data file, with no importedBy: the earlier wording', () => {
    const old = { path: 'src/x.ts', unused: true, eulogy: '' } as FileEntry;
    expect(usageView(old, meta, model)).toEqual({ legacy: usageDetail(old, meta) });
    const oldUsed = { ...old, unused: false };
    expect(usageView(oldUsed, meta, model)).toEqual({ legacy: usageDetail(oldUsed, meta) });
  });
});

describe('usageView: the importers', () => {
  it('in importedBy order, with name, folder and type only; the first 5 shown', () => {
    const paths = ['a.ts', 'src/b.ts', 'src/c.ts', 'src/deep/d.ts', 'src/e.ts', 'src/f.ts', 'src/g.ts'];
    const v = usageView(file('src/x.ts', { importedBy: paths.map((path, i) => (i === 1 ? { path, typeOnly: true } : { path })) }), meta, modelOf());
    if ('legacy' in v) throw new Error('legacy');
    expect(v.shown).toBe(5);
    expect(v.importers.map((i) => i.path)).toEqual(paths);
    expect(v.importers.slice(0, 2)).toEqual([
      { path: 'a.ts', name: 'a.ts', folder: '', typeOnly: false },
      { path: 'src/b.ts', name: 'b.ts', folder: 'src', typeOnly: true },
    ]);
    expect(v.importers[3]).toMatchObject({ name: 'd.ts', folder: 'src/deep' });
  });

  it('shows them all when there are 5 or fewer', () => {
    const v = usageView(file('src/x.ts', { importedBy: by('src/main.ts', 'src/app.ts') }), meta, model);
    expect('legacy' in v ? -1 : v.shown).toBe(2);
  });
});
