/**
 * Locale-independent string order by Unicode code point. Every sort in the layout uses it, so the
 * same data gives the same scene on any machine. (`<` on strings compares UTF-16 code units, which
 * orders characters above U+FFFF before U+E000 to U+FFFF, and `localeCompare` depends on the machine.)
 *
 * The same rule the analyser uses; a copy, because the frontend does not import analyser code.
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
