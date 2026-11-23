import type { ImporterEntry } from './import-graph';
import { compareCodePoint } from './sort';

/**
 * Where Knip's verdict and the import graph don't fit together (importers spec, Req 5). Reported, never hidden, and never changes the
 * data: the stones follow Knip. Pure.
 *  - an unused file with an importer that is used (Knip says nothing uses it, yet something live imports it);
 *  - a used file that isn't an entry point and that nothing imports (something loads it that neither knows about).
 */
export interface Disagreements {
  usedImporters: Array<{ file: string; importer: string }>;
  unimported: string[];
}

export function disagreements(
  files: ReadonlyArray<{ path: string; unused: boolean; entry: boolean }>,
  importedBy: ReadonlyMap<string, readonly ImporterEntry[]>,
): Disagreements {
  const unused = new Set(files.filter((f) => f.unused).map((f) => f.path));
  const usedImporters: Disagreements['usedImporters'] = [];
  const unimported: string[] = [];
  for (const f of [...files].sort((a, b) => compareCodePoint(a.path, b.path))) {
    const importers = importedBy.get(f.path) ?? [];
    if (f.unused) {
      const live = importers.find((i) => !unused.has(i.path));
      if (live) usedImporters.push({ file: f.path, importer: live.path });
    } else if (!f.entry && importers.length === 0) {
      unimported.push(f.path);
    }
  }
  return { usedImporters, unimported };
}

export const REPORT_LIMIT = 20;

export function disagreementReport(d: Disagreements): string[] {
  const lines: string[] = [];
  if (d.usedImporters.length > 0) {
    lines.push(`Knip and the import graph disagree on ${d.usedImporters.length} files (the data is written as Knip says):`);
    for (const x of d.usedImporters.slice(0, REPORT_LIMIT)) lines.push(`  ${x.file} is unused (Knip), but imported by ${x.importer}, which is used`);
    if (d.usedImporters.length > REPORT_LIMIT) lines.push(`  … and ${d.usedImporters.length - REPORT_LIMIT} more`);
  }
  if (d.unimported.length > 0) {
    const shown = d.unimported.slice(0, REPORT_LIMIT).join(', ');
    const more = d.unimported.length > REPORT_LIMIT ? `, … and ${d.unimported.length - REPORT_LIMIT} more` : '';
    lines.push(`Used files nothing imports and that aren't entry points (${d.unimported.length}): ${shown}${more}`);
  }
  return lines;
}
