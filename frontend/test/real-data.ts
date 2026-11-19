import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { checkGraveyardData } from '../src/model/graveyard-load';

/** The test data files in `public/graveyards/`, loaded through the same checks the app uses. */
export type RealGraveyardName = 'demo.oikosledger' | 'demo.spatialql';

export const REAL_GRAVEYARDS: readonly RealGraveyardName[] = ['demo.oikosledger', 'demo.spatialql'];

export function loadRealGraveyard(name: RealGraveyardName): Graveyard {
  const file = fileURLToPath(new URL(`../public/graveyards/${name}.graveyard.json`, import.meta.url));
  const result = checkGraveyardData(JSON.parse(readFileSync(file, 'utf8')));
  if (!result.ok) throw new Error(`${name} did not load: ${result.message} ${result.details.join('; ')}`);
  return result.graveyard;
}
