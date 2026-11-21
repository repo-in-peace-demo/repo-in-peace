/**
 * A file's contents for its eulogy, cut to a budget (eulogies spec, Req 3.4). Pure. The model is given the start of the file: whole
 * lines that fit the budget in bytes, or, when the first line alone is longer, as much of it as fits without splitting a UTF-8
 * character. A binary or empty file is described as such, with no text.
 */

/** The most of a file's contents sent to the model, in bytes. */
export const CONTENTS_BUDGET_BYTES = 4096;

/** A NUL byte this early means a binary file. */
const BINARY_PROBE_BYTES = 8192;

export interface Contents {
  /** What the model is shown (empty for a binary or empty file). */
  text: string;
  /** True when some of the file was left out. */
  cut: boolean;
  kind: 'text' | 'binary' | 'empty';
}

const NEWLINE = 0x0a;
const isContinuation = (byte: number): boolean => (byte & 0xc0) === 0x80;

export function cutContents(bytes: Uint8Array, budget: number = CONTENTS_BUDGET_BYTES): Contents {
  if (bytes.length === 0) return { text: '', cut: false, kind: 'empty' };
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { text: '', cut: false, kind: 'binary' };
  let whole: string;
  try {
    whole = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { text: '', cut: false, kind: 'binary' }; // not UTF-8 text
  }
  const limit = Math.max(0, Math.floor(budget));
  if (bytes.length <= limit) return { text: whole, cut: false, kind: 'text' };

  // The last line end within the budget; otherwise the budget itself, backed off to the start of a UTF-8 character.
  let end = bytes.lastIndexOf(NEWLINE, limit - 1) + 1;
  if (end === 0) {
    end = limit;
    while (end > 0 && isContinuation(bytes[end]!)) end--;
  }
  return { text: new TextDecoder('utf-8').decode(bytes.subarray(0, end)), cut: true, kind: 'text' };
}
