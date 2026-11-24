import { useMemo } from 'react';

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

/** The moon's middle and the witch's size, in the sky's viewBox units. */
const MOON = { x: 1240, y: 170 };
const WITCH_SCALE = 55;
/** A point of the witch's drawing (scene/Witch.tsx's shapes: x right, y up, about -1 to 1) in the sky's units, over the moon. */
const at = (x: number, y: number): [number, number] => [MOON.x + 6 + x * WITCH_SCALE, MOON.y + 4 - y * WITCH_SCALE];
const pts = (...ps: Array<[number, number]>): string => ps.map(([x, y]) => at(x, y).join(',')).join(' ');
const k = WITCH_SCALE;

/**
 * The witch on her broom in front of the moon, a dark silhouette drawn from the same shapes as the scene's witch (scene/Witch.tsx).
 * She stays where she is: the whole figure bobs and tilts gently, the bristles and the cloak flutter (index.css); still under reduced
 * motion. Decoration: hidden from screen readers with the rest of the sky.
 */
function Witch() {
  const [bx, by] = at(-0.6, -0.08); // the binding, where the bristles fan from
  const [sx, sy] = at(0.08, 0.27); // the shoulders, where the cloak hangs from
  const line = (x1: number, y1: number, x2: number, y2: number, r: number) => {
    const [a1, b1] = at(x1, y1);
    const [a2, b2] = at(x2, y2);
    return <line x1={a1} y1={b1} x2={a2} y2={b2} strokeWidth={2 * r * k} />;
  };
  const ellipse = (x: number, y: number, rx: number, ry: number) => {
    const [cx, cy] = at(x, y);
    return <ellipse cx={cx} cy={cy} rx={rx * k} ry={ry * k} />;
  };
  return (
    <g className="landing-witch" fill="#06080c" stroke="#06080c" strokeLinecap="round" opacity="0.96" style={{ transformOrigin: `${MOON.x}px ${MOON.y}px` }}>
      <g className="landing-witch-bristles" style={{ transformOrigin: `${bx}px ${by}px` }}>
        {Array.from({ length: 7 }, (_, i) => {
          const q = i / 6 - 0.5;
          return <g key={i}>{line(-0.6, -0.08 + q * 0.05, -0.98, -0.1 + q * 0.34, 0.018)}</g>;
        })}
      </g>
      <g className="landing-witch-cloak" stroke="none" style={{ transformOrigin: `${sx}px ${sy}px` }}>
        <polygon points={pts([0.08, 0.27], [-0.02, 0], [-0.5, 0.2])} />
        <polygon points={pts([-0.02, 0], [-0.38, 0], [-0.5, 0.2])} />
      </g>
      {line(-0.62, -0.08, 0.86, 0.06, 0.022)}
      <g stroke="none">
        {ellipse(-0.6, -0.08, 0.05, 0.075)}
        {ellipse(0.02, 0.1, 0.17, 0.16)}
        {ellipse(0.13, 0.33, 0.075, 0.08)}
        {ellipse(0.12, 0.4, 0.2, 0.03)}
        <polygon points={pts([0.02, 0.41], [0.23, 0.41], [-0.02, 0.72])} />
      </g>
      {line(-0.02, 0.71, -0.14, 0.76, 0.022)}
      {line(0.08, 0.18, 0.36, 0.03, 0.035)}
      {line(0, -0.02, 0.14, -0.2, 0.04)}
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
        <circle cx={MOON.x} cy={MOON.y} r="44" fill="#dbe3ef" />
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
