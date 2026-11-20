import type { Graveyard } from '@shared/graveyard-schema';
import { makeSyntheticGraveyard } from '../model/synthetic';

/**
 * Development builds only (loaded lazily behind `import.meta.env.DEV` in `App.tsx`): the made-up graveyard of `?synthetic=<n>`.
 * Always the same one for the same n (seed 1, the mixed shape), so a performance check can be repeated.
 */
export function madeGraveyard(files: number): Graveyard {
  return makeSyntheticGraveyard({ files, seed: 1, shape: 'mixed' });
}
