import type { FileEntry, RepoMeta } from '@shared/graveyard-schema';
import { usageDetail } from './grave-facts';
import type { SceneModel } from './scene-model';

/**
 * The detail panel's Usage row (importers spec, design "The detail panel"). Pure. The words always follow Knip's verdict
 * (`file.unused`), so the panel never contradicts the stone; the import graph only explains it.
 */

export interface ImporterView {
  path: string;
  /** The file name, the link's text. */
  name: string;
  /** The folder, shown dimmed; "" for the repository root. */
  folder: string;
  typeOnly: boolean;
}

export type UsageView =
  | {
      text: string;
      /** Every importer, in `importedBy` order. */
      importers: ImporterView[];
      /** How many of them show before "+N more". */
      shown: number;
    }
  /** A data file from before the import graph: the earlier wording. */
  | { legacy: string };

/** Importers shown before "+N more". */
export const IMPORTERS_SHOWN = 5;

const files = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}`;

export function usageView(file: FileEntry, meta: RepoMeta, model: Pick<SceneModel, 'lookup' | 'stones'>): UsageView {
  if (file.importedBy === undefined) return { legacy: usageDetail(file, meta) };

  const importerFile = (path: string): FileEntry | undefined => {
    const at = model.lookup.get(path);
    return at?.kind === 'file' ? model.stones[at.index]?.file : undefined;
  };
  const importers: ImporterView[] = file.importedBy.map(({ path, typeOnly }) => {
    const cut = path.lastIndexOf('/');
    return { path, name: path.slice(cut + 1), folder: cut < 0 ? '' : path.slice(0, cut), typeOnly: typeOnly === true };
  });
  const n = importers.length;
  const isTest = (path: string): boolean => importerFile(path)?.entry?.kind === 'test';
  const onlyTests = n > 0 && importers.every((i) => isTest(i.path));

  let text: string;
  if (file.unused) {
    if (n === 0) text = 'Unused: nothing in the project imports it (Knip)';
    else if (onlyTests) text = 'Unused: only imported by tests';
    else if (importers.every((i) => isTest(i.path) || importerFile(i.path)?.unused === true)) text = 'Unused: only imported by other unused files';
    else text = `Unused (Knip), though imported by ${files(n)}`;
  } else if (file.entry !== undefined) {
    const what = file.entry.kind === 'test' ? 'a test file' : file.entry.label;
    text = n === 0 ? `Entry point: ${what}` : `Entry point: ${what}, and imported by ${files(n)}`;
  } else if (onlyTests) text = 'Used only by tests';
  else if (n > 0) text = `Imported by ${files(n)}`;
  else text = 'Used (Knip), but no file in the project imports it';

  return { text, importers, shown: Math.min(n, IMPORTERS_SHOWN) };
}
