import type { Change, CommitRecord } from '../core/commit-record';

/**
 * The exact `git log` arguments the analyser runs (append the snapshot SHA).
 * The parser below is written against the output of this command.
 * Keep in sync with test/fixtures/make-git-log-sample.sh.
 */
export const GIT_LOG_ARGS = [
  'log',
  '--topo-order',
  '-z',
  '--name-status',
  '-M',
  '--format=%x1e%H%x1f%P%x1f%cI%x1f%an',
] as const;

/*
 * Output layout, confirmed against real git output (see test/fixtures):
 *
 *   record     = RS header NUL [LF entries]
 *   header     = sha US parents US committerDate US authorName
 *   parents    = space-separated SHAs, empty for a root commit
 *   entries    = (status NUL path NUL [path2 NUL])*
 *
 * Commits with no file changes (merges, empty commits) have no LF after the
 * header NUL. Renames and copies carry two paths: old, then new.
 */
const RS = '\x1e';
const US = '\x1f';
const NUL = '\0';
const SHA_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export class GitLogParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitLogParseError';
  }
}

/** Parses the output of `git log` run with GIT_LOG_ARGS into commit records, in the order git printed them. */
export function parseGitLog(text: string): CommitRecord[] {
  if (text === '') return [];
  if (!text.startsWith(RS)) {
    throw new GitLogParseError('git log output does not start with a record separator');
  }
  return text
    .slice(RS.length)
    .split(RS)
    .map((chunk, index) => parseRecord(chunk, index));
}

function parseRecord(chunk: string, index: number): CommitRecord {
  const where = `commit #${index + 1} in git log output`;

  const headerEnd = chunk.indexOf(NUL);
  if (headerEnd === -1) throw new GitLogParseError(`${where}: header is not terminated`);

  const fields = chunk.slice(0, headerEnd).split(US);
  const [sha, parentsField, dateField, author] = fields;
  if (
    fields.length !== 4 ||
    sha === undefined ||
    parentsField === undefined ||
    dateField === undefined ||
    author === undefined
  ) {
    throw new GitLogParseError(`${where}: expected 4 header fields, found ${fields.length}`);
  }

  if (!SHA_PATTERN.test(sha)) throw new GitLogParseError(`${where}: bad commit SHA "${sha}"`);
  const parents = parentsField === '' ? [] : parentsField.split(' ');
  for (const parent of parents) {
    if (!SHA_PATTERN.test(parent)) throw new GitLogParseError(`${where}: bad parent SHA "${parent}"`);
  }

  const ms = Date.parse(dateField);
  if (Number.isNaN(ms)) throw new GitLogParseError(`${where}: bad date "${dateField}"`);

  let rest = chunk.slice(headerEnd + NUL.length);
  if (rest.startsWith('\n')) rest = rest.slice(1);
  if (rest !== '' && !rest.endsWith(NUL)) {
    throw new GitLogParseError(`${where}: file entries are cut off`);
  }

  return {
    sha,
    parents,
    date: new Date(ms).toISOString(),
    author,
    changes: parseChanges(rest, where),
  };
}

function parseChanges(entries: string, where: string): Change[] {
  if (entries === '') return [];

  const tokens = entries.split(NUL);
  tokens.pop(); // text after the final NUL is always empty here

  const changes: Change[] = [];
  let i = 0;

  const takePath = (status: string): string => {
    const path = tokens[i++];
    if (path === undefined || path === '') {
      throw new GitLogParseError(`${where}: status "${status}" is missing a path`);
    }
    return path;
  };

  while (i < tokens.length) {
    const status = tokens[i++] ?? '';
    switch (status[0]) {
      case 'A':
        changes.push({ kind: 'add', path: takePath(status) });
        break;
      case 'M':
      case 'T':
        changes.push({ kind: 'modify', path: takePath(status) });
        break;
      case 'D':
        changes.push({ kind: 'delete', path: takePath(status) });
        break;
      case 'C': {
        takePath(status); // source of the copy is untouched
        changes.push({ kind: 'add', path: takePath(status) });
        break;
      }
      case 'R': {
        const oldPath = takePath(status);
        changes.push({ kind: 'rename', oldPath, path: takePath(status) });
        break;
      }
      default:
        throw new GitLogParseError(`${where}: unsupported change status "${status}"`);
    }
  }
  return changes;
}
