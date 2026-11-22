/**
 * The per-client throttle (bury-and-resurrect Req 6.2, Decision 4): sliding windows, in memory, per function instance. The clock comes
 * in, so tests need no real time. The cap on open pull requests (Req 6.1) is not here: it is counted on GitHub, so it holds across
 * instances (open-pr.ts).
 */

export interface ThrottleRule {
  limit: number;
  windowMs: number;
}

/** 3 a minute and 20 an hour per client (Decision 4). */
export const DEFAULT_RULES: readonly ThrottleRule[] = [
  { limit: 3, windowMs: 60_000 },
  { limit: 20, windowMs: 3_600_000 },
];
export const MAX_KEYS = 10_000;

export type Take = { ok: true } | { ok: false; retryAfterMs: number; retryAfterSeconds: number };

export class Throttle {
  /** Accepted request times per key, oldest first. Map order is least recently used first, for dropping keys. */
  private readonly times = new Map<string, number[]>();
  private readonly longest: number;

  constructor(
    private readonly rules: readonly ThrottleRule[] = DEFAULT_RULES,
    private readonly now: () => number = Date.now,
    private readonly maxKeys: number = MAX_KEYS,
  ) {
    this.longest = Math.max(...rules.map((r) => r.windowMs));
  }

  /** Counts a request for `key` if every rule allows it; a refused request is not counted. */
  take(key: string): Take {
    const now = this.now();
    const kept = (this.times.get(key) ?? []).filter((t) => now - t < this.longest);
    let retryAfterMs = 0;
    for (const rule of this.rules) {
      const inWindow = kept.filter((t) => now - t < rule.windowMs);
      if (inWindow.length >= rule.limit) {
        // The request fits once enough of the oldest in the window have left it.
        const leaving = inWindow[inWindow.length - rule.limit]!;
        retryAfterMs = Math.max(retryAfterMs, leaving + rule.windowMs - now);
      }
    }
    this.times.delete(key);
    if (retryAfterMs > 0) {
      if (kept.length > 0) this.times.set(key, kept);
      return { ok: false, retryAfterMs, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }
    kept.push(now);
    this.times.set(key, kept);
    while (this.times.size > this.maxKeys) this.times.delete(this.times.keys().next().value!);
    return { ok: true };
  }

  get size(): number {
    return this.times.size;
  }
}
