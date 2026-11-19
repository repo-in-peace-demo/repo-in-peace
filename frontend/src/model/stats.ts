import type { Graveyard } from '@shared/graveyard-schema';

/** The numbers of the statistics overlay. Pure. */
export interface Stats {
  files: number;
  folders: number;
  ghosts: number;
  /** By the file's `decayState`. These three add up to `files`. */
  fresh: number;
  stale: number;
  ancient: number;
  /** Counted among all files, whatever their state: an unused stone can be fresh, stale or ancient. */
  unused: number;
  hot: number;
}

export function computeStats(graveyard: Graveyard): Stats {
  const stats: Stats = {
    files: graveyard.files.length,
    folders: graveyard.folders.length,
    ghosts: graveyard.ghosts.length,
    fresh: 0,
    stale: 0,
    ancient: 0,
    unused: 0,
    hot: 0,
  };
  for (const file of graveyard.files) {
    stats[file.decayState]++;
    if (file.unused) stats.unused++;
    if (file.hot) stats.hot++;
  }
  return stats;
}
