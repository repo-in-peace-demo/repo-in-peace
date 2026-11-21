import type { Counts } from './app-flow';
import type { Manifest } from './manifest';

/**
 * The words of the boot and digging screens, and how much of them shows while they type (interface spec, Req 1.3, 1.4, 3.1). Pure.
 * Our own text: a made-up workstation, with no SGI, IRIX or FSN name in it.
 */

/** How fast the lines type: a character every MS_PER_CHAR, and a pause of MS_PER_LINE before each new line. */
export const MS_PER_CHAR = 6;
export const MS_PER_LINE = 80;

const dots = (label: string, width = 28): string => `${label} ${'.'.repeat(Math.max(3, width - label.length))}`;

/** The fake boot, ending with how many graveyards were found (none when the demo list is missing). */
export function bootLines(manifest: Manifest | null): string[] {
  const found = manifest === null ? 'none' : `${manifest.graveyards.length} found`;
  return [
    'RIP/OS 0.9  Repo In Peace night shift',
    `${dots('memory check')} 64 MB ok`,
    `${dots('lantern')} lit`,
    `${dots('probing graveyards')} ${found}`,
    `${dots('mounting /graveyards')} ${manifest === null ? 'no demo list' : 'ok'}`,
    '',
    'Choose a graveyard to walk.',
  ];
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The digging screen: a few short lines with the real counts of the graveyard being opened, in the one vocabulary (Unused, ghosts):
 *   opening oikos_ledger…
 *   exhuming 129 graves…
 *   12 lie Unused…
 *   summoning 2 ghosts…   (only when there are ghosts)
 *   raising the fences…
 */
export function diggingLines(counts: Counts | null): string[] {
  if (counts === null) return ['opening the gates…'];
  const lines = [`opening ${counts.repo}…`, `exhuming ${plural(counts.files, 'grave', 'graves')}…`];
  if (counts.unused > 0) lines.push(`${counts.unused.toLocaleString('en-US')} ${counts.unused === 1 ? 'lies' : 'lie'} Unused…`);
  if (counts.ghosts > 0) lines.push(`summoning ${plural(counts.ghosts, 'ghost', 'ghosts')}…`);
  lines.push('raising the fences…');
  return lines;
}

/** How long the whole text takes to type. */
export function typingDuration(lines: readonly string[], msPerChar: number = MS_PER_CHAR, msPerLine: number = MS_PER_LINE): number {
  return lines.reduce((sum, line) => sum + msPerLine + Array.from(line).length * msPerChar, 0);
}

/**
 * The text shown `elapsedMs` after the typing started: whole lines so far, then the part of the current line. `Infinity` gives all
 * of it (a skip, or reduced motion). The result is always a prefix of the whole text and never shrinks as time goes on.
 */
export function typedText(lines: readonly string[], elapsedMs: number, msPerChar: number = MS_PER_CHAR, msPerLine: number = MS_PER_LINE): { lines: string[]; done: boolean } {
  const shown: string[] = [];
  let left = Number.isNaN(elapsedMs) ? 0 : elapsedMs;
  for (const line of lines) {
    if (left < msPerLine) return { lines: shown, done: false };
    left -= msPerLine;
    const chars = Array.from(line);
    const typed = Math.min(chars.length, Math.floor(left / msPerChar));
    shown.push(chars.slice(0, typed).join(''));
    if (typed < chars.length) return { lines: shown, done: false };
    left -= chars.length * msPerChar;
  }
  return { lines: shown, done: true };
}
