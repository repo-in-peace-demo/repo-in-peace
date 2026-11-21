import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Graveyard } from '@shared/graveyard-schema';
import { expect, type Page } from './fixtures';

/**
 * A copy of the spatialql demo as the analyser writes it with --eulogies (eulogies spec, task 12): a model named, epitaphs on a
 * stone and a ghost, one stone left empty, and one eulogy holding markup that must show as text.
 */

export const EULOGY_MODEL = 'qwen2.5:7b';
export const STONE_EPITAPH = 'Here lies the anchor settler, who brought each anchor gently to rest. It never once let one drift.';
export const GHOST_EPITAPH = 'Here lies a test that checked the placing of things. It was deleted, but its questions still linger.';
export const MARKUP_EULOGY = 'Here lies <b>x</b>, bold only in spirit. It was shown as plain words.';

export function eulogyGraveyard(): { graveyard: Graveyard; stone: string; ghost: string; empty: string; markup: string } {
  const file = fileURLToPath(new URL('../public/graveyards/demo.spatialql.graveyard.json', import.meta.url));
  const graveyard = JSON.parse(readFileSync(file, 'utf8')) as Graveyard;
  const byPath = (path: string) => graveyard.files.find((f) => f.path === path)!;
  const [stone, empty, markup] = [byPath('src/anchor-settle.ts'), byPath('src/anchor-settle.test.ts'), byPath('src/assets.ts')];
  graveyard.meta.eulogyModel = EULOGY_MODEL;
  for (const f of graveyard.files) f.eulogy = `Here lies ${f.path.slice(f.path.lastIndexOf('/') + 1)}. It rests.`;
  stone.eulogy = STONE_EPITAPH;
  empty.eulogy = '';
  markup.eulogy = MARKUP_EULOGY;
  graveyard.ghosts.forEach((g, i) => (g.eulogy = i === 0 ? GHOST_EPITAPH : ''));
  return { graveyard, stone: stone.path, ghost: graveyard.ghosts[0]!.path, empty: empty.path, markup: markup.path };
}

/** Opens the file through "Open a graveyard file…" on the boot screen, as a user would, and waits for the scene. */
export async function openEulogyFile(page: Page, graveyard: Graveyard): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Repo In Peace' })).toContainText('RIP/OS');
  await page.keyboard.press('KeyX'); // skips the typing
  await page.locator('input[type=file]').setInputFiles({
    name: 'spatialql-eulogies.graveyard.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(graveyard)),
  });
  await page.waitForFunction(() => window.repoInPeace !== undefined && document.querySelector('canvas') !== null, undefined, { timeout: 60_000 });
  await page.waitForTimeout(800);
}
