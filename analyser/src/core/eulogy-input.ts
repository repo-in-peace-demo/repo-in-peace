import type { FileEntry, Thresholds } from '../../../shared/graveyard-schema';
import { FACT_NAMES, factRule } from '../../../shared/vocabulary';
import type { Contents } from './eulogy-contents';
import type { FileHistory, People, RawGhost } from './history';
import { redact } from './redact';

/**
 * What the model is told about one grave (eulogies spec, Req 3). Pure. The state and flags are in the project's one vocabulary;
 * the commit subject and the contents have every person of the repository replaced by "someone" (Req 3.3); the path and the file
 * name are given as they are, because they are what the eulogy must be accurate about.
 */

export type EulogyInput =
  | { kind: 'file'; path: string; name: string; state: string; flags: string[]; lines: number; subject: string; contents: Contents }
  | { kind: 'ghost'; path: string; name: string; deletedDay: string; subject: string; contents: Contents };

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const redacted = (contents: Contents, people: People): Contents => (contents.kind === 'text' ? { ...contents, text: redact(contents.text, people) } : contents);

export function fileInput(file: FileEntry, history: FileHistory, thresholds: Thresholds, contents: Contents, people: People): EulogyInput {
  const flags: string[] = [];
  if (file.unused) flags.push(`${FACT_NAMES.unused} (${factRule('unused', thresholds)})`);
  if (file.hot) flags.push(`${FACT_NAMES.hot} (${factRule('hot', thresholds)})`);
  return {
    kind: 'file',
    path: file.path,
    name: nameOf(file.path),
    state: `${FACT_NAMES[file.decayState]} (${factRule(file.decayState, thresholds)})`,
    flags,
    lines: file.linesOfCode,
    subject: redact(history.lastCommitSubject, people),
    contents: redacted(contents, people),
  };
}

export function ghostInput(ghost: RawGhost, contents: Contents, people: People): EulogyInput {
  return {
    kind: 'ghost',
    path: ghost.path,
    name: nameOf(ghost.path),
    deletedDay: ghost.deletedDate.slice(0, 10), // the data file's dates are ISO 8601 UTC
    subject: redact(ghost.deletedSubject, people),
    contents: redacted(contents, people),
  };
}
