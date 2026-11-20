/**
 * A console warning in development builds only (Vite's `import.meta.env.DEV`); a production build drops it. Outside Vite (the
 * end-to-end tests load the model modules in plain Node) `import.meta.env` is missing, and nothing is logged.
 */
export function devWarn(message: string): void {
  if (import.meta.env?.DEV) console.warn(message);
}
