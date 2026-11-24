import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';

/**
 * The landing page at the bare address (ui/Landing.tsx): what it shows, the way to the boot screen and back, keyboard and contrast,
 * reduced motion, narrow screens, and screenshots (with the favicons enlarged).
 */
const OUT = 'test-results/screenshots/';
const landing = (page: Page) => page.locator('main.landing');
const boot = (page: Page) => page.getByRole('main').filter({ hasText: 'RIP/OS' });

async function open(page: Page, size = { width: 1280, height: 720 }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto('/');
  await expect(landing(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** WCAG relative luminance and contrast ratio, of `rgb(r, g, b)` strings. */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

test('the bare address shows the landing page: the logo with alt text, the title as real text in Creepster, the line, two buttons, the footer', async ({ page }) => {
  const fontHosts: string[] = [];
  page.on('request', (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) fontHosts.push(r.url());
  });
  await open(page);
  await expect(page.getByRole('img', { name: /Repo In Peace logo/ })).toBeVisible();
  const title = page.getByRole('heading', { level: 1, name: 'Repo In Peace' });
  await expect(title).toBeVisible();
  expect(await title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Creepster"?/);
  expect(await title.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(124, 252, 154)');
  expect(await page.evaluate(() => document.fonts.check('16px Creepster'))).toBe(true);
  await expect(landing(page)).toContainText('Your codebase as a haunted 3D graveyard. Dead files crack, old ones grow moss, deleted ones haunt as ghosts. Bury or resurrect them with a real pull request.');
  await expect(page.getByRole('button', { name: 'Enter the graveyard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take the tour' })).toBeVisible();
  await expect(page.locator('.landing-footer')).toContainText('Built with Kiro for Kiroween 2026');
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/sl2902/repo-in-peace');
  await expect(page.getByRole('link', { name: 'Analyse your own repo' })).toHaveAttribute('href', 'https://github.com/sl2902/repo-in-peace#analyse-your-own-repo');
  // No 3D here, and no font from another host.
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(fontHosts).toEqual([]);
  // Desktop: no "best on a desktop" line.
  await expect(page.getByText('Best on a desktop browser.')).toBeHidden();
});

for (const name of ['Enter the graveyard', 'Take the tour']) {
  test(`${name} goes to the boot screen at ?boot; Back returns to the landing page`, async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name }).click();
    await expect(boot(page)).toBeVisible();
    expect(new URL(page.url()).search).toBe('?boot');
    await page.goBack();
    await expect(landing(page)).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
  });
}

test('a ?graveyard= link skips the landing page and the boot screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?graveyard=demo.spatialql');
  await page.waitForFunction(() => window.repoInPeace !== undefined && document.querySelector('canvas') !== null, undefined, { timeout: 60_000 });
  await expect(landing(page)).toHaveCount(0);
  await expect(boot(page)).toHaveCount(0);
});

test('keyboard: Tab reaches both buttons and the footer links, each with a visible focus ring', async ({ page }) => {
  await open(page);
  const reached: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return { text: el.textContent?.trim() ?? '', outline: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    if (focus === null) continue;
    reached.push(focus.text);
    expect(focus.outline, focus.text).not.toBe('none');
    expect(focus.width, focus.text).toBeGreaterThanOrEqual(2);
  }
  expect(reached.slice(0, 4)).toEqual(['Enter the graveyard', 'Take the tour', 'GitHub', 'Analyse your own repo']);
  // From a fresh page, the first Tab is on the primary button, and Enter goes in.
  await page.reload();
  await expect(landing(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Enter the graveyard' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(boot(page)).toBeVisible();
});

test('contrast: every piece of text meets WCAG AA against both ends of the background', async ({ page }) => {
  await open(page);
  const ends = ['rgb(11, 16, 32)', 'rgb(20, 27, 46)']; // #0B1020 and #141B2E
  const texts = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.landing h1, .landing p, .landing button, .landing footer, .landing footer a')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const s = getComputedStyle(el);
        return { what: el.textContent?.trim().slice(0, 30) ?? '', color: s.color, background: s.backgroundColor, size: parseFloat(s.fontSize), bold: Number(s.fontWeight) >= 700 };
      }),
  );
  expect(texts.length).toBeGreaterThanOrEqual(7);
  for (const t of texts) {
    const large = t.size >= 24 || (t.bold && t.size >= 18.66);
    const need = large ? 3 : 4.5;
    // A filled button is read against its own fill; everything else against the page's background, at its darkest and lightest.
    const backs = t.background !== 'rgba(0, 0, 0, 0)' && !t.background.endsWith(', 0)') ? [t.background] : ends;
    for (const b of backs) expect(contrast(t.color, b), `${t.what}: ${t.color} on ${b}`).toBeGreaterThanOrEqual(need);
  }
});

test('under reduced motion nothing moves; without it, only the stars twinkle and the witch bobs in front of the moon', async ({ page }) => {
  await open(page);
  const moving = await page.evaluate(() => document.getAnimations().map((a) => (a.effect as KeyframeEffect | null)?.target?.getAttribute('class') ?? ''));
  expect(moving.length).toBeGreaterThan(0);
  expect(new Set(moving)).toEqual(new Set(['landing-star', 'landing-witch', 'landing-witch-bristles', 'landing-witch-cloak', 'landing-witch-hair']));
  // She stays on the moon: over two seconds her middle moves a few pixels at most, and is always inside the moon's glow.
  const centre = () => page.locator('.landing-witch').evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const moon = await page.locator('.landing-moon').evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 }; });
  const seen = [];
  for (let i = 0; i < 5; i++) { seen.push(await centre()); await page.waitForTimeout(500); }
  for (const c of seen) expect(Math.hypot(c.x - moon.x, c.y - moon.y)).toBeLessThan(moon.r * 1.2);
  expect(Math.max(...seen.map((c) => c.y)) - Math.min(...seen.map((c) => c.y))).toBeGreaterThan(0.5); // it does bob
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(landing(page)).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('a narrow screen stays readable, with "Best on a desktop browser."', async ({ page }) => {
  await open(page, { width: 390, height: 780 });
  await expect(page.getByText('Best on a desktop browser.')).toBeVisible();
  for (const name of ['Enter the graveyard', 'Take the tour']) {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(390);
  // The page scrolls to its footer.
  await page.locator('.landing-footer').scrollIntoViewIfNeeded();
  await expect(page.locator('.landing-footer')).toBeInViewport();
  await page.screenshot({ path: `${OUT}landing-390x780.png`, fullPage: false });
});

test('screenshots: 1280 × 720, 1920 × 1080, and the favicons at 16 and 32 px enlarged', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await open(page, size);
    await page.emulateMedia({ reducedMotion: 'reduce' }); // the stars held still, so the picture is the same every run
    await page.mouse.move(5, 5);
    await page.screenshot({ path: `${OUT}landing-${size.width}x${size.height}.png` });
  }
  const origin = new URL(page.url()).origin;
  await page.setViewportSize({ width: 560, height: 300 });
  await page.setContent(`<body style="margin:0;padding:20px;background:#fff;display:flex;gap:24px;font:12px sans-serif;align-items:flex-end">
    ${[16, 32].map((n) => `<figure style="margin:0"><img src="${origin}/brand/favicon-${n}.png" width="${n * (n === 16 ? 12 : 6)}" style="image-rendering:pixelated;display:block"><figcaption>${n} px, ×${n === 16 ? 12 : 6}</figcaption></figure>`).join('')}
    <figure style="margin:0;background:#202124;padding:8px"><img src="${origin}/brand/favicon-16.png" width="16"> <img src="${origin}/brand/favicon-32.png" width="32"><figcaption style="color:#ccc">actual size, dark tab</figcaption></figure>
  </body>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}favicons-enlarged.png` });
});
