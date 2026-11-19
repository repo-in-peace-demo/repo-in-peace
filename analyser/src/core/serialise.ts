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
      eulogy: f.eulogy,
    })),
    ghosts: ghosts.map((g) => ({
      path: g.path,
      deletedInSha: g.deletedInSha,
      deletedDate: g.deletedDate,
      deletedBy: g.deletedBy,
      lastExistingSha: g.lastExistingSha,
    })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
