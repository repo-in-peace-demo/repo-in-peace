import type { Graveyard } from '@shared/graveyard-schema';
import type { BootNotice } from '../model/app-flow';
import { checkGraveyardData } from '../model/graveyard-load';

/**
 * Reads a graveyard file the user picked or dropped (interface spec, Req 1.7, 1.8). In the browser only: the content is never sent
 * anywhere (there is no request with it). It takes the same checks as a demo file, with the same version message.
 */

/** Larger than any graveyard a repository would make; a bigger file is refused before it is read. */
export const LOCAL_FILE_MAX_BYTES = 50 * 1024 * 1024;

export type LocalFileResult = { ok: true; fileName: string; graveyard: Graveyard } | { ok: false; notice: BootNotice };

export async function readLocalFile(file: Pick<File, 'name' | 'size' | 'text'>): Promise<LocalFileResult> {
  const title = `Could not open ${file.name}`;
  if (file.size > LOCAL_FILE_MAX_BYTES) {
    return { ok: false, notice: { title, message: `The file is ${(file.size / 1024 / 1024).toFixed(0)} MB; a graveyard file is far smaller. Choose the .graveyard.json the analyser wrote.`, details: [] } };
  }
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { ok: false, notice: { title, message: 'This is not a graveyard file: it is not JSON.', details: [] } };
  }
  const checked = checkGraveyardData(json);
  if (!checked.ok) return { ok: false, notice: { title, message: checked.message, details: checked.details } };
  return { ok: true, fileName: file.name, graveyard: checked.graveyard };
}
