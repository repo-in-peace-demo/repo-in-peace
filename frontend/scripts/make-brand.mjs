// Writes Repo In Peace's logo and icons (public/brand/), all from the drawings below: an original rounded tombstone with a shovel
// leaning on its right side and a mound of earth at its foot, in the app's palette. Run: node scripts/make-brand.mjs
//   logo.svg          the full logo: the whole inscription (landing page, README, social image)
//   mark.svg          the small mark: stone, shovel and RIP only, drawn to stay legible at 16 px
//   favicon-16.png, favicon-32.png, apple-touch-icon.png (180), icon-512.png (the app icon)
//   social.png        1200 × 630: logo, title (Creepster) and tagline on the night background
// The PNGs are rendered by Playwright's Chromium (a dev dependency already), so they match the SVGs exactly.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = fileURLToPath(new URL('../public/brand/', import.meta.url));
const FONT = fileURLToPath(new URL('../public/fonts/creepster/Creepster-Regular.woff2', import.meta.url));

/**
 * The words carved on the full logo, top to bottom. The one place they are set: to use a generic inscription instead, change these
 * (for example `{ title: 'RIP', name: '3D FILE', year: 'BROWSER', epitaph: ['Flew over files.', 'Rose again.'] }`) and run this again.
 * "FSN" is plain carved text in the same lettering as the rest: no logo, motif, colour or branded lettering of SGI's.
 */
export const INSCRIPTION = { title: 'RIP', name: 'FSN', year: '1992', epitaph: ['Flew over files.', 'Rose again.'] };

/** The tagline, shared by the landing page (src/ui/Landing.tsx says the same) and the social image. */
const TAGLINE =
  'Your codebase as a haunted 3D graveyard. Dead files crack, old ones grow moss, deleted ones haunt as ghosts. Bury or resurrect them with a real pull request.';

// The app's palette (src/scene/colors.ts and the moonlit stones): stone blue-grey, wood, dark iron, soil.
const STONE_LIGHT = '#a3b0c8';
const STONE_DARK = '#5b6886';
const STONE_EDGE = '#2a3146';
const CARVE = '#232a3c';
const CARVE_LIGHT = '#c6d0e2'; // the lit lower lip of each carved letter
const WOOD = '#8a6034';
const WOOD_DARK = '#5e3f22';
const IRON = '#3b4049';
const IRON_LIGHT = '#6c7380';
const SOIL = '#3b2a1c';
const SOIL_TOP = '#5a4128';
const SERIF = "Georgia, 'Times New Roman', 'DejaVu Serif', serif";

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Carved text: the dark cut, with a thin lit lip one unit below it. */
const carved = (x, y, size, text, extra = '') =>
  `<text x="${x}" y="${y + size * 0.06}" font-size="${size}" fill="${CARVE_LIGHT}" opacity="0.55" ${extra}>${esc(text)}</text>` +
  `<text x="${x}" y="${y}" font-size="${size}" fill="${CARVE}" ${extra}>${esc(text)}</text>`;

/** The full logo, on a 240 × 300 grid. */
function logoSvg() {
  const i = INSCRIPTION;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300" width="240" height="300" role="img" aria-labelledby="t">
<title id="t">Repo In Peace: a tombstone carved ${esc([i.title, i.name, i.year, ...i.epitaph].join(' '))}, a shovel leaning on it</title>
<defs>
  <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${STONE_LIGHT}"/><stop offset="1" stop-color="${STONE_DARK}"/></linearGradient>
  <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SOIL_TOP}"/><stop offset="1" stop-color="${SOIL}"/></linearGradient>
</defs>
<path d="M40 276 V112 A80 80 0 0 1 200 112 V276 Z" fill="url(#stone)" stroke="${STONE_EDGE}" stroke-width="4" stroke-linejoin="round"/>
<path d="M52 270 V114 A68 68 0 0 1 188 114" fill="none" stroke="${CARVE_LIGHT}" stroke-opacity="0.35" stroke-width="2"/>
<g font-family="${SERIF}" text-anchor="middle">
  ${carved(120, 104, 40, i.title, 'font-weight="700" letter-spacing="4"')}
  ${carved(120, 146, 26, i.name, 'font-weight="700" letter-spacing="3"')}
  ${carved(120, 176, 20, i.year, 'letter-spacing="2"')}
  ${carved(120, 210, 13.5, i.epitaph[0] ?? '', 'font-style="italic"')}
  ${carved(120, 228, 13.5, i.epitaph[1] ?? '', 'font-style="italic"')}
</g>
${shovel(214, 288, 196, 132, 1)}
<path d="M22 292 C34 262 72 252 120 252 C168 252 196 262 206 292 Z" fill="url(#soil)" stroke="${SOIL}" stroke-width="2"/>
<g fill="${SOIL_TOP}" opacity="0.9"><circle cx="70" cy="268" r="3"/><circle cx="108" cy="262" r="2.4"/><circle cx="150" cy="266" r="2.8"/><circle cx="182" cy="276" r="2.2"/></g>
</svg>
`;
}

/**
 * A shovel from its blade on the ground at (bx, by) to its grip resting at (gx, gy), drawn `scale` times as thick.
 * The handle in wood, the blade and collar in dark iron, a D-grip at the top.
 */
function shovel(bx, by, gx, gy, scale) {
  const dx = gx - bx;
  const dy = gy - by;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const at = (t, side = 0) => [bx + dx * t + nx * side, by + dy * t + ny * side].map((v) => v.toFixed(1)).join(' ');
  const w = 13 * scale; // half-width of the blade
  const bl = 0.26; // the blade's share of the length
  const blade = `M${at(0, 0)} Q${at(0.02, w)} ${at(0.09, w)} L${at(bl, w * 0.8)} L${at(bl, -w * 0.8)} L${at(0.09, -w)} Q${at(0.02, -w)} ${at(0, 0)} Z`;
  return `<g stroke-linecap="round" stroke-linejoin="round">
  <path d="M${at(bl - 0.02)} L${at(0.93)}" stroke="${WOOD_DARK}" stroke-width="${7.5 * scale}"/>
  <path d="M${at(bl - 0.02)} L${at(0.93)}" stroke="${WOOD}" stroke-width="${5 * scale}"/>
  <path d="M${at(0.93, -7 * scale)} L${at(1, -6 * scale)} L${at(1, 6 * scale)} L${at(0.93, 7 * scale)}" fill="none" stroke="${WOOD_DARK}" stroke-width="${4.5 * scale}"/>
  <path d="${blade}" fill="${IRON}" stroke="#1d2128" stroke-width="${1.6 * scale}"/>
  <path d="M${at(0.05, -w * 0.45)} L${at(bl - 0.03, -w * 0.45)}" stroke="${IRON_LIGHT}" stroke-width="${1.6 * scale}" opacity="0.8"/>
  <path d="M${at(bl - 0.015, -5 * scale)} L${at(bl + 0.05, -3.5 * scale)} L${at(bl + 0.05, 3.5 * scale)} L${at(bl - 0.015, 5 * scale)} Z" fill="${IRON}"/>
</g>`;
}

/**
 * RIP for the small mark, as strokes (not text), so it is the same on every machine. Drawn on the 16 px pixel grid (4 units a pixel):
 * one-pixel strokes centred in pixel columns and rows, square corners, and a clear pixel between letters, so it stays legible at
 * 16 px (revised: the first, rounded letters ran together there). Letters 5 px tall, from y 24 to 44.
 */
const MARK_RIP = [
  'M14 24 V44', 'M12 26 H22 V34 H14', 'M18 36 L22 44', // R: stem, bowl, leg
  'M30 24 V44', // I
  'M38 24 V44', 'M36 26 H46 V34 H38', // P: stem, bowl
];

/** The small mark, on a 64 × 64 grid: the stone filling the icon, RIP, the shovel at its right side, a strip of earth. */
function markSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-labelledby="t">
<title id="t">Repo In Peace</title>
<defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${STONE_LIGHT}"/><stop offset="1" stop-color="${STONE_DARK}"/></linearGradient></defs>
<path d="M6 59 V27 A24 24 0 0 1 54 27 V59 Z" fill="url(#s)" stroke="${STONE_EDGE}" stroke-width="2.5" stroke-linejoin="round"/>
<g fill="none" stroke="${CARVE}" stroke-width="4" stroke-linecap="butt" stroke-linejoin="miter">${MARK_RIP.map((d) => `<path d="${d}"/>`).join('')}</g>
<path d="M53 61 L60 20" stroke="${WOOD_DARK}" stroke-width="4" stroke-linecap="round"/>
<path d="M53 61 L60 20" stroke="${WOOD}" stroke-width="2.2" stroke-linecap="round"/>
<path d="M49 63 L50 52 L58 53.5 L57 63 Z" fill="${IRON}" stroke="#1d2128" stroke-width="1"/>
<path d="M2 63 Q30 56 50 63 Z" fill="${SOIL_TOP}"/>
</svg>
`;
}

function socialHtml(logo, fontBase64) {
  return `<!doctype html><html><head><style>
@font-face { font-family: 'Creepster'; src: url(data:font/woff2;base64,${fontBase64}) format('woff2'); }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { background: radial-gradient(circle at 78% 22%, #1c2540 0, transparent 38%), linear-gradient(#0B1020, #141B2E); color: #D9DEE8;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; display: flex; align-items: center; gap: 56px; padding: 0 90px; box-sizing: border-box; }
.logo { width: 300px; height: 375px; flex: none; }
.moon { position: absolute; left: 920px; top: 78px; width: 70px; height: 70px; border-radius: 50%; background: #dfe7f3; box-shadow: 0 0 60px 18px rgba(196,210,230,0.25); }
h1 { font-family: 'Creepster', fantasy; font-weight: 400; color: #7CFC9A; font-size: 104px; margin: 0 0 22px; letter-spacing: 2px; line-height: 1; }
p { font-size: 29px; line-height: 1.4; margin: 0; color: #D9DEE8; max-width: 680px; }
.star { position: absolute; width: 2px; height: 2px; background: #dbe6ff; border-radius: 50%; }
</style></head><body>
<div class="moon"></div>
${[[120, 60], [260, 120], [470, 40], [610, 96], [760, 30], [1060, 170], [1130, 60], [840, 200], [380, 190], [700, 160]].map(([x, y]) => `<div class="star" style="left:${x}px;top:${y}px"></div>`).join('')}
<div class="logo">${logo.replace('width="240" height="300"', 'width="300" height="375"')}</div>
<div><h1>Repo In Peace</h1><p>${esc(TAGLINE)}</p></div>
</body></html>`;
}

mkdirSync(OUT, { recursive: true });
const logo = logoSvg();
const mark = markSvg();
writeFileSync(`${OUT}logo.svg`, logo);
writeFileSync(`${OUT}mark.svg`, mark);

const browser = await chromium.launch();
const page = await browser.newPage();
const png = async (html, width, height, file) => {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}${file}`, omitBackground: true, clip: { x: 0, y: 0, width, height } });
};
const markAt = (size) => `<html><body style="margin:0">${mark.replace('width="64" height="64"', `width="${size}" height="${size}"`)}</body></html>`;
for (const [size, file] of [[16, 'favicon-16.png'], [32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [512, 'icon-512.png']]) await png(markAt(size), size, size, file);
await png(socialHtml(logo, readFileSync(FONT).toString('base64')), 1200, 630, 'social.png');
await browser.close();
console.log(`wrote ${OUT}: logo.svg, mark.svg, favicon-16.png, favicon-32.png, apple-touch-icon.png, icon-512.png, social.png`);
