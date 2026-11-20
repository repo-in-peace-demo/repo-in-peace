import type { Graveyard } from '@shared/graveyard-schema';
import { devFeatures } from '../model/dev-features';
import { makeSyntheticGraveyard } from '../model/synthetic';

/**
 * Development builds only (loaded lazily behind `import.meta.env.DEV` in `ui/useGraveyardLoad.ts`): the made-up graveyard the page
 * address asks for with `?synthetic=<n>`, or null. Always the same one for the same n (seed 1, the mixed shape), so a performance
 * check can be repeated.
 */
export function syntheticFromAddress(search: string): { name: string; graveyard: Graveyard } | null {
  const n = devFeatures(true, search).made;
  if (n === null) return null;
  return { name: `synthetic-${n}`, graveyard: makeSyntheticGraveyard({ files: n, seed: 1, shape: 'mixed' }) };
}
