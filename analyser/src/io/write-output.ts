import { randomBytes } from 'node:crypto';
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * The real path a file will have once written, even if it and some of its parent
 * directories do not exist yet: the nearest existing ancestor is resolved
 * (following symlinks), and the missing part is appended.
 */
export async function realPathOfFuture(path: string): Promise<string> {
  let current = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(await realpath(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Writes `text` to `target` so a failed run never leaves a half-written file.
 * The text goes to a temporary file in the same directory (same filesystem, so
 * the rename is atomic), then replaces the target. The temporary file is removed on any error.
 * Missing parent directories are created.
 */
export async function writeFileAtomic(target: string, text: string): Promise<void> {
  const directory = dirname(target);
  await mkdir(directory, { recursive: true });

  const temporary = join(directory, `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
