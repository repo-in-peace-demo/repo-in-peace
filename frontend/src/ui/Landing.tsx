import { useMemo } from 'react';
import { WITCH_COLOUR, WITCH_HANDLE, WITCH_HINGES, WITCH_PARTS, WITCH_STRAWS, WITCH_VIEWBOX } from '../model/witch-drawing';

/** The tagline, word for word as in the social image (scripts/make-brand.mjs). */
export const TAGLINE =
  'Your codebase as a haunted 3D graveyard. Dead files crack, old ones grow moss, deleted ones haunt as ghosts. Bury or resurrect them with a real pull request.';
export const REPO_URL = 'https://github.com/sl2902/repo-in-peace';
export const ANALYSE_URL = `${REPO_URL}#analyse-your-own-repo`;

/** Fixed star positions (percent of the width, percent of the sky's height), and how bright each is: the same every visit. */
function starField(): Array<{ x: number; y: number; r: number; delay: number }> {
  let seed = 7;
  const next = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 46 }, () => ({ x: next() * 100, y: next() * 62, r: 0.6 + next() * 0.9, delay: next() * 9 }));
}

/** The moon's middle and radius, in the sky's viewBox units. */
const MOON = { x: 1240, y: 170, r: 44 };
/** The witch's drawing (model/witch-drawing.ts, 200 × 120) at half size over the moon: about 100 units wide, as before. */
const WITCH_SCALE = 0.5;
const WITCH_AT = { x: MOON.x + 6 - (WITCH_VIEWBOX.w * WITCH_SCALE) / 2, y: MOON.y + 4 - (WITCH_VIEWBOX.h * WITCH_SCALE) / 2 };

/**
 * The witch on her broom in front of the moon, drawn from the same shapes as the scene's witch (model/witch-drawing.ts). She stays
 * where she is: the whole figure bobs and tilts gently, and the bristles, cloak and hair flutter (index.css); still under reduced
 * motion. Decoration: hidden from screen readers with the rest of the sky.
 */
function Witch() {
  const part = (name: 'bristles' | 'cloak' | 'hair') => (
    <g className={`landing-witch-${name}`} style={{ transformOrigin: `${WITCH_HINGES[name].x}px ${WITCH_HINGES[name].y}px` }}>
      {WITCH_PARTS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );
  return (
    <g className="landing-witch" style={{ transformOrigin: `${MOON.x}px ${MOON.y}px` }}>
      <g transform={`translate(${WITCH_AT.x} ${WITCH_AT.y}) scale(${WITCH_SCALE})`} fill={WITCH_COLOUR}>
        {part('bristles')}
        {part('cloak')}
        {part('hair')}
        {WITCH_PARTS.body.map((d) => (
          <path key={d} d={d} />
        ))}
        <g fill="none" stroke={WITCH_COLOUR} strokeLinecap="round">
          <path d={WITCH_HANDLE.d} strokeWidth={WITCH_HANDLE.width} />
          {WITCH_STRAWS.map((d) => (
            <path key={d} d={d} strokeWidth={1.4} />
          ))}
        </g>
      </g>
    </g>
  );
}

/** Craters: centre (relative to the moon's), radius. Lit from the upper right, as the scene's moon is. */
const CRATERS: ReadonlyArray<[number, number, number]> = [
  [20, -19, 5.5],
  [-25, 11, 4.2],
  [6, -29, 3],
  [27, 18, 3.6],
  [-14, 28, 2.6],
  [-31, -8, 2.2],
];
/** The maria: irregular blotches (relative to the moon's middle), softened by a blur. */
const MARIA = [
  'M-30 -22 C-24 -32 -8 -30 -4 -22 C0 -14 -6 -6 -14 -4 C-22 -2 -30 -6 -32 -12 C-33 -16 -32 -19 -30 -22 Z',
  'M2 -6 C8 -12 20 -10 24 -2 C28 6 22 16 14 18 C6 20 -2 14 -2 6 C-2 1 -1 -3 2 -6 Z',
  'M-20 8 C-14 4 -6 8 -6 14 C-6 20 -12 24 -18 22 C-24 20 -26 12 -20 8 Z',
  'M-4 24 C2 20 12 22 12 28 C12 34 2 36 -4 32 C-7 30 -7 27 -4 24 Z',
];

/** An arc of a circle from angle a1 to a2 (degrees, 0 to the right, positive downward as SVG's y). */
function arc(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const p = (a: number) => `${(cx + r * Math.cos((a * Math.PI) / 180)).toFixed(2)} ${(cy + r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;
  return `M${p(a1)} A${r} ${r} 0 0 1 ${p(a2)}`;
}

/**
 * The moon: a sphere's shading (lit from the upper right, darker toward the limb), soft maria, fine grain, and craters each with a
 * darker crescent on the lower left and a faint lit rim on the upper right. All clipped to the disc; the glow stays as it was.
 */
function Moon() {
  const { x, y, r } = MOON;
  return (
    <g>
      <defs>
        <radialGradient id="landing-moon-shade" cx="0.62" cy="0.36" r="0.75">
          <stop offset="0" stopColor="#e9eef6" />
          <stop offset="0.6" stopColor="#d9e1ed" />
          <stop offset="1" stopColor="#aeb9cd" />
        </radialGradient>
        <clipPath id="landing-moon-disc">
          <circle cx={x} cy={y} r={r} />
        </clipPath>
        <filter id="landing-moon-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
        <filter id="landing-moon-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
          <feColorMatrix values="0 0 0 0 0.32  0 0 0 0 0.38  0 0 0 0 0.5  0.9 0 0 0 -0.42" />
        </filter>
        {CRATERS.map(([dx, dy, cr], i) => (
          <mask key={i} id={`landing-crater-${i}`} maskUnits="userSpaceOnUse">
            <circle cx={x + dx} cy={y + dy} r={cr} fill="#fff" />
            <circle cx={x + dx + cr * 0.38} cy={y + dy - cr * 0.38} r={cr * 0.92} fill="#000" />
          </mask>
        ))}
      </defs>
      <circle className="landing-moon" cx={x} cy={y} r={r} fill="url(#landing-moon-shade)" />
      <g clipPath="url(#landing-moon-disc)">
        <g fill="#93a5c2" opacity="0.38" filter="url(#landing-moon-soft)">
          {MARIA.map((d) => (
            <path key={d} d={d} transform={`translate(${x} ${y})`} />
          ))}
        </g>
        <rect x={x - r} y={y - r} width={2 * r} height={2 * r} filter="url(#landing-moon-grain)" opacity="0.5" />
        {CRATERS.map(([dx, dy, cr], i) => (
          <g key={i}>
            <circle cx={x + dx} cy={y + dy} r={cr} fill="#8798b6" opacity="0.18" />
            <circle cx={x + dx} cy={y + dy} r={cr} fill="#6f7f9c" opacity="0.55" mask={`url(#landing-crater-${i})`} />
            <path d={arc(x + dx, y + dy, cr, -110, 20)} fill="none" stroke="#f4f7fb" strokeWidth={Math.max(0.6, cr * 0.16)} opacity="0.6" strokeLinecap="round" />
          </g>
        ))}
      </g>
    </g>
  );
}

/**
 * The landing page at the bare address (landing page request): the full logo, the title in Creepster, one line, and the way in.
 * A static night drawn in SVG behind it (moon and glow, stars, the witch bobbing in front of the moon, a low line of trees and stones); no 3D, so it opens at once. The
 * stars twinkle very slowly, and not at all under reduced motion (index.css). "Take the tour" goes to the boot screen for now.
 */
export function Landing({ onEnter }: { onEnter: () => void }) {
  const stars = useMemo(starField, []);
  return (
    <main className="landing" aria-labelledby="landing-title">
      <svg className="landing-sky" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="landing-moon-glow">
            <stop offset="0" stopColor="#c4d2e6" stopOpacity="0.35" />
            <stop offset="1" stopColor="#c4d2e6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={MOON.x} cy={MOON.y} r="150" fill="url(#landing-moon-glow)" />
        <Moon />
        <g fill="#dbe6ff">
          {stars.map((s, i) => (
            <circle key={i} className="landing-star" cx={s.x * 16} cy={s.y * 9} r={s.r} style={{ animationDelay: `${s.delay}s` }} />
          ))}
        </g>
        <Witch />
        {/* Along the bottom: a dark line of pines and bare trees, with a few tombstones in front of it. */}
        <path
          fill="#070b16"
          d="M0 900 V790 L40 760 L60 700 L80 760 L120 770 L150 690 L180 765 L240 780 L270 720 L300 775 L380 785 L410 705 L440 780 L520 790 L560 735 L600 785 L700 792 L730 720 L760 788 L860 795 L900 740 L940 790 L1040 792 L1070 712 L1100 785 L1180 790 L1220 735 L1260 786 L1340 782 L1370 700 L1400 778 L1480 785 L1520 730 L1560 782 L1600 776 V900 Z"
        />
        <g fill="#0d1322">
          <path d="M210 900 V842 A26 26 0 0 1 262 842 V900 Z" />
          <path d="M330 900 V856 A18 18 0 0 1 366 856 V900 Z" />
          <path d="M1120 900 V838 A30 30 0 0 1 1180 838 V900 Z" />
          <path d="M1250 900 V860 A16 16 0 0 1 1282 860 V900 Z" />
          <path d="M760 900 V868 A14 14 0 0 1 788 868 V900 Z" />
        </g>
      </svg>

      <div className="landing-content">
        <img className="landing-logo" src={`${import.meta.env.BASE_URL}brand/logo.svg`} width={240} height={300}
          alt="Repo In Peace logo: a carved tombstone with a shovel leaning on it and a mound of earth at its foot" />
        <h1 id="landing-title" className="landing-title">Repo In Peace</h1>
        <p className="landing-tagline">{TAGLINE}</p>
        <div className="landing-actions">
          <button type="button" className="landing-primary" onClick={onEnter}>
            Enter the graveyard
          </button>
          {/* The guided tour is a later task: until then, Take the tour goes to the boot screen too. */}
          <button type="button" className="landing-secondary" onClick={onEnter}>
            Take the tour
          </button>
        </div>
        <p className="landing-desktop">Best on a desktop browser.</p>
      </div>

      <footer className="landing-footer">
        Built with Kiro for Kiroween 2026 · <a href={REPO_URL}>GitHub</a> · <a href={ANALYSE_URL}>Analyse your own repo</a>
      </footer>
    </main>
  );
}
