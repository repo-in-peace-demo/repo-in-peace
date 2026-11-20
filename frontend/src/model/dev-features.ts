/**
 * Which development extras a page address asks for. Pure. Only development builds call it (every caller sits behind
 * `import.meta.env.DEV`, so a production build does not contain it), and with `isDev` false it turns everything off whatever the
 * address says, so a production page could not switch an extra on even if it did.
 *
 *   ?stats            the performance overlay (`ui/PerfStats.tsx`)
 *   ?synthetic=<n>    a made-up graveyard of n files instead of a data file (`model/synthetic.ts`), with the overlay on
 *   window.repoInPeace  the handles for the console and the browser tests (`scene/dev-api.ts`), always on in development
 */

/** The largest made-up graveyard the address can ask for. */
export const SYNTHETIC_MAX_FILES = 20_000;

export interface DevFeatures {
  /** `window.repoInPeace`. */
  api: boolean;
  /** The performance overlay. */
  perf: boolean;
  /** The number of files of the made-up graveyard to show, or null for the data file. */
  made: number | null;
}

export const NO_DEV_FEATURES: DevFeatures = { api: false, perf: false, made: null };

export function devFeatures(isDev: boolean, search: string): DevFeatures {
  if (!isDev) return NO_DEV_FEATURES;
  const params = new URLSearchParams(search);
  const raw = params.get('synthetic');
  const n = raw === null || !/^\d+$/.test(raw.trim()) ? null : Number.parseInt(raw.trim(), 10);
  const made = n === null || n < 1 ? null : Math.min(n, SYNTHETIC_MAX_FILES);
  return { api: true, perf: params.has('stats') || made !== null, made };
}
