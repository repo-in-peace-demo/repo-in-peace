import type { Graveyard } from '../../../shared/graveyard-schema';

/**
 * Graveyard to JSON text, byte for byte stable. Pure.
 * Every object is rebuilt with its keys in schema order, so the order keys were
 * added in never shows in the output. Two-space indent, one trailing newline.
 */
export function toJson(graveyard: Graveyard): string {
  const { meta, folders, files, ghosts } = graveyard;
  const ordered = {
    meta: {
      name: meta.name,
      snapshotSha: meta.snapshotSha,
      snapshotDate: meta.snapshotDate,
      analysedAt: meta.analysedAt,
      schemaVersion: meta.schemaVersion,
      thresholds: {
        staleAfterDays: meta.thresholds.staleAfterDays,
        ancientAfterDays: meta.thresholds.ancientAfterDays,
        decayCapDays: meta.thresholds.decayCapDays,
        hotCommits: meta.thresholds.hotCommits,
        hotWindowDays: meta.thresholds.hotWindowDays,
      },
      // Written only when the analyser ran with --eulogies, so the output without it is byte-identical to before.
      ...(meta.eulogyModel === undefined ? {} : { eulogyModel: meta.eulogyModel }),
    },
    folders: folders.map((f) => ({ path: f.path, parent: f.parent })),
    files: files.map((f) => ({
      path: f.path,
      folder: f.folder,
      linesOfCode: f.linesOfCode,
      lastCommitDate: f.lastCommitDate,
      lastCommitAuthor: f.lastCommitAuthor,
      recentCommits: f.recentCommits,
      unused: f.unused,
      decayScore: f.decayScore,
      decayState: f.decayState,
      hot: f.hot,
      // The import graph (importers spec): after hot, before the eulogy; importedBy whenever it was built, entry only when there is one.
      ...(f.importedBy === undefined ? {} : { importedBy: f.importedBy.map((i) => (i.typeOnly ? { path: i.path, typeOnly: true as const } : { path: i.path })) }),
      ...(f.entry === undefined ? {} : { entry: { kind: f.entry.kind, label: f.entry.label } }),
      eulogy: f.eulogy,
    })),
    ghosts: ghosts.map((g) => ({
      path: g.path,
      deletedInSha: g.deletedInSha,
      deletedDate: g.deletedDate,
      deletedBy: g.deletedBy,
      lastExistingSha: g.lastExistingSha,
      ...(g.eulogy === undefined ? {} : { eulogy: g.eulogy }),
    })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
