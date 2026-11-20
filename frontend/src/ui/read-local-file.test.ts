import { describe, expect, it } from 'vitest';
import { loadRealGraveyard } from '../../test/real-data';
import { LOCAL_FILE_MAX_BYTES, readLocalFile } from './read-local-file';

const fileOf = (name: string, text: string, size = text.length) => ({ name, size, text: async () => text });

describe('reading a graveyard file from disk', () => {
  it('opens a valid file', async () => {
    const g = loadRealGraveyard('demo.spatialql');
    const result = await readLocalFile(fileOf('mine.graveyard.json', JSON.stringify(g)));
    expect(result.ok && result.graveyard.files.length).toBe(120);
  });

  it('refuses an old version with the version message, text that is not JSON, and a file far too big', async () => {
    const g = loadRealGraveyard('demo.spatialql');
    const old = await readLocalFile(fileOf('old.graveyard.json', JSON.stringify({ ...g, meta: { ...g.meta, schemaVersion: 1 } })));
    expect(!old.ok && old.notice.message).toContain('schema version 1');
    const junk = await readLocalFile(fileOf('x.json', '{ not json'));
    expect(!junk.ok && junk.notice.message).toContain('not JSON');
    let read = false;
    const big = await readLocalFile({ name: 'big.json', size: LOCAL_FILE_MAX_BYTES + 1, text: async () => ((read = true), '{}') });
    expect(big.ok).toBe(false);
    expect(read).toBe(false); // refused before it is read
  });
});
