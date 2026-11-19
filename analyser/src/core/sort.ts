/**
 * Locale-independent string order by Unicode code point.
 * Used for every sort in the output so the same data always gives the same file.
 * (`<` on strings compares UTF-16 code units, which puts astral characters before
 * U+E000 to U+FFFF, and `localeCompare` depends on the machine.)
 */
export function compareCodePoint(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    // The loop conditions guarantee both indexes are inside their strings.
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}
