import { useEffect, useState } from 'react';
import type { Graveyard } from '@shared/graveyard-schema';
import { graveyardUrl, parseGraveyardName } from '../model/graveyard-load';
import { fetchGraveyard } from './fetch-graveyard';

export type LoadState =
  | { status: 'loading' }
  | { status: 'error'; title: string; message: string; details: string[] }
  | { status: 'ready'; name: string; graveyard: Graveyard };

/**
 * Loads the graveyard named in the page address (`?graveyard=...`, `demo.spatialql` when there is none), or in development builds a
 * made-up one (`?synthetic=<n>`).
 * Nothing is requested when `enabled` is false (the browser cannot draw WebGL) or the name is not allowed.
 *
 * @param search the query string of the page address
 * @param baseUrl where the site is served from, Vite's `import.meta.env.BASE_URL`
 */
export function useGraveyardLoad(search: string, baseUrl: string, enabled: boolean): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) return;

    // Development builds only: `?synthetic=<n>` shows a made-up graveyard instead of a data file. The whole branch, and the module it
    // loads, is dropped from a production build (`import.meta.env.DEV` is false there).
    if (import.meta.env.DEV && new URLSearchParams(search).has('synthetic')) {
      let gone = false;
      void import('../dev/synthetic-load').then(({ syntheticFromAddress }) => {
        if (gone) return;
        const made = syntheticFromAddress(search);
        setState(made ? { status: 'ready', ...made } : { status: 'error', title: 'Bad synthetic size', message: 'Use ?synthetic=<n> with a whole number of files, at least 1.', details: [] });
      });
      return () => {
        gone = true;
      };
    }

    const parsed = parseGraveyardName(search);
    if (!parsed.ok) {
      setState({ status: 'error', title: 'Name not allowed', message: parsed.message, details: [] });
      return;
    }

    setState({ status: 'loading' });
    const controller = new AbortController();
    void fetchGraveyard(parsed.name, graveyardUrl(parsed.name, baseUrl), controller.signal).then((outcome) => {
      if (outcome.kind === 'aborted') return;
      setState(
        outcome.kind === 'ready'
          ? { status: 'ready', name: parsed.name, graveyard: outcome.graveyard }
          : { status: 'error', title: outcome.title, message: outcome.message, details: outcome.details },
      );
    });
    // Starting again (or leaving the page) cancels the request that is still on its way.
    return () => controller.abort();
  }, [search, baseUrl, enabled]);

  return state;
}
